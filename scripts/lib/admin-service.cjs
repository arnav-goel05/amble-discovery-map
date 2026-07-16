"use strict";

const crypto = require("node:crypto");

const bounded = (value, max = 500) => value == null ? null : String(value).slice(0, max);
const sanitizeCandidate = (candidate) => ({
  key: bounded(candidate?.key, 160), name: bounded(candidate?.name, 240),
  gmlId: bounded(candidate?.gmlId ?? candidate?.gmlIds?.[0], 240),
  gmlIds: (candidate?.gmlIds ?? [candidate?.gmlId].filter(Boolean)).slice(0, 32).map((value) => bounded(value, 240)),
  distanceMeters: Number.isFinite(candidate?.distanceMeters) ? candidate.distanceMeters : null,
  latitude: Number.isFinite(Number(candidate?.latitude)) ? Number(candidate.latitude) : null,
  longitude: Number.isFinite(Number(candidate?.longitude)) ? Number(candidate.longitude) : null,
  sourceTiles: (candidate?.sourceTiles ?? []).slice(0, 100).map((tile) => ({
    tilePath: bounded(tile?.tilePath ?? tile?.path, 500),
    batchIds: (tile?.batchIds ?? []).slice(0, 10_000).map(Number).filter(Number.isInteger),
  })),
  rejectionReason: bounded(candidate?.rejectionReason, 600),
});

class AdminService {
  constructor({ repository } = {}) {
    if (!repository) throw new Error("AdminService requires a repository");
    this.repository = repository;
  }

  createVenueReview({ venueId, evidenceHash, evidenceSnapshot, candidates, createdAt }) {
    if (!venueId || !/^[a-f0-9]{64}$/i.test(evidenceHash ?? "")) throw new Error("Venue review requires venueId and evidenceHash");
    const reviewId = `vr_${crypto.createHash("sha256").update(`${venueId}\0${evidenceHash}`).digest("hex").slice(0, 24)}`;
    return this.repository.upsertVenueReview({
      reviewId, venueId, evidenceHash, createdAt,
      evidenceSnapshot: {
        venue: bounded(evidenceSnapshot?.venue, 300),
        rawNames: (evidenceSnapshot?.rawNames ?? []).slice(0, 30).map((value) => bounded(value, 300)),
        addressCandidates: (evidenceSnapshot?.addressCandidates ?? []).slice(0, 30).map((value) => bounded(value, 500)),
        postalCodes: (evidenceSnapshot?.postalCodes ?? []).slice(0, 30).map((value) => bounded(value, 20)),
        evidenceInspected: (evidenceSnapshot?.evidenceInspected ?? []).slice(0, 30),
        recoveryAttempts: (evidenceSnapshot?.recoveryAttempts ?? []).slice(0, 10),
        localLookupEvidence: (evidenceSnapshot?.localLookupEvidence ?? []).slice(0, 20),
        finalReason: bounded(evidenceSnapshot?.finalReason, 1000),
      },
      candidates: (candidates ?? []).slice(0, 100).map(sanitizeCandidate),
    });
  }

  listVenueReviews(query = {}) { return this.repository.listVenueReviews(query); }
  venueReview(reviewId) { return this.repository.getVenueReview(reviewId); }
  decideVenueReview(reviewId, decision) { return this.repository.decideVenueReview(reviewId, decision); }

  approvedMappingProposals() {
    return this.repository.approvedVenueReviews().map((review) => {
      const candidate = review.candidates.find((item) => item.gmlId === review.decisionCandidateGmlId || item.gmlIds?.includes(review.decisionCandidateGmlId));
      return {
        schemaVersion: "1.0", reviewId: review.reviewId, venueId: review.venueId,
        evidenceHash: review.evidenceHash, candidateGmlId: review.decisionCandidateGmlId,
        candidate, decisionReason: review.decisionReason, decidedAt: review.decidedAt,
        status: "proposed_for_pipeline_revalidation",
      };
    });
  }
}

module.exports = { AdminService, sanitizeCandidate };
