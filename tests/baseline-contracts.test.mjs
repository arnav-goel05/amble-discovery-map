import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractValidationError,
  validateApprovedSnapshot,
  validateEventOccurrence,
  validateLifecycleTimestamps,
  validateResultEnvelope,
  validateSourceRecord,
  validateVenueEvidence,
  validateVenueReview,
} from "../scripts/lib/contracts/baseline-contracts.mjs";
import { approvedSnapshot, sourceRecord, venueEvidence } from "./helpers/baseline-fixtures.mjs";

const hash = (character) => character.repeat(64);
const rejectsWith = (callback, code) => assert.throws(callback, (error) => {
  assert(error instanceof ContractValidationError);
  assert.equal(error.code, code);
  return true;
});

test("source records require immutable provenance and an inclusive window", () => {
  assert.equal(validateSourceRecord(sourceRecord()).listingIdentity, "fixture-listing-1");
  rejectsWith(() => validateSourceRecord(sourceRecord({ recordPointer: "https://example.test/raw.json" })), "source_record_pointer_invalid");
  rejectsWith(() => validateSourceRecord(sourceRecord({ requestedWindow: { start: "2026-07-21", end: "2026-07-14", timezone: "Asia/Singapore" } })), "source_record_window_invalid");
});

test("canonical occurrences keep occurrence, parent, and merged identities separate", () => {
  const occurrence = {
    schemaVersion: "1.0", occurrenceId: "fixture:occurrence-1", parentListingId: "fixture:list-1",
    mergedEventId: "merged:fixture", sourceName: "Fixture Official", sourceEventId: "event-1",
    title: "Fixture Event", startsAt: "2026-07-14T02:00:00.000Z", endsAt: "2026-07-14T03:00:00.000Z",
    allDay: false, timezone: "Asia/Singapore", venueId: "venue-fixture", venueName: "Fixture Venue",
    addressEvidence: [], description: null, category: null, officialUrl: "https://example.test/events/1",
    contentHash: hash("d"), provenanceRefs: ["raw/fixture/listing.json#/records/0"], reviewStatus: "eligible",
  };
  assert.equal(validateEventOccurrence(occurrence).occurrenceId, "fixture:occurrence-1");
  rejectsWith(() => validateEventOccurrence({ ...occurrence, occurrenceId: occurrence.parentListingId }), "event_occurrence_identity_collapsed");
  rejectsWith(() => validateEventOccurrence({ ...occurrence, startsAt: occurrence.endsAt, endsAt: occurrence.startsAt }), "event_occurrence_schedule_invalid");
});

test("venue evidence and review contracts enforce partition and evidence-bound decisions", () => {
  assert.equal(validateVenueEvidence(venueEvidence()).resolutionStatus, "pending");
  rejectsWith(() => validateVenueEvidence(venueEvidence({ eventIds: ["event-1", "event-1"] })), "venue_event_partition_invalid");

  const review = {
    schemaVersion: "1.0", reviewId: "review-1", venueId: "venue-fixture", evidenceHash: hash("b"),
    evidenceSnapshot: {}, candidates: [{ gmlId: "SLA_BLDG2_1" }], status: "approved",
    decisionCandidateGmlId: "SLA_BLDG2_1", decisionReason: "Unique official-address match",
    idempotencyKey: "decision-1", createdAt: "2026-07-14T00:00:00.000Z", decidedAt: "2026-07-14T00:05:00.000Z",
  };
  assert.equal(validateVenueReview(review).status, "approved");
  rejectsWith(() => validateVenueReview({ ...review, decisionCandidateGmlId: "SLA_BLDG2_UNKNOWN" }), "venue_review_candidate_invalid");
});

test("snapshot and result envelopes reject incomplete or misleading states", () => {
  assert.equal(validateApprovedSnapshot(approvedSnapshot()).snapshotId, "snapshot-fixture");
  rejectsWith(() => validateApprovedSnapshot(approvedSnapshot({ freshness: "fresh", staleAfter: "2026-07-13T00:00:00.000Z" })), "snapshot_freshness_invalid");

  const result = { schemaVersion: "1.0", status: "success", data: { id: 1 }, fetchedAt: "2026-07-14T00:00:00.000Z", stale: false, warning: null, source: { id: "fixture", costClass: "free" } };
  assert.equal(validateResultEnvelope(result).status, "success");
  rejectsWith(() => validateResultEnvelope({ ...result, status: "unavailable", data: { old: true }, stale: false }), "result_envelope_unavailable_data");
  rejectsWith(() => validateResultEnvelope({ ...result, stale: true, warning: null }), "result_envelope_stale_warning_missing");
});

test("lifecycle timestamps are valid and monotonically ordered", () => {
  assert.equal(validateLifecycleTimestamps({ createdAt: "2026-07-14T00:00:00.000Z", lastActivityAt: "2026-07-15T00:00:00.000Z", expiresAt: "2026-07-22T00:00:00.000Z" }).expiresAt, "2026-07-22T00:00:00.000Z");
  rejectsWith(() => validateLifecycleTimestamps({ createdAt: "2026-07-15T00:00:00.000Z", expiresAt: "2026-07-14T00:00:00.000Z" }), "lifecycle_timestamp_order_invalid");
});
