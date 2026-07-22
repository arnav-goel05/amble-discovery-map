import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_IDS = Object.freeze({
  "Catch.sg": "catch",
  SISTIC: "sistic",
  "Fever Singapore": "fever",
  "Visit Singapore All Happenings": "visit",
  "Singapore Film Society": "sfs",
  Honeycombers: "honey",
  ArtsEquator: "arts",
  "Time Out Singapore": "timeout",
});

const SOURCE_LABELS = Object.freeze({
  "Visit Singapore All Happenings": "Visit Singapore",
});

const readRecords = (runDir, relativePath) => {
  const artifactPath = join(runDir, relativePath);
  return existsSync(artifactPath)
    ? JSON.parse(readFileSync(artifactPath, "utf8")).records ?? []
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
  highlightedPois = 0,
}) {
  const resolutionsByEvent = new Map();
  for (const venue of Object.values(status.venues ?? {}))
    for (const eventId of venue.eventIds ?? []) {
      const resolutions = resolutionsByEvent.get(eventId) ?? [];
      resolutions.push(venue.resolve?.resolutionStatus ?? "unknown");
      resolutionsByEvent.set(eventId, resolutions);
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

  const reasons = {};
  for (const record of excluded) {
    const sourceName = record.event?.sourceName ?? record.sourceName;
    if (!sourceName || !record.reasonCode) continue;
    reasons[sourceName] ??= {};
    reasons[sourceName][record.reasonCode] =
      (reasons[sourceName][record.reasonCode] ?? 0) + 1;
  }

  const sources = Object.entries(status.sources ?? {}).map(
    ([sourceName, source]) => {
      const counts = source.counts ?? {};
      const outcomes = placement[sourceName] ?? {
        mapped: 0,
        notMappable: 0,
        review: 0,
        offMap: 0,
        dedup: counts.duplicateCollapsed ?? 0,
      };
      return {
        id: SOURCE_IDS[sourceName] ?? sourceName.toLowerCase().replaceAll(/\W+/g, "-"),
        name: SOURCE_LABELS[sourceName] ?? sourceName,
        status: sourceStatus(source),
        records: counts.sourceRecordsReceived ?? 0,
        fieldTotal: counts.processedSourceRecords ?? 0,
        occurrences: counts.occurrencesEmitted ?? 0,
        eligible: counts.eligiblePreDedup ?? 0,
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
    uniqueActivities:
      status.deduplication?.counts?.acceptedPrimary ??
      status.normalization?.counts?.acceptedPrimary ??
      0,
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
  return buildEventDashboardPayload({
    status,
    events: readRecords(runDir, "normalized/events.json"),
    excluded: readRecords(runDir, "normalized/excluded.json"),
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
