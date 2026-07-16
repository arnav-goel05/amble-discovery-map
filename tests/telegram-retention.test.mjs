import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PlanGameService } = require("../scripts/lib/plan-game-service.cjs");

test("abandoned session and verification data purge after seven inactive days but not before", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-retention-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00Z");
  let service = new PlanGameService({ root, clock: () => new Date(now) });
  const plan = service.createPlan({ title: "Retention", stops: [{ id: "one", type: "event", title: "One", place: "One", latitude: 1.29, longitude: 103.85 }] });
  const game = service.createGame({ planId: plan.id });
  service.handleTelegramUpdate({ update_id: 1, message: { chat: { id: 88 }, text: `/start ${game.id}` } });
  service.repository.savePhotoSubmission({ gameId: game.id, chatId: 88, missionId: "mission-1", fileUniqueId: "abandoned", status: "needs_review", verifier: "fixture", result: {}, deleteAfter: "2026-08-01T00:00:00Z" });
  service.close();
  service = new PlanGameService({ root, clock: () => new Date(now) });
  context.after(() => service.close());
  now = new Date("2026-07-20T23:59:59Z");
  assert.deepEqual(service.purgeAbandonedSessions(), { deletedSessions: 0 });
  assert.equal(service.repository.getActiveGameId(88), game.id);
  now = new Date("2026-07-21T00:00:01Z");
  assert.deepEqual(service.purgeAbandonedSessions(), { deletedSessions: 1 });
  assert.equal(service.repository.getActiveGameId(88), null);
  assert.ok(service.getGame(game.id), "immutable game snapshot remains available");
  assert.equal(service.repository.db.prepare("SELECT count(*) count FROM photo_submissions").get().count, 0);
});

test("raw Telegram content is minimized and settled delivery payloads have bounded retention", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-minimization-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00Z");
  const service = new PlanGameService({ root, clock: () => new Date(now) });
  context.after(() => service.close());
  const update = { update_id: 123, message: { chat: { id: 999 }, text: "private secret text", location: { latitude: 1.2, longitude: 103.8 }, photo: [{ file_id: "raw-file-secret", file_unique_id: "unique" }] } };
  service.recordTelegramUpdate(update, "delivered");
  service.saveTelegramDelivery(123, [{ chatId: 999, text: "reply" }], true);
  service.enqueueTelegramActions(123, [{ chatId: 999, text: "reply" }]);
  const stored = service.repository.db.prepare("SELECT payload FROM telegram_updates WHERE update_id=123").get().payload;
  assert.doesNotMatch(stored, /private secret text|raw-file-secret|latitude|longitude/);
  now = new Date("2026-07-14T23:59:00Z");
  assert.deepEqual(service.purgeSettledTelegramRecords(), { deliveries: 0, outbound: 0, updates: 0 });
  now = new Date("2026-07-15T00:01:00Z");
  const purged = service.purgeSettledTelegramRecords();
  assert.ok(purged.deliveries >= 1);
  assert.ok(purged.updates >= 1);
});
