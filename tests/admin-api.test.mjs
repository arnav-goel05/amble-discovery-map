import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { adminApiPlugin } = require("../scripts/admin-api-plugin.cjs");
const { hashAdminPassword } = require("../scripts/lib/admin-auth-service.cjs");
const { PlanGameService } = require("../scripts/lib/plan-game-service.cjs");

async function fixture(context, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wh-admin-api-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plugin = adminApiPlugin({ databasePath: path.join(root, "admin.sqlite"), passwordHash: hashAdminPassword("test-password"), maxAttempts: 2, ...options });
  const server = http.createServer((request, response) => plugin.middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { plugin.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { plugin, base };
}

async function login(base, password = "test-password") {
  const response = await fetch(`${base}/api/admin/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  const payload = await response.json();
  return { response, payload, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("private admin authentication uses secure cookie, CSRF, logout, and generic throttling", async (context) => {
  const { base } = await fixture(context);
  const denied = await fetch(`${base}/api/admin/venue-reviews`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, "admin_auth_required");

  for (let index = 0; index < 2; index += 1) {
    const failed = await login(base, "wrong");
    assert.equal(failed.response.status, 401);
    assert.equal(failed.payload.error.message, "Unable to sign in");
  }
  const throttled = await login(base, "test-password");
  assert.equal(throttled.response.status, 429);
  assert.equal(throttled.payload.error.message, "Unable to sign in");
});

test("authenticated venue review API enforces stale hashes, candidates, CSRF, and idempotency", async (context) => {
  const { base, plugin } = await fixture(context);
  const evidenceHash = "f".repeat(64);
  const review = plugin.service.createVenueReview({
    venueId: "venue-api", evidenceHash, evidenceSnapshot: { venue: "National Library Building", addressCandidates: ["100 Victoria Street"] },
    candidates: [{ name: "National Library Building", gmlId: "SLA_BLDG2_123", gmlIds: ["SLA_BLDG2_123"], sourceTiles: [{ tilePath: "tiles/a.b3dm", batchIds: [1] }] }],
  });
  const session = await login(base);
  assert.equal(session.response.status, 200);
  const setCookie = session.response.headers.get("set-cookie");
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\/api\/admin/i);
  const headers = { cookie: session.cookie };
  const queue = await fetch(`${base}/api/admin/venue-reviews?status=pending`, { headers });
  assert.equal(queue.status, 200);
  assert.equal((await queue.json()).data.records[0].reviewId, review.reviewId);
  const detail = await fetch(`${base}/api/admin/venue-reviews/${review.reviewId}`, { headers });
  assert.equal((await detail.json()).data.evidenceSnapshot.addressCandidates[0], "100 Victoria Street");

  const noCsrf = await fetch(`${base}/api/admin/venue-reviews/${review.reviewId}/decision`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", evidenceHash, candidateGmlId: "SLA_BLDG2_123", reason: "Verified", idempotencyKey: "api-decision" }) });
  assert.equal(noCsrf.status, 403);
  const stale = await fetch(`${base}/api/admin/venue-reviews/${review.reviewId}/decision`, { method: "POST", headers: { ...headers, "content-type": "application/json", "x-csrf-token": session.payload.data.csrfToken }, body: JSON.stringify({ decision: "approve", evidenceHash: "0".repeat(64), candidateGmlId: "SLA_BLDG2_123", reason: "Verified", idempotencyKey: "api-stale" }) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "venue_review_stale");
  const decide = () => fetch(`${base}/api/admin/venue-reviews/${review.reviewId}/decision`, { method: "POST", headers: { ...headers, "content-type": "application/json", "x-csrf-token": session.payload.data.csrfToken, "idempotency-key": "api-decision" }, body: JSON.stringify({ decision: "approve", evidenceHash, candidateGmlId: "SLA_BLDG2_123", reason: "Official address agrees" }) });
  const approved = await decide();
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).data.pipelineReconciliationRequired, true);
  assert.equal((await decide()).status, 200);

  const logout = await fetch(`${base}/api/admin/session`, { method: "DELETE", headers: { ...headers, "x-csrf-token": session.payload.data.csrfToken } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await fetch(`${base}/api/admin/venue-reviews`, { headers })).status, 401);
});

test("admin errors use the common bounded public envelope", async (context) => {
  const { base } = await fixture(context);
  const malformed = await fetch(`${base}/api/admin/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  const payload = await malformed.json();
  assert.equal(payload.schemaVersion, "1.0");
  assert.match(payload.error.code, /^[a-z0-9_]+$/);
  assert.equal(Object.hasOwn(payload.error, "stack"), false);
});

test("plan and game revocation require the authenticated admin session and CSRF", async (context) => {
  const api = await fixture(context);
  const plan = api.plugin.gameService.createPlan({ stops: [{ id: "revoke", type: "event", title: "Revoke", place: "Place", latitude: 1.29, longitude: 103.85 }] });
  const game = api.plugin.gameService.createGame({ planId: plan.id });
  assert.equal((await fetch(`${api.base}/api/admin/games/${game.id}/revoke`, { method: "POST" })).status, 401);
  const session = await login(api.base);
  const headers = { cookie: session.cookie, "x-csrf-token": session.payload.data.csrfToken };
  assert.equal((await fetch(`${api.base}/api/admin/games/${game.id}/revoke`, { method: "POST", headers })).status, 200);
  assert.equal((await fetch(`${api.base}/api/admin/games/${game.id}/revoke`, { method: "POST", headers })).status, 200);
  assert.equal((await fetch(`${api.base}/api/admin/plans/${plan.id}/revoke`, { method: "POST", headers })).status, 200);
});

test("session-authenticated photo review is minimal, idempotent, and rejects terminal work", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wh-admin-photo-api-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gameService = new PlanGameService({ root: path.join(root, "plans") });
  context.after(() => gameService.close());
  const plan = gameService.createPlan({ stops: [{ id: "one", type: "event", title: "One", place: "One", latitude: 1.29, longitude: 103.85 }] });
  const game = gameService.createGame({ planId: plan.id });
  gameService.handleTelegramUpdate({ update_id: 1, message: { chat: { id: 55 }, text: `/start ${game.id}` } });
  const submission = gameService.repository.savePhotoSubmission({ gameId: game.id, chatId: 55, missionId: "mission-1", fileUniqueId: "private-file-id", status: "needs_review", verifier: "fixture", result: { reason: "uncertain", raw: "must-not-return" }, deleteAfter: "2026-07-21T00:00:00Z" });
  const api = await fixture(context, { gameService });
  const session = await login(api.base);
  const headers = { cookie: session.cookie };
  const queue = await fetch(`${api.base}/api/admin/photo-reviews?status=needs_review`, { headers });
  assert.equal(queue.status, 200);
  const record = (await queue.json()).data.records[0];
  assert.equal(record.id, submission.id);
  assert.equal(JSON.stringify(record).includes("private-file-id"), false);
  assert.equal(JSON.stringify(record).includes("must-not-return"), false);
  const decide = () => fetch(`${api.base}/api/admin/photo-reviews/${submission.id}`, { method: "POST", headers: { ...headers, "content-type": "application/json", "x-csrf-token": session.payload.data.csrfToken, "idempotency-key": "photo-decision-1" }, body: JSON.stringify({ decision: "rejected", reason: "The subject does not match" }) });
  assert.equal((await decide()).status, 200);
  assert.equal((await decide()).status, 200);

  const terminalSubmission = gameService.repository.savePhotoSubmission({ gameId: game.id, chatId: 55, missionId: "mission-1", fileUniqueId: "terminal-file", status: "needs_review", verifier: "fixture", result: {}, deleteAfter: "2026-07-21T00:00:00Z" });
  gameService.revokeGame(game.id);
  const terminal = await fetch(`${api.base}/api/admin/photo-reviews/${terminalSubmission.id}`, { method: "POST", headers: { ...headers, "content-type": "application/json", "x-csrf-token": session.payload.data.csrfToken, "idempotency-key": "photo-decision-2" }, body: JSON.stringify({ decision: "accepted", reason: "Too late" }) });
  assert.equal(terminal.status, 409);
});
