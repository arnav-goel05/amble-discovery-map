import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { hashAdminPassword } = require("./lib/admin-auth-service.cjs");
const root = path.resolve(import.meta.dirname, "..");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "whats-here-baseline-smoke-"));
const weekly = path.join(runtime, "weekly");
const weeklyRun = "smoke-weekly";
const port = 44000 + Math.floor(Math.random() * 8000);
const origin = `http://127.0.0.1:${port}`;
const adminPassword = `smoke-${process.pid}`;
fs.mkdirSync(path.join(weekly, "runs", weeklyRun), { recursive: true });
fs.writeFileSync(path.join(weekly, "runs", weeklyRun, "status.json"), JSON.stringify({
  schemaVersion: "1.0", runId: weeklyRun, startedAt: "2026-07-14T00:00:00.000Z", completedAt: "2026-07-14T00:10:00.000Z",
  complete: true, status: "success", events: { complete: true, status: "success" },
  restaurants: { status: "success", coverage: [{ id: "smoke", complete: true }] },
}));
fs.writeFileSync(path.join(weekly, "latest.json"), JSON.stringify({ schemaVersion: "1.0", runId: weeklyRun, statusRef: `runs/${weeklyRun}/status.json` }));

const child = spawn(process.execPath, ["scripts/serve-app.cjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    PLAN_STORE_ROOT: path.join(runtime, "plans"),
    ADMIN_DATABASE_PATH: path.join(runtime, "admin.sqlite"),
    ADMIN_PASSWORD_HASH: hashAdminPassword(adminPassword),
    ADMIN_SESSION_SECRET: `session-${process.pid}`,
    WEEKLY_REFRESH_OUTPUT_ROOT: weekly,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let diagnostics = "";
child.stdout.on("data", (chunk) => { diagnostics += chunk; });
child.stderr.on("data", (chunk) => { diagnostics += chunk; });

const waitForServer = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode != null) throw new Error(`server exited early:\n${diagnostics}`);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not become ready:\n${diagnostics}`);
};
const stop = async () => {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
};

try {
  await waitForServer();
  const snapshot = await (await fetch(`${origin}/api/snapshot`)).json();
  assert.equal(snapshot.schemaVersion, "1.0");
  assert.ok(snapshot.data.snapshotId);
  assert.equal(typeof snapshot.stale, "boolean");

  const denied = await fetch(`${origin}/api/admin/venue-reviews`);
  assert.equal(denied.status, 401);
  const login = await fetch(`${origin}/api/admin/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: adminPassword }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/i);
  const loginBody = await login.json();
  assert.ok(loginBody.data.csrfToken);

  const restaurant = await fetch(`${origin}/api/restaurants?bbox=invalid`);
  assert.equal(restaurant.status, 400);
  assert.equal((await restaurant.json()).schemaVersion, "1.0");

  const planResponse = await fetch(`${origin}/api/plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    title: "Baseline smoke", travelMode: "walking",
    stops: [{ id: "smoke-event", type: "event", title: "Smoke event", place: "Esplanade", latitude: 1.2897, longitude: 103.8559 }],
  }) });
  assert.equal(planResponse.status, 201);
  const plan = await planResponse.json();
  assert.ok(plan.id);
  assert.equal((await fetch(`${origin}/api/plans/${plan.id}`)).status, 200);

  const weeklyStatus = await (await fetch(`${origin}/api/weekly-refresh/status`)).json();
  assert.equal(weeklyStatus.data.complete, true);
  assert.equal(weeklyStatus.data.events.status, "success");
  assert.equal(weeklyStatus.data.restaurants.coverageComplete, 1);
  console.log(JSON.stringify({ complete: true, admin: "authenticated", plan: "persisted", restaurant: "contract_verified", snapshot: snapshot.data.snapshotId, weekly: weeklyStatus.data.runId }, null, 2));
} finally {
  await stop();
  fs.rmSync(runtime, { recursive: true, force: true });
}
