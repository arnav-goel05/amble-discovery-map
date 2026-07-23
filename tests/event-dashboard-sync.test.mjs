import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEventDashboardPayload,
  syncEventDashboard,
} from "../scripts/lib/event-pipeline/dashboard-sync.mjs";

test("dashboard payload derives source placement, dedup and exclusions", () => {
  const status = {
    runId: "run-1",
    finalizedAt: "2026-07-22T00:00:00Z",
    status: "success",
    window: { start: "2026-07-22", end: "2026-07-29" },
    sources: {
      "Catch.sg": {
        role: "authoritative",
        status: "success",
        counts: {
          sourceRecordsReceived: 2,
          processedSourceRecords: 2,
          occurrencesEmitted: 3,
          eligiblePreDedup: 2,
          excludedOccurrences: 1,
          fieldCompleteness: {
            title: {
              present: 2,
              not_published_by_source: 0,
              extraction_failed: 0,
            },
          },
        },
      },
    },
    venues: {
      venue: {
        eventIds: ["event-1"],
        resolve: { resolutionStatus: "approved" },
      },
    },
    deduplication: {
      counts: { acceptedPrimary: 1, crossSourceDuplicateCollapsed: 0 },
    },
  };
  const payload = buildEventDashboardPayload({
    status,
    events: [
      {
        id: "event-1",
        occurrenceId: "event-1",
        parentActivityId: "activity:one",
        parentListingId: "Catch.sg:one",
        title: "One",
        schedule: { kind: "exact", start: "2026-08-01" },
        sources: [
          { source: "Catch.sg", sourceUrl: "https://catch.sg/event/one" },
          { source: "Catch.sg", sourceUrl: "https://catch.sg/event/one" },
        ],
      },
    ],
    excluded: [
      {
        reasonCode: "expired",
        event: {
          sourceName: "Catch.sg",
          parentActivityId: "activity:rejected",
        },
      },
    ],
    dateReviews: [
      {
        sourceName: "Catch.sg",
        reasonCodes: ["far_future", "known_placeholder_year"],
      },
    ],
  });

  assert.equal(payload.sources[0].mapped, 1);
  assert.equal(payload.sources[0].dedup, 1);
  assert.equal(payload.sources[0].review, 1);
  assert.deepEqual(payload.sources[0].reasons, {
    expired: 1,
    far_future: 1,
    known_placeholder_year: 1,
  });
  assert.deepEqual(payload.sources[0].fields.title, [2, 0, 0]);
  assert.equal(payload.activityCount, 1);
  assert.equal(payload.occurrenceCount, 1);
  assert.equal(payload.sessionCount, 1);
  assert.equal(payload.venueGroupCount, 1);
  assert.equal(payload.sourceOfferCount, 1);
  assert.equal(payload.groupingReviewCount, 0);
  assert.equal(payload.uniqueActivities, payload.activityCount);
  assert.equal(payload.sources[0].activities, 1);
  assert.equal(payload.distinctFoundActivities, 2);
  assert.equal(payload.distinctRejectedActivities, 1);
  assert.equal(payload.sources[0].distinctFound, 2);
  assert.equal(payload.sources[0].distinctEligible, 1);
  assert.equal(payload.sources[0].distinctExcluded, 1);
  assert.equal(payload.sources[0].distinctMapped, 1);
  assert.equal(payload.sources[0].distinctReview, 0);
  assert.deepEqual(payload.sources[0].distinctReasons, { expired: 1 });
});

test("dashboard distinct counts ignore rejected sessions for an accepted activity", () => {
  const status = {
    runId: "run-2",
    finalizedAt: "2026-07-22T00:00:00Z",
    status: "success",
    sources: {
      "Catch.sg": {
        status: "success",
        counts: {
          sourceRecordsReceived: 1,
          processedSourceRecords: 1,
          occurrencesEmitted: 2,
          eligiblePreDedup: 1,
          excludedOccurrences: 1,
        },
      },
    },
  };
  const payload = buildEventDashboardPayload({
    status,
    events: [
      {
        id: "current-session",
        occurrenceId: "current-session",
        parentActivityId: "activity:recurring",
        parentListingId: "Catch.sg:recurring",
        sourceName: "Catch.sg",
        sources: [{ source: "Catch.sg" }],
      },
    ],
    excluded: [
      {
        reasonCode: "expired",
        event: {
          id: "expired-session",
          parentActivityId: "activity:recurring",
          sourceName: "Catch.sg",
        },
      },
    ],
  });

  assert.equal(payload.distinctFoundActivities, 1);
  assert.equal(payload.distinctRejectedActivities, 0);
  assert.equal(payload.sources[0].distinctFound, 1);
  assert.equal(payload.sources[0].distinctEligible, 1);
  assert.equal(payload.sources[0].distinctExcluded, 0);
  assert.deepEqual(payload.sources[0].distinctReasons, {});
});

test("dashboard synchronization is optional and reports HTTP failures", async () => {
  assert.deepEqual(await syncEventDashboard({}), {
    status: "skipped",
    reasonCode: "dashboard_sync_not_configured",
  });
  const result = await syncEventDashboard(
    { runId: "run-1" },
    {
      url: "https://dashboard.test/api/pipeline",
      token: "secret",
      fetchImpl: async (_url, options) => {
        assert.equal(options.method, "PUT");
        assert.equal(options.headers.accept, "application/json");
        assert.equal(options.headers.authorization, "Bearer secret");
        return { ok: false, status: 503 };
      },
    },
  );
  assert.deepEqual(result, {
    status: "failed",
    reasonCode: "dashboard_sync_http_error",
    httpStatus: 503,
  });
});
