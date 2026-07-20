import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileActivityIdentity,
  stableEventKey,
} from "../scripts/reconcile-event-content.mjs";
import { buildActivityHierarchy } from "../scripts/event-normalizer.mjs";

test("reconciliation prefers a persisted identity anchor over current source membership", () => {
  assert.equal(
    stableEventKey({
      identityAnchor: "persisted",
      sources: [{ source: "SISTIC", sourceId: "new" }],
      occurrenceId: "new",
    }),
    "persisted",
  );
});

test("prior anchors survive evidence, source membership, schedule, and location-state changes", () => {
  const current = {
    id: "published:one",
    identityAnchor: "published:one",
    publishedEventId: "published:one",
    parentActivityId: "activity:one",
    evidenceLevel: "editorial_authoritative",
    schedule: { kind: "anytime" },
    publicPlacement: "off_map",
    sources: [{ source: "Honeycombers", sourceId: "guide" }],
  };
  const incoming = {
    id: "catch:new",
    identityAnchor: "catch:new",
    publishedEventId: "catch:new",
    parentActivityId: "activity:one",
    evidenceLevel: "direct_corroborated",
    schedule: { kind: "exact", start: "2026-08-01T20:00:00+08:00" },
    publicPlacement: "mapped",
    mappingStatus: "approved",
    sources: [
      { source: "Catch.sg", sourceId: "new" },
      { source: "Honeycombers", sourceId: "guide" },
    ],
  };
  const result = reconcileActivityIdentity(current, incoming);
  assert.deepEqual(
    [
      result.id,
      result.occurrenceId,
      result.identityAnchor,
      result.publishedEventId,
    ],
    ["published:one", "published:one", "published:one", "published:one"],
  );
  assert.equal(result.evidenceLevel, "direct_corroborated");
  assert.equal(result.schedule.kind, "exact");
  assert.equal(result.publicPlacement, "mapped");
  assert.equal(result.sources.length, 2);
});

test("one stable parent preserves sibling sessions and splits only reliable venue-session pairs", () => {
  const reliable = buildActivityHierarchy({
    sourceName: "SFS",
    sourceRecordId: "film:1",
    title: "Island Film",
    schedule: { kind: "selectable" },
    sessions: [
      { sourceSessionId: "one", venueKey: "gv" },
      { sourceSessionId: "two", venueKey: "projector" },
    ],
    venues: [
      { venueKey: "gv", name: "GV Cineleisure" },
      { venueKey: "projector", name: "The Projector" },
    ],
  });
  assert.equal(reliable.sessions.length, 2);
  assert.equal(reliable.venueOccurrences.length, 2);
  assert.equal(
    new Set(reliable.sessions.map(({ sessionId }) => sessionId)).size,
    2,
  );
  assert.ok(
    reliable.venueOccurrences.every(
      ({ sessionIds }) => sessionIds.length === 1,
    ),
  );

  const unresolved = buildActivityHierarchy({
    sourceName: "Guide",
    sourceRecordId: "tour:1",
    title: "Pop-up Tour",
    schedule: { kind: "recurring" },
    venues: [{ name: "Various venues" }, { name: "Several studios" }],
  });
  assert.equal(unresolved.venueOccurrences.length, 1);
  assert.deepEqual(
    [
      unresolved.venueOccurrences[0].publicPlacement,
      unresolved.venueOccurrences[0].offMapSubtype,
    ],
    ["off_map", "multiple_locations"],
  );
});
