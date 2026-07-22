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
        sources: [{ source: "Catch.sg" }, { source: "Catch.sg" }],
      },
    ],
    excluded: [
      { reasonCode: "expired", event: { sourceName: "Catch.sg" } },
    ],
  });

  assert.equal(payload.sources[0].mapped, 1);
  assert.equal(payload.sources[0].dedup, 1);
  assert.deepEqual(payload.sources[0].reasons, { expired: 1 });
  assert.deepEqual(payload.sources[0].fields.title, [2, 0, 0]);
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
