const CANDIDATE_TYPES = new Set([
  "event",
  "venue",
  "restaurant",
  "deal",
  "plan_stop",
  "game",
]);
const SOURCE_STATUSES = new Set(["fresh", "empty", "stale", "unavailable"]);

export class CandidateEnvelopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CandidateEnvelopeError";
    this.code = code;
  }
}

export class DiscoveryValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DiscoveryValidationError";
    this.code = code;
  }
}

const candidateFail = (code, message) => {
  throw new CandidateEnvelopeError(code, message);
};
const discoveryFail = (code, message) => {
  throw new DiscoveryValidationError(code, message);
};
const finiteCoordinate = (value, min, max) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

function validateCandidate(candidate, source) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.candidateId !== "string" ||
    !/^[a-z][a-z0-9_-]*:.+/.test(candidate.candidateId)
  )
    candidateFail(
      "candidate_identity_invalid",
      "Candidate identity is invalid",
    );
  if (
    !CANDIDATE_TYPES.has(candidate.candidateType) ||
    typeof candidate.areaId !== "string" ||
    !candidate.areaId ||
    !Array.isArray(candidate.coordinates) ||
    candidate.coordinates.length !== 2 ||
    !finiteCoordinate(candidate.coordinates[0], -180, 180) ||
    !finiteCoordinate(candidate.coordinates[1], -90, 90) ||
    !candidate.attributes ||
    typeof candidate.attributes !== "object" ||
    Array.isArray(candidate.attributes)
  )
    candidateFail("candidate_identity_invalid", "Candidate fields are invalid");
  if (candidate.sourceSnapshotId !== source.sourceSnapshotId)
    candidateFail(
      "candidate_snapshot_unapproved",
      "Candidate snapshot is not approved by its source",
    );
  if (
    !Array.isArray(candidate.evidenceRefs) ||
    candidate.evidenceRefs.length === 0 ||
    candidate.evidenceRefs.some((value) => typeof value !== "string" || !value)
  )
    candidateFail(
      "candidate_evidence_missing",
      "Candidate evidence is required",
    );
  return structuredClone(candidate);
}

export function createApprovedCandidateEnvelope({
  sourceSnapshotId,
  generatedAt,
  sources,
} = {}) {
  if (
    typeof sourceSnapshotId !== "string" ||
    !sourceSnapshotId ||
    Number.isNaN(Date.parse(generatedAt)) ||
    !Array.isArray(sources)
  )
    candidateFail(
      "candidate_envelope_invalid",
      "Candidate envelope metadata is invalid",
    );
  const identities = new Set();
  const approvedCandidates = [];
  const summaries = [];
  for (const source of sources) {
    if (
      !source ||
      typeof source.sourceId !== "string" ||
      !source.sourceId ||
      !SOURCE_STATUSES.has(source.status) ||
      !Array.isArray(source.candidates)
    )
      candidateFail("candidate_source_invalid", "Candidate source is invalid");
    if (source.approved !== true)
      candidateFail(
        "candidate_source_unapproved",
        "Candidate source is not approved",
      );
    const normalizedStatus =
      source.status === "fresh" && source.candidates.length === 0
        ? "empty"
        : source.status;
    let count = 0;
    if (normalizedStatus === "fresh") {
      for (const item of source.candidates) {
        const validated = validateCandidate(item, source);
        if (identities.has(validated.candidateId))
          candidateFail(
            "candidate_identity_duplicate",
            "Candidate identity is duplicated",
          );
        identities.add(validated.candidateId);
        approvedCandidates.push(validated);
        count += 1;
      }
    }
    summaries.push({
      sourceId: source.sourceId,
      status: normalizedStatus,
      candidateCount: count,
    });
  }
  approvedCandidates.sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  summaries.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {
    schemaVersion: "1.0",
    sourceSnapshotId,
    generatedAt,
    candidates: approvedCandidates,
    sources: summaries,
  };
}

function closedObject(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

export function orderSuggestedAreas(areas = []) {
  return areas
    .map((area) => structuredClone(area))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.areaId.localeCompare(right.areaId),
    )
    .map((area, index) => ({ ...area, rank: index + 1 }));
}

export function validateDiscoveryResult(result, envelope) {
  if (
    !closedObject(
      result,
      new Set(["intentRevision", "areas", "clarification"]),
    ) ||
    !Number.isSafeInteger(result.intentRevision) ||
    result.intentRevision < 0 ||
    !Array.isArray(result.areas) ||
    result.areas.length > 5
  )
    discoveryFail(
      "discovery_schema_invalid",
      "Discovery result schema is invalid",
    );
  const candidates = new Map(
    (envelope?.candidates || []).map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const areas = new Set([...candidates.values()].map(({ areaId }) => areaId));
  for (const [index, area] of result.areas.entries()) {
    if (
      !closedObject(
        area,
        new Set([
          "areaId",
          "rank",
          "confidence",
          "reasons",
          "tradeoffs",
          "candidateIds",
        ]),
      ) ||
      !Array.isArray(area.candidateIds) ||
      area.candidateIds.length === 0 ||
      new Set(area.candidateIds).size !== area.candidateIds.length ||
      !Array.isArray(area.reasons) ||
      area.reasons.length < 1 ||
      area.reasons.length > 3 ||
      !Array.isArray(area.tradeoffs) ||
      area.tradeoffs.length > 2
    )
      discoveryFail(
        "discovery_schema_invalid",
        "Suggested area schema is invalid",
      );
    if (!areas.has(area.areaId))
      discoveryFail("discovery_area_unknown", "Suggested area is unknown");
    if (
      !Number.isFinite(area.confidence) ||
      area.confidence < 0 ||
      area.confidence > 1
    )
      discoveryFail(
        "discovery_confidence_invalid",
        "Suggested confidence is invalid",
      );
    if (
      !Number.isInteger(area.rank) ||
      area.rank !== index + 1 ||
      (index > 0 && result.areas[index - 1].confidence < area.confidence)
    )
      discoveryFail("discovery_rank_invalid", "Suggested rank is invalid");
    for (const candidateId of area.candidateIds) {
      const candidate = candidates.get(candidateId);
      if (!candidate)
        discoveryFail(
          "discovery_candidate_unknown",
          "Suggested candidate is unknown",
        );
      if (candidate.areaId !== area.areaId)
        discoveryFail(
          "discovery_candidate_area_mismatch",
          "Suggested candidate belongs to a different area",
        );
    }
    for (const reason of area.reasons) {
      if (
        !closedObject(
          reason,
          new Set(["text", "candidateIds", "attributeKeys"]),
        ) ||
        typeof reason.text !== "string" ||
        !reason.text ||
        reason.text.length > 180 ||
        !Array.isArray(reason.candidateIds) ||
        reason.candidateIds.length === 0 ||
        !Array.isArray(reason.attributeKeys) ||
        reason.attributeKeys.length === 0
      )
        discoveryFail(
          "discovery_schema_invalid",
          "Discovery reason is invalid",
        );
      if (
        reason.candidateIds.some(
          (candidateId) => !area.candidateIds.includes(candidateId),
        )
      )
        discoveryFail(
          "discovery_reason_candidate_invalid",
          "Discovery reason cites a candidate outside the area result",
        );
      for (const candidateId of reason.candidateIds) {
        const candidate = candidates.get(candidateId);
        if (!candidate)
          discoveryFail(
            "discovery_candidate_unknown",
            "Discovery reason candidate is unknown",
          );
        if (
          reason.attributeKeys.some(
            (key) => !Object.hasOwn(candidate.attributes, key),
          )
        )
          discoveryFail(
            "discovery_claim_unsupported",
            "Discovery reason cites an unsupported attribute",
          );
      }
    }
  }
  const clarification = result.clarification;
  if (
    clarification !== null &&
    (!closedObject(
      clarification,
      new Set(["question", "answerType", "choices"]),
    ) ||
      typeof clarification.question !== "string" ||
      !clarification.question ||
      !["choice", "short"].includes(clarification.answerType) ||
      (clarification.answerType === "choice" &&
        (!Array.isArray(clarification.choices) ||
          clarification.choices.length < 2 ||
          clarification.choices.length > 5)))
  )
    discoveryFail(
      "discovery_schema_invalid",
      "Discovery clarification is invalid",
    );
  return structuredClone(result);
}

export function reconcileDiscoveryAreas(previous = [], next = []) {
  const before = new Map(previous.map((area) => [area.areaId, area]));
  const after = new Map(next.map((area) => [area.areaId, area]));
  return [
    ...next.map((area) => ({
      ...area,
      status: !before.has(area.areaId)
        ? "create"
        : JSON.stringify(before.get(area.areaId)) === JSON.stringify(area)
          ? "noop"
          : "update",
    })),
    ...previous
      .filter((area) => !after.has(area.areaId))
      .map((area) => ({ ...area, status: "expire" })),
  ];
}
