const inSingapore = (latitude, longitude) => Number.isFinite(latitude) && Number.isFinite(longitude)
  && latitude >= 1.13 && latitude <= 1.49 && longitude >= 103.55 && longitude <= 104.15;

function validTileEvidence(sourceTiles) {
  return Array.isArray(sourceTiles) && sourceTiles.length > 0 && sourceTiles.every((tile) =>
    typeof (tile.tilePath ?? tile.path) === "string" && (tile.tilePath ?? tile.path).length > 0
    && Array.isArray(tile.batchIds) && tile.batchIds.length > 0
    && tile.batchIds.every((batchId) => Number.isInteger(Number(batchId))));
}

export function revalidateAdminApprovedCandidate({ venueId, evidenceHash, proposals = [], currentCandidates = [] }) {
  const proposal = proposals.find((item) => item.venueId === venueId && item.evidenceHash === evidenceHash
    && item.status === "proposed_for_pipeline_revalidation");
  if (!proposal?.candidateGmlId) return null;
  const current = currentCandidates.find((candidate) => candidate.gmlId === proposal.candidateGmlId
    || candidate.gmlIds?.includes(proposal.candidateGmlId));
  if (!current || !validTileEvidence(current.sourceTiles)
    || !inSingapore(Number(current.latitude), Number(current.longitude))) return null;
  return {
    ...current,
    adminReview: {
      reviewId: proposal.reviewId,
      evidenceHash,
      candidateGmlId: proposal.candidateGmlId,
      decisionReason: proposal.decisionReason,
      decidedAt: proposal.decidedAt,
    },
  };
}

export { validTileEvidence };
