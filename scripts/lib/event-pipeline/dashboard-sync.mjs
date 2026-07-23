import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectEventActivities } from "./activity-projection.mjs";

const SOURCE_IDS = Object.freeze({
  "Catch.sg": "catch",
  SISTIC: "sistic",
  "Fever Singapore": "fever",
  "Visit Singapore All Happenings": "visit",
  "Singapore Film Society": "sfs",
  "Time Out Singapore": "timeout",
});

const SOURCE_LABELS = Object.freeze({
  "Visit Singapore All Happenings": "Visit Singapore",
});

const readRecords = (runDir, relativePath) => {
  const artifactPath = join(runDir, relativePath);
  return existsSync(artifactPath)
    ? (JSON.parse(readFileSync(artifactPath, "utf8")).records ?? [])
    : [];
};

function placementFor(event, resolutionStatuses) {
  if (resolutionStatuses.includes("approved")) return "mapped";
  if (resolutionStatuses.includes("needs_review")) return "review";
  if (
    resolutionStatuses.length > 0 &&
    resolutionStatuses.every((status) => status === "not_mappable")
  )
    return "notMappable";
  return "offMap";
}

const distinctActivityKey = (event) =>
  event?.parentActivityId ??
  event?.parentListingId ??
  event?.parentEventId ??
  event?.sourceEventId ??
  event?.id ??
  null;

const EXCLUSION_REASON_PRIORITY = Object.freeze([
  "missing_venue",
  "ordinary_attraction_admission",
  "membership_offer",
  "authority_domain_review",
  "online",
  "outside_singapore",
  "expired",
]);

function terminalReason(reasonCodes) {
  return (
    EXCLUSION_REASON_PRIORITY.find((reason) => reasonCodes.has(reason)) ??
    [...reasonCodes].sort()[0] ??
    "unknown"
  );
}

function sourceStatus(source) {
  const counts = source.counts ?? {};
  const parts = [source.status === "success" ? "Success" : source.status];
  if (counts.listingAppearances > counts.sourceRecordsReceived)
    parts.push(
      `${counts.listingAppearances} appearances → ${counts.sourceRecordsReceived} records`,
    );
  else if (counts.sourceRecordsReceived)
    parts.push(`${counts.sourceRecordsReceived} records`);
  if (counts.invalidSourceRecords)
    parts.push(`${counts.invalidSourceRecords} invalid`);
  if (source.role === "discovery") parts.push("discovery source");
  return parts.join(" · ");
}

function fieldCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts.fieldCompleteness ?? {}).map(([field, values]) => [
      field,
      [
        values.present ?? 0,
        values.not_published_by_source ?? 0,
        values.extraction_failed ?? 0,
      ],
    ]),
  );
}

export function buildEventDashboardPayload({
  status,
  events,
  excluded,
  dateReviews = [],
  activities = null,
  groupingReviews = null,
  highlightedPois = 0,
}) {
  const projection = activities
    ? {
        activities: { records: activities },
        reviews: { records: groupingReviews ?? [] },
      }
    : projectEventActivities({
        events,
        runId: status.runId,
        generatedAt:
          status.finalizedAt ?? status.createdAt ?? "1970-01-01T00:00:00.000Z",
      });
  const activityRecords = projection.activities.records ?? [];
  const dashboardActivities = activityRecords.filter((activity) =>
    (activity.sources ?? []).some((sourceName) => SOURCE_IDS[sourceName]),
  );
  const activityCountsBySource = new Map();
  const offerCountsBySource = new Map();
  for (const activity of dashboardActivities)
    for (const source of activity.sources ?? [])
      activityCountsBySource.set(
        source,
        (activityCountsBySource.get(source) ?? 0) + 1,
      );
  for (const activity of dashboardActivities)
    for (const offer of activity.sourceOffers ?? [])
      offerCountsBySource.set(
        offer.source,
        (offerCountsBySource.get(offer.source) ?? 0) + 1,
      );
  const resolutionsByEvent = new Map();
  for (const venue of Object.values(status.venues ?? {}))
    for (const eventId of venue.eventIds ?? []) {
      const resolutions = resolutionsByEvent.get(eventId) ?? [];
      resolutions.push(venue.resolve?.resolutionStatus ?? "unknown");
      resolutionsByEvent.set(eventId, resolutions);
    }

  const reviewedParentActivities = new Set(
    dateReviews
      .map((review) => distinctActivityKey(review.event ?? review))
      .filter(Boolean),
  );
  const distinctPlacement = {};
  for (const activity of dashboardActivities) {
    const statuses = (activity.occurrenceIds ?? []).flatMap(
      (eventId) => resolutionsByEvent.get(eventId) ?? [],
    );
    if (
      (activity.sourceParentActivityIds ?? []).some((id) =>
        reviewedParentActivities.has(id),
      )
    )
      statuses.push("needs_review");
    const outcome = placementFor(activity, statuses);
    for (const sourceName of new Set(activity.sources ?? [])) {
      distinctPlacement[sourceName] ??= {
        mapped: 0,
        notMappable: 0,
        review: 0,
        offMap: 0,
      };
      distinctPlacement[sourceName][outcome] += 1;
    }
  }

  const placement = {};
  for (const event of events) {
    const sourceOccurrences = {};
    for (const source of event.sources ?? [{ source: event.sourceName }])
      sourceOccurrences[source.source] =
        (sourceOccurrences[source.source] ?? 0) + 1;
    const outcome = placementFor(
      event,
      resolutionsByEvent.get(event.occurrenceId ?? event.id) ?? [],
    );
    for (const [sourceName, occurrences] of Object.entries(sourceOccurrences)) {
      placement[sourceName] ??= {
        mapped: 0,
        notMappable: 0,
        review: 0,
        offMap: 0,
        dedup: 0,
      };
      placement[sourceName][outcome] += 1;
      placement[sourceName].dedup += occurrences - 1;
    }
  }

  const acceptedParentActivities = new Set(
    events.map(distinctActivityKey).filter(Boolean),
  );
  const rejectedActivityGroups = new Map();
  for (const record of excluded) {
    const event = record.event ?? record;
    const sourceName = event.sourceName ?? record.sourceName;
    const activityKey = distinctActivityKey(event);
    if (
      !sourceName ||
      !SOURCE_IDS[sourceName] ||
      !activityKey ||
      !record.reasonCode ||
      acceptedParentActivities.has(activityKey)
    )
      continue;
    const key = `${sourceName}\0${activityKey}`;
    const group = rejectedActivityGroups.get(key) ?? {
      sourceName,
      reasonCodes: new Set(),
    };
    group.reasonCodes.add(record.reasonCode);
    rejectedActivityGroups.set(key, group);
  }
  const distinctReasons = {};
  const distinctExcludedBySource = new Map();
  for (const group of rejectedActivityGroups.values()) {
    const reasonCode = terminalReason(group.reasonCodes);
    distinctExcludedBySource.set(
      group.sourceName,
      (distinctExcludedBySource.get(group.sourceName) ?? 0) + 1,
    );
    distinctReasons[group.sourceName] ??= {};
    distinctReasons[group.sourceName][reasonCode] =
      (distinctReasons[group.sourceName][reasonCode] ?? 0) + 1;
  }

  const reasons = {};
  for (const record of excluded) {
    const sourceName = record.event?.sourceName ?? record.sourceName;
    if (!sourceName || !record.reasonCode) continue;
    reasons[sourceName] ??= {};
    reasons[sourceName][record.reasonCode] =
      (reasons[sourceName][record.reasonCode] ?? 0) + 1;
  }
  for (const review of dateReviews) {
    const sourceName = review.sourceName ?? review.event?.sourceName;
    if (!sourceName) continue;
    placement[sourceName] ??= {
      mapped: 0,
      notMappable: 0,
      review: 0,
      offMap: 0,
      dedup: 0,
    };
    placement[sourceName].review += 1;
    reasons[sourceName] ??= {};
    for (const reasonCode of new Set(review.reasonCodes ?? []))
      reasons[sourceName][reasonCode] =
        (reasons[sourceName][reasonCode] ?? 0) + 1;
  }

  const sources = Object.entries(status.sources ?? {})
    .filter(([sourceName]) => SOURCE_IDS[sourceName])
    .map(
    ([sourceName, source]) => {
      const counts = source.counts ?? {};
      const outcomes = placement[sourceName] ?? {
        mapped: 0,
        notMappable: 0,
        review: 0,
        offMap: 0,
        dedup: counts.duplicateCollapsed ?? 0,
      };
      const distinctOutcomes = distinctPlacement[sourceName] ?? {
        mapped: 0,
        notMappable: 0,
        review: 0,
        offMap: 0,
      };
      const distinctEligible = activityCountsBySource.get(sourceName) ?? 0;
      const distinctExcluded = distinctExcludedBySource.get(sourceName) ?? 0;
      return {
        id:
          SOURCE_IDS[sourceName] ??
          sourceName.toLowerCase().replaceAll(/\W+/g, "-"),
        name: SOURCE_LABELS[sourceName] ?? sourceName,
        status: sourceStatus(source),
        records: counts.sourceRecordsReceived ?? 0,
        fieldTotal: counts.processedSourceRecords ?? 0,
        occurrences: counts.occurrencesEmitted ?? 0,
        eligible: counts.eligiblePreDedup ?? 0,
        activities: activityCountsBySource.get(sourceName) ?? 0,
        sourceOffers: offerCountsBySource.get(sourceName) ?? 0,
        distinctFound: distinctEligible + distinctExcluded,
        distinctEligible,
        distinctExcluded,
        distinctMapped: distinctOutcomes.mapped,
        distinctNotMappable: distinctOutcomes.notMappable,
        distinctReview: distinctOutcomes.review,
        distinctOffMap: distinctOutcomes.offMap,
        distinctReasons: distinctReasons[sourceName] ?? {},
        dedup: outcomes.dedup,
        excluded: counts.excludedOccurrences ?? 0,
        mapped: outcomes.mapped,
        notMappable: outcomes.notMappable,
        review: outcomes.review,
        offMap: outcomes.offMap,
        reasons: reasons[sourceName] ?? {},
        fields: fieldCounts(counts),
      };
    },
  );

  return {
    schemaVersion: "1.0",
    runId: status.runId,
    finalizedAt: status.finalizedAt,
    status: status.status,
    publication: status.publication,
    window: status.window,
    activityCount: dashboardActivities.length,
    occurrenceCount: events.length,
    sessionCount: dashboardActivities.reduce(
      (sum, activity) => sum + (activity.sessions?.length ?? 0),
      0,
    ),
    venueGroupCount: dashboardActivities.reduce(
      (sum, activity) => sum + (activity.venueGroups?.length ?? 0),
      0,
    ),
    sourceOfferCount: dashboardActivities.reduce(
      (sum, activity) => sum + (activity.sourceOffers?.length ?? 0),
      0,
    ),
    groupingReviewCount: projection.reviews.records?.length ?? 0,
    uniqueActivities: dashboardActivities.length,
    distinctFoundActivities:
      dashboardActivities.length + rejectedActivityGroups.size,
    distinctRejectedActivities: rejectedActivityGroups.size,
    crossSourceDuplicateCollapsed:
      status.deduplication?.counts?.crossSourceDuplicateCollapsed ?? 0,
    highlightedPois,
    sources,
  };
}

export function buildEventDashboardPayloadFromRun(
  runDir,
  status,
  { highlightedPois = 0 } = {},
) {
  const activitiesPath = join(runDir, "normalized/activities.json");
  const groupingReviewsPath = join(
    runDir,
    "normalized/activity-grouping-reviews.json",
  );
  return buildEventDashboardPayload({
    status,
    events: readRecords(runDir, "normalized/events.json"),
    excluded: readRecords(runDir, "normalized/excluded.json"),
    dateReviews: readRecords(runDir, "normalized/date-reviews.json"),
    activities: existsSync(activitiesPath)
      ? readRecords(runDir, "normalized/activities.json")
      : null,
    groupingReviews: existsSync(groupingReviewsPath)
      ? readRecords(runDir, "normalized/activity-grouping-reviews.json")
      : null,
    highlightedPois,
  });
}

export async function syncEventDashboard(
  payload,
  {
    url = process.env.EVENT_DASHBOARD_SYNC_URL,
    token = process.env.EVENT_DASHBOARD_SYNC_TOKEN,
    fetchImpl = fetch,
    timeoutMs = 15_000,
  } = {},
) {
  if (!url || !token)
    return { status: "skipped", reasonCode: "dashboard_sync_not_configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "PUT",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok)
      return {
        status: "failed",
        reasonCode: "dashboard_sync_http_error",
        httpStatus: response.status,
      };
    return { status: "success", httpStatus: response.status };
  } catch (error) {
    return {
      status: "failed",
      reasonCode:
        error?.name === "AbortError"
          ? "dashboard_sync_timeout"
          : "dashboard_sync_request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
