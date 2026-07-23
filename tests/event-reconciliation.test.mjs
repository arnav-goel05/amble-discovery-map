import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileActivityIdentity,
  reconcilePublishedLandmarks,
  reconcileSourceAvailability,
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
    sources: [{ source: "Time Out Singapore", sourceId: "guide" }],
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
      { source: "Time Out Singapore", sourceId: "guide" },
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

test("retired-only events are archived with traceable source evidence", () => {
  const result = reconcileSourceAvailability({
    previousEvents: [
      {
        id: "retired:event",
        sources: [{ source: "Retired Guide", sourceId: "guide" }],
        sourceContributions: [
          {
            sourceName: "Retired Guide",
            sourceRecordId: "retired:guide",
          },
        ],
      },
    ],
    currentEvents: [],
    sourceStatuses: { "Catch.sg": "success" },
    asOf: "2026-07-23T00:00:00+08:00",
  });

  assert.deepEqual(result.events, []);
  assert.equal(result.counts.retired, 1);
  assert.deepEqual(result.traces, [
    {
      eventId: "retired:event",
      outcome: "archived",
      reasonCode: "source_retired",
      sourceNames: ["Retired Guide"],
      sourceRecordIds: ["retired:guide"],
    },
  ]);
});

test("mixed events preserve supported identity and remove retired contributions", () => {
  const previous = {
    id: "published:shared",
    identityAnchor: "published:shared",
    parentActivityId: "activity:shared",
    sources: [
      { source: "Catch.sg", sourceId: "official" },
      { source: "Retired Guide", sourceId: "guide" },
    ],
    sourceContributions: [
      { sourceName: "Catch.sg", sourceRecordId: "Catch.sg:official" },
      { sourceName: "Retired Guide", sourceRecordId: "retired:guide" },
    ],
  };
  const incoming = {
    id: "Catch.sg:official:new",
    parentActivityId: "activity:shared",
    sources: [{ source: "Catch.sg", sourceId: "official" }],
    sourceContributions: [
      { sourceName: "Catch.sg", sourceRecordId: "Catch.sg:official" },
    ],
  };
  const result = reconcileSourceAvailability({
    previousEvents: [previous],
    currentEvents: [incoming],
    sourceStatuses: { "Catch.sg": "success" },
  });

  assert.equal(result.events[0].id, "published:shared");
  assert.deepEqual(result.events[0].sources, [
    { source: "Catch.sg", sourceId: "official" },
  ]);
  assert.deepEqual(result.events[0].sourceContributions, [
    { sourceName: "Catch.sg", sourceRecordId: "Catch.sg:official" },
  ]);
  assert.equal(result.counts.retired, 0);
});

test("landmark reconciliation removes retired copies and preserves supported placement", () => {
  const supported = {
    id: "supported",
    title: "Updated title",
    sources: [{ source: "Catch.sg", sourceId: "one" }],
  };
  const result = reconcilePublishedLandmarks({
    landmarks: [
      {
        id: "place",
        events: [
          {
            id: "retired",
            sources: [{ source: "Retired Guide", sourceId: "old" }],
          },
          {
            id: "supported",
            title: "Old title",
            coordinates: { lat: 1.3, lng: 103.8 },
            publicPlacement: "mapped",
            mappingStatus: "approved",
            lifecycleState: "active",
            sources: [{ source: "Catch.sg", sourceId: "one" }],
          },
        ],
      },
    ],
    events: [supported],
  });

  assert.deepEqual(result.removedEventIds, ["Retired Guide:old"]);
  assert.equal(result.records[0].events.length, 1);
  assert.equal(result.records[0].events[0].title, "Updated title");
  assert.equal(result.records[0].events[0].publicPlacement, "mapped");
  assert.deepEqual(result.records[0].events[0].coordinates, {
    lat: 1.3,
    lng: 103.8,
  });
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
