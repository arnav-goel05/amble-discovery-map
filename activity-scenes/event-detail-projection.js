import { eventLocationLabel } from "./events/event-location-label.js";
import { plainText } from "./plain-text.js";

const SINGAPORE_TIME_ZONE = "Asia/Singapore";

const optionalText = (value) => plainText(value) || null;

function validUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(
      value,
      globalThis.window?.location?.href ?? "http://localhost/",
    );
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function referenceLabel(url) {
  if (!url) return "Reference";
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "catch.sg") return "Catch.sg";
  if (hostname === "sistic.com.sg") return "SISTIC";
  return hostname;
}

function canonicalOfferReferences(event) {
  const references = [];
  const occurrenceId = event.occurrenceId ?? event.sessionId ?? event.id;
  for (const [index, offer] of (event.sourceOffers ?? []).entries()) {
    const occurrenceIds = offer.sessionIds ?? offer.occurrenceIds ?? [];
    if (offer.scope === "sessions" && !occurrenceIds.includes(occurrenceId))
      continue;
    const url = validUrl(offer.url);
    if (!url) continue;
    const referenceId =
      optionalText(offer.referenceId ?? offer.offerId ?? offer.id) ??
      `reference:${index + 1}`;
    const label =
      optionalText(offer.label ?? offer.source) ?? referenceLabel(url);
    const key = `${referenceId}|${url}`;
    if (
      !references.some(
        (reference) =>
          reference.referenceId === referenceId && reference.url === url,
      )
    )
      references.push({ key, referenceId, label, url });
  }
  return references;
}

function legacyEventReferences(event, eventUrl) {
  const records =
    Array.isArray(event.sources) &&
    event.sources.some((source) => source && typeof source === "object")
      ? event.sources.filter((source) => source && typeof source === "object")
      : [{ source: event.source, sourceUrl: event.sourceUrl || eventUrl }];
  const references = [];
  for (const [index, record] of records.entries()) {
    const url = validUrl(record?.sourceUrl || record?.url || eventUrl);
    const label =
      optionalText(record?.source) || (url ? referenceLabel(url) : null);
    if (!label && !url) continue;
    const referenceId =
      optionalText(record?.referenceId ?? record?.id) ??
      `reference:${index + 1}`;
    const key = `${referenceId}|${url || ""}`;
    if (
      !references.some(
        (reference) =>
          reference.referenceId === referenceId && reference.url === url,
      )
    )
      references.push({
        key,
        referenceId,
        label: label || referenceLabel(url),
        url,
      });
  }
  return references;
}

function eventReferences(event, eventUrl) {
  if (Array.isArray(event.sourceOffers)) return canonicalOfferReferences(event);
  return legacyEventReferences(event, eventUrl);
}

function scheduleTime(schedule, fallbackStart) {
  const timestamp = Date.parse(schedule?.start ?? fallbackStart ?? "");
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SINGAPORE_TIME_ZONE,
  });
}

function scheduleDate(schedule) {
  if (optionalText(schedule?.displayText))
    return optionalText(schedule.displayText);
  const timestamp = Date.parse(schedule?.start ?? "");
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: SINGAPORE_TIME_ZONE,
  });
}

function canonicalActivity(event) {
  return (
    typeof event?.activityId === "string" &&
    Array.isArray(event.sessions) &&
    Array.isArray(event.venueGroups)
  );
}

function venueForSession(activity, session) {
  const venueGroupIds = new Set(session.venueGroupIds ?? []);
  return (
    activity.venueGroups.find(({ venueGroupId }) =>
      venueGroupIds.has(venueGroupId),
    ) ??
    activity.venueGroups.find(({ sessionIds }) =>
      sessionIds?.includes(session.sessionId),
    ) ??
    null
  );
}

function expandCanonicalActivity(activity) {
  if (activity.sessions.length === 0) return [activity];
  return activity.sessions.map((session) => {
    const venueGroup = venueForSession(activity, session);
    return {
      ...activity,
      id: session.sessionId,
      occurrenceId: session.sessionId,
      sessionId: session.sessionId,
      schedule: session.schedule,
      startsAt: session.schedule?.start ?? null,
      endsAt: session.schedule?.end ?? null,
      dateText: session.schedule?.displayText ?? null,
      timeText: null,
      availability: session.availability,
      venue: venueGroup?.label ?? null,
      address: venueGroup?.address ?? null,
      coordinates: venueGroup?.coordinates ?? null,
      approvedLocationId: venueGroup?.approvedLocationId ?? null,
      publicPlacement: venueGroup?.publicPlacement ?? "off_map",
      mappingStatus: venueGroup?.mappingStatus ?? "not_required",
      offMapSubtype: venueGroup?.offMapSubtype ?? null,
      projectedVenueGroupId: venueGroup?.venueGroupId ?? null,
      projectedSessionIds: [session.sessionId],
      venueOccurrences: activity.venueGroups.map((group) => ({
        venueOccurrenceId: group.venueGroupId,
        approvedLocationId: group.approvedLocationId,
        publishedVenueName: group.label,
        offMapSubtype: group.offMapSubtype ?? null,
      })),
    };
  });
}

function normalizeEvent(event, landmark, index) {
  const title = plainText(event.title);
  if (!title) return null;
  const startTimestamp = Date.parse(
    event.schedule?.start || event.startDateTime || event.startsAt || "",
  );
  const explicitEventUrl = validUrl(
    event.eventUrl || event.sourceUrl || event.url,
  );
  const references = eventReferences(event, explicitEventUrl);
  const eventUrl = explicitEventUrl ?? references[0]?.url ?? null;
  return {
    id: event.id || `${landmark.id}-event-${index + 1}`,
    activityId:
      event.activityId ||
      event.parentActivityId ||
      event.parentListingId ||
      `activity:${landmark.id}:${event.id || index + 1}`,
    occurrenceId:
      event.occurrenceId || event.id || `${landmark.id}-event-${index + 1}`,
    sourceIndex: index,
    sortTimestamp: Number.isFinite(startTimestamp)
      ? startTimestamp
      : Number.POSITIVE_INFINITY,
    title,
    date:
      optionalText(event.dateText || event.dateRange || event.date) ??
      scheduleDate(event.schedule),
    time:
      optionalText(event.timeText || event.timeRange || event.time) ??
      scheduleTime(
        event.schedule,
        event.startDateTime || event.startsAt || event.start,
      ),
    locationType: eventLocationLabel(event, { includeDefault: true }),
    venue: optionalText(
      event.venue || (event.venueVerified ? landmark.label : null),
    ),
    address: optionalText(event.address),
    category: optionalText(event.category),
    price: optionalText(event.price),
    description: optionalText(event.description),
    organizer: optionalText(event.organizer),
    eventUrl,
    references,
    anchor: event.coordinates || landmark.anchor || null,
    landmarkId: event.approvedLocationId ?? landmark.id,
    venueGroupId: event.projectedVenueGroupId ?? null,
    sourceEvent: event,
  };
}

function groupNormalizedActivities(occurrences) {
  const grouped = new Map();
  for (const occurrence of occurrences) {
    const rows = grouped.get(occurrence.activityId) ?? [];
    rows.push(occurrence);
    grouped.set(occurrence.activityId, rows);
  }
  return [...grouped.values()]
    .map((rows) => {
      rows.sort(
        (a, b) =>
          a.sortTimestamp - b.sortTimestamp || a.sourceIndex - b.sourceIndex,
      );
      const primary = rows[0];
      const venueGroups = [
        ...new Map(
          rows.map((item) => {
            const key =
              item.venueGroupId ||
              item.landmarkId ||
              item.venue ||
              "location-tba";
            return [
              key,
              {
                venueGroupId: key,
                label: item.venue || "Location TBA",
                occurrences: rows.filter(
                  (candidate) =>
                    (candidate.venueGroupId ||
                      candidate.landmarkId ||
                      candidate.venue ||
                      "location-tba") === key,
                ),
              },
            ];
          }),
        ).values(),
      ];
      const references = [
        ...new Map(
          rows
            .flatMap((item) => item.references)
            .map((item) => [item.key, item]),
        ).values(),
      ];
      const offerCoverage = new Map();
      for (const item of rows)
        for (const reference of item.references) {
          const offer = offerCoverage.get(reference.key) ?? {
            ...reference,
            occurrenceIds: [],
          };
          offer.occurrenceIds.push(item.occurrenceId);
          offerCoverage.set(reference.key, offer);
        }
      const sourceOffers = [...offerCoverage.values()].map((offer) => ({
        ...offer,
        occurrenceIds: [...new Set(offer.occurrenceIds)],
        scope:
          new Set(offer.occurrenceIds).size === rows.length
            ? "activity"
            : "sessions",
      }));
      const finite = rows.filter((item) => Number.isFinite(item.sortTimestamp));
      return {
        ...primary,
        occurrences: rows,
        venueGroups,
        references,
        sourceOffers,
        sessionCount: rows.length,
        scheduleSummary:
          rows.length > 1
            ? `${rows.length} upcoming sessions${finite.length ? ` · ${finite[0].date || ""}${finite.length > 1 ? ` – ${finite.at(-1).date || ""}` : ""}` : ""}`
            : primary.date ||
              primary.sourceEvent?.schedule?.displayText ||
              "Schedule unavailable",
      };
    })
    .sort(
      (a, b) =>
        a.sortTimestamp - b.sortTimestamp ||
        a.activityId.localeCompare(b.activityId),
    );
}

function selectedInputs(sourceEvents, activity) {
  if (canonicalActivity(activity)) return [activity];
  if (activity?.occurrences?.length)
    return activity.occurrences.map(
      (occurrence) => occurrence.sourceEvent ?? occurrence,
    );
  return sourceEvents;
}

export function projectEventDetails({
  landmark,
  sourceEvents = [],
  activity = null,
}) {
  if (!landmark || !Array.isArray(sourceEvents)) return [];
  let sourceIndex = 0;
  const occurrences = [];
  for (const event of selectedInputs(sourceEvents, activity)) {
    const expanded = canonicalActivity(event)
      ? expandCanonicalActivity(event)
      : [event];
    for (const candidate of expanded) {
      const normalized = normalizeEvent(candidate, landmark, sourceIndex);
      sourceIndex += 1;
      if (normalized) occurrences.push(normalized);
    }
  }
  return groupNormalizedActivities(occurrences);
}
