import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PlanGameService } = require("../scripts/lib/plan-game-service.cjs");
const { planGameApiPlugin } = require("../scripts/plan-game-api-plugin.cjs");

test("game storage, service, and diagnostics contain no product telemetry surface", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "no-telemetry-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root });
  context.after(() => service.close());
  assert.equal(service.repository.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metric_events'").get(), undefined);
  assert.equal(typeof service.recordMetric, "undefined");
  assert.equal(typeof service.metricSummary, "undefined");
  assert.deepEqual(Object.keys(service.diagnostics()).sort(), ["pendingMessages", "storage"]);
});

test("readiness and operational logs expose health/queue state without private payloads", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "no-telemetry-api-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logs = [];
  const service = new PlanGameService({ root });
  const plugin = planGameApiPlugin({ service, telegramToken: "token", webhookSecret: "secret", logger: (entry) => logs.push(entry), fetchImpl: async () => { throw new Error("provider leaked SECRET_VALUE"); } });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.close(); service.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ready = await (await fetch(`${base}/health/ready`)).json();
  assert.deepEqual(Object.keys(ready).sort(), ["botConfigured", "deliveryConfigured", "gamesEnabled", "ok", "queueDepth", "storage"]);
  assert.equal(JSON.stringify(ready).includes("metrics"), false);
  const plan = service.createPlan({ stops: [{ id: "one", type: "event", title: "One", place: "One", latitude: 1.29, longitude: 103.85 }] });
  const game = service.createGame({ planId: plan.id });
  await fetch(`${base}/api/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "secret" }, body: JSON.stringify({ update_id: 10, message: { chat: { id: 4 }, text: `/start ${game.id}` } }) });
  assert.equal(JSON.stringify(logs).includes("SECRET_VALUE"), false);
  assert.equal(JSON.stringify(logs).includes(`/start ${game.id}`), false);
});
