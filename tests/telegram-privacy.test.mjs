import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PlanGameService } = require("../scripts/lib/plan-game-service.cjs");

const stops = [
  { id: "one", type: "event", title: "One", place: "One", latitude: 1.29, longitude: 103.85 },
  { id: "two", type: "event", title: "Two", place: "Two", latitude: 1.291, longitude: 103.851 },
];

function fixture(context, stopCount = 1, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-privacy-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00Z");
  const service = new PlanGameService({ root, clock: () => new Date(now), ...options });
  context.after(() => service.close());
  const plan = service.createPlan({ title: "Privacy", stops: stops.slice(0, stopCount) });
  const game = service.createGame({ planId: plan.id, timerMinutes: options.timerMinutes });
  const chatId = 77;
  service.handleTelegramUpdate({ update_id: 1, message: { chat: { id: chatId }, text: `/start ${game.id}` } });
  return { service, game, chatId, setNow(value) { now = new Date(value); } };
}

function seedPhoto(service, game, chatId, missionIndex = 0, suffix = "a") {
  return service.repository.savePhotoSubmission({
    gameId: game.id, chatId, missionId: game.missions[missionIndex].id, fileUniqueId: `photo-${suffix}`,
    status: "needs_review", verifier: "fixture", result: { reason: "uncertain" }, deleteAfter: "2026-07-21T00:00:00Z",
  });
}

function assertTerminalCleanup(service, game, chatId) {
  assert.equal(service.repository.getActiveGameId(chatId), null);
  assert.equal(service.repository.db.prepare("SELECT count(*) count FROM photo_submissions WHERE game_id=? AND chat_id=?").get(game.id, String(chatId)).count, 0);
  assert.equal(service.repository.db.prepare("SELECT count(*) count FROM photo_fingerprints WHERE first_game_id=?").get(game.id).count, 0);
}

test("quit, timed-out, skipped-final, and revoked sessions clean verification data atomically", (context) => {
  for (const transition of ["quit", "timed_out", "skipped_final", "revoked"]) {
    const current = fixture(context, 1, transition === "timed_out" ? { timerMinutes: 15 } : {});
    seedPhoto(current.service, current.game, current.chatId, 0, transition);
    if (transition === "quit") current.service.handleTelegramUpdate({ update_id: 2, message: { chat: { id: current.chatId }, text: "/quit" } });
    if (transition === "timed_out") {
      current.setNow("2026-07-14T00:16:00Z");
      current.service.handleTelegramUpdate({ update_id: 2, message: { chat: { id: current.chatId }, text: "/status" } });
    }
    if (transition === "skipped_final") current.service.handleTelegramUpdate({ update_id: 2, message: { chat: { id: current.chatId }, text: "/skip" } });
    if (transition === "revoked") current.service.revokeGame(current.game.id);
    assertTerminalCleanup(current.service, current.game, current.chatId);
  }
});

test("individual mission completion retains verification while final and manually accepted completion clean it", (context) => {
  const { service, game, chatId } = fixture(context, 2, { photoVerifier: { verify: ({ message }) => ({ status: "accepted", reason: "fixture", verifier: "fixture", fileUniqueId: message.photo[0].file_unique_id }) } });
  service.handleTelegramUpdate({ update_id: 2, message: { chat: { id: chatId }, location: { latitude: 1.29, longitude: 103.85 } } });
  service.handleTelegramUpdate({ update_id: 3, message: { chat: { id: chatId }, photo: [{ file_unique_id: "accepted-first" }] } });
  assert.equal(service.repository.db.prepare("SELECT count(*) count FROM photo_submissions WHERE game_id=?").get(game.id).count, 1);
  assert.equal(service.repository.getActiveGameId(chatId), game.id);
  service.handleTelegramUpdate({ update_id: 4, message: { chat: { id: chatId }, location: { latitude: 1.291, longitude: 103.851 } } });
  service.handleTelegramUpdate({ update_id: 5, message: { chat: { id: chatId }, photo: [{ file_unique_id: "accepted-final" }] } });
  assertTerminalCleanup(service, game, chatId);

  const manual = fixture(context, 1);
  const submission = seedPhoto(manual.service, manual.game, manual.chatId, 0, "manual");
  manual.service.reviewPhotoSubmission(submission.id, { status: "accepted", reviewer: "admin", reason: "Verified" });
  assertTerminalCleanup(manual.service, manual.game, manual.chatId);
});

test("a rejected manual review stays non-terminal and cannot decide terminal or deleted work", (context) => {
  const current = fixture(context);
  const submission = seedPhoto(current.service, current.game, current.chatId, 0, "reject");
  current.service.reviewPhotoSubmission(submission.id, { status: "rejected", reviewer: "admin", reason: "Wrong place" });
  assert.equal(current.service.repository.getActiveGameId(current.chatId), current.game.id);
  assert.throws(() => current.service.reviewPhotoSubmission(submission.id, { status: "accepted", reviewer: "admin", reason: "Replay" }), /not awaiting review|deleted|terminal/);
});
