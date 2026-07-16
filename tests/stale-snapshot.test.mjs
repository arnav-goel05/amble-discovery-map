import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import { activateStagedSnapshot, stageImmutableSnapshot } from "../scripts/lib/approved-snapshot.mjs";

const require = createRequire(import.meta.url);
const { approvedSnapshotApiPlugin } = require("../scripts/approved-snapshot-api-plugin.cjs");

function publish(root, snapshotId, overrides = {}) {
  const staged = stageImmutableSnapshot({
    root,
    snapshot: {
      schemaVersion: "1.0", snapshotId, publishedAt: overrides.publishedAt || "2026-07-14T00:00:00.000Z",
      coveredWindow: { start: "2026-07-14", end: "2026-07-21", timezone: "Asia/Singapore" },
      freshness: "fresh", staleAfter: overrides.staleAfter || "2026-07-21T00:00:00.000Z",
      sourceHealth: overrides.sourceHealth || {}, previousSnapshotId: overrides.previousSnapshotId || null,
    },
    artifacts: { "landmarks.json": "[]\n", "pois.json": "[]\n", "tileset.json": "{}\n" },
    commitEligibility: { eligible: true },
  });
  return activateStagedSnapshot({ root, staged }).active;
}

async function serverFor(root, clock) {
  const plugin = approvedSnapshotApiPlugin({ root, now: clock });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("approved snapshot API crosses the stale boundary without changing the active pointer", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stale-snapshot-api-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-20T23:59:59.000Z");
  publish(root, "prior", { sourceHealth: { catch: { status: "failed", lastSuccessfulAt: "2026-07-14T00:00:00.000Z", error: "SECRET upstream detail", internalUrl: "/private/path" } } });
  const { server, base } = await serverFor(root, () => new Date(now));
  context.after(() => server.close());
  let response = await fetch(`${base}/api/snapshot`);
  let payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.snapshotId, "prior");
  assert.equal(payload.stale, false);
  assert.deepEqual(payload.data.sourceHealth, { catch: { status: "failed", lastSuccessfulAt: "2026-07-14T00:00:00.000Z" } });
  assert.doesNotMatch(JSON.stringify(payload), /SECRET|private\/path/);

  now = new Date("2026-07-21T00:00:01.000Z");
  response = await fetch(`${base}/api/snapshot`);
  payload = await response.json();
  assert.equal(payload.data.snapshotId, "prior");
  assert.equal(payload.stale, true);
  assert.equal(payload.data.freshness, "potentially_outdated");
  assert.match(payload.warning, /potentially outdated/i);
});

test("verified recovery atomically replaces stale data while no prior snapshot returns unavailable", async (context) => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "empty-snapshot-api-"));
  const recoveredRoot = fs.mkdtempSync(path.join(os.tmpdir(), "recovered-snapshot-api-"));
  context.after(() => { fs.rmSync(emptyRoot, { recursive: true, force: true }); fs.rmSync(recoveredRoot, { recursive: true, force: true }); });
  const empty = await serverFor(emptyRoot, () => new Date("2026-07-22T00:00:00Z"));
  context.after(() => empty.server.close());
  const unavailable = await fetch(`${empty.base}/api/snapshot`);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, "snapshot_pointer_missing");

  publish(recoveredRoot, "prior", { staleAfter: "2026-07-15T00:00:00.000Z" });
  let now = new Date("2026-07-22T00:00:00.000Z");
  const recovered = await serverFor(recoveredRoot, () => new Date(now));
  context.after(() => recovered.server.close());
  assert.equal((await (await fetch(`${recovered.base}/api/snapshot`)).json()).stale, true);
  publish(recoveredRoot, "recovered", { publishedAt: "2026-07-22T01:00:00.000Z", staleAfter: "2026-07-29T01:00:00.000Z", previousSnapshotId: "prior" });
  now = new Date("2026-07-22T02:00:00.000Z");
  const payload = await (await fetch(`${recovered.base}/api/snapshot`)).json();
  assert.equal(payload.data.snapshotId, "recovered");
  assert.equal(payload.stale, false);
});
