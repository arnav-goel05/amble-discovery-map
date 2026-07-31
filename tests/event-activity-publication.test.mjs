import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { hydrateInternalLandmarks } from "../scripts/event-frontend-snapshot.mjs";
import {
  ApiClientError,
  loadPublicSnapshot,
} from "../activity-scenes/shared/api-client.js";

const require = createRequire(import.meta.url);
const {
  projectPublicActivityCatalogue,
  projectPublicLandmarks,
  validatePublicActivityCatalogue,
} = require("../scripts/lib/public-event-catalogue.cjs");

function internalActivities() {
  return {
    schemaVersion: "1.0",
    runId: "run-fixture",
    generatedAt: "2026-07-23T00:00:00.000Z",
    records: [
      {
        activityId: "activity:one",
        title: "One activity",
        description: "Description",
        lifecycleState: "active",
        freshness: "current",
        occurrenceIds: ["source:one", "source:two"],
        groupingDecision: { strategy: "fixture" },
        evidenceRefs: ["private/evidence.json"],
        sessions: [
          {
            sessionId: "session:one",
            occurrenceIds: ["source:one"],
            sourceSessionIds: ["source-session"],
            schedule: {
              kind: "exact",
              start: "2026-07-24T11:00:00.000Z",
              end: "2026-07-24T12:00:00.000Z",
              displayText: "24 July",
            },
            availability: "available",
            venueGroupIds: ["venue-group:one"],
            evidenceRefs: ["private/session.json"],
          },
        ],
        venueGroups: [
          {
            venueGroupId: "venue-group:one",
            activityId: "activity:one",
            label: "Venue One",
            publicPlacement: "mapped",
            mappingStatus: "approved",
            approvedLocationId: "venue-one",
            coordinates: { lat: 1.3, lng: 103.8 },
            occurrenceIds: ["source:one"],
            sessionIds: ["session:one"],
          },
        ],
        sourceOffers: [
          {
            offerId: "offer:one",
            source: "Official",
            url: "https://example.com/event",
            scope: "activity",
            sessionIds: [],
            evidenceRefs: ["private/offer.json"],
          },
        ],
        scheduleSummary: {
          kind: "exact",
          label: "24 July",
          sessionCount: 1,
        },
      },
    ],
  };
}

test("projects one compact activity and strips internal occurrence evidence", () => {
  const projected = projectPublicActivityCatalogue(internalActivities(), {
    snapshotId: "snapshot-one",
  });
  assert.equal(projected.counts.activities, 1);
  assert.equal(projected.counts.sessions, 1);
  assert.equal(projected.records[0].sessions[0].sessionId, "session:one");
  const serialized = JSON.stringify(projected);
  for (const forbidden of [
    "occurrenceIds",
    "sourceSessionIds",
    "evidenceRefs",
    "groupingDecision",
  ])
    assert.equal(serialized.includes(forbidden), false);
});

test("landmarks reference canonical activities and mapped venue groups", () => {
  const activities = projectPublicActivityCatalogue(internalActivities());
  const landmarks = projectPublicLandmarks(
    [
      {
        id: "venue-one",
        label: "Venue One",
        anchor: { lat: 1.3, lng: 103.8 },
        events: [{ id: "source:one", activityId: "activity:one" }],
      },
    ],
    activities,
  );
  assert.equal("events" in landmarks[0], false);
  assert.deepEqual(landmarks[0].activityRefs, [
    {
      activityId: "activity:one",
      venueGroupIds: ["venue-group:one"],
    },
  ]);
});

test("rejects dangling landmark and session references", () => {
  const activities = projectPublicActivityCatalogue(internalActivities());
  assert.throws(
    () =>
      projectPublicLandmarks(
        [
          {
            id: "venue-one",
            events: [{ activityId: "activity:missing" }],
          },
        ],
        activities,
      ),
    /public_landmark_activity_missing/,
  );
  const invalid = structuredClone(activities);
  invalid.records[0].venueGroups[0].sessionIds = ["session:missing"];
  assert.throws(
    () => validatePublicActivityCatalogue(invalid),
    /public_activity_venue_session_invalid/,
  );
});

test("hydrates private occurrence records behind public landmark references", () => {
  const activity = internalActivities().records[0];
  const landmarks = hydrateInternalLandmarks(
    [
      {
        id: "venue-one",
        label: "Venue One",
        anchor: { lat: 1.3, lng: 103.8 },
        activityRefs: [
          {
            activityId: activity.activityId,
            venueGroupIds: ["venue-group:one"],
          },
        ],
      },
    ],
    {
      mapped: [
        {
          id: "source:one",
          occurrenceId: "source:one",
          parentActivityId: activity.activityId,
        },
        {
          id: "source:two",
          occurrenceId: "source:two",
          parentActivityId: activity.activityId,
        },
      ],
      offMap: [],
      activities: { records: [activity] },
    },
  );
  assert.deepEqual(
    landmarks[0].events.map(({ id }) => id),
    ["source:one"],
  );
  assert.equal(landmarks[0].events[0].approvedLocationId, "venue-one");
  assert.equal(landmarks[0].events[0].publicPlacement, "mapped");
});

test("browser rejects the removed occurrence contract without fallback", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        schemaVersion: "1.0",
        data: {
          eventsRef: "/legacy-events",
          landmarksRef: "/landmarks",
          poisRef: "/pois",
        },
        fetchedAt: "2026-07-23T00:00:00.000Z",
        stale: false,
        warning: null,
      };
    },
  });
  await assert.rejects(
    () => loadPublicSnapshot({ fetchImpl }),
    (error) =>
      error instanceof ApiClientError &&
      error.code === "activity_snapshot_contract_unsupported",
  );
});
