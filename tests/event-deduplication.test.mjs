import assert from "node:assert/strict";
import test from "node:test";

import { canonicalEventTitle, finalizeDeduplication, generateDedupCandidates } from "../scripts/lib/event-sources/deduplicate.mjs";

const event = (source, id, overrides = {}) => ({
  id: `${source}:${id}`, occurrenceId: `${source}:${id}`, identityAnchor: `${source}:${id}`,
  title: "Singapore Night Festival 2026", startDateTime: "2026-07-17T19:00:00+08:00", endDateTime: "2026-07-17T21:00:00+08:00",
  venueId: `${source}-venue`, venue: "National Gallery Singapore", sources: [{ source, sourceId: id, recordRef: `raw/${source}/${id}.json` }], provenanceRefs: [`raw/${source}/${id}.json`], supportingDiscoveryIds: [],
  ...overrides,
});
const approved = (poiId) => ({ resolutionStatus: "approved", poiId });

test("nine-source candidate generation preserves edition years and schedule conflicts", () => {
  const events = [event("Catch.sg", "one"), event("SISTIC", "two", { title: "Singapore Night Festival — 2026" }), event("Fever Singapore", "three", { title: "Singapore Night Festival 2027" }), event("Roots HAN", "four", { startDateTime: "2026-07-18T19:00:00+08:00", endDateTime: "2026-07-18T21:00:00+08:00" })];
  const candidates = generateDedupCandidates(events);
  assert.deepEqual(candidates.map(({ occurrenceIds }) => occurrenceIds), [["Catch.sg:one", "SISTIC:two"]]);
  assert.equal(canonicalEventTitle("Night—Festival!"), "night festival");
});

test("post-venue finalization merges only the same approved POI and keeps weak/different locations distinct", () => {
  const events = [event("Catch.sg", "one"), event("SISTIC", "two"), event("Fever Singapore", "three")];
  const candidates = generateDedupCandidates(events);
  const result = finalizeDeduplication({ events, candidates, resolutions: { "Catch.sg-venue": approved("poi-a"), "SISTIC-venue": approved("poi-a"), "Fever Singapore-venue": approved("poi-b") }, sourcePrecedence: { "Catch.sg": 10, SISTIC: 20, "Fever Singapore": 30 } });
  assert.equal(result.events.length, 2);
  assert.equal(result.counts.crossSourceDuplicateCollapsed, 1);
  assert.equal(result.events.find(({ identityAnchor }) => identityAnchor === "Catch.sg:one").sources.length, 2);
  assert.ok(result.decisions.some(({ decision }) => decision === "potential_duplicate_kept_distinct"));
});

test("sibling performances remain distinct even at one approved venue", () => {
  const events = [event("SISTIC", "matinee", { startDateTime: "2026-07-17T14:00:00+08:00", endDateTime: "2026-07-17T16:00:00+08:00" }), event("SISTIC", "evening")];
  assert.equal(generateDedupCandidates(events).length, 0);
  assert.equal(finalizeDeduplication({ events, resolutions: { "SISTIC-venue": approved("poi-a") } }).events.length, 2);
});

test("a broad cross-source listing cannot collapse multiple sibling performances", () => {
  const events = [
    event("Catch.sg", "day-one", {
      startDateTime: "2026-07-17T19:00:00+08:00",
      endDateTime: "2026-07-17T21:00:00+08:00",
    }),
    event("Catch.sg", "day-two", {
      startDateTime: "2026-07-18T19:00:00+08:00",
      endDateTime: "2026-07-18T21:00:00+08:00",
    }),
    event("SISTIC", "date-range", {
      startDateTime: "2026-07-17T00:00:00+08:00",
      endDateTime: "2026-07-18T23:59:59+08:00",
    }),
  ];
  const candidates = generateDedupCandidates(events);
  assert.equal(candidates.length, 2);

  const result = finalizeDeduplication({
    events,
    candidates,
    resolutions: {
      "Catch.sg-venue": approved("poi-a"),
      "SISTIC-venue": approved("poi-a"),
    },
  });

  assert.equal(result.events.length, 3);
  assert.equal(result.counts.crossSourceDuplicateCollapsed, 0);
  assert.equal(result.decisions.length, 2);
  assert.ok(result.decisions.every(({ decision, evidence }) =>
    decision === "potential_duplicate_kept_distinct" && evidence.reason === "ambiguous_sibling_mapping"));
});

test("prior cluster joins block while membership changes preserve the prior anchor", () => {
  const events = [event("SISTIC", "two"), event("Fever Singapore", "three")];
  const resolutions = { "SISTIC-venue": approved("poi-a"), "Fever Singapore-venue": approved("poi-a") };
  const joined = finalizeDeduplication({ events, resolutions, priorClusters: [{ identityAnchor: "old-a", memberIds: ["SISTIC:two"] }, { identityAnchor: "old-b", memberIds: ["Fever Singapore:three"] }] });
  assert.equal(joined.blockingReviews.length, 1);
  assert.equal(joined.events.length, 2);
  const preserved = finalizeDeduplication({ events, resolutions, priorClusters: [{ identityAnchor: "old-a", memberIds: ["SISTIC:two"] }] });
  assert.equal(preserved.events.length, 1);
  assert.equal(preserved.events[0].identityAnchor, "old-a");
});

test("discovery provenance never changes authoritative membership or anchor", () => {
  const base = event("Catch.sg", "one");
  const withDiscovery = { ...base, supportingDiscoveryIds: ["Honeycombers:item"] };
  const a = finalizeDeduplication({ events: [base] }).events[0];
  const b = finalizeDeduplication({ events: [withDiscovery] }).events[0];
  assert.equal(a.identityAnchor, b.identityAnchor);
  assert.equal(a.membershipHash, b.membershipHash);
  assert.deepEqual(b.sourceOccurrenceIds, ["Catch.sg:one"]);
});

test("same-source category and ticket repeats collapse while preserving child sessions", () => {
  const shared = { parentActivityId: "activity:festival", parentListingId: "Catch.sg:festival", sessions: [{ sessionId: "session:one" }], venueOccurrences: [{ venueOccurrenceId: "venue:one" }] };
  const events = [
    event("Catch.sg", "category-repeat", shared),
    event("Catch.sg", "ticket-repeat", { ...shared, title: "Singapore Night Festival — tickets", sessions: [{ sessionId: "session:two" }] }),
  ];
  const result = finalizeDeduplication({ events, resolutions: { "Catch.sg-venue": approved("poi-a") } });
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0].sessions.map(({ sessionId }) => sessionId).sort(), ["session:one", "session:two"]);
  assert.equal(result.events[0].venueOccurrences.length, 1);
});

test("direct and editorial records merge across all sources while retaining every contribution", () => {
  const direct = event("Catch.sg", "one", { evidenceLevel: "direct", sourceContributions: [{ sourceRecordId: "catch:one" }] });
  const editorial = event("Honeycombers", "guide", { evidenceLevel: "editorial_authoritative", supportingDiscoveryIds: ["honey:guide"], sourceContributions: [{ sourceRecordId: "honey:guide" }] });
  const result = finalizeDeduplication({ events: [direct, editorial], resolutions: { "Catch.sg-venue": approved("poi-a"), "Honeycombers-venue": approved("poi-a") }, sourcePrecedence: { "Catch.sg": 10, Honeycombers: 999 } });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].evidenceLevel, "direct_corroborated");
  assert.deepEqual(result.events[0].sourceContributions.map(({ sourceRecordId }) => sourceRecordId).sort(), ["catch:one", "honey:guide"]);
  assert.deepEqual(result.events[0].supportingDiscoveryIds, ["honey:guide"]);
});

test("same-title events at one time and building stay distinct when organizers conflict", () => {
  const events = [
    event("Catch.sg", "one", { organizer: "National Gallery Singapore" }),
    event("SISTIC", "two", { organizer: "Independent Arts Company" }),
  ];
  const result = finalizeDeduplication({ events, resolutions: { "Catch.sg-venue": approved("poi-a"), "SISTIC-venue": approved("poi-a") } });
  assert.equal(result.events.length, 2);
  assert.equal(generateDedupCandidates(events).length, 0);
});

test("anytime and off-map matches merge only with the same strong location state", () => {
  const anytime = { startDateTime: null, endDateTime: null, schedule: { kind: "anytime" }, publicPlacement: "off_map", mappingStatus: "not_required", offMapSubtype: "secret_tba", venue: "Location TBA" };
  const secret = finalizeDeduplication({ events: [event("Fever Singapore", "secret", anytime), event("Time Out Singapore", "secret", anytime)] });
  assert.equal(secret.events.length, 1);
  const multiple = event("Honeycombers", "multi", { ...anytime, offMapSubtype: "multiple_locations", venue: "Various venues" });
  assert.equal(finalizeDeduplication({ events: [event("Fever Singapore", "secret", anytime), multiple] }).events.length, 2);
});

test("generic titles, sibling sessions, distinct editions, and uncertain locations stay distinct", () => {
  assert.equal(generateDedupCandidates([event("Catch.sg", "generic", { title: "Workshop" }), event("SISTIC", "generic", { title: "Workshop" })]).length, 0);
  assert.equal(generateDedupCandidates([event("Catch.sg", "2026"), event("SISTIC", "2027", { title: "Singapore Night Festival 2027" })]).length, 0);
  const siblings = [event("Catch.sg", "matinee", { parentActivityId: "activity:show", startDateTime: "2026-07-17T14:00:00+08:00", endDateTime: "2026-07-17T16:00:00+08:00" }), event("Catch.sg", "evening", { parentActivityId: "activity:show" })];
  assert.equal(finalizeDeduplication({ events: siblings }).events.length, 2);
  assert.equal(finalizeDeduplication({ events: [event("Catch.sg", "one"), event("SISTIC", "two")], resolutions: {} }).events.length, 2);
});
