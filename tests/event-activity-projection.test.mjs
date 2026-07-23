import test from "node:test";
import assert from "node:assert/strict";
import {
  projectEventActivities,
  validateActivityProjection,
} from "../scripts/lib/event-pipeline/activity-projection.mjs";

const occurrence = ({
  id,
  parent = "activity:show",
  listing = "SISTIC:show",
  source = "SISTIC",
  date = "2026-08-01",
  venue = "Victoria Theatre",
  url = "https://www.sistic.com.sg/events/show",
  title = "Example Show",
  sources,
  sourceParents,
} = {}) => ({
  id,
  occurrenceId: id,
  identityAnchor: id,
  parentActivityId: parent,
  parentListingId: listing,
  sourceParentActivities:
    sourceParents ?? [
      { source, parentActivityId: parent, parentListingId: listing },
    ],
  title,
  venue,
  schedule: {
    kind: "exact",
    start: date,
    end: date,
    displayText: date,
    finalKnownOccurrence: date,
  },
  sessions: [
    {
      sessionId: `source-session:${id}`,
      schedule: { kind: "exact", start: date, end: date },
      venueKey: venue,
    },
  ],
  sources:
    sources ?? [
      { source, sourceId: id, sourceUrl: url, recordRef: `raw/${id}` },
    ],
  lifecycleState: "active",
  publicPlacement: "mapped",
  mappingStatus: "approved",
});

test("groups sibling occurrences into one activity without losing sessions", () => {
  const result = projectEventActivities({
    runId: "run-1",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [
      occurrence({ id: "show-1", date: "2026-08-01" }),
      occurrence({ id: "show-2", date: "2026-08-02" }),
    ],
  });
  assert.equal(result.activities.records.length, 1);
  assert.equal(result.activities.records[0].sessions.length, 2);
  assert.deepEqual(result.activities.records[0].occurrenceIds, ["show-1", "show-2"]);
  assert.equal(result.activities.counts.occurrences, 2);
  assert.equal(result.activities.counts.activities, 1);
  assert.equal(result.reviews.records.length, 0);
  assert.equal(result.decisions.counts.create, 5);
  assert.equal(
    result.activities.records[0].groupingDecision.strategy,
    "source_parent_activity",
  );
  assert.doesNotThrow(() => validateActivityProjection(result.activities, result.reviews));
});

test("classifies no-op, update, expire, and review outcomes deterministically", () => {
  const baseline = projectEventActivities({
    runId: "run-before",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [occurrence({ id: "show-1" })],
  });
  const unchanged = projectEventActivities({
    runId: "run-after",
    generatedAt: "2026-07-23T00:00:00.000Z",
    events: [occurrence({ id: "show-1" })],
    previousActivities: baseline.activities.records,
  });
  assert.equal(unchanged.decisions.counts["no-op"], 4);

  const expired = projectEventActivities({
    runId: "run-expired",
    generatedAt: "2026-07-24T00:00:00.000Z",
    events: [],
    previousActivities: baseline.activities.records,
  });
  assert.equal(expired.decisions.counts.expire, 4);

  const conflicted = projectEventActivities({
    runId: "run-review",
    generatedAt: "2026-07-25T00:00:00.000Z",
    events: [
      occurrence({ id: "show-1", date: "2026-08-01" }),
      occurrence({ id: "show-1", date: "2026-08-02" }),
    ],
  });
  assert.equal(conflicted.decisions.counts.review, 1);
  assert.equal(
    conflicted.decisions.records.find(({ action }) => action === "review")
      .reasonCode,
    "contradictory_session_schedule",
  );
});

test("an accepted occurrence bridge links source parents but unrelated titles remain separate", () => {
  const bridgeParents = [
    { source: "SISTIC", parentActivityId: "activity:sistic-show", parentListingId: "SISTIC:show" },
    { source: "Fever Singapore", parentActivityId: "activity:fever-show", parentListingId: "Fever:show" },
  ];
  const result = projectEventActivities({
    runId: "run-2",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [
      occurrence({ id: "merged-1", parent: "activity:sistic-show", sourceParents: bridgeParents }),
      occurrence({ id: "fever-2", parent: "activity:fever-show", listing: "Fever:show", source: "Fever Singapore", date: "2026-08-02" }),
      occurrence({ id: "other", parent: "activity:other", title: "Example Show: Youth Edition" }),
    ],
  });
  assert.equal(result.activities.records.length, 2);
  assert.equal(result.activities.records.find((item) => item.occurrenceIds.includes("merged-1")).occurrenceIds.length, 2);
});

test("projection is input-order independent", () => {
  const events = [
    occurrence({ id: "show-2", date: "2026-08-02" }),
    occurrence({ id: "show-1", date: "2026-08-01" }),
  ];
  const first = projectEventActivities({ runId: "run", generatedAt: "2026-07-22T00:00:00.000Z", events });
  const second = projectEventActivities({ runId: "run", generatedAt: "2026-07-22T00:00:00.000Z", events: [...events].reverse() });
  assert.deepEqual(first, second);
});

test("direct contradictions isolate the affected occurrence in review", () => {
  const first = occurrence({ id: "same", date: "2026-08-01" });
  const conflict = occurrence({ id: "same", date: "2026-08-02" });
  const safe = occurrence({ id: "safe", date: "2026-08-03" });
  const result = projectEventActivities({ runId: "run", generatedAt: "2026-07-22T00:00:00.000Z", events: [first, conflict, safe] });
  assert.equal(result.reviews.records.length, 1);
  assert.equal(result.reviews.records[0].reasonCode, "contradictory_session_schedule");
  assert.deepEqual(result.activities.records[0].occurrenceIds, ["safe"]);
});

test("deduplicates safe offers and scopes partial coverage to sessions", () => {
  const result = projectEventActivities({
    runId: "run",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [
      occurrence({ id: "show-1", sources: [{ source: "SISTIC", sourceId: "1", sourceUrl: "https://www.sistic.com.sg/events/show?utm_source=x", recordRef: "raw/1" }] }),
      occurrence({ id: "show-2", date: "2026-08-02", url: "javascript:alert(1)" }),
    ],
  });
  const activity = result.activities.records[0];
  assert.equal(activity.sourceOffers.length, 1);
  assert.equal(activity.sourceOffers[0].url, "https://www.sistic.com.sg/events/show");
  assert.equal(activity.sourceOffers[0].scope, "sessions");
  assert.equal(activity.sourceOffers[0].sessionIds.length, 1);
});
