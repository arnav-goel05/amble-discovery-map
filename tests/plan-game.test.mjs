import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PlanGameService, distanceMeters, normalizePlan } = require("../scripts/lib/plan-game-service.cjs");
const { verifyLocationEvidence } = require("../scripts/lib/game-verification.cjs");
const { planGameApiPlugin, sameSecret } = require("../scripts/plan-game-api-plugin.cjs");

const stops = [
  { id: "event-1", type: "event", title: "Jazz by the Bay", place: "Esplanade", latitude: 1.2897, longitude: 103.8559, detail: "14 Jul · 8pm" },
  { id: "food-1", type: "restaurant", title: "Example Kitchen", place: "3 Example Road", latitude: 1.285, longitude: 103.858 },
];

test("plan validation preserves ordered event and food stops and rejects unsafe input", () => {
  const plan = normalizePlan({ title: "  Marina day  ", travelMode: "walking", stops });
  assert.equal(plan.title, "Marina day");
  assert.deepEqual(plan.stops.map(({ type }) => type), ["event", "restaurant"]);
  assert.throws(() => normalizePlan({ stops: [] }), /1 to 20/);
  assert.throws(() => normalizePlan({ stops: [{ ...stops[0], latitude: 100 }] }), /coordinates/);
  assert.equal(normalizePlan({ title: "x", travelMode: "teleporting", stops }).travelMode, "walking");
});

test("Google Maps route links keep order and split long mobile-safe routes", async () => {
  const { googleMapsRouteUrls } = await import("../activity-scenes/plan-routes.js");
  const many = Array.from({ length: 10 }, (_, index) => ({ latitude: 1.28 + index / 1000, longitude: 103.85 + index / 1000 }));
  const urls = googleMapsRouteUrls(many, "walking");
  assert.equal(urls.length, 3);
  const first = new URL(urls[0]);
  assert.equal(first.origin + first.pathname, "https://www.google.com/maps/dir/");
  assert.equal(first.searchParams.get("api"), "1");
  assert.equal(first.searchParams.get("travelmode"), "walking");
  assert.equal(first.searchParams.has("origin"), false);
  assert.equal(first.searchParams.get("waypoints").split("|").length, 3);
  assert.equal(new URL(urls[1]).searchParams.get("origin"), first.searchParams.get("destination"));
  const transit = googleMapsRouteUrls(many.slice(0, 3), "transit");
  assert.equal(transit.length, 3);
  assert.equal(new URL(transit[0]).searchParams.has("origin"), false);
  assert.equal(new URL(transit[0]).searchParams.has("waypoints"), false);
});

test("game generation persists missions and Telegram progression requires proximity then photo", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-game-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root, botUsername: "WhatsHereTestBot" });
  const plan = service.createPlan({ title: "Marina day", travelMode: "walking", stops });
  const game = service.createGame({ planId: plan.id });
  assert.equal(game.missions.length, 2);
  assert.match(game.missions[0].prompt, /event sign/);
  assert.match(game.missions[1].prompt, /dish, menu detail/);
  assert.equal(game.telegramUrl, `https://t.me/WhatsHereTestBot?start=${game.id}`);
  assert.deepEqual(service.getPlan(plan.id).stops.map(({ id }) => id), ["event-1", "food-1"]);

  const chat = { id: 77 };
  const start = service.handleTelegramUpdate({ update_id: 1, message: { chat, text: `/start ${game.id}` } });
  assert.match(start[0].text, /Mission 1\/2/);
  assert.equal(start[0].requestLocation, true);
  const premature = service.handleTelegramUpdate({ update_id: 2, message: { chat, photo: [{ file_id: "x", file_unique_id: "unique-x" }] } });
  assert.match(premature[0].text, /location first/);
  const far = service.handleTelegramUpdate({ update_id: 3, message: { chat, location: { latitude: 1.35, longitude: 103.9 } } });
  assert.match(far[0].text, /away/);
  const near = service.handleTelegramUpdate({ update_id: 4, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } });
  assert.match(near[0].text, /Location confirmed/);
  const photo = service.handleTelegramUpdate({ update_id: 5, message: { chat, photo: [{ file_id: "photo", file_unique_id: "unique-photo" }] } });
  assert.match(photo[0].text, /Mission 2\/2/);
  assert.deepEqual(service.handleTelegramUpdate({ update_id: 5, message: { chat, photo: [{ file_id: "duplicate", file_unique_id: "unique-duplicate" }] } }), []);
  service.handleTelegramUpdate({ update_id: 6, message: { chat, location: { latitude: 1.285, longitude: 103.858 } } });
  const complete = service.handleTelegramUpdate({ update_id: 7, message: { chat, photo: [{ file_id: "last", file_unique_id: "unique-last" }] } });
  assert.match(complete[0].text, /Challenge complete/);
});

test("distance and webhook-secret checks enforce their boundaries", () => {
  assert.ok(distanceMeters({ latitude: 1.29, longitude: 103.85 }, { latitude: 1.2901, longitude: 103.8501 }) < 20);
  assert.equal(sameSecret("secret-123", "secret-123"), true);
  assert.equal(sameSecret("secret-123", "secret-124"), false);
  assert.equal(sameSecret("", "secret-123"), false);
});

test("Telegram delivery outbox persists replies until delivery succeeds", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-delivery-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root });
  const actions = [{ chatId: 1, text: "Mission" }];
  service.saveTelegramDelivery(42, actions, false);
  assert.deepEqual(service.telegramDelivery(42).actions, actions);
  assert.equal(service.telegramDelivery(42).delivered, false);
  service.saveTelegramDelivery(42, actions, true);
  assert.equal(service.telegramDelivery(42).delivered, true);
});

test("authenticated webhook sends Telegram replies once and acknowledges duplicate updates", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-webhook-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root, botUsername: "TestBot" });
  const plan = service.createPlan({ title: "Webhook game", stops: [stops[0]] });
  const game = service.createGame({ planId: plan.id });
  const sends = [];
  const plugin = planGameApiPlugin({
    service, telegramToken: "token", webhookSecret: "secret",
    fetchImpl: async (url, options) => { sends.push({ url, payload: JSON.parse(options.body) }); return Response.json({ ok: true, result: {} }); },
  });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/telegram/webhook`;
  const update = { update_id: 7654, message: { chat: { id: 52 }, text: `/start ${game.id}` } };
  const send = () => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" }, body: JSON.stringify(update) });
  const concurrent = await Promise.all([send(), send()]);
  assert.deepEqual(concurrent.map((response) => response.status), [200, 200]);
  assert.equal(sends.length, 1);
  assert.match(sends[0].url, /api\.telegram\.org\/bottoken\/sendMessage/);
  assert.equal(sends[0].payload.reply_markup.keyboard[0][0].request_location, true);
  assert.ok((await Promise.all(concurrent.map((response) => response.json()))).some((payload) => payload.duplicate === true));
  assert.deepEqual(await (await send()).json(), { ok: true, duplicate: true });
  assert.equal(sends.length, 1);
});

test("failed Telegram sends replay the persisted reply without advancing twice", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-webhook-retry-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now) });
  const plan = service.createPlan({ title: "Retry game", stops: [stops[0]] });
  const game = service.createGame({ planId: plan.id });
  const sends = [];
  const plugin = planGameApiPlugin({
    service, telegramToken: "token", webhookSecret: "secret",
    fetchImpl: async (_url, options) => {
      sends.push(JSON.parse(options.body));
      return sends.length === 1 ? Response.json({ ok: false, description: "temporary failure" }, { status: 502 }) : Response.json({ ok: true, result: {} });
    },
  });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/telegram/webhook`;
  const update = { update_id: 8765, message: { chat: { id: 53 }, text: `/start ${game.id}` } };
  const send = () => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" }, body: JSON.stringify(update) });
  assert.equal((await send()).status, 502);
  assert.equal(service.telegramDelivery(update.update_id).delivered, false);
  assert.equal(service.telegramOutbox(update.update_id)[0].status, "retry");
  assert.equal(service.telegramOutbox(update.update_id)[0].attempts, 1);
  now = new Date("2026-07-14T00:00:02.000Z");
  assert.equal((await send()).status, 200);
  assert.equal(service.telegramDelivery(update.update_id).delivered, true);
  assert.equal(service.telegramOutbox(update.update_id)[0].status, "delivered");
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0], sends[1]);
  assert.equal(service.readSession(game.id, 53).missionIndex, 0);
});

test("durable worker retries a queued Telegram outage after restart-safe backoff", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-worker-retry-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now) });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Worker retry", stops: [stops[0]] }).id });
  let attempts = 0;
  const plugin = planGameApiPlugin({
    service, telegramToken: "token", webhookSecret: "secret", logger: () => {},
    fetchImpl: async () => { attempts += 1; return attempts === 1 ? Response.json({ ok: false }, { status: 502 }) : Response.json({ ok: true }); },
  });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/telegram/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" },
    body: JSON.stringify({ update_id: 8811, message: { chat: { id: 88 }, text: `/start ${game.id}` } }),
  });
  assert.equal(response.status, 502);
  now = new Date("2026-07-14T00:00:02.000Z");
  assert.deepEqual(await plugin.drainOutbox(), { processed: 1, delivered: 1 });
  assert.equal(service.telegramDelivery(8811).delivered, true);
});

test("two service instances claim one Telegram update and send only once", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-multi-instance-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = new PlanGameService({ root });
  const game = first.createGame({ planId: first.createPlan({ title: "Concurrent", stops: [stops[0]] }).id });
  const second = new PlanGameService({ root });
  context.after(() => { first.close(); second.close(); });
  const sends = [];
  const options = { telegramToken: "token", webhookSecret: "secret", logger: () => {}, fetchImpl: async (_url, request) => { sends.push(JSON.parse(request.body)); await new Promise((resolve) => setTimeout(resolve, 5)); return Response.json({ ok: true }); } };
  const plugins = [planGameApiPlugin({ ...options, service: first }), planGameApiPlugin({ ...options, service: second })];
  const servers = plugins.map((plugin) => http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); })));
  await Promise.all(servers.map((server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))));
  context.after(() => servers.forEach((server) => server.close()));
  const update = { update_id: 9911, message: { chat: { id: 99 }, text: `/start ${game.id}` } };
  const responses = await Promise.all(servers.map((server) => fetch(`http://127.0.0.1:${server.address().port}/api/telegram/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" }, body: JSON.stringify(update),
  })));
  assert.ok(responses.every((response) => [200, 202].includes(response.status)));
  assert.equal(sends.length, 1);
  assert.equal(first.readSession(game.id, 99).missionIndex, 0);
});

test("durable rate limits reject abusive Telegram update bursts", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-rate-limit-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root });
  context.after(() => service.close());
  const plugin = planGameApiPlugin({ service, telegramToken: "token", webhookSecret: "secret", telegramRateLimit: 1, fetchImpl: async () => Response.json({ ok: true }) });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/telegram/webhook`;
  const send = (update_id) => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" }, body: JSON.stringify({ update_id, message: { chat: { id: 404 }, text: "/help" } }) });
  assert.equal((await send(3001)).status, 200);
  const limited = await send(3002);
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /rate limit/i);
});

test("SQLite persistence restores active games and sessions after a process restart", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-game-restart-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = new PlanGameService({ root, botUsername: "TestBot" });
  const plan = first.createPlan({ title: "Restartable", travelMode: "walking", stops });
  const game = first.createGame({ planId: plan.id });
  first.handleTelegramUpdate({ update_id: 9001, message: { chat: { id: 55 }, text: `/start ${game.id}` } });
  assert.equal(first.diagnostics().storage, "sqlite");
  assert.equal(fs.existsSync(path.join(root, "game-state.sqlite")), true);
  first.close();

  const restarted = new PlanGameService({ root, botUsername: "TestBot" });
  context.after(() => restarted.close());
  const actions = restarted.handleTelegramUpdate({ update_id: 9002, message: { chat: { id: 55 }, text: "/status" } });
  assert.equal(actions.length, 1);
  assert.match(actions[0].text, /Mission 1\/2: Jazz by the Bay/);
  assert.equal(restarted.repository.counts().sessions, 1);
});

test("anonymous plans use sliding seven-day activity only after successful game creation", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-activity-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now) });
  context.after(() => service.close());
  const plan = service.createPlan({ title: "Activity", stops: [stops[0]] });
  assert.equal(plan.lastActivityAt, now.toISOString());
  assert.equal(plan.expiresAt, "2026-07-21T00:00:00.000Z");
  now = new Date("2026-07-16T00:00:00.000Z");
  assert.equal(service.getPlan(plan.id).lastActivityAt, "2026-07-14T00:00:00.000Z");
  const game = service.createGame({ planId: plan.id });
  const refreshed = service.getPlan(plan.id);
  assert.equal(refreshed.lastActivityAt, now.toISOString());
  assert.equal(refreshed.expiresAt, "2026-07-23T00:00:00.000Z");
  assert.deepEqual(game.missions.map(({ sourceId }) => sourceId), [stops[0].id]);
});

test("expired plans purge transactionally unless an active immutable game still references them", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-purge-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now) });
  context.after(() => service.close());
  const abandoned = service.createPlan({ title: "Abandoned", stops: [stops[0]] });
  const protectedPlan = service.createPlan({ title: "Protected", stops: [stops[1]] });
  const game = service.createGame({ planId: protectedPlan.id });
  now = new Date("2026-07-21T00:00:01.000Z");
  assert.equal(service.planAvailability(abandoned.id), "expired");
  assert.equal(service.purgeExpiredPlans().deletedPlanIds.includes(abandoned.id), true);
  assert.equal(service.getPlan(abandoned.id), null);
  assert.ok(service.getPlan(protectedPlan.id));
  assert.ok(service.getGame(game.id));
});

test("plan API returns 410 before maintenance deletion and 404 after bounded purge", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-expiry-api-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now) });
  const plan = service.createPlan({ title: "Expires", stops: [stops[0]] });
  const plugin = planGameApiPlugin({ service, telegramToken: "", webhookSecret: "test" });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.close(); service.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}/api/plans/${plan.id}`;
  now = new Date("2026-07-21T00:00:01.000Z");
  assert.equal((await fetch(endpoint)).status, 410);
  assert.deepEqual(await plugin.drainOutbox(), { processed: 0 });
  assert.equal((await fetch(endpoint)).status, 404);
});

test("legacy JSON plans, games, sessions, active pointers, and deliveries import non-destructively", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-game-legacy-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = { id: "plan_legacy123", schemaVersion: "1.0", title: "Legacy", travelMode: "walking", stops, createdAt: "2026-07-01T00:00:00.000Z" };
  const game = { id: "game_legacy123", schemaVersion: "1.0", planId: plan.id, title: "Legacy Challenge", missions: [{ id: "mission-1", order: 1, title: stops[0].title, place: stops[0].place, latitude: stops[0].latitude, longitude: stops[0].longitude, radiusMeters: 300, prompt: "Legacy prompt" }], createdAt: "2026-07-01T00:00:00.000Z" };
  const session = { gameId: game.id, chatId: "88", missionIndex: 0, phase: "location", completed: false, seenUpdateIds: [] };
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value)}\n`); };
  write(path.join(root, "plans", `${plan.id}.json`), plan);
  write(path.join(root, "games", `${game.id}.json`), game);
  write(path.join(root, "sessions", game.id, "88.json"), session);
  write(path.join(root, "sessions", "active", "88.json"), { gameId: game.id });
  write(path.join(root, "telegram-deliveries", "77.json"), { updateId: 77, actions: [{ chatId: 88, text: "Saved" }], delivered: true });

  const service = new PlanGameService({ root, botUsername: "TestBot" });
  context.after(() => service.close());
  assert.equal(service.getPlan(plan.id).title, "Legacy");
  assert.equal(service.getGame(game.id).title, "Legacy Challenge");
  assert.equal(service.telegramDelivery(77).delivered, true);
  assert.match(service.handleTelegramUpdate({ update_id: 78, message: { chat: { id: 88 }, text: "/status" } })[0].text, /Legacy prompt/);
  assert.equal(fs.existsSync(path.join(root, "plans", `${plan.id}.json`)), true);
});

test("Telegram lifecycle supports help, pause, resume, skip, status, quit, and saved re-entry", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-game-lifecycle-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root, botUsername: "TestBot" });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Lifecycle", stops }).id });
  const chat = { id: 101 };
  const help = service.handleTelegramUpdate({ update_id: 100, message: { chat, text: "/help" } })[0].text;
  assert.match(help, /\/pause/);
  assert.doesNotMatch(help, /\/hint/);
  service.handleTelegramUpdate({ update_id: 101, message: { chat, text: `/start ${game.id}` } });
  assert.match(service.handleTelegramUpdate({ update_id: 102, message: { chat, text: "/pause" } })[0].text, /paused/);
  assert.match(service.handleTelegramUpdate({ update_id: 103, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } })[0].text, /Use \/resume/);
  assert.match(service.handleTelegramUpdate({ update_id: 104, message: { chat, text: "/resume" } })[0].text, /Mission 1\/2/);
  assert.match(service.handleTelegramUpdate({ update_id: 105, message: { chat, text: "/skip" } })[0].text, /Mission 2\/2/);
  const status = service.handleTelegramUpdate({ update_id: 106, message: { chat, text: "/status" } })[0].text;
  assert.match(status, /Skipped: 1/);
  assert.doesNotMatch(status, /Hints:/);
  assert.match(service.handleTelegramUpdate({ update_id: 107, message: { chat, text: "/quit" } })[0].text, /progress remains saved/);
  assert.match(service.handleTelegramUpdate({ update_id: 108, message: { chat, text: "/status" } })[0].text, /Open a challenge link/);
  assert.match(service.handleTelegramUpdate({ update_id: 109, message: { chat, text: `/start ${game.id}` } })[0].text, /quit and cannot be resumed/);
});

test("multiple players progress through one game independently", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-multiple-players-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Group", stops }).id });
  service.handleTelegramUpdate({ update_id: 1101, message: { chat: { id: 1 }, text: `/start ${game.id}` } });
  service.handleTelegramUpdate({ update_id: 1102, message: { chat: { id: 2 }, text: `/start ${game.id}` } });
  service.handleTelegramUpdate({ update_id: 1103, message: { chat: { id: 1 }, text: "/skip" } });
  assert.equal(service.readSession(game.id, 1).missionIndex, 1);
  assert.equal(service.readSession(game.id, 2).missionIndex, 0);
});

test("themes, timers, map progress, bonuses, and replayable recaps survive in game snapshots", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-rich-gameplay-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T01:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now) });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Mystery", stops: [stops[0]] }).id, theme: "detective", timerMinutes: 60 });
  assert.equal(game.theme, "detective");
  assert.match(game.missions[0].prompt, /Case file/);
  assert.match(game.missions[0].mapsUrl, /google\.com\/maps\/dir/);
  const chat = { id: 303 };
  service.handleTelegramUpdate({ update_id: 300, message: { chat, text: `/start ${game.id}` } });
  assert.match(service.handleTelegramUpdate({ update_id: 301, message: { chat, text: "/route" } })[0].text, /Google|google/);
  service.handleTelegramUpdate({ update_id: 302, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } });
  now = new Date("2026-07-14T01:10:00.000Z");
  const completion = service.handleTelegramUpdate({ update_id: 303, message: { chat, photo: [{ file_id: "rich", file_unique_id: "rich-photo" }] } });
  assert.match(completion[0].text, /route recap/);
  assert.ok(service.readSession(game.id, chat.id).score > 90);
  assert.match(service.handleTelegramUpdate({ update_id: 304, message: { chat, text: `/start ${game.id}` } })[0].text, /Jazz by the Bay/);
});

test("expired and revoked games cannot start while immutable mission snapshots remain readable", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-game-expiry-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now), gameTtlMs: 1000 });
  context.after(() => service.close());
  const plan = service.createPlan({ title: "Immutable", stops });
  const expired = service.createGame({ planId: plan.id });
  assert.equal(expired.snapshotVersion, 1);
  assert.deepEqual(expired.missions.map(({ sourceId }) => sourceId), ["event-1", "food-1"]);
  now = new Date("2026-07-14T00:00:02.000Z");
  assert.match(service.handleTelegramUpdate({ update_id: 200, message: { chat: { id: 202 }, text: `/start ${expired.id}` } })[0].text, /expired/);
  now = new Date("2026-07-14T00:00:00.000Z");
  const revoked = service.createGame({ planId: plan.id });
  service.revokeGame(revoked.id);
  assert.match(service.handleTelegramUpdate({ update_id: 201, message: { chat: { id: 203 }, text: `/start ${revoked.id}` } })[0].text, /revoked/);
  assert.equal(service.getGame(revoked.id).missions[0].title, "Jazz by the Bay");
  service.revokePlan(plan.id);
  assert.throws(() => service.createGame({ planId: plan.id }), /plan was revoked/);
});

test("adaptive location verification handles freshness, accuracy, footprints, and consistent readings", () => {
  const now = new Date("2026-07-14T04:00:00.000Z");
  const mission = {
    id: "mission-1", latitude: 1.3, longitude: 103.8, radiusMeters: 80,
    verification: { radiusMeters: 80, maxAccuracyMeters: 100, maxAgeSeconds: 120, requireConsistentReadings: true },
  };
  assert.equal(verifyLocationEvidence({ mission, location: { latitude: 1.3, longitude: 103.8 }, messageDate: now.getTime() / 1000 - 121, now }).reason, "stale_location");
  assert.equal(verifyLocationEvidence({ mission, location: { latitude: 1.3, longitude: 103.8, horizontal_accuracy: 101 }, messageDate: now.getTime() / 1000, now }).reason, "low_accuracy");
  const first = verifyLocationEvidence({ mission, location: { latitude: 1.3, longitude: 103.8, horizontal_accuracy: 15 }, messageDate: now.getTime() / 1000, now });
  assert.equal(first.status, "pending");
  const second = verifyLocationEvidence({ mission, location: { latitude: 1.30001, longitude: 103.80001, horizontal_accuracy: 12 }, messageDate: now.getTime() / 1000, now, priorReadings: [first.reading] });
  assert.equal(second.status, "accepted");
  const footprintMission = { ...mission, verification: { ...mission.verification, requireConsistentReadings: false, buildingPolygon: [[103.81, 1.31], [103.82, 1.31], [103.82, 1.32], [103.81, 1.32]] } };
  assert.equal(verifyLocationEvidence({ mission: footprintMission, location: { latitude: 1.315, longitude: 103.815 }, now }).reason, "building_footprint");
});

test("photo verification rejects reused identities and preserves uncertain submissions for review", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-photo-verification-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Photo checks", stops }).id });
  const chat = { id: 505 };
  service.handleTelegramUpdate({ update_id: 500, message: { chat, text: `/start ${game.id}` } });
  service.handleTelegramUpdate({ update_id: 501, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } });
  const uncertain = service.handleTelegramUpdate({ update_id: 502, photoVerification: { status: "needs_review", reason: "low_confidence", verifier: "test-vision" }, message: { chat, photo: [{ file_id: "review", file_unique_id: "same-photo" }] } });
  assert.match(uncertain[0].text, /marked for review/);
  const duplicate = service.handleTelegramUpdate({ update_id: 503, photoVerification: { status: "accepted", verifier: "test-vision" }, message: { chat, photo: [{ file_id: "again", file_unique_id: "same-photo" }] } });
  assert.match(duplicate[0].text, /already used/);
  assert.equal(service.readSession(game.id, chat.id).missionIndex, 0);
  const submissionId = service.readSession(game.id, chat.id).history.at(-1).submissionId;
  const reviewed = service.reviewPhotoSubmission(submissionId, { status: "accepted", reviewer: "test-operator" });
  assert.match(reviewed.action.text, /Organizer review complete/);
  assert.equal(service.readSession(game.id, chat.id).missionIndex, 1);
  const replay = service.createGame({ planId: service.createPlan({ title: "Replay check", stops: [stops[0]] }).id });
  service.handleTelegramUpdate({ update_id: 504, message: { chat, text: `/start ${replay.id}` } });
  service.handleTelegramUpdate({ update_id: 505, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } });
  assert.match(service.handleTelegramUpdate({ update_id: 506, message: { chat, photo: [{ file_id: "cross-game", file_unique_id: "same-photo" }] } })[0].text, /already used/);
});

test("photo-verification records purge after the configured privacy window", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-photo-retention-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = new PlanGameService({ root, clock: () => new Date(now), photoRetentionMs: 1_000 });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Retention", stops }).id });
  const chat = { id: 515 };
  service.handleTelegramUpdate({ update_id: 510, message: { chat, text: `/start ${game.id}` } });
  service.handleTelegramUpdate({ update_id: 511, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } });
  service.handleTelegramUpdate({ update_id: 512, message: { chat, photo: [{ file_id: "retained", file_unique_id: "retained-photo" }] } });
  now = new Date("2026-07-14T00:00:02.000Z");
  assert.equal(service.purgeExpiredPhotoSubmissions(), 1);
});

test("legacy operator-secret photo review endpoint is removed", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-photo-review-api-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Review API", stops: [stops[0]] }).id });
  const chat = { id: 707 };
  service.handleTelegramUpdate({ update_id: 700, message: { chat, text: `/start ${game.id}` } });
  service.handleTelegramUpdate({ update_id: 701, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } });
  service.handleTelegramUpdate({ update_id: 702, photoVerification: { status: "needs_review", verifier: "test" }, message: { chat, photo: [{ file_id: "review", file_unique_id: "review-api" }] } });
  const submissionId = service.readSession(game.id, chat.id).history.at(-1).submissionId;
  const plugin = planGameApiPlugin({ service, telegramToken: "token" });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/admin/photo-reviews/${submissionId}`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Operator-Secret": "operator-secret" }, body: JSON.stringify({ status: "accepted", reviewer: "ops" }) });
  assert.equal(response.status, 404);
});

test("configured async vision verification is server-side and uncertainty does not advance the mission", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-vision-provider-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root });
  context.after(() => service.close());
  const game = service.createGame({ planId: service.createPlan({ title: "Vision", stops: [stops[0]] }).id });
  const chat = { id: 606 };
  service.handleTelegramUpdate({ update_id: 600, message: { chat, text: `/start ${game.id}` } });
  service.handleTelegramUpdate({ update_id: 601, message: { chat, location: { latitude: 1.2897, longitude: 103.8559 } } });
  const sent = [];
  const plugin = planGameApiPlugin({
    service, telegramToken: "token", webhookSecret: "secret",
    visionVerifier: { verify: async () => ({ status: "needs_review", reason: "uncertain_subject", confidence: 0.4, secretDebug: "must-not-persist" }) },
    fetchImpl: async (_url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ ok: true }); },
  });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/telegram/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" },
    body: JSON.stringify({ update_id: 602, message: { chat, photo: [{ file_id: "vision", file_unique_id: "vision-unique" }] } }),
  });
  assert.equal(response.status, 200);
  assert.match(sent[0].text, /marked for review/);
  assert.equal(service.readSession(game.id, chat.id).missionIndex, 0);
  assert.equal(JSON.stringify(service.telegramDelivery(602)).includes("must-not-persist"), false);
});

test("health, readiness, and structured diagnostics expose no secrets or product telemetry", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-health-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new PlanGameService({ root, botUsername: "HealthBot" });
  context.after(() => service.close());
  service.createGame({ planId: service.createPlan({ title: "Observed", stops: [stops[0]] }).id });
  const plugin = planGameApiPlugin({ service, telegramToken: "token", webhookSecret: "webhook-secret", logger: () => {} });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/health/live`)).status, 200);
  const ready = await fetch(`${origin}/health/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).storage, "sqlite");
  assert.equal((await fetch(`${origin}/api/admin/diagnostics`, { headers: { "X-Operator-Secret": "operator-secret" } })).status, 404);
});
