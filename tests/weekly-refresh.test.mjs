import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runWeeklyRefresh, validateWeeklyConfig } from "../scripts/run-weekly-refresh.mjs";

test("disabled weekly refresh skips all pipeline commands", () => {
  let invoked = false;
  const result = runWeeklyRefresh({
    config: { ...config, enabled: false },
    invoke: () => { invoked = true; throw new Error("must not run"); },
  });
  assert.equal(result.complete, true);
  assert.equal(result.status, "disabled");
  assert.equal(result.reasonCode, "weekly_refresh_disabled");
  assert.equal(result.events.status, "skipped");
  assert.equal(result.restaurants.status, "skipped");
  assert.equal(invoked, false);
});

const config = {
  schemaVersion: "1.0", timezone: "Asia/Singapore",
  event: { command: ["npm", "run", "event-pipeline", "--", "start"], maximumContinuations: 5 },
  restaurants: { command: ["npm", "run", "restaurant-pipeline", "--", "start"], maximumContinuationsPerCoverage: 2, coverage: [
    { id: "west", bbox: "1.2,103.7,1.3,103.8" }, { id: "east", bbox: "1.2,103.8,1.3,103.9" },
  ] },
};
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weekly-refresh-test-"));
const response = (payload, status = 0) => ({ status, stdout: JSON.stringify(payload), stderr: "" });

test("weekly refresh owns one lock and rejects an overlapping invocation", () => {
  const root = temp(); const output = path.join(root, "runtime"); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, ".lock"), "busy");
  const result = runWeeklyRefresh({ root, config, env: { WEEKLY_REFRESH_OUTPUT_ROOT: output } });
  assert.equal(result.status, "overlap_rejected");
  assert.equal(fs.readFileSync(path.join(output, ".lock"), "utf8"), "busy");
});

test("weekly refresh follows the exact event continuation before every configured restaurant coverage", () => {
  const root = temp(); const calls = []; let event = 0;
  const invoke = (call) => {
    calls.push(call);
    if (call.domain === "events") return event++ === 0
      ? response({ runId: "event-1", status: "pending", complete: false, next: { command: "npm run event-pipeline -- advance --run event-1" } }, 3)
      : response({ runId: "event-1", status: "success", complete: true });
    return response({ runId: `restaurant-${call.coverageId}`, status: "complete", complete: true });
  };
  const result = runWeeklyRefresh({ root, config, invoke, env: { WEEKLY_REFRESH_OUTPUT_ROOT: path.join(root, "runtime") } });
  assert.equal(result.complete, true);
  assert.deepEqual(calls.map(({ domain, coverageId }) => [domain, coverageId || null]), [["events", null], ["events", null], ["restaurants", "west"], ["restaurants", "east"]]);
  assert.deepEqual(calls[1].args, ["run", "event-pipeline", "--", "advance", "--run", "event-1"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "runtime/latest.json"), "utf8")).status, "success");
});

test("a completed partial event run is terminally stale and skips restaurant mutation", () => {
  const root = temp(); const calls = [];
  const result = runWeeklyRefresh({ root, config, env: { WEEKLY_REFRESH_OUTPUT_ROOT: path.join(root, "runtime") }, invoke: (call) => {
    calls.push(call); return response({ runId: "event-partial", status: "partial", complete: true });
  } });
  assert.equal(result.complete, true);
  assert.equal(result.status, "stale");
  assert.equal(result.events.publicationStatus, "stale");
  assert.equal(result.restaurants.status, "skipped");
  assert.equal(calls.length, 1);
});

test("an event release failure is distinct from a stale preserved snapshot", () => {
  const root = temp();
  const result = runWeeklyRefresh({ root, config, env: { WEEKLY_REFRESH_OUTPUT_ROOT: path.join(root, "runtime") }, invoke: () => response({ runId: "event-failed", status: "failed", complete: true }, 1) });
  assert.equal(result.complete, false);
  assert.equal(result.status, "release_failed");
  assert.equal(result.events.publicationStatus, "release_failed");
  assert.equal(result.restaurants.reasonCode, "event_release_failed");
});

test("restaurant continuation and partial coverage produce a versioned combined terminal report", () => {
  const root = temp(); let west = 0;
  const result = runWeeklyRefresh({ root, config, env: { WEEKLY_REFRESH_OUTPUT_ROOT: path.join(root, "runtime") }, invoke: (call) => {
    if (call.domain === "events") return response({ runId: "event-ok", status: "success", complete: true });
    if (call.coverageId === "west" && west++ === 0) return response({ runId: "west-1", status: "continuation_required", complete: false }, 3);
    if (call.coverageId === "west") return response({ runId: "west-1", status: "complete", complete: true });
    return response({ runId: "east-1", status: "failed", complete: false }, 1);
  } });
  assert.equal(result.status, "partial");
  assert.equal(result.restaurants.coverage.length, 2);
  assert.equal(result.restaurants.coverage[0].attempts.length, 2);
  assert.ok(fs.existsSync(path.join(root, "runtime/runs", result.runId, "status.json")));
  assert.equal(fs.existsSync(path.join(root, "runtime/.lock")), false);
});

test("checked-in coverage remains bounded and non-overlapping by identity", () => {
  const checkedIn = JSON.parse(fs.readFileSync(new URL("../data/weekly-refresh-config.json", import.meta.url), "utf8"));
  assert.equal(validateWeeklyConfig(checkedIn), checkedIn);
  assert.equal(new Set(checkedIn.restaurants.coverage.map(({ id }) => id)).size, checkedIn.restaurants.coverage.length);
  assert.equal(checkedIn.restaurants.coverage.length, 15);
});
