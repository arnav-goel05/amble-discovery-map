import test from "node:test";
import assert from "node:assert/strict";

import { projectEventActivities } from "../scripts/lib/event-pipeline/activity-projection.mjs";
import { repairScheduleEvents } from "../scripts/lib/event-pipeline/schedule-semantics-repair.mjs";

function event({
  id,
  source,
  schedule,
  venue,
  approvedLocationId,
  publicPlacement,
  mappingStatus,
}) {
  return {
    id,
    occurrenceId: id,
    identityAnchor: id,
    parentActivityId: `activity:${source}`,
    parentListingId: `${source}:memory-palace`,
    title: "Memory Palace",
    venue,
    approvedLocationId,
    publicPlacement,
    mappingStatus,
    schedule,
    sessions: [{ sessionId: `source-session:${id}`, schedule }],
    sources: [
      {
        source,
        sourceId: id,
        sourceUrl: `https://example.test/${source}/${id}`,
      },
    ],
    venueOccurrences: [
      {
        approvedLocationId,
        publishedVenueName: venue,
        publicPlacement,
        mappingStatus,
      },
    ],
    lifecycleState: "active",
  };
}

test("saved-evidence repair expands enumerated dates and enriches approved coarse siblings", () => {
  const activityId = "activity:approved-memory-palace";
  const sistic = event({
    id: "SISTIC:memory-palace",
    source: "SISTIC",
    venue: "National Museum of Singapore",
    approvedLocationId: "national-museum",
    publicPlacement: "mapped",
    mappingStatus: "approved",
    schedule: {
      kind: "range",
      start: "Sun, 26 Jul 2026",
      end: "Sun, 02 Aug 2026",
      displayText: "26 Jul & 2 Aug 2026, Sun, 9am",
    },
  });
  const catchEvents = ["2026-07-26", "2026-08-02"].map((day) =>
    event({
      id: `Catch:${day}`,
      source: "Catch.sg",
      venue: "Offsite",
      approvedLocationId: null,
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      schedule: {
        kind: "selectable",
        start: day,
        end: day,
        displayText: day,
      },
    }),
  );
  const repaired = repairScheduleEvents({
    events: [sistic, ...catchEvents],
    previousActivities: [
      {
        activityId,
        occurrenceIds: [sistic.id, ...catchEvents.map(({ id }) => id)],
      },
    ],
  });
  assert.deepEqual(repaired.audit, {
    activitiesInspected: 1,
    enumeratedActivities: 1,
    occurrencesExpanded: 1,
    coarseOccurrencesEnriched: 2,
    concreteSchedulesExactified: 0,
    unsupportedBoundariesHeld: 0,
  });
  assert.equal(repaired.events.length, 4);
  assert.deepEqual(
    [...new Set(repaired.events.map(({ schedule }) => schedule.start))],
    ["2026-07-26T09:00:00+08:00", "2026-08-02T09:00:00+08:00"],
  );
  assert.equal(
    repaired.events.every(
      ({ schedule }) =>
        schedule.kind === "exact" &&
        schedule.evidenceReasonCode === "enumerated_dates_parsed",
    ),
    true,
  );

  const projection = projectEventActivities({
    runId: "schedule-repair-test",
    events: repaired.events,
  }).activities.records[0];
  assert.equal(projection.sessions.length, 2);
  assert.equal(
    projection.sessions.every(
      (session) =>
        session.occurrenceIds.length === 2 &&
        session.venueGroupIds.length === 1,
    ),
    true,
  );
  assert.equal(projection.venueGroups.length, 1);
  assert.equal(projection.venueGroups[0].approvedLocationId, "national-museum");
});

test("saved-evidence repair preserves unrelated identity while normalizing its boundaries", () => {
  const unrelated = event({
    id: "SISTIC:unrelated",
    source: "SISTIC",
    venue: "Victoria Theatre",
    approvedLocationId: "victoria-theatre",
    publicPlacement: "mapped",
    mappingStatus: "approved",
    schedule: {
      kind: "exact",
      start: "2026-08-08T20:00:00+08:00",
      end: null,
      displayText: "8 August 2026, 8pm",
    },
  });
  const repaired = repairScheduleEvents({
    events: [unrelated],
    previousActivities: [
      { activityId: "activity:unrelated", occurrenceIds: [unrelated.id] },
    ],
  });
  assert.equal(repaired.events.length, 1);
  assert.equal(repaired.events[0].id, unrelated.id);
  assert.equal(repaired.events[0].title, unrelated.title);
  assert.equal(repaired.events[0].venue, unrelated.venue);
  assert.equal(repaired.events[0].schedule.kind, "exact");
  assert.equal(
    repaired.events[0].schedule.start,
    "2026-08-08T20:00:00+08:00",
  );
  assert.equal(
    repaired.events[0].schedule.end,
    "2026-08-08T20:00:00+08:00",
  );
  assert.equal(repaired.audit.enumeratedActivities, 0);
});
