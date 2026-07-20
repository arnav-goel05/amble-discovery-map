"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class AdminRepositoryError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const json = (value) => JSON.stringify(value);

class AdminRepository {
  constructor({ databasePath = path.join(process.cwd(), "outputs/admin/admin.sqlite"), clock = () => new Date() } = {}) {
    this.databasePath = databasePath;
    this.clock = clock;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  now() { return this.clock().toISOString(); }
  transaction(work) {
    if (this.db.isTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = work(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_sessions(
        token_hash TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at, revoked_at);
      CREATE TABLE IF NOT EXISTS admin_login_attempts(subject_hash TEXT NOT NULL, attempted_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS admin_login_attempts_subject_time_idx ON admin_login_attempts(subject_hash, attempted_at);
      CREATE TABLE IF NOT EXISTS venue_reviews(
        review_id TEXT PRIMARY KEY, venue_id TEXT NOT NULL, evidence_hash TEXT NOT NULL,
        evidence_snapshot TEXT NOT NULL, candidates TEXT NOT NULL, status TEXT NOT NULL,
        decision_candidate_gml_id TEXT, decision_reason TEXT, idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL, decided_at TEXT, superseded_at TEXT,
        UNIQUE(venue_id, evidence_hash)
      );
      CREATE INDEX IF NOT EXISTS venue_reviews_queue_idx ON venue_reviews(status, created_at, review_id);
      CREATE TABLE IF NOT EXISTS admin_idempotency(
        idempotency_key TEXT PRIMARY KEY, operation TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO admin_schema_migrations(version, applied_at) VALUES (1, datetime('now'));
    `);
  }

  createSession({ tokenHash, csrfHash, expiresAt }) {
    const createdAt = this.now();
    this.db.prepare("INSERT INTO admin_sessions(token_hash,csrf_hash,created_at,expires_at) VALUES (?,?,?,?)")
      .run(tokenHash, csrfHash, createdAt, expiresAt);
    return { tokenHash, csrfHash, createdAt, expiresAt, revokedAt: null };
  }

  session(tokenHash) {
    const row = this.db.prepare("SELECT * FROM admin_sessions WHERE token_hash=?").get(tokenHash);
    if (!row) return null;
    return { tokenHash: row.token_hash, csrfHash: row.csrf_hash, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at };
  }

  revokeSession(tokenHash) {
    this.db.prepare("UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE token_hash=?").run(this.now(), tokenHash);
    return this.session(tokenHash);
  }

  rotateSessionCsrf(tokenHash, csrfHash) {
    this.db.prepare("UPDATE admin_sessions SET csrf_hash=? WHERE token_hash=? AND revoked_at IS NULL").run(csrfHash, tokenHash);
    return this.session(tokenHash);
  }

  recordLoginAttempt(subjectHash) {
    this.db.prepare("INSERT INTO admin_login_attempts(subject_hash,attempted_at) VALUES (?,?)").run(subjectHash, this.now());
  }

  loginAttemptsSince(subjectHash, since) {
    return this.db.prepare("SELECT count(*) count FROM admin_login_attempts WHERE subject_hash=? AND attempted_at>=?").get(subjectHash, since).count;
  }

  clearLoginAttempts(subjectHash) { this.db.prepare("DELETE FROM admin_login_attempts WHERE subject_hash=?").run(subjectHash); }

  rowToReview(row) {
    if (!row) return null;
    return {
      schemaVersion: "1.0", reviewId: row.review_id, venueId: row.venue_id, evidenceHash: row.evidence_hash,
      evidenceSnapshot: parse(row.evidence_snapshot, {}), candidates: parse(row.candidates, []), status: row.status,
      decisionCandidateGmlId: row.decision_candidate_gml_id, decisionReason: row.decision_reason,
      idempotencyKey: row.idempotency_key, createdAt: row.created_at, decidedAt: row.decided_at,
    };
  }

  upsertVenueReview(review) {
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM venue_reviews WHERE venue_id=? AND evidence_hash=?").get(review.venueId, review.evidenceHash);
      if (existing) return this.rowToReview(existing);
      this.db.prepare("UPDATE venue_reviews SET status='superseded',superseded_at=? WHERE venue_id=? AND status IN ('pending','deferred')")
        .run(this.now(), review.venueId);
      this.db.prepare(`INSERT INTO venue_reviews(review_id,venue_id,evidence_hash,evidence_snapshot,candidates,status,created_at)
        VALUES (?,?,?,?,?,'pending',?)`).run(review.reviewId, review.venueId, review.evidenceHash, json(review.evidenceSnapshot ?? {}), json(review.candidates ?? []), review.createdAt ?? this.now());
      return this.getVenueReview(review.reviewId);
    });
  }

  getVenueReview(reviewId) { return this.rowToReview(this.db.prepare("SELECT * FROM venue_reviews WHERE review_id=?").get(reviewId)); }

  listVenueReviews({ status = "pending", cursor = null, limit = 25 } = {}) {
    const bounded = Math.max(1, Math.min(100, Number(limit) || 25));
    const rows = this.db.prepare(`SELECT * FROM venue_reviews WHERE status=? AND (? IS NULL OR review_id>?) ORDER BY review_id LIMIT ?`)
      .all(status, cursor, cursor, bounded + 1);
    return { records: rows.slice(0, bounded).map((row) => this.rowToReview(row)), nextCursor: rows.length > bounded ? rows[bounded - 1].review_id : null };
  }

  reconcileVenueReviewQueue(activeReviews = []) {
    const refs = activeReviews.map((item) => typeof item === "string" ? { venueId: item, evidenceHash: null } : item)
      .filter((item) => item?.venueId);
    const venueIds = [...new Set(refs.map(({ venueId }) => String(venueId)))];
    return this.transaction(() => {
      const active = new Set(refs.map(({ venueId, evidenceHash }) => `${venueId}\0${evidenceHash ?? "*"}`));
      const rows = this.db.prepare("SELECT review_id,venue_id,evidence_hash FROM venue_reviews WHERE status IN ('pending','deferred')").all();
      const stale = rows.filter((row) => !active.has(`${row.venue_id}\0*`) && !active.has(`${row.venue_id}\0${row.evidence_hash}`));
      const supersede = this.db.prepare("UPDATE venue_reviews SET status='superseded',superseded_at=? WHERE review_id=?");
      for (const row of stale) supersede.run(this.now(), row.review_id);
      const superseded = stale.length;
      const pending = this.db.prepare("SELECT COUNT(*) AS count FROM venue_reviews WHERE status='pending'").get().count;
      const deferred = this.db.prepare("SELECT COUNT(*) AS count FROM venue_reviews WHERE status='deferred'").get().count;
      return { activeVenueIds: venueIds, superseded, pending, deferred };
    });
  }

  decideVenueReview(reviewId, decision) {
    return this.transaction(() => {
      const operation = `venue-review:${reviewId}`;
      const prior = this.db.prepare("SELECT operation,response FROM admin_idempotency WHERE idempotency_key=?").get(decision.idempotencyKey);
      if (prior && prior.operation !== operation) throw new AdminRepositoryError("idempotency_key_conflict", "Idempotency key was already used for another operation", 409);
      if (prior) return { ...parse(prior.response), idempotent: true };
      const review = this.getVenueReview(reviewId);
      if (!review) throw new AdminRepositoryError("venue_review_not_found", "Venue review was not found", 404);
      if (review.evidenceHash !== decision.evidenceHash) throw new AdminRepositoryError("venue_review_stale", "Venue evidence changed; refresh before deciding", 409);
      if (!["pending", "deferred"].includes(review.status)) throw new AdminRepositoryError("venue_review_already_decided", "Venue review was already decided", 409);
      const status = { approve: "approved", reject: "rejected", defer: "deferred" }[decision.decision];
      if (!status) throw new AdminRepositoryError("venue_review_decision_invalid", "Decision must be approve, reject, or defer");
      if (status === "approved" && !review.candidates.some((candidate) => candidate.gmlId === decision.candidateGmlId || candidate.gmlIds?.includes(decision.candidateGmlId))) {
        throw new AdminRepositoryError("venue_review_candidate_invalid", "Selected candidate is absent from current evidence", 409);
      }
      if (["approved", "rejected"].includes(status) && !String(decision.reason ?? "").trim()) throw new AdminRepositoryError("venue_review_reason_required", "A decision reason is required");
      const decidedAt = this.now();
      this.db.prepare(`UPDATE venue_reviews SET status=?,decision_candidate_gml_id=?,decision_reason=?,idempotency_key=?,decided_at=? WHERE review_id=?`)
        .run(status, status === "approved" ? decision.candidateGmlId : null, decision.reason ?? null, decision.idempotencyKey, decidedAt, reviewId);
      const response = { review: this.getVenueReview(reviewId), pipelineReconciliationRequired: true, idempotent: false };
      this.db.prepare("INSERT INTO admin_idempotency(idempotency_key,operation,response,created_at) VALUES (?,?,?,?)")
        .run(decision.idempotencyKey, operation, json(response), decidedAt);
      return response;
    });
  }

  approvedVenueReviews() {
    return this.db.prepare("SELECT * FROM venue_reviews WHERE status='approved' ORDER BY decided_at").all().map((row) => this.rowToReview(row));
  }

  performIdempotent(idempotencyKey, operation, work) {
    return this.transaction(() => {
      const prior = this.db.prepare("SELECT operation,response FROM admin_idempotency WHERE idempotency_key=?").get(idempotencyKey);
      if (prior && prior.operation !== operation) throw new AdminRepositoryError("idempotency_key_conflict", "Idempotency key was already used for another operation", 409);
      if (prior) return { ...parse(prior.response), idempotent: true };
      const response = work();
      this.db.prepare("INSERT INTO admin_idempotency(idempotency_key,operation,response,created_at) VALUES(?,?,?,?)").run(idempotencyKey, operation, json(response), this.now());
      return response;
    });
  }

  close() { this.db.close(); }
}

module.exports = { AdminRepository, AdminRepositoryError };
