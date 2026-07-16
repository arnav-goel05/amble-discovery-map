const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      game_id TEXT NOT NULL REFERENCES games(id),
      chat_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (game_id, chat_id)
    );
    CREATE TABLE IF NOT EXISTS active_sessions (
      chat_id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_deliveries (
      update_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL,
      processed_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS outbound_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      update_id INTEGER,
      sequence INTEGER NOT NULL DEFAULT 0,
      chat_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      UNIQUE(update_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS outbound_messages_due_idx ON outbound_messages(status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS metric_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dimensions TEXT NOT NULL DEFAULT '{}',
      value REAL NOT NULL DEFAULT 1,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS metric_events_name_time_idx ON metric_events(name, occurred_at);
    CREATE TABLE IF NOT EXISTS legacy_imports (
      source_path TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL,
      checksum_hint TEXT
    );
  `,
}, {
  version: 2,
  sql: `
    ALTER TABLE outbound_messages ADD COLUMN claimed_by TEXT;
    ALTER TABLE outbound_messages ADD COLUMN lease_until TEXT;
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_started_at TEXT NOT NULL,
      count INTEGER NOT NULL
    );
  `,
}, {
  version: 3,
  sql: `
    CREATE TABLE IF NOT EXISTS photo_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id),
      chat_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      file_unique_id TEXT NOT NULL,
      status TEXT NOT NULL,
      verifier TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delete_after TEXT,
      UNIQUE(game_id, file_unique_id)
    );
    CREATE INDEX IF NOT EXISTS photo_submissions_retention_idx ON photo_submissions(delete_after);
  `,
}, {
  version: 4,
  sql: `
    CREATE TABLE IF NOT EXISTS photo_fingerprints (
      file_unique_id TEXT PRIMARY KEY,
      first_game_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      delete_after TEXT
    );
    INSERT OR IGNORE INTO photo_fingerprints(file_unique_id,first_game_id,first_seen_at,delete_after)
      SELECT file_unique_id,game_id,MIN(created_at),MAX(delete_after) FROM photo_submissions GROUP BY file_unique_id;
    CREATE INDEX IF NOT EXISTS photo_fingerprints_retention_idx ON photo_fingerprints(delete_after);
  `,
}, {
  version: 5,
  sql: `
    ALTER TABLE plans ADD COLUMN last_activity_at TEXT;
    UPDATE plans SET last_activity_at=COALESCE(last_activity_at,created_at);
    CREATE INDEX IF NOT EXISTS plans_expiry_activity_idx ON plans(expires_at,last_activity_at);
    CREATE INDEX IF NOT EXISTS games_plan_lifecycle_idx ON games(plan_id,revoked_at,expires_at);
  `,
}, {
  version: 6,
  sql: `
    ALTER TABLE sessions ADD COLUMN abandon_after TEXT;
    UPDATE sessions SET abandon_after=datetime(updated_at,'+7 days');
    CREATE INDEX IF NOT EXISTS sessions_abandonment_idx ON sessions(abandon_after);
    CREATE INDEX IF NOT EXISTS telegram_deliveries_settled_idx ON telegram_deliveries(delivered,updated_at);
    CREATE INDEX IF NOT EXISTS telegram_updates_settled_idx ON telegram_updates(status,processed_at);
  `,
}, {
  version: 7,
  sql: `DROP TABLE IF EXISTS metric_events;`,
}, {
  version: 8,
  sql: `
    CREATE TABLE IF NOT EXISTS deleted_photo_reviews (
      submission_id INTEGER PRIMARY KEY,
      deleted_at TEXT NOT NULL,
      reason TEXT NOT NULL
    );
  `,
}];

function json(value) { return JSON.stringify(value); }
function parse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function files(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
}
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
const TERMINAL_SESSION_STATUSES = new Set(["completed", "timed_out", "quit", "revoked"]);
const SESSION_ABANDONMENT_MS = 7 * 24 * 60 * 60 * 1000;
const SETTLED_TELEGRAM_RETENTION_MS = 24 * 60 * 60 * 1000;
function minimalTelegramUpdate(update) {
  const message = update?.message ?? {};
  return {
    updateId: Number(update?.update_id),
    chatId: message?.chat?.id == null ? null : String(message.chat.id),
    kind: message.location ? "location" : Array.isArray(message.photo) && message.photo.length ? "photo" : message.text ? "text" : "other",
  };
}

class SqliteGameRepository {
  constructor({ root, databasePath, clock = () => new Date() } = {}) {
    this.root = root || path.join(process.cwd(), "outputs", "plans");
    this.databasePath = databasePath || path.join(this.root, "game-state.sqlite");
    this.clock = clock;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
    this.importLegacyJson();
  }

  now() { return this.clock().toISOString(); }

  migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set(this.db.prepare("SELECT version FROM schema_migrations").all().map(({ version }) => version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(migration.version, this.now());
      });
    }
  }

  transaction(work) {
    if (this.db.isTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createPlan(plan) {
    this.db.prepare("INSERT INTO plans(id, payload, created_at, expires_at, revoked_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(plan.id, json(plan), plan.createdAt, plan.expiresAt || null, plan.revokedAt || null, plan.lastActivityAt || plan.createdAt);
    return plan;
  }

  getPlan(id) {
    const row = this.db.prepare("SELECT payload,last_activity_at FROM plans WHERE id=?").get(id);
    const plan = parse(row?.payload);
    return plan ? { ...plan, lastActivityAt: plan.lastActivityAt || row.last_activity_at } : null;
  }

  savePlan(plan) {
    const result = this.db.prepare("UPDATE plans SET payload=?, version=version+1, expires_at=?, revoked_at=?, last_activity_at=? WHERE id=?")
      .run(json(plan), plan.expiresAt || null, plan.revokedAt || null, plan.lastActivityAt || plan.createdAt, plan.id);
    if (!result.changes) throw new Error("plan was not found");
    return plan;
  }

  createGame(game) {
    this.db.prepare("INSERT INTO games(id, plan_id, payload, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(game.id, game.planId, json(game), game.createdAt, game.expiresAt || null, game.revokedAt || null);
    return game;
  }

  getGame(id) { return parse(this.db.prepare("SELECT payload FROM games WHERE id=?").get(id)?.payload); }

  saveGame(game) {
    const result = this.db.prepare("UPDATE games SET payload=?, version=version+1, expires_at=?, revoked_at=? WHERE id=?")
      .run(json(game), game.expiresAt || null, game.revokedAt || null, game.id);
    if (!result.changes) throw new Error("game was not found");
    return game;
  }

  getSession(gameId, chatId, fallback) {
    const row = this.db.prepare("SELECT payload, version FROM sessions WHERE game_id=? AND chat_id=?").get(gameId, String(chatId));
    return row ? { ...parse(row.payload, fallback), storageVersion: row.version } : fallback;
  }

  saveSession(session) {
    const now = this.now();
    const abandonAfter = TERMINAL_SESSION_STATUSES.has(session.status) ? null : new Date(this.clock().getTime() + SESSION_ABANDONMENT_MS).toISOString();
    this.db.prepare(`INSERT INTO sessions(game_id, chat_id, payload, version, updated_at, abandon_after) VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(game_id, chat_id) DO UPDATE SET payload=excluded.payload, version=sessions.version+1, updated_at=excluded.updated_at,abandon_after=excluded.abandon_after`)
      .run(session.gameId, String(session.chatId), json(session), now, abandonAfter);
    return this.getSession(session.gameId, session.chatId, session);
  }

  setActiveSession(chatId, gameId) {
    this.db.prepare(`INSERT INTO active_sessions(chat_id, game_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET game_id=excluded.game_id, updated_at=excluded.updated_at`)
      .run(String(chatId), gameId, this.now());
  }

  getActiveGameId(chatId) { return this.db.prepare("SELECT game_id FROM active_sessions WHERE chat_id=?").get(String(chatId))?.game_id || null; }
  clearActiveSession(chatId) { this.db.prepare("DELETE FROM active_sessions WHERE chat_id=?").run(String(chatId)); }

  getTelegramDelivery(updateId) {
    const row = this.db.prepare("SELECT payload, delivered FROM telegram_deliveries WHERE update_id=?").get(updateId);
    return row ? { ...parse(row.payload, {}), delivered: Boolean(row.delivered) } : null;
  }

  saveTelegramDelivery(updateId, actions, delivered) {
    const payload = { updateId, actions, delivered: Boolean(delivered), updatedAt: this.now() };
    this.db.prepare(`INSERT INTO telegram_deliveries(update_id, payload, delivered, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(update_id) DO UPDATE SET payload=excluded.payload, delivered=excluded.delivered, updated_at=excluded.updated_at`)
      .run(updateId, json(payload), delivered ? 1 : 0, payload.updatedAt);
    return payload;
  }

  recordTelegramUpdate(update, status = "received", error = null) {
    if (!Number.isFinite(update?.update_id)) return null;
    const now = this.now();
    this.db.prepare(`INSERT INTO telegram_updates(update_id,payload,status,received_at,processed_at,error) VALUES(?,?,?,?,?,?)
      ON CONFLICT(update_id) DO UPDATE SET status=excluded.status, processed_at=excluded.processed_at, error=excluded.error`)
      .run(update.update_id, json(minimalTelegramUpdate(update)), status, now, status === "received" ? null : now, error ? String(error).slice(0, 120) : null);
    return this.db.prepare("SELECT * FROM telegram_updates WHERE update_id=?").get(update.update_id);
  }

  claimTelegramUpdate(update, leaseMs = 30_000) {
    if (!Number.isFinite(update?.update_id)) return { claimed: true };
    const now = this.clock();
    const inserted = this.db.prepare("INSERT OR IGNORE INTO telegram_updates(update_id,payload,status,received_at,processed_at,error) VALUES(?,?, 'received', ?, NULL, NULL)")
      .run(update.update_id, json(minimalTelegramUpdate(update)), now.toISOString());
    if (inserted.changes) return { claimed: true };
    const staleBefore = new Date(now.getTime() - leaseMs).toISOString();
    const reclaimed = this.db.prepare("UPDATE telegram_updates SET payload=?,received_at=?,error=NULL WHERE update_id=? AND status='received' AND received_at<=?")
      .run(json(minimalTelegramUpdate(update)), now.toISOString(), update.update_id, staleBefore);
    return { claimed: Boolean(reclaimed.changes) };
  }

  enqueueOutbound(updateId, actions) {
    const now = this.now();
    const insert = this.db.prepare(`INSERT OR IGNORE INTO outbound_messages(update_id,sequence,chat_id,payload,status,attempts,next_attempt_at,created_at)
      VALUES(?,?,?,?, 'pending', 0, ?, ?)`);
    actions.forEach((action, sequence) => insert.run(updateId, sequence, String(action.chatId), json(action), now, now));
  }

  claimOutboundForUpdate(updateId, workerId, leaseMs = 30_000) {
    return this.transaction(() => {
      const now = this.now();
      const leaseUntil = new Date(this.clock().getTime() + leaseMs).toISOString();
      const rows = this.db.prepare(`SELECT id FROM outbound_messages
        WHERE update_id=? AND status!='delivered' AND next_attempt_at<=? AND (status!='sending' OR lease_until IS NULL OR lease_until<=?) ORDER BY sequence`).all(updateId, now, now);
      const claim = this.db.prepare("UPDATE outbound_messages SET status='sending', claimed_by=?, lease_until=? WHERE id=? AND status!='delivered'");
      const claimed = [];
      for (const row of rows) if (claim.run(workerId, leaseUntil, row.id).changes) claimed.push(row.id);
      if (!claimed.length) return [];
      const placeholders = claimed.map(() => "?").join(",");
      return this.db.prepare(`SELECT * FROM outbound_messages WHERE id IN (${placeholders}) ORDER BY sequence`).all(...claimed)
        .map((row) => ({ ...row, payload: parse(row.payload, {}) }));
    });
  }

  claimDueOutbound(workerId, limit = 50, leaseMs = 30_000) {
    return this.transaction(() => {
      const now = this.now();
      const leaseUntil = new Date(this.clock().getTime() + leaseMs).toISOString();
      const rows = this.db.prepare(`SELECT id FROM outbound_messages
        WHERE next_attempt_at<=? AND (status IN ('pending','retry') OR (status='sending' AND (lease_until IS NULL OR lease_until<=?)))
        ORDER BY next_attempt_at,id LIMIT ?`).all(now, now, Math.max(1, Math.min(500, Number(limit) || 50)));
      const claim = this.db.prepare("UPDATE outbound_messages SET status='sending', claimed_by=?, lease_until=? WHERE id=? AND status!='delivered'");
      const claimed = [];
      for (const row of rows) if (claim.run(workerId, leaseUntil, row.id).changes) claimed.push(row.id);
      if (!claimed.length) return [];
      const placeholders = claimed.map(() => "?").join(",");
      return this.db.prepare(`SELECT * FROM outbound_messages WHERE id IN (${placeholders}) ORDER BY id`).all(...claimed)
        .map((row) => ({ ...row, payload: parse(row.payload, {}) }));
    });
  }

  markOutboundDelivered(id) {
    this.db.prepare("UPDATE outbound_messages SET status='delivered', delivered_at=?, claimed_by=NULL, lease_until=NULL, last_error=NULL WHERE id=?").run(this.now(), id);
  }

  markOutboundFailed(id, error) {
    const row = this.db.prepare("SELECT attempts FROM outbound_messages WHERE id=?").get(id);
    if (!row) return;
    const attempts = row.attempts + 1;
    const delayMs = Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6));
    const nextAttempt = new Date(this.clock().getTime() + delayMs).toISOString();
    this.db.prepare("UPDATE outbound_messages SET status='retry', attempts=?, next_attempt_at=?, last_error=?, claimed_by=NULL, lease_until=NULL WHERE id=?")
      .run(attempts, nextAttempt, String(error || "delivery failed").slice(0, 1000), id);
  }

  outboundForUpdate(updateId) {
    return this.db.prepare("SELECT * FROM outbound_messages WHERE update_id=? ORDER BY sequence").all(updateId)
      .map((row) => ({ ...row, payload: parse(row.payload, {}) }));
  }

  consumeRateLimit(key, limit, windowMs) {
    return this.transaction(() => {
      const now = this.clock();
      const row = this.db.prepare("SELECT * FROM rate_limits WHERE key=?").get(key);
      if (!row || now.getTime() - Date.parse(row.window_started_at) >= windowMs) {
        this.db.prepare("INSERT INTO rate_limits(key,window_started_at,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_started_at=excluded.window_started_at,count=1").run(key, now.toISOString());
        return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 };
      }
      if (row.count >= limit) return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, windowMs - (now.getTime() - Date.parse(row.window_started_at))) };
      this.db.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").run(key);
      return { allowed: true, remaining: Math.max(0, limit - row.count - 1), retryAfterMs: 0 };
    });
  }

  savePhotoSubmission({ gameId, chatId, missionId, fileUniqueId, status, verifier, result, deleteAfter }) {
    return this.transaction(() => {
      const fingerprint = this.db.prepare("INSERT OR IGNORE INTO photo_fingerprints(file_unique_id,first_game_id,first_seen_at,delete_after) VALUES(?,?,?,?)")
        .run(fileUniqueId, gameId, this.now(), deleteAfter || null);
      if (!fingerprint.changes) {
        const existing = this.db.prepare("SELECT id,chat_id,mission_id,status FROM photo_submissions WHERE file_unique_id=? ORDER BY id DESC LIMIT 1").get(fileUniqueId);
        return { ...existing, duplicate: true };
      }
      const record = this.db.prepare(`INSERT INTO photo_submissions(game_id,chat_id,mission_id,file_unique_id,status,verifier,result,created_at,delete_after)
        VALUES(?,?,?,?,?,?,?,?,?) RETURNING id`).get(gameId, String(chatId), missionId, fileUniqueId, status, verifier, json(result), this.now(), deleteAfter || null);
      return { id: record.id, duplicate: false };
    });
  }

  getPhotoSubmission(id) {
    const row = this.db.prepare("SELECT * FROM photo_submissions WHERE id=?").get(Number(id));
    return row ? { ...row, result: parse(row.result, {}) } : null;
  }

  listPhotoReviews({ status = "needs_review", cursor = null, limit = 25 } = {}) {
    const bounded = Math.max(1, Math.min(100, Number(limit) || 25));
    const rows = this.db.prepare(`SELECT id,game_id,mission_id,status,verifier,result,created_at,delete_after
      FROM photo_submissions WHERE status=? AND (? IS NULL OR id>?) ORDER BY id LIMIT ?`).all(status, cursor == null ? null : Number(cursor), cursor == null ? null : Number(cursor), bounded + 1);
    const records = rows.slice(0, bounded).map((row) => {
      const result = parse(row.result, {});
      return { id: row.id, gameId: row.game_id, missionId: row.mission_id, status: row.status, verifier: row.verifier,
        reason: result.reason ? String(result.reason).slice(0, 160) : null,
        confidence: Number.isFinite(result.confidence) ? result.confidence : null,
        createdAt: row.created_at, deleteAfter: row.delete_after };
    });
    return { records, nextCursor: rows.length > bounded ? String(rows[bounded - 1].id) : null };
  }

  deletedPhotoReview(id) { return this.db.prepare("SELECT * FROM deleted_photo_reviews WHERE submission_id=?").get(Number(id)) || null; }

  reviewPhotoSubmission(id, status, reviewer, reason = null) {
    const submission = this.getPhotoSubmission(id);
    if (!submission) throw new Error("photo submission was not found");
    if (submission.status !== "needs_review") throw new Error("photo submission is not awaiting review");
    const result = { ...submission.result, manualReview: { status, reviewer: String(reviewer || "operator").slice(0, 120), reason: reason ? String(reason).slice(0, 1000) : null, reviewedAt: this.now() } };
    this.db.prepare("UPDATE photo_submissions SET status=?, result=? WHERE id=?").run(status, json(result), submission.id);
    return this.getPhotoSubmission(submission.id);
  }

  deleteSessionVerification(gameId, chatId, reason = "session_terminal") {
    const records = this.db.prepare("SELECT id,file_unique_id FROM photo_submissions WHERE game_id=? AND chat_id=?").all(gameId, String(chatId));
    const tombstone = this.db.prepare("INSERT OR IGNORE INTO deleted_photo_reviews(submission_id,deleted_at,reason) VALUES(?,?,?)");
    for (const record of records) tombstone.run(record.id, this.now(), reason);
    this.db.prepare("DELETE FROM photo_submissions WHERE game_id=? AND chat_id=?").run(gameId, String(chatId));
    const removeFingerprint = this.db.prepare("DELETE FROM photo_fingerprints WHERE file_unique_id=? AND NOT EXISTS (SELECT 1 FROM photo_submissions WHERE file_unique_id=?)");
    for (const record of records) removeFingerprint.run(record.file_unique_id, record.file_unique_id);
  }

  terminateSession(session) {
    if (!TERMINAL_SESSION_STATUSES.has(session.status)) throw new Error("terminal session status is required");
    return this.transaction(() => {
      this.saveSession(session);
      this.deleteSessionVerification(session.gameId, session.chatId);
      this.clearActiveSession(session.chatId);
      return this.getSession(session.gameId, session.chatId, session);
    });
  }

  terminateGameSessions(gameId, status = "revoked") {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT payload FROM sessions WHERE game_id=?").all(gameId);
      for (const row of rows) {
        const session = parse(row.payload, {});
        session.status = status;
        session.completed = true;
        session.updatedAt = this.now();
        this.terminateSession(session);
      }
      return rows.length;
    });
  }

  purgeAbandonedSessions() {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT game_id,chat_id FROM sessions WHERE abandon_after IS NOT NULL AND abandon_after<=?").all(this.now());
      for (const row of rows) {
        this.deleteSessionVerification(row.game_id, row.chat_id, "session_abandoned");
        this.clearActiveSession(row.chat_id);
        this.db.prepare("DELETE FROM sessions WHERE game_id=? AND chat_id=?").run(row.game_id, row.chat_id);
      }
      return { deletedSessions: rows.length };
    });
  }

  purgeSettledTelegramRecords() {
    return this.transaction(() => {
      const threshold = new Date(this.clock().getTime() - SETTLED_TELEGRAM_RETENTION_MS).toISOString();
      const deliveries = this.db.prepare("DELETE FROM telegram_deliveries WHERE delivered=1 AND updated_at<=?").run(threshold).changes;
      const outbound = this.db.prepare("DELETE FROM outbound_messages WHERE status='delivered' AND delivered_at IS NOT NULL AND delivered_at<=?").run(threshold).changes;
      const updates = this.db.prepare("DELETE FROM telegram_updates WHERE status!='received' AND processed_at IS NOT NULL AND processed_at<=?").run(threshold).changes;
      return { deliveries, outbound, updates };
    });
  }

  purgeExpiredPhotoSubmissions() {
    return this.transaction(() => {
      const now = this.now();
      const expired = this.db.prepare("SELECT id FROM photo_submissions WHERE delete_after IS NOT NULL AND delete_after<=?").all(now);
      const tombstone = this.db.prepare("INSERT OR IGNORE INTO deleted_photo_reviews(submission_id,deleted_at,reason) VALUES(?,?,'retention_expired')");
      for (const row of expired) tombstone.run(row.id, now);
      const changes = this.db.prepare("DELETE FROM photo_submissions WHERE delete_after IS NOT NULL AND delete_after<=?").run(now).changes;
      this.db.prepare("DELETE FROM photo_fingerprints WHERE delete_after IS NOT NULL AND delete_after<=?").run(now);
      return changes;
    });
  }

  purgeExpiredPlans() {
    return this.transaction(() => {
      const now = this.now();
      const rows = this.db.prepare(`SELECT p.id FROM plans p
        WHERE p.expires_at IS NOT NULL AND p.expires_at<=?
        AND NOT EXISTS (SELECT 1 FROM games g WHERE g.plan_id=p.id)`).all(now);
      const remove = this.db.prepare("DELETE FROM plans WHERE id=?");
      const deletedPlanIds = [];
      for (const row of rows) if (remove.run(row.id).changes) deletedPlanIds.push(row.id);
      return { deletedPlanIds };
    });
  }

  counts() {
    const count = (table) => this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    return { plans: count("plans"), games: count("games"), sessions: count("sessions"), pendingMessages: this.db.prepare("SELECT COUNT(*) AS count FROM outbound_messages WHERE status IN ('pending','retry')").get().count };
  }

  importFile(sourcePath, kind, value) {
    if (!value || this.db.prepare("SELECT 1 FROM legacy_imports WHERE source_path=?").get(sourcePath)) return;
    try {
      if (kind === "plan" && value.id) this.db.prepare("INSERT OR IGNORE INTO plans(id,payload,created_at,expires_at,revoked_at,last_activity_at) VALUES(?,?,?,?,?,?)").run(value.id, json(value), value.createdAt || this.now(), value.expiresAt || null, value.revokedAt || null, value.lastActivityAt || value.createdAt || this.now());
      if (kind === "game" && value.id && value.planId && this.getPlan(value.planId)) this.db.prepare("INSERT OR IGNORE INTO games(id,plan_id,payload,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?)").run(value.id, value.planId, json(value), value.createdAt || this.now(), value.expiresAt || null, value.revokedAt || null);
      if (kind === "session" && value.gameId && value.chatId !== undefined && this.getGame(value.gameId)) {
        const updatedAt = value.updatedAt || this.now();
        const abandonAfter = TERMINAL_SESSION_STATUSES.has(value.status)
          ? null
          : new Date(Date.parse(updatedAt) + SESSION_ABANDONMENT_MS).toISOString();
        this.db.prepare("INSERT OR IGNORE INTO sessions(game_id,chat_id,payload,updated_at,abandon_after) VALUES(?,?,?,?,?)")
          .run(value.gameId, String(value.chatId), json(value), updatedAt, abandonAfter);
      }
      if (kind === "active" && value.gameId && value.chatId !== undefined && this.getGame(value.gameId)) this.db.prepare("INSERT OR IGNORE INTO active_sessions(chat_id,game_id,updated_at) VALUES(?,?,?)").run(String(value.chatId), value.gameId, value.updatedAt || this.now());
      if (kind === "delivery" && Number.isFinite(value.updateId)) this.saveTelegramDelivery(value.updateId, value.actions || [], value.delivered);
      this.db.prepare("INSERT OR IGNORE INTO legacy_imports(source_path, imported_at, checksum_hint) VALUES(?,?,?)").run(sourcePath, this.now(), String(fs.statSync(sourcePath).size));
    } catch { /* A malformed or relationally incomplete legacy record remains untouched for manual recovery. */ }
  }

  importLegacyJson() {
    this.transaction(() => {
      for (const entry of files(path.join(this.root, "plans"))) if (entry.isFile() && entry.name.endsWith(".json")) {
        const source = path.join(this.root, "plans", entry.name); this.importFile(source, "plan", read(source));
      }
      for (const entry of files(path.join(this.root, "games"))) if (entry.isFile() && entry.name.endsWith(".json")) {
        const source = path.join(this.root, "games", entry.name); this.importFile(source, "game", read(source));
      }
      for (const entry of files(path.join(this.root, "telegram-deliveries"))) if (entry.isFile() && entry.name.endsWith(".json")) {
        const source = path.join(this.root, "telegram-deliveries", entry.name); this.importFile(source, "delivery", read(source));
      }
      const sessionsRoot = path.join(this.root, "sessions");
      for (const gameEntry of files(sessionsRoot)) {
        if (!gameEntry.isDirectory()) continue;
        const directory = path.join(sessionsRoot, gameEntry.name);
        for (const entry of files(directory)) if (entry.isFile() && entry.name.endsWith(".json")) {
          const source = path.join(directory, entry.name);
          const value = read(source);
          if (gameEntry.name === "active") this.importFile(source, "active", value ? { ...value, chatId: value.chatId ?? entry.name.replace(/\.json$/, "") } : value);
          else this.importFile(source, "session", value ? { ...value, gameId: value.gameId || gameEntry.name, chatId: value.chatId ?? entry.name.replace(/\.json$/, "") } : value);
        }
      }
    });
  }

  close() { this.db.close(); }
}

module.exports = { MIGRATIONS, SqliteGameRepository };
