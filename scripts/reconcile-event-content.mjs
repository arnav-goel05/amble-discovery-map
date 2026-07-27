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

const eventSourceNames = (event) =>
  new Set(
    [
      ...(event.sources ?? []).map(({ source }) => source),
      ...(event.sourceContributions ?? []).map(contributionSource),
    ].filter(Boolean),
  );

const filterSupportedSources = (event, supportedSources) => ({
  ...event,
  sources: (event.sources ?? []).filter(
    ({ source }) => !source || supportedSources.has(source),
  ),
  sourceContributions: (event.sourceContributions ?? []).filter((item) => {
    const source = contributionSource(item);
    return !source || supportedSources.has(source);
  }),
});

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
  const landmarkEventKey = (event) =>
    String(
      event.identityAnchor ??
        event.occurrenceId ??
        event.id ??
        stableEventKey(event),
    );
  const ownedVenues = new Set(sourceVenues.map(normalizeVenue));
  const retained = (current.events || []).filter(
    (event) => !ownedVenues.has(normalizeVenue(event.venue)),
  );
  const events = new Map(
    retained.map((event) => [landmarkEventKey(event), event]),
  );
  const claimedPriorIndexes = new Set();
  for (const event of next.events || []) {
    let priorIndex = -1;
    let priorScore = -1;
    for (const [index, candidate] of (current.events ?? []).entries()) {
      if (claimedPriorIndexes.has(index)) continue;
      const score = publishedEventMatchScore(candidate, event);
      if (score > priorScore) {
        priorIndex = index;
        priorScore = score;
      }
    }
    const prior = priorIndex >= 0 ? current.events[priorIndex] : null;
    if (prior) claimedPriorIndexes.add(priorIndex);
    const reconciled = reconcileActivityIdentity(prior, event);
    events.set(landmarkEventKey(reconciled), reconciled);
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
  const supportedSources = new Set(Object.keys(sourceStatuses));
  const preparedPrevious = previousEvents.map((original) => {
    const sourceNames = eventSourceNames(original);
    const retiredSourceNames = [...sourceNames].filter(
      (source) => !supportedSources.has(source),
    );
    return {
      original,
      event: filterSupportedSources(original, supportedSources),
      retiredSourceNames,
      retiredOnly:
        sourceNames.size > 0 && retiredSourceNames.length === sourceNames.size,
    };
  });
  const previousByAnchor = new Map(
    preparedPrevious.map(({ event }) => [stableEventKey(event), event]),
  );
  const currentAnchors = new Set();
  const traces = [];
  const events = currentEvents.map((incoming) => {
    const prior =
      previousByAnchor.get(stableEventKey(incoming)) ??
      preparedPrevious
        .map(({ event }) => event)
        .find((event) => {
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
  for (const {
    original,
    event: previous,
    retiredOnly,
    retiredSourceNames,
  } of preparedPrevious) {
    if (currentAnchors.has(stableEventKey(previous))) continue;
    if (retiredOnly) {
      traces.push({
        eventId: stableEventKey(previous),
        outcome: "archived",
        reasonCode: "source_retired",
        sourceNames: retiredSourceNames,
        sourceRecordIds: (original.sourceContributions ?? [])
          .map(({ sourceRecordId }) => sourceRecordId)
          .filter(Boolean),
      });
      continue;
    }
    const contributionStatuses = [...eventSourceNames(previous)]
      .map((source) => sourceStatuses[source])
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
      retired: traces.filter(
        ({ reasonCode }) => reasonCode === "source_retired",
      ).length,
    },
  };
}

const occurrenceAliases = (event) =>
  new Set(
    [
      event.id,
      event.occurrenceId,
      event.identityAnchor,
      event.publishedEventId,
      ...(event.sourceOccurrenceIds ?? []),
    ].filter(Boolean),
  );

const scheduleAliases = (event) =>
  new Set(
    [
      event.schedule?.start,
      event.schedule?.end,
      event.startsAt,
      event.endsAt,
      event.startDateTime,
      event.endDateTime,
      event.dateText,
    ].filter(Boolean),
  );

const publishedEventMatchScore = (published, current) => {
  const publishedAliases = occurrenceAliases(published);
  if (
    [...occurrenceAliases(current)].some((alias) =>
      publishedAliases.has(alias),
    )
  )
    return 100;
  const publishedSources = sourceIdentities(published);
  const related =
    (published.parentActivityId &&
      published.parentActivityId === current.parentActivityId) ||
    [...sourceIdentities(current)].some((identity) =>
      publishedSources.has(identity),
    );
  if (!related) return -1;
  const publishedSchedule = scheduleAliases(published);
  const currentSchedule = scheduleAliases(current);
  const scheduleMatch = [...currentSchedule].some((value) =>
    publishedSchedule.has(value),
  );
  if (publishedSchedule.size && currentSchedule.size && !scheduleMatch)
    return -1;
  const venueMatch =
    normalizeVenue(published.venue) &&
    normalizeVenue(published.venue) === normalizeVenue(current.venue);
  if (!scheduleMatch && !venueMatch) return -1;
  return 1 + (scheduleMatch ? 20 : 0) + (venueMatch ? 5 : 0);
};

export function reconcilePublishedLandmarks({ landmarks = [], events = [] }) {
  const removedEventIds = [];
  const records = landmarks.map((landmark) => {
    const claimedCurrentIndexes = new Set();
    return {
      ...landmark,
      events: (landmark.events ?? []).flatMap((published) => {
        let currentIndex = -1;
        let currentScore = -1;
        for (const [index, event] of events.entries()) {
          if (claimedCurrentIndexes.has(index)) continue;
          const score = publishedEventMatchScore(published, event);
          if (score > currentScore) {
            currentIndex = index;
            currentScore = score;
          }
        }
        const current = currentIndex >= 0 ? events[currentIndex] : null;
        if (!current) {
          removedEventIds.push(stableEventKey(published));
          return [];
        }
        claimedCurrentIndexes.add(currentIndex);
        if (current.lifecycleState && current.lifecycleState !== "active") {
          removedEventIds.push(stableEventKey(published));
          return [];
        }
        return [
          {
          ...published,
          ...current,
          coordinates: published.coordinates,
          venueVerified: published.venueVerified,
          publicPlacement: published.publicPlacement,
          mappingStatus: published.mappingStatus,
          lifecycleState:
            current.lifecycleState ?? published.lifecycleState ?? "active",
        },
      ];
      }),
    };
  });
  return { records, removedEventIds };
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
