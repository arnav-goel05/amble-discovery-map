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

test("authoritative activity evidence classifies mobile occurrences before venue resolution", () => {
  const cyclingTour = buildActivityHierarchy({
    sourceName: "Fever Singapore",
    sourceRecordId: "/m/100539",
    title: "Historical Singapore Bike Tour Tickets",
    venue: "Let's Go Tour Singapore",
    schedule: { kind: "selectable" },
  });
  assert.deepEqual(
    [
      cyclingTour.venueOccurrences[0].publicPlacement,
      cyclingTour.venueOccurrences[0].mappingStatus,
      cyclingTour.venueOccurrences[0].offMapSubtype,
    ],
    ["off_map", "not_required", "mobile_route"],
  );

  const walkingTour = buildActivityHierarchy({
    sourceName: "Fixture",
    sourceRecordId: "walking",
    title: "Chinatown Walking Tour",
    venue: "Local Walking Tours",
    schedule: { kind: "selectable" },
  });
  assert.equal(walkingTour.venueOccurrences[0].offMapSubtype, "mobile_route");

  const multiStopSpeedboat = buildActivityHierarchy({
    sourceName: "SISTIC",
    sourceRecordId: "Speedboat",
    title: "Albatross Hop-On Hop-Off Speedboat Pass",
    venue: "Royal Albatross in Resorts World Sentosa",
    sourceCoordinates: { lat: 1.2569835, lng: 103.8202676 },
    description:
      "Unlimited rides between Sentosa, Lazarus, Kusu and Sisters' Islands. Boats operate on a continuous loop from either boarding point.",
  });
  assert.deepEqual(
    [
      multiStopSpeedboat.venueOccurrences[0].publicPlacement,
      multiStopSpeedboat.venueOccurrences[0].offMapSubtype,
    ],
    ["off_map", "mobile_route"],
  );
});

test("mobile inference preserves a usable fixed meeting point and remains occurrence-specific", () => {
  const fixedTour = buildActivityHierarchy({
    sourceName: "Fixture",
    sourceRecordId: "fixed-tour",
    title: "Backstage Walking Tour",
    venue: "Esplanade Concert Hall",
    address: "1 Esplanade Drive, Singapore 038981",
  });
  assert.deepEqual(
    [
      fixedTour.venueOccurrences[0].publicPlacement,
      fixedTour.venueOccurrences[0].mappingStatus,
      fixedTour.venueOccurrences[0].offMapSubtype,
    ],
    ["none", "pending_review", null],
    "a source-backed meeting building remains eligible for OneMap resolution",
  );

  const fixedCruiseMeetingPoint = buildActivityHierarchy({
    sourceName: "SISTIC",
    sourceRecordId: "dinner",
    title: "Dinner Cruise - Romance Under Sail",
    venue: "Royal Albatross in Resorts World Sentosa",
    address: "8 Sentosa Gateway, Singapore 098269",
    description:
      "The experience begins at Resorts World Sentosa before the ship sails into port waters.",
  });
  assert.deepEqual(
    [
      fixedCruiseMeetingPoint.venueOccurrences[0].publicPlacement,
      fixedCruiseMeetingPoint.venueOccurrences[0].offMapSubtype,
    ],
    ["none", null],
  );
});
