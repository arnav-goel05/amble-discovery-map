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

function catalogueCandidates(source) {
  if (!Array.isArray(source?.items)) return null;
  if (
    typeof source.catalogRevision !== "string" ||
    !source.catalogRevision ||
    !Array.isArray(source.sources) ||
    source.sources.length === 0
  )
    discoveryFail(
      "discovery_catalog_invalid",
      "Discovery catalogue revision or provenance is invalid",
    );
  return source.items.map((item) => ({
    candidateId: item.targetId,
    candidateType: item.type,
    areaId:
      item.attributes?.areaId ?? (item.type === "area" ? item.targetId : null),
    coordinates: null,
    attributes: structuredClone(item.attributes || {}),
    label: item.label,
  }));
}

export function discoveryCandidates(source) {
  const projected = catalogueCandidates(source);
  return projected ?? structuredClone(source?.candidates || []);
}

function normalizedResult(result, legacy) {
  if (!legacy) return result;
  const mode = result.areas?.length
    ? "recommendations"
    : result.clarification
      ? "clarification"
      : "no_match";
  return {
    ...result,
    mode,
    clarification: mode === "recommendations" ? null : result.clarification,
    message: null,
  };
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

export function validateDiscoveryResult(
  result,
  source,
  { catalogRevision = null } = {},
) {
  const legacy =
    !Object.hasOwn(result || {}, "mode") &&
    !Object.hasOwn(result || {}, "message") &&
    Array.isArray(source?.candidates);
  const normalized = normalizedResult(result, legacy);
  if (
    Array.isArray(source?.items) &&
    catalogRevision !== null &&
    catalogRevision !== source.catalogRevision
  )
    discoveryFail(
      "discovery_catalog_revision_mismatch",
      "Discovery result is bound to a different catalogue revision",
    );
  if (
    !closedObject(
      normalized,
      new Set(["intentRevision", "mode", "areas", "clarification", "message"]),
    ) ||
    !Number.isSafeInteger(normalized.intentRevision) ||
    normalized.intentRevision < 0 ||
    !["recommendations", "clarification", "no_match"].includes(
      normalized.mode,
    ) ||
    !Array.isArray(normalized.areas) ||
    normalized.areas.length > 5 ||
    (normalized.message !== null &&
      (typeof normalized.message !== "string" ||
        normalized.message.length < 1 ||
        normalized.message.length > 240))
  )
    discoveryFail(
      "discovery_schema_invalid",
      "Discovery result schema is invalid",
    );
  if (
    (normalized.mode === "recommendations" &&
      (normalized.areas.length === 0 ||
        normalized.clarification !== null ||
        normalized.message !== null)) ||
    (normalized.mode === "clarification" &&
      (normalized.areas.length !== 0 ||
        normalized.clarification === null ||
        normalized.message !== null)) ||
    (normalized.mode === "no_match" &&
      (normalized.areas.length !== 0 ||
        normalized.clarification !== null ||
        (!legacy && normalized.message === null)))
  )
    discoveryFail(
      "discovery_schema_invalid",
      "Discovery result mode is inconsistent with its content",
    );
  const candidates = new Map(
    discoveryCandidates(source).map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const areas = new Set([...candidates.values()].map(({ areaId }) => areaId));
  for (const [index, area] of normalized.areas.entries()) {
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
      area.candidateIds.length > 20 ||
      new Set(area.candidateIds).size !== area.candidateIds.length ||
      !Array.isArray(area.reasons) ||
      area.reasons.length < 1 ||
      area.reasons.length > 3 ||
      !Array.isArray(area.tradeoffs) ||
      area.tradeoffs.length < 1 ||
      area.tradeoffs.length > 2 ||
      area.tradeoffs.some(
        (tradeoff) =>
          typeof tradeoff !== "string" ||
          !tradeoff.trim() ||
          tradeoff.length > 140,
      )
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
      (index > 0 && normalized.areas[index - 1].confidence < area.confidence)
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
        reason.candidateIds.length > 20 ||
        new Set(reason.candidateIds).size !== reason.candidateIds.length ||
        !Array.isArray(reason.attributeKeys) ||
        reason.attributeKeys.length === 0 ||
        reason.attributeKeys.length > 12 ||
        new Set(reason.attributeKeys).size !== reason.attributeKeys.length ||
        reason.attributeKeys.some(
          (key) => typeof key !== "string" || !key || key.length > 64,
        )
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
  const clarification = legacy
    ? result.clarification
    : normalized.clarification;
  if (
    clarification !== null &&
    (!closedObject(
      clarification,
      new Set(["question", "answerType", "choices"]),
    ) ||
      typeof clarification.question !== "string" ||
      !clarification.question ||
      clarification.question.length > 180 ||
      !["choice", "short"].includes(clarification.answerType) ||
      (clarification.answerType === "choice" &&
        (!Array.isArray(clarification.choices) ||
          clarification.choices.length < 2 ||
          clarification.choices.length > 5 ||
          clarification.choices.some(
            (choice) =>
              typeof choice !== "string" || !choice || choice.length > 60,
          ))) ||
      (clarification.answerType === "short" &&
        clarification.choices !== undefined))
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
