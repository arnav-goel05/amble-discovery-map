const VERSION = "1.0";
const HASH = /^[a-f0-9]{64}$/i;
const REVIEW_STATUSES = new Set(["eligible", "undated_review", "invalid", "not_physical"]);
const RESOLUTION_STATUSES = new Set(["pending", "approved_reuse", "candidate_matched", "needs_review", "not_mappable", "invalid"]);
const VENUE_REVIEW_STATUSES = new Set(["pending", "approved", "rejected", "deferred", "superseded"]);

export class ContractValidationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ContractValidationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new ContractValidationError(code, message, details); };
const object = (value, code) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, "Expected an object");
  return value;
};
const text = (value, code) => {
  if (typeof value !== "string" || !value.trim()) fail(code, "Expected non-empty text");
  return value;
};
const version = (value) => { if (value !== VERSION) fail("schema_version_unsupported", `Unsupported schema version: ${String(value)}`); };
const timestamp = (value, code) => {
  text(value, code);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail(code, "Expected a canonical ISO 8601 UTC timestamp");
  return date;
};
const dateOnly = (value, code) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) fail(code, "Expected an ISO calendar date");
  return value;
};
const hash = (value, code) => { if (typeof value !== "string" || !HASH.test(value)) fail(code, "Expected a SHA-256 hex digest"); };
const stringArray = (value, code, { nonEmpty = false, unique = false } = {}) => {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || !item.trim())) fail(code, "Expected an array of non-empty strings");
  if (unique && new Set(value).size !== value.length) fail(code, "Array identities must be unique");
  return value;
};
const httpUrl = (value, code) => {
  try { if (!/^https?:$/.test(new URL(value).protocol)) throw new Error(); }
  catch { fail(code, "Expected an HTTP(S) URL"); }
};

export function validateSourceRecord(value) {
  const record = object(value, "source_record_invalid");
  version(record.schemaVersion);
  for (const field of ["runId", "adapterId", "adapterVersion", "sourceName", "listingIdentity"]) text(record[field], `source_record_${field}_missing`);
  httpUrl(record.sourceUrl, "source_record_url_invalid");
  timestamp(record.retrievedAt, "source_record_retrieved_at_invalid");
  const window = object(record.requestedWindow, "source_record_window_invalid");
  const start = dateOnly(window.start, "source_record_window_invalid");
  const end = dateOnly(window.end, "source_record_window_invalid");
  if (start > end || window.timezone !== "Asia/Singapore") fail("source_record_window_invalid", "Requested window must be ordered and use Asia/Singapore");
  if (typeof record.recordPointer !== "string" || !/^(?![a-z]+:\/\/)(?!\/)(?:raw|records|sources)\/.+#\//i.test(record.recordPointer)) fail("source_record_pointer_invalid", "Record pointer must be a run-relative JSON pointer");
  hash(record.payloadHash, "source_record_payload_hash_invalid");
  const provenance = object(record.provenance, "source_record_provenance_invalid");
  if (!new Set(["GET", "POST"]).has(provenance.method)) fail("source_record_provenance_invalid", "Unsupported request method");
  return record;
}

export function validateEventOccurrence(value) {
  const event = object(value, "event_occurrence_invalid");
  version(event.schemaVersion);
  for (const field of ["occurrenceId", "parentListingId", "mergedEventId", "sourceName", "sourceEventId", "title", "timezone"]) text(event[field], `event_occurrence_${field}_missing`);
  if (event.occurrenceId === event.parentListingId || event.occurrenceId === event.mergedEventId) fail("event_occurrence_identity_collapsed", "Occurrence identity must remain separate from grouping identities");
  if (event.timezone !== "Asia/Singapore" || typeof event.allDay !== "boolean") fail("event_occurrence_schedule_invalid", "Schedule interpretation is invalid");
  const startsAt = event.startsAt === null ? null : timestamp(event.startsAt, "event_occurrence_schedule_invalid");
  const endsAt = event.endsAt === null ? null : timestamp(event.endsAt, "event_occurrence_schedule_invalid");
  if (startsAt && endsAt && endsAt < startsAt) fail("event_occurrence_schedule_invalid", "Event end precedes start");
  if (event.reviewStatus === "eligible") {
    text(event.venueId, "event_occurrence_venue_missing");
    text(event.venueName, "event_occurrence_venue_missing");
  }
  if (!REVIEW_STATUSES.has(event.reviewStatus)) fail("event_occurrence_review_status_invalid", "Unsupported review status");
  if (event.officialUrl !== null) httpUrl(event.officialUrl, "event_occurrence_official_url_invalid");
  hash(event.contentHash, "event_occurrence_content_hash_invalid");
  stringArray(event.provenanceRefs, "event_occurrence_provenance_missing", { nonEmpty: true, unique: true });
  return event;
}

export function validateVenueEvidence(value) {
  const venue = object(value, "venue_evidence_invalid");
  for (const field of ["venueId", "normalizedName"]) text(venue[field], `venue_${field}_missing`);
  stringArray(venue.rawNames, "venue_raw_names_invalid", { nonEmpty: true, unique: true });
  stringArray(venue.eventIds, "venue_event_partition_invalid", { nonEmpty: true, unique: true });
  hash(venue.evidenceHash, "venue_evidence_hash_invalid");
  if (!Array.isArray(venue.addressCandidates) || !Array.isArray(venue.postalCodes) || !Array.isArray(venue.coordinateCandidates) || !Array.isArray(venue.recoveryAttempts) || !Array.isArray(venue.candidateBuildings)) fail("venue_evidence_collections_invalid", "Venue evidence collections are required");
  for (const coordinate of venue.coordinateCandidates) {
    const lat = Number(coordinate?.lat), lng = Number(coordinate?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !coordinate.source) fail("venue_coordinate_invalid", "Invalid evidence coordinate");
  }
  if (!RESOLUTION_STATUSES.has(venue.resolutionStatus)) fail("venue_resolution_status_invalid", "Unsupported venue resolution status");
  return venue;
}

export function validateVenueReview(value) {
  const review = object(value, "venue_review_invalid");
  version(review.schemaVersion);
  for (const field of ["reviewId", "venueId"]) text(review[field], `venue_review_${field}_missing`);
  hash(review.evidenceHash, "venue_review_evidence_hash_invalid");
  object(review.evidenceSnapshot, "venue_review_evidence_invalid");
  if (!Array.isArray(review.candidates) || !VENUE_REVIEW_STATUSES.has(review.status)) fail("venue_review_status_invalid", "Venue review state is invalid");
  timestamp(review.createdAt, "venue_review_created_at_invalid");
  if (review.status === "approved") {
    text(review.decisionCandidateGmlId, "venue_review_candidate_invalid");
    if (!review.candidates.some((candidate) => candidate?.gmlId === review.decisionCandidateGmlId)) fail("venue_review_candidate_invalid", "Approved candidate is absent from the evidence snapshot");
  }
  if (["approved", "rejected"].includes(review.status)) text(review.decisionReason, "venue_review_reason_missing");
  if (["approved", "rejected", "deferred"].includes(review.status)) {
    text(review.idempotencyKey, "venue_review_idempotency_key_missing");
    timestamp(review.decidedAt, "venue_review_decided_at_invalid");
    validateLifecycleTimestamps({ createdAt: review.createdAt, decidedAt: review.decidedAt });
  }
  return review;
}

export function validateApprovedSnapshot(value, { now = null } = {}) {
  const snapshot = object(value, "approved_snapshot_invalid");
  version(snapshot.schemaVersion);
  text(snapshot.snapshotId, "snapshot_id_missing");
  const publishedAt = timestamp(snapshot.publishedAt, "snapshot_published_at_invalid");
  const staleAfter = timestamp(snapshot.staleAfter, "snapshot_stale_after_invalid");
  if (staleAfter <= publishedAt) fail("snapshot_freshness_invalid", "staleAfter must follow publishedAt");
  const window = object(snapshot.coveredWindow, "snapshot_window_invalid");
  if (dateOnly(window.start, "snapshot_window_invalid") > dateOnly(window.end, "snapshot_window_invalid") || window.timezone !== "Asia/Singapore") fail("snapshot_window_invalid", "Snapshot window is invalid");
  if (!new Set(["fresh", "potentially_outdated"]).has(snapshot.freshness)) fail("snapshot_freshness_invalid", "Snapshot freshness is invalid");
  object(snapshot.sourceHealth, "snapshot_source_health_invalid");
  for (const field of ["landmarksRef", "poisRef", "tilesetRef"]) {
    if (typeof snapshot[field] !== "string" || !snapshot[field] || pathIsUnsafe(snapshot[field])) fail("snapshot_reference_invalid", `Invalid ${field}`);
  }
  hash(snapshot.contentHash, "snapshot_content_hash_invalid");
  if (snapshot.previousSnapshotId !== null && typeof snapshot.previousSnapshotId !== "string") fail("snapshot_previous_id_invalid", "Previous snapshot identity is invalid");
  if (now && new Date(now) > staleAfter && snapshot.freshness === "fresh") return { ...snapshot, freshness: "potentially_outdated" };
  return snapshot;
}

function pathIsUnsafe(value) { return value.startsWith("/") || value.includes("\\") || value.split("/").includes(".."); }

export function validateResultEnvelope(value) {
  const result = object(value, "result_envelope_invalid");
  version(result.schemaVersion);
  if (!new Set(["success", "unavailable", "error"]).has(result.status)) fail("result_envelope_status_invalid", "Unsupported result status");
  timestamp(result.fetchedAt, "result_envelope_fetched_at_invalid");
  if (typeof result.stale !== "boolean" || !(result.warning === null || typeof result.warning === "string")) fail("result_envelope_state_invalid", "Result freshness state is invalid");
  const source = object(result.source, "result_envelope_source_invalid");
  text(source.id, "result_envelope_source_invalid");
  if (!new Set(["free", "open"]).has(source.costClass)) fail("result_envelope_source_invalid", "Result source must be free or open");
  if (result.status === "success" && (result.data === null || result.data === undefined)) fail("result_envelope_data_missing", "Successful result requires data");
  if (result.status !== "success" && result.data !== null && result.data !== undefined) fail("result_envelope_unavailable_data", "Unavailable/error results cannot claim current data");
  if (result.stale && (result.status !== "success" || !result.warning?.trim())) fail("result_envelope_stale_warning_missing", "Approved stale data requires a warning");
  return result;
}

export function validateLifecycleTimestamps(value) {
  const lifecycle = object(value, "lifecycle_timestamps_invalid");
  const fields = ["createdAt", "lastActivityAt", "expiresAt", "decidedAt", "revokedAt", "deletedAt"].filter((field) => lifecycle[field] !== undefined && lifecycle[field] !== null);
  const parsed = new Map(fields.map((field) => [field, timestamp(lifecycle[field], `lifecycle_${field}_invalid`)]));
  if (!parsed.has("createdAt")) fail("lifecycle_created_at_missing", "createdAt is required");
  for (const field of fields.filter((field) => field !== "createdAt")) if (parsed.get(field) < parsed.get("createdAt")) fail("lifecycle_timestamp_order_invalid", `${field} precedes createdAt`);
  if (parsed.has("lastActivityAt") && parsed.has("expiresAt") && parsed.get("expiresAt") < parsed.get("lastActivityAt")) fail("lifecycle_timestamp_order_invalid", "expiresAt precedes lastActivityAt");
  return lifecycle;
}
