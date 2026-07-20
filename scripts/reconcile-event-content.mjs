import { createHash } from "node:crypto";

export const normalizeVenue = (value = "") =>
  String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const sourceIdentity = (event) =>
  (event.sources || [])
    .map((source) => `${source.source || ""}:${source.sourceId || ""}`)
    .filter((value) => !value.endsWith(":"))
    .sort()[0];

export const stableEventKey = (event) =>
  String(
    event.identityAnchor ||
      sourceIdentity(event) ||
      event.occurrenceId ||
      event.id ||
      event.parentEventId,
  );

const sourceIdentities = (event) =>
  new Set(
    (event.sources ?? [])
      .map((source) => `${source.source ?? ""}:${source.sourceId ?? ""}`)
      .filter((value) => !value.endsWith(":")),
  );

export function reconcileActivityIdentity(current, incoming) {
  if (!current) return incoming;
  const currentSources = sourceIdentities(current),
    incomingSources = sourceIdentities(incoming);
  const sameActivity =
    Boolean(
      current.parentActivityId &&
      current.parentActivityId === incoming.parentActivityId,
    ) ||
    [...currentSources].some((identity) => incomingSources.has(identity)) ||
    (current.publishedEventId &&
      current.publishedEventId === incoming.publishedEventId) ||
    (current.id && current.id === incoming.id);
  if (!sameActivity) return incoming;
  if (
    !current.identityAnchor &&
    !current.publishedEventId &&
    !current.occurrenceId
  )
    return incoming;
  const identityAnchor =
    current.identityAnchor ??
    current.publishedEventId ??
    stableEventKey(current);
  return {
    ...incoming,
    id: identityAnchor,
    occurrenceId: identityAnchor,
    identityAnchor,
    publishedEventId: current.publishedEventId ?? identityAnchor,
  };
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};

export const contentHash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

export function reconcileLandmark(current, next, sourceVenues) {
  if (!current) return { action: "create", landmark: next };
  const ownedVenues = new Set(sourceVenues.map(normalizeVenue));
  const retained = (current.events || []).filter(
    (event) => !ownedVenues.has(normalizeVenue(event.venue)),
  );
  const events = new Map(
    retained.map((event) => [stableEventKey(event), event]),
  );
  for (const event of next.events || []) {
    const prior = (current.events ?? []).find(
      (candidate) => reconcileActivityIdentity(candidate, event) !== event,
    );
    const reconciled = reconcileActivityIdentity(prior, event);
    events.set(stableEventKey(reconciled), reconciled);
  }
  const landmark = { ...current, ...next, events: [...events.values()] };
  return contentHash(current) === contentHash(landmark)
    ? { action: "noop", landmark: current }
    : { action: "update", landmark };
}

export function reconcilePoi(current, next) {
  if (!current) return { action: "create", poi: next };
  return contentHash(current) === contentHash(next)
    ? { action: "noop", poi: current }
    : { action: "update", poi: next };
}

const contributionSource = (contribution) =>
  contribution.sourceName ??
  String(contribution.sourceRecordId ?? "").split(":")[0] ??
  null;

export function reconcileSourceAvailability({
  previousEvents = [],
  currentEvents = [],
  sourceStatuses = {},
  asOf = new Date().toISOString(),
}) {
  const previousByAnchor = new Map(
    previousEvents.map((event) => [stableEventKey(event), event]),
  );
  const currentAnchors = new Set();
  const traces = [];
  const events = currentEvents.map((incoming) => {
    const prior =
      previousByAnchor.get(stableEventKey(incoming)) ??
      previousEvents.find((event) => {
        const oldIds = sourceIdentities(event),
          newIds = sourceIdentities(incoming);
        return (
          [...oldIds].some((id) => newIds.has(id)) ||
          (event.parentActivityId &&
            event.parentActivityId === incoming.parentActivityId)
        );
      });
    const event = reconcileActivityIdentity(prior, incoming);
    currentAnchors.add(stableEventKey(event));
    if (!prior) return event;
    const currentContributionIds = new Set(
      (event.sourceContributions ?? []).map(
        ({ sourceRecordId }) => sourceRecordId,
      ),
    );
    const carried = (prior.sourceContributions ?? [])
      .filter((contribution) => {
        const status = sourceStatuses[contributionSource(contribution)];
        return (
          !currentContributionIds.has(contribution.sourceRecordId) &&
          status &&
          status !== "success" &&
          status !== "disabled"
        );
      })
      .map((contribution) => ({
        ...contribution,
        freshness: "stale",
        staleSince: contribution.staleSince ?? asOf,
        staleReason: "source_unavailable",
      }));
    if (!carried.length) return event;
    const sourceContributions = [
      ...(event.sourceContributions ?? []),
      ...carried,
    ];
    const fields = [
      ...new Set(sourceContributions.flatMap(({ fields = [] }) => fields)),
    ];
    const fieldFreshness = Object.fromEntries(
      fields.map((field) => [
        field,
        sourceContributions.some(
          (item) =>
            item.freshness === "current" && item.fields?.includes(field),
        )
          ? "current"
          : "stale",
      ]),
    );
    traces.push({
      eventId: stableEventKey(event),
      outcome: "carry_forward_stale",
      sourceRecordIds: carried.map(({ sourceRecordId }) => sourceRecordId),
    });
    return {
      ...event,
      sourceContributions,
      freshness: Object.values(fieldFreshness).every(
        (value) => value === "current",
      )
        ? "current"
        : "stale",
      staleReason: "source_unavailable",
      fieldFreshness,
    };
  });
  for (const previous of previousEvents) {
    if (currentAnchors.has(stableEventKey(previous))) continue;
    const contributionStatuses = (previous.sourceContributions ?? [])
      .map((item) => sourceStatuses[contributionSource(item)])
      .filter(Boolean);
    const expired = isExpiredEvent(previous, asOf);
    if (
      expired ||
      (contributionStatuses.length &&
        contributionStatuses.every((status) => status === "success"))
    ) {
      traces.push({
        eventId: stableEventKey(previous),
        outcome: "archived",
        reasonCode: expired ? "expired" : "source_record_removed",
      });
      continue;
    }
    if (
      contributionStatuses.some(
        (status) => status && status !== "success" && status !== "disabled",
      )
    ) {
      const sourceContributions = (previous.sourceContributions ?? []).map(
        (item) => ({
          ...item,
          freshness: "stale",
          staleSince: item.staleSince ?? asOf,
          staleReason: "source_unavailable",
        }),
      );
      events.push({
        ...previous,
        sourceContributions,
        freshness: "stale",
        staleReason: "source_unavailable",
      });
      traces.push({
        eventId: stableEventKey(previous),
        outcome: "carry_forward_stale",
        sourceRecordIds: sourceContributions.map(
          ({ sourceRecordId }) => sourceRecordId,
        ),
      });
    }
  }
  return {
    events,
    traces,
    counts: {
      current: currentEvents.length,
      carriedForwardStale: traces.filter(
        ({ outcome }) => outcome === "carry_forward_stale",
      ).length,
      archived: traces.filter(({ outcome }) => outcome === "archived").length,
    },
  };
}

const parseEnd = (event) => {
  for (const value of [
    event.schedule?.finalKnownOccurrence,
    event.schedule?.end,
    event.endDateTime,
    event.startDateTime,
  ]) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const dates =
    String(event.dateText || "").match(
      /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/g,
    ) || [];
  if (!dates.length) return null;
  const parsed = Date.parse(`${dates.at(-1)} 23:59:59 GMT+0800`);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isExpiredEvent = (event, asOf) => {
  const end = parseEnd(event);
  return end === null ? false : end < new Date(asOf).valueOf();
};

export function pruneExpiredContent({ landmarks, pois, asOf }) {
  const nextLandmarks = [];
  const removedLandmarkIds = [];
  const expiredEventIds = [];
  const undatedReviewEventIds = [];
  for (const landmark of landmarks) {
    const events = (landmark.events || []).filter((event) => {
      if (parseEnd(event) === null) undatedReviewEventIds.push(event.id);
      const expired = isExpiredEvent(event, asOf);
      if (expired) expiredEventIds.push(event.id);
      return !expired;
    });
    if (!events.length) removedLandmarkIds.push(landmark.id);
    else nextLandmarks.push({ ...landmark, events });
  }
  const removed = new Set(removedLandmarkIds);
  return {
    landmarks: nextLandmarks,
    pois: pois.filter((poi) => !removed.has(poi.id)),
    expiredEventIds,
    removedLandmarkIds,
    undatedReviewEventIds,
  };
}
