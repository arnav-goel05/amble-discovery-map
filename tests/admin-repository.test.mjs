import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AdminRepository,
  AdminRepositoryError,
} = require("../scripts/lib/admin-repository.cjs");
const {
  AdminAuthService,
  hashAdminPassword,
} = require("../scripts/lib/admin-auth-service.cjs");
const { AdminService } = require("../scripts/lib/admin-service.cjs");

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wh-admin-repository-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = new Date("2026-07-14T00:00:00.000Z");
  return {
    databasePath: path.join(root, "admin.sqlite"),
    clock: () => new Date(now),
    advance(milliseconds) {
      now = new Date(now.valueOf() + milliseconds);
    },
  };
}

const candidate = {
  name: "National Library Building",
  gmlId: "SLA_BLDG2_123",
  gmlIds: ["SLA_BLDG2_123"],
  latitude: 1.2976,
  longitude: 103.8545,
  sourceTiles: [{ tilePath: "tiles/0/0/0.b3dm", batchIds: [7] }],
};

test("admin migrations are restart-safe and sessions expire or revoke server-side", (context) => {
  const state = fixture(context);
  const repository = new AdminRepository(state);
  assert.deepEqual(
    repository.db
      .prepare("SELECT version FROM admin_schema_migrations ORDER BY version")
      .all()
      .map(({ version }) => version),
    [1],
  );
  const auth = new AdminAuthService({
    repository,
    passwordHash: hashAdminPassword("correct horse"),
    clock: state.clock,
    sessionTtlMs: 1_000,
  });
  const first = auth.login("correct horse", "127.0.0.1");
  assert.equal(auth.authenticate(first.sessionToken).authenticated, true);
  auth.logout(first.sessionToken, first.csrfToken);
  assert.throws(() => auth.authenticate(first.sessionToken), {
    code: "admin_session_invalid",
  });
  const second = auth.login("correct horse", "127.0.0.1");
  state.advance(1_001);
  assert.throws(() => auth.authenticate(second.sessionToken), {
    code: "admin_session_invalid",
  });
  repository.close();

  const restarted = new AdminRepository(state);
  assert.deepEqual(
    restarted.db
      .prepare("SELECT version FROM admin_schema_migrations ORDER BY version")
      .all()
      .map(({ version }) => version),
    [1],
  );
  assert.equal(restarted.session("missing"), null);
  restarted.close();
});

test("venue review state is durable, stale-safe, superseding, and idempotent", (context) => {
  const state = fixture(context);
  const repository = new AdminRepository(state);
  const service = new AdminService({ repository });
  const evidenceHash = "a".repeat(64);
  const review = service.createVenueReview({
    venueId: "venue-1",
    evidenceHash,
    evidenceSnapshot: { venue: "Library", rawNames: ["Library"] },
    candidates: [candidate],
  });
  const duplicate = service.createVenueReview({
    venueId: "venue-1",
    evidenceHash,
    evidenceSnapshot: { venue: "ignored" },
    candidates: [],
  });
  assert.equal(duplicate.reviewId, review.reviewId);
  assert.equal(repository.listVenueReviews().records.length, 1);
  assert.throws(
    () =>
      service.decideVenueReview(review.reviewId, {
        decision: "approve",
        evidenceHash: "b".repeat(64),
        candidateGmlId: candidate.gmlId,
        reason: "Verified",
        idempotencyKey: "decision-1",
      }),
    { code: "venue_review_stale" },
  );
  assert.throws(
    () =>
      service.decideVenueReview(review.reviewId, {
        decision: "approve",
        evidenceHash,
        candidateGmlId: "unknown",
        reason: "Verified",
        idempotencyKey: "decision-2",
      }),
    { code: "venue_review_candidate_invalid" },
  );
  const result = service.decideVenueReview(review.reviewId, {
    decision: "approve",
    evidenceHash,
    candidateGmlId: candidate.gmlId,
    reason: "Official address and local geometry agree",
    idempotencyKey: "decision-3",
  });
  assert.equal(result.pipelineReconciliationRequired, true);
  assert.equal(result.review.status, "approved");
  assert.equal(
    service.decideVenueReview(review.reviewId, {
      decision: "approve",
      evidenceHash,
      candidateGmlId: candidate.gmlId,
      reason: "Official address and local geometry agree",
      idempotencyKey: "decision-3",
    }).idempotent,
    true,
  );
  assert.throws(
    () =>
      service.decideVenueReview(review.reviewId, {
        decision: "approve",
        evidenceHash,
        candidateGmlId: candidate.gmlId,
        reason: "Replay under another key",
        idempotencyKey: "decision-4",
      }),
    { code: "venue_review_already_decided" },
  );
  repository.close();

  const restarted = new AdminRepository(state);
  assert.equal(restarted.getVenueReview(review.reviewId).status, "approved");
  assert.equal(
    restarted.approvedVenueReviews()[0].decisionCandidateGmlId,
    candidate.gmlId,
  );
  restarted.close();
});

test("new evidence supersedes only unresolved work and validates idempotency operation ownership", (context) => {
  const state = fixture(context);
  const repository = new AdminRepository(state);
  const service = new AdminService({ repository });
  const first = service.createVenueReview({
    venueId: "venue-2",
    evidenceHash: "c".repeat(64),
    evidenceSnapshot: { venue: "A" },
    candidates: [candidate],
  });
  const next = service.createVenueReview({
    venueId: "venue-2",
    evidenceHash: "d".repeat(64),
    evidenceSnapshot: { venue: "A" },
    candidates: [candidate],
  });
  assert.equal(repository.getVenueReview(first.reviewId).status, "superseded");
  service.decideVenueReview(next.reviewId, {
    decision: "defer",
    evidenceHash: next.evidenceHash,
    reason: "",
    idempotencyKey: "shared-key",
  });
  const other = service.createVenueReview({
    venueId: "venue-3",
    evidenceHash: "e".repeat(64),
    evidenceSnapshot: { venue: "B" },
    candidates: [candidate],
  });
  assert.throws(
    () =>
      service.decideVenueReview(other.reviewId, {
        decision: "defer",
        evidenceHash: other.evidenceHash,
        reason: "",
        idempotencyKey: "shared-key",
      }),
    (error) =>
      error instanceof AdminRepositoryError &&
      error.code === "idempotency_key_conflict",
  );
  repository.close();
});

test("queue reconciliation supersedes reviews absent from the current pipeline run", (context) => {
  const state = fixture(context);
  const repository = new AdminRepository(state);
  const service = new AdminService({ repository });
  const active = service.createVenueReview({
    venueId: "venue-active",
    evidenceHash: "1".repeat(64),
    evidenceSnapshot: { venue: "Active" },
    candidates: [candidate],
  });
  const stale = service.createVenueReview({
    venueId: "venue-stale",
    evidenceHash: "2".repeat(64),
    evidenceSnapshot: { venue: "Stale" },
    candidates: [candidate],
  });
  const deferred = service.createVenueReview({
    venueId: "venue-deferred",
    evidenceHash: "3".repeat(64),
    evidenceSnapshot: { venue: "Deferred" },
    candidates: [candidate],
  });
  service.decideVenueReview(deferred.reviewId, {
    decision: "defer",
    evidenceHash: deferred.evidenceHash,
    reason: "",
    idempotencyKey: "defer-before-reconcile",
  });

  const result = repository.reconcileVenueReviewQueue([active.venueId]);
  assert.deepEqual(result, {
    activeVenueIds: [active.venueId],
    superseded: 2,
    pending: 1,
    deferred: 0,
  });
  assert.equal(repository.getVenueReview(active.reviewId).status, "pending");
  assert.equal(repository.getVenueReview(stale.reviewId).status, "superseded");
  assert.equal(
    repository.getVenueReview(deferred.reviewId).status,
    "superseded",
  );
  repository.close();
});

test("queue reconciliation retains only the current evidence hash for an active venue", (context) => {
  const state = fixture(context);
  const repository = new AdminRepository(state);
  const service = new AdminService({ repository });
  const old = service.createVenueReview({
    venueId: "venue-hash",
    evidenceHash: "4".repeat(64),
    evidenceSnapshot: { venue: "Hash" },
    candidates: [candidate],
  });
  const current = service.createVenueReview({
    venueId: "venue-hash",
    evidenceHash: "5".repeat(64),
    evidenceSnapshot: { venue: "Hash" },
    candidates: [candidate],
  });
  const result = repository.reconcileVenueReviewQueue([
    { venueId: "venue-hash", evidenceHash: current.evidenceHash },
  ]);
  assert.equal(repository.getVenueReview(old.reviewId).status, "superseded");
  assert.equal(repository.getVenueReview(current.reviewId).status, "pending");
  assert.deepEqual(result.activeVenueIds, ["venue-hash"]);
  repository.close();
});
