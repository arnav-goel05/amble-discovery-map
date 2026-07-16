import assert from "node:assert/strict";
import test from "node:test";
import { computeVenueEvidenceHash } from "../scripts/lib/event-pipeline/evidence-hash.mjs";
import { revalidateAdminApprovedCandidate } from "../scripts/lib/admin-approved-resolution.mjs";

const evidence = {
  venue: "National Library Building",
  eventIds: ["event-1"],
  events: [{ id: "event-1", address: "100 Victoria Street", coordinates: null, sources: [{ provider: "Catch.sg" }] }],
  enrichmentRecords: [{ eventId: "event-1", coordinateCandidates: [{ lat: 1.2976, lng: 103.8545, source: "official", recordRef: "record-1" }] }],
};
const current = {
  name: "NATIONAL LIBRARY BUILDING",
  gmlIds: ["SLA_BLDG2_123"], latitude: 1.2976, longitude: 103.8545,
  sourceTiles: [{ tilePath: "tiles/0/0/0.b3dm", batchIds: [4] }],
};

test("approved admin selection is only a proposal until current OneMap evidence revalidates", () => {
  const evidenceHash = computeVenueEvidenceHash(evidence);
  const proposals = [{ schemaVersion: "1.0", reviewId: "vr_1", venueId: "venue-1", evidenceHash, candidateGmlId: "SLA_BLDG2_123", decisionReason: "Address agrees", decidedAt: "2026-07-14T00:00:00Z", status: "proposed_for_pipeline_revalidation" }];
  assert.equal(revalidateAdminApprovedCandidate({ venueId: "venue-1", evidenceHash, proposals, currentCandidates: [] }), null);
  const accepted = revalidateAdminApprovedCandidate({ venueId: "venue-1", evidenceHash, proposals, currentCandidates: [current] });
  assert.equal(accepted.gmlIds[0], "SLA_BLDG2_123");
  assert.equal(accepted.adminReview.reviewId, "vr_1");
});

test("stale evidence, absent GML identities, coordinates, or tiles cannot re-enter publication", () => {
  const evidenceHash = computeVenueEvidenceHash(evidence);
  const proposal = { reviewId: "vr_1", venueId: "venue-1", evidenceHash, candidateGmlId: "SLA_BLDG2_123", status: "proposed_for_pipeline_revalidation" };
  assert.equal(revalidateAdminApprovedCandidate({ venueId: "venue-1", evidenceHash: "0".repeat(64), proposals: [proposal], currentCandidates: [current] }), null);
  assert.equal(revalidateAdminApprovedCandidate({ venueId: "venue-1", evidenceHash, proposals: [{ ...proposal, candidateGmlId: "missing" }], currentCandidates: [current] }), null);
  assert.equal(revalidateAdminApprovedCandidate({ venueId: "venue-1", evidenceHash, proposals: [proposal], currentCandidates: [{ ...current, sourceTiles: [] }] }), null);
  assert.equal(revalidateAdminApprovedCandidate({ venueId: "venue-1", evidenceHash, proposals: [proposal], currentCandidates: [{ ...current, latitude: 0 }] }), null);
});

test("venue evidence identity changes when decision inputs change", () => {
  assert.notEqual(computeVenueEvidenceHash(evidence), computeVenueEvidenceHash({ ...evidence, events: [{ ...evidence.events[0], address: "Different address" }] }));
});
