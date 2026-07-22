import assert from "node:assert/strict";
import test from "node:test";

import {
  assessEventDateQuality,
  auditEventDates,
  createDateReviewItem,
  DATE_QUALITY_POLICY_VERSION,
  parseEventDate,
  validateDateReviewArtifact,
} from "../scripts/lib/event-pipeline/date-quality-audit.mjs";

const options = { asOf: "2026-07-22T00:00:00+08:00" };

test("event date audit accepts a plausible future event", () => {
  const result = assessEventDateQuality(
    {
      id: "normal",
      title: "Concert",
      sourceName: "Example",
      schedule: {
        start: "2026-09-19T20:00:00+08:00",
        end: "2026-09-19T22:00:00+08:00",
      },
    },
    options,
  );
  assert.equal(result.status, "plausible");
  assert.deepEqual(result.reasons, []);
});

test("event date audit identifies missing, stale, inverted, and placeholder dates", () => {
  const report = auditEventDates(
    [
      { id: "missing", sourceName: "A", title: "Undated" },
      {
        id: "stale",
        sourceName: "A",
        schedule: { start: "2025-01-01", end: "2025-01-02" },
      },
      {
        id: "inverted",
        sourceName: "B",
        schedule: { start: "2026-09-02", end: "2026-09-01" },
      },
      {
        id: "waitlist",
        sourceName: "B",
        title: "Show waitlist",
        schedule: { start: "2050-01-01", end: "2050-01-01" },
        availability: "waitlist",
      },
    ],
    options,
  );
  assert.equal(report.counts.questionable, 4);
  assert.equal(report.byReason.missing_date, 1);
  assert.equal(report.byReason.stale_or_expired, 1);
  assert.equal(report.byReason.inverted_interval, 1);
  assert.equal(report.byReason.far_future, 1);
  assert.equal(report.byReason.known_placeholder_year, 1);
  assert.equal(report.byReason.waitlist_placeholder_date, 1);
  assert.equal(report.bySource.B.questionable, 2);
});

test("event date audit reports unparseable and conflicting fields", () => {
  const result = assessEventDateQuality(
    {
      id: "conflict",
      schedule: { start: "not a date" },
      startsAt: "2026-08-01T10:00:00+08:00",
      startDateTime: "2026-08-05T10:00:00+08:00",
    },
    options,
  );
  assert.equal(result.status, "questionable");
  assert.ok(
    result.reasons.some(({ code }) => code === "conflicting_start_fields"),
  );
  assert.equal(parseEventDate("not a date"), null);
});

test("a date-only end covers the full Singapore calendar day", () => {
  const result = assessEventDateQuality(
    {
      schedule: {
        start: "2026-07-23T19:30:00+08:00",
        end: "2026-07-23",
      },
    },
    options,
  );
  assert.equal(result.status, "plausible");
});

test("selectable and anytime schedules do not require an invented exact date", () => {
  for (const kind of ["selectable", "anytime", "recurring"]) {
    const result = assessEventDateQuality(
      {
        id: kind,
        schedule: {
          kind,
          displayText: kind === "recurring" ? "Every Saturday" : kind,
          recurrence: kind === "recurring" ? "weekly" : null,
        },
      },
      options,
    );
    assert.equal(result.status, "plausible", kind);
  }
});

test("review identity is stable for unchanged evidence and changes with evidence", () => {
  const event = {
    id: "source:event#1",
    parentActivityId: "activity:one",
    sourceName: "Example",
    title: "Undated event",
    schedule: { kind: "unverified" },
    provenanceRefs: ["raw/example.json#/records/0"],
    fieldCompleteness: {
      schedule: { evidenceHash: "evidence-one" },
    },
  };
  const assessment = assessEventDateQuality(event, options);
  const first = createDateReviewItem(event, assessment, {
    ...options,
    sourceRecordRef: "raw/example.json#/records/0",
    occurrenceIndex: 0,
  });
  const repeated = createDateReviewItem(event, assessment, {
    ...options,
    sourceRecordRef: "raw/example.json#/records/0",
    occurrenceIndex: 0,
  });
  const changed = createDateReviewItem(
    {
      ...event,
      fieldCompleteness: {
        schedule: { evidenceHash: "evidence-two" },
      },
    },
    assessment,
    { ...options, sourceRecordRef: "raw/example.json#/records/0", occurrenceIndex: 0 },
  );
  assert.equal(first.reviewId, repeated.reviewId);
  assert.notEqual(first.reviewId, changed.reviewId);
  assert.equal(first.policyVersion, DATE_QUALITY_POLICY_VERSION);
  assert.deepEqual(first.reasonCodes, ["missing_date"]);
  assert.equal(first.status, "needs_review");
  assert.equal(first.lifecycleState, "held");
  const corrected = assessEventDateQuality(
    {
      ...event,
      schedule: { kind: "exact", start: "2026-08-01" },
      dateText: "2026-08-01",
    },
    options,
  );
  assert.equal(corrected.status, "plausible");
  assert.throws(
    () => createDateReviewItem(event, corrected, options),
    /questionable date assessment/,
  );
});

test("date-review identity follows schedule evidence before unrelated field evidence", () => {
  const base = {
    id: "event-one",
    sourceName: "Example",
    schedule: { kind: "unverified" },
    provenanceRefs: ["raw/example.json#/records/0"],
    fieldCompleteness: {
      title: { evidenceHash: "unchanged-title" },
      schedule: { evidenceHash: "schedule-one" },
    },
  };
  const assessment = assessEventDateQuality(base, options);
  const first = createDateReviewItem(base, assessment, options);
  const changed = createDateReviewItem(
    {
      ...base,
      fieldCompleteness: {
        ...base.fieldCompleteness,
        schedule: { evidenceHash: "schedule-two" },
      },
    },
    assessment,
    options,
  );
  assert.notEqual(first.reviewId, changed.reviewId);
  assert.equal(first.evidenceHash, "schedule-one");
  assert.equal(changed.evidenceHash, "schedule-two");
});

test("future and duration thresholds are deterministic at their boundaries", () => {
  const atHorizon = assessEventDateQuality(
    { schedule: { start: "2029-07-22T00:00:00+08:00" } },
    options,
  );
  const pastHorizon = assessEventDateQuality(
    { schedule: { start: "2029-07-22T00:00:01+08:00" } },
    options,
  );
  const atDuration = assessEventDateQuality(
    { schedule: { start: "2026-07-22", end: "2028-07-20" } },
    options,
  );
  assert.equal(atHorizon.status, "plausible");
  assert.ok(pastHorizon.reasons.some(({ code }) => code === "far_future"));
  assert.ok(
    !atDuration.reasons.some(
      ({ code }) => code === "implausibly_long_interval",
    ),
  );
});

test("date-review artifact validation rejects overlap and unknown reasons", () => {
  const event = {
    id: "event-one",
    sourceName: "Example",
    schedule: { kind: "unverified" },
    provenanceRefs: ["raw/example.json#/records/0"],
  };
  const assessment = assessEventDateQuality(event, options);
  const review = createDateReviewItem(event, assessment, {
    ...options,
    sourceRecordRef: "raw/example.json#/records/0",
  });
  const envelope = {
    schemaVersion: "3.0",
    counts: { records: 1 },
    records: [review],
  };
  assert.equal(validateDateReviewArtifact(envelope), envelope);
  assert.throws(
    () => validateDateReviewArtifact(envelope, { acceptedEventIds: [event.id] }),
    /both accepted and held/,
  );
  assert.throws(
    () =>
      validateDateReviewArtifact({
        ...envelope,
        records: [{ ...review, reasonCodes: ["unknown_reason"] }],
      }),
    /Invalid normalized date review contract/,
  );
});
