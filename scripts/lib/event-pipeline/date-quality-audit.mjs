import { createHash } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DATE_QUALITY_POLICY_VERSION = "1.0";
export const DATE_QUALITY_REASON_CODES = Object.freeze([
  "missing_date",
  "unparseable_date",
  "conflicting_start_fields",
  "inverted_interval",
  "implausibly_long_interval",
  "stale_or_expired",
  "far_future",
  "known_placeholder_year",
  "waitlist_placeholder_date",
  "date_assessment_failed",
]);

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseEventDate(value, { endOfDay = false } = {}) {
  const text = clean(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${endOfDay ? "23:59:59" : "00:00:00"}+08:00`
    : text;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateFields(record) {
  return {
    scheduleStart: record.schedule?.start,
    startsAt: record.startsAt,
    startDateTime: record.startDateTime,
    dateText: record.dateText,
    scheduleDisplayText: record.schedule?.displayText,
  };
}

function normalizedBoundaryFields(record) {
  return {
    scheduleStart: record.schedule?.start,
    startsAt: record.startsAt,
    startDateTime: record.startDateTime,
  };
}

function finalFields(record) {
  return {
    finalKnownOccurrence: record.schedule?.finalKnownOccurrence,
    scheduleEnd: record.schedule?.end,
    endsAt: record.endsAt,
    endDateTime: record.endDateTime,
  };
}

function firstParsed(fields, parseOptions) {
  for (const [field, value] of Object.entries(fields)) {
    const timestamp = parseEventDate(value, parseOptions);
    if (timestamp !== null) return { field, value: clean(value), timestamp };
  }
  return null;
}

function sourcesOf(record) {
  const sources = (record.sources ?? [])
    .map(({ source }) => source)
    .filter(Boolean);
  return [...new Set(sources.length ? sources : [record.sourceName].filter(Boolean))];
}

function addReason(reasons, code, detail) {
  if (!reasons.some((reason) => reason.code === code))
    reasons.push({ code, detail });
}

function calendarYear(value, timestamp) {
  const publishedYear = clean(value)?.match(/\b(\d{4})\b/)?.[1];
  if (publishedYear) return Number(publishedYear);
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Singapore",
      year: "numeric",
    }).format(timestamp),
  );
}

export function assessEventDateQuality(
  record,
  { asOf, futureHorizonYears = 3, maximumDurationDays = 730 } = {},
) {
  const asOfTimestamp = parseEventDate(asOf) ?? Date.now();
  const startFields = dateFields(record);
  const endFields = finalFields(record);
  const publishedStartValues = Object.entries(startFields).filter(([, value]) =>
    clean(value),
  );
  const parsedStarts = Object.entries(normalizedBoundaryFields(record))
    .map(([field, value]) => ({ field, value, timestamp: parseEventDate(value) }))
    .filter(({ timestamp }) => timestamp !== null);
  const start = firstParsed(startFields);
  const end = firstParsed(endFields, { endOfDay: true }) ?? start;
  const reasons = [];

  const intentionalFlexibleSchedule =
    ["anytime", "selectable"].includes(record.schedule?.kind) ||
    (record.schedule?.kind === "recurring" &&
      Boolean(record.schedule?.recurrence ?? clean(record.schedule?.displayText)));

  if (!publishedStartValues.length && !intentionalFlexibleSchedule)
    addReason(reasons, "missing_date", "No start date was published or normalized.");
  else if (!start && !intentionalFlexibleSchedule)
    addReason(
      reasons,
      "unparseable_date",
      "Date text exists but none of the normalized start fields can be parsed.",
    );

  if (parsedStarts.length > 1) {
    const timestamps = parsedStarts.map(({ timestamp }) => timestamp);
    if (Math.max(...timestamps) - Math.min(...timestamps) > DAY_MS)
      addReason(
        reasons,
        "conflicting_start_fields",
        "Normalized start fields disagree by more than one day.",
      );
  }

  if (start && end && end.timestamp < start.timestamp)
    addReason(reasons, "inverted_interval", "The event ends before it starts.");

  if (
    start &&
    end &&
    end.timestamp >= start.timestamp &&
    end.timestamp - start.timestamp > maximumDurationDays * DAY_MS
  )
    addReason(
      reasons,
      "implausibly_long_interval",
      `The event interval exceeds ${maximumDurationDays} days.`,
    );

  if (end && end.timestamp < asOfTimestamp)
    addReason(
      reasons,
      "stale_or_expired",
      "The final known occurrence is before the audit date.",
    );

  if (start) {
    const horizon = new Date(asOfTimestamp);
    horizon.setUTCFullYear(horizon.getUTCFullYear() + futureHorizonYears);
    if (start.timestamp > horizon.getTime())
      addReason(
        reasons,
        "far_future",
        `The start is more than ${futureHorizonYears} years after the audit date.`,
      );

    const year = calendarYear(start.value, start.timestamp);
    if ([2038, 2050, 2099, 9999].includes(year))
      addReason(
        reasons,
        "known_placeholder_year",
        `${year} is commonly used as a sentinel or placeholder year.`,
      );

    const waitlistText = [
      record.title,
      record.availability,
      ...record.sessions?.map(({ availability }) => availability) ?? [],
    ]
      .filter(Boolean)
      .join(" ");
    if (/\bwaitlist\b/i.test(waitlistText) && start.timestamp > horizon.getTime())
      addReason(
        reasons,
        "waitlist_placeholder_date",
        "A waitlist record carries an implausibly distant concrete date.",
      );
  }

  return {
    schemaVersion: "1.0",
    policyVersion: DATE_QUALITY_POLICY_VERSION,
    asOf: new Date(asOfTimestamp).toISOString(),
    id: record.id ?? record.occurrenceId ?? null,
    parentActivityId: record.parentActivityId ?? null,
    title: record.title ?? null,
    sources: sourcesOf(record),
    start: start
      ? { field: start.field, value: start.value, iso: new Date(start.timestamp).toISOString() }
      : null,
    end: end
      ? { field: end.field, value: end.value, iso: new Date(end.timestamp).toISOString() }
      : null,
    status: reasons.length ? "questionable" : "plausible",
    reasons,
  };
}

function evidenceHashOf(record) {
  if (clean(record.fieldCompleteness?.schedule?.evidenceHash))
    return record.fieldCompleteness.schedule.evidenceHash;
  for (const assessment of Object.values(record.fieldCompleteness ?? {}))
    if (clean(assessment?.evidenceHash)) return assessment.evidenceHash;
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: record.id ?? record.occurrenceId ?? null,
        schedule: record.schedule ?? null,
        startsAt: record.startsAt ?? null,
        endsAt: record.endsAt ?? null,
        dateText: record.dateText ?? null,
        provenanceRefs: record.provenanceRefs ?? [],
      }),
    )
    .digest("hex");
}

export function failedDateAssessment(record, { asOf } = {}) {
  const asOfTimestamp = parseEventDate(asOf) ?? Date.now();
  return {
    schemaVersion: "1.0",
    policyVersion: DATE_QUALITY_POLICY_VERSION,
    asOf: new Date(asOfTimestamp).toISOString(),
    id: record.id ?? record.occurrenceId ?? null,
    parentActivityId: record.parentActivityId ?? null,
    title: record.title ?? null,
    sources: sourcesOf(record),
    start: null,
    end: null,
    status: "questionable",
    reasons: [
      {
        code: "date_assessment_failed",
        detail: "Date-quality assessment failed; the identity was held safely.",
      },
    ],
  };
}

export function createDateReviewItem(
  event,
  assessment,
  { asOf, sourceRecordRef = null, occurrenceIndex = 0 } = {},
) {
  if (assessment?.status !== "questionable" || !assessment.reasons?.length)
    throw new Error("A questionable date assessment is required");
  const evidenceHash = evidenceHashOf(event);
  const identity = event.id ?? event.occurrenceId;
  if (!identity) throw new Error("Date review requires a stable event identity");
  const reviewId = `date-review:${createHash("sha256")
    .update(JSON.stringify([identity, evidenceHash, DATE_QUALITY_POLICY_VERSION]))
    .digest("hex")
    .slice(0, 24)}`;
  return {
    schemaVersion: "1.0",
    reviewId,
    eventId: identity,
    parentActivityId: event.parentActivityId ?? null,
    sourceName: event.sourceName ?? assessment.sources?.[0] ?? null,
    sourceRecordRef: sourceRecordRef ?? event.provenanceRefs?.[0] ?? null,
    occurrenceIndex,
    evidenceHash,
    policyVersion: DATE_QUALITY_POLICY_VERSION,
    asOf: asOf ?? assessment.asOf,
    status: "needs_review",
    lifecycleState: "held",
    reasonCodes: assessment.reasons.map(({ code }) => code).toSorted(),
    assessment,
    event: {
      ...event,
      lifecycleState: "held",
      reviewStatus: "needs_review",
      dateReviewReasonCodes: assessment.reasons
        .map(({ code }) => code)
        .toSorted(),
    },
  };
}

export function auditEventDates(records, options = {}) {
  const assessments = records.map((record) =>
    assessEventDateQuality(record, options),
  );
  const questionable = assessments.filter(({ status }) => status === "questionable");
  const byReason = {};
  const bySource = {};
  for (const assessment of questionable) {
    for (const { code } of assessment.reasons)
      byReason[code] = (byReason[code] ?? 0) + 1;
    for (const source of assessment.sources) {
      const entry = (bySource[source] ??= { questionable: 0, reasons: {} });
      entry.questionable += 1;
      for (const { code } of assessment.reasons)
        entry.reasons[code] = (entry.reasons[code] ?? 0) + 1;
    }
  }
  const examplesByReason = Object.fromEntries(
    Object.keys(byReason)
      .sort()
      .map((code) => [
        code,
        questionable
          .filter(({ reasons }) => reasons.some((reason) => reason.code === code))
          .slice(0, options.exampleLimit ?? 5),
      ]),
  );
  return {
    counts: {
      records: assessments.length,
      plausible: assessments.length - questionable.length,
      questionable: questionable.length,
    },
    byReason,
    bySource,
    examplesByReason,
    assessments,
  };
}

export function summarizeDateReviews(items = []) {
  const byReason = {};
  const bySource = {};
  for (const item of items) {
    const source = item.sourceName ?? "unknown";
    const sourceSummary = (bySource[source] ??= { needsReview: 0, reasons: {} });
    sourceSummary.needsReview += 1;
    for (const code of new Set(item.reasonCodes ?? [])) {
      byReason[code] = (byReason[code] ?? 0) + 1;
      sourceSummary.reasons[code] = (sourceSummary.reasons[code] ?? 0) + 1;
    }
  }
  return { needsReview: items.length, byReason, bySource };
}

export function validateDateReviewArtifact(
  artifact,
  { acceptedEventIds = [] } = {},
) {
  if (
    artifact?.schemaVersion !== "3.0" ||
    !Array.isArray(artifact.records) ||
    artifact.counts?.records !== artifact.records.length
  )
    throw new Error("Invalid normalized date-review envelope");
  const accepted = new Set(acceptedEventIds);
  const reviewIds = new Set();
  const eventIds = new Set();
  for (const review of artifact.records) {
    if (
      review.schemaVersion !== "1.0" ||
      review.policyVersion !== DATE_QUALITY_POLICY_VERSION ||
      review.status !== "needs_review" ||
      review.lifecycleState !== "held" ||
      !clean(review.reviewId) ||
      !clean(review.eventId) ||
      !clean(review.evidenceHash) ||
      !clean(review.sourceRecordRef) ||
      !Array.isArray(review.reasonCodes) ||
      review.reasonCodes.length === 0 ||
      new Set(review.reasonCodes).size !== review.reasonCodes.length ||
      review.reasonCodes.some(
        (code) => !DATE_QUALITY_REASON_CODES.includes(code),
      )
    )
      throw new Error("Invalid normalized date review contract");
    if (reviewIds.has(review.reviewId) || eventIds.has(review.eventId))
      throw new Error(
        "Normalized date reviews require unique review and event identities",
      );
    if (accepted.has(review.eventId))
      throw new Error("An event cannot be both accepted and held for date review");
    reviewIds.add(review.reviewId);
    eventIds.add(review.eventId);
  }
  return artifact;
}
