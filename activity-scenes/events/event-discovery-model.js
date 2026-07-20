const normalize = (value) => String(value ?? "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&nbsp;/gi, " ")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const displayText = (value) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
const eventIdentity = (landmarkId, eventId) => `${landmarkId}::${eventId}`;
const eventCandidateIdentity = (landmarkId, eventId) => `event:${landmarkId}:${eventId}`;

function candidateCoordinates(event, landmark) {
  const source = event?.coordinates || landmark?.anchor;
  const longitude = Number(Array.isArray(source) ? source[0] : source?.lng);
  const latitude = Number(Array.isArray(source) ? source[1] : source?.lat);
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    ? [longitude, latitude]
    : null;
}

function candidateEvidence(event) {
  const references = [];
  for (const source of Array.isArray(event?.sources) ? event.sources : []) {
    for (const value of [source?.recordRef, source?.sourceUrl, source?.sourceId]) {
      if (typeof value === "string" && value.trim() && !references.includes(value.trim())) references.push(value.trim());
    }
  }
  for (const value of [event?.eventUrl, event?.sourceUrl]) {
    if (typeof value === "string" && value.trim() && !references.includes(value.trim())) references.push(value.trim());
  }
  return references;
}

function scheduleValue(event) {
  const value = Date.parse(event.schedule?.start || event.startDateTime || event.startsAt || "");
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function scheduleEndValue(event, start) {
  const value = Date.parse(event.schedule?.end || event.endDateTime || event.endsAt || "");
  return Number.isFinite(value) ? value : start;
}

function priceValue(event) {
  const text = displayText(event.price);
  if (!text) return { kind: "unknown", value: null };
  if (/\bfree\b/i.test(text)) return { kind: "free", value: 0 };
  const amounts = [...text.matchAll(/(?:s\$|sgd|\$)?\s*(\d+(?:\.\d{1,2})?)/gi)].map((match) => Number(match[1]));
  return amounts.length ? { kind: "paid", value: Math.min(...amounts) } : { kind: "unknown", value: null };
}

function localDay(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function dateWindow(range, now, dateStart, dateEnd) {
  const customStart = localDay(dateStart);
  const customEnd = localDay(dateEnd, true);
  if (customStart !== null || customEnd !== null) return {
    start: customStart ?? Number.NEGATIVE_INFINITY,
    end: customEnd ?? Number.POSITIVE_INFINITY,
  };
  if (range === "any") return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === "later") {
    const later = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start: later.getTime(), end: Number.POSITIVE_INFINITY };
  }
  const end = new Date(start);
  if (range === "this-month") end.setMonth(end.getMonth() + 1, 1);
  else end.setDate(end.getDate() + ({ today: 1, "7-days": 7, "30-days": 30, "this-week": 7 }[range] || 0));
  return end > start ? { start: start.getTime(), end: end.getTime() - 1 } : null;
}

function matchesPrice(event, range) {
  if (range === "any") return true;
  if (range === "free") return event.priceKind === "free";
  if (event.priceValue === null) return false;
  if (range === "under-25") return event.priceValue > 0 && event.priceValue < 25;
  if (range === "25-50") return event.priceValue >= 25 && event.priceValue <= 50;
  if (range === "50-100") return event.priceValue > 50 && event.priceValue <= 100;
  if (range === "100-plus") return event.priceValue > 100;
  return true;
}

export function createEventDiscoveryModel(landmarks = [], {
  areaIdOf = ({ event, landmark }) => event?.areaId || landmark?.areaId || landmark?.subzoneId || null,
  categoryOf = (event) => event.category || "Other",
  now = () => new Date(),
  sourceSnapshotId = null,
  offMapEvents = [],
} = {}) {
  if (!Array.isArray(landmarks)) throw new TypeError("landmarks must be an array");
  const events = [];
  const landmarkIds = new Set();
  for (const landmark of landmarks) {
    if (!landmark?.id || landmarkIds.has(landmark.id)) throw new Error(`Missing or duplicate landmark identity: ${landmark?.id ?? "unknown"}`);
    landmarkIds.add(landmark.id);
    const localEventIds = new Set();
    for (const [eventIndex, event] of (landmark.events ?? []).entries()) {
      const eventId = event?.id || `${landmark.id}-event-${eventIndex + 1}`;
      if (localEventIds.has(eventId)) throw new Error(`Duplicate event identity ${eventId} in landmark ${landmark.id}`);
      localEventIds.add(eventId);
      const title = displayText(event?.title);
      if (!title) continue;
      const venue = displayText(event.venue || landmark.label);
      const date = displayText(event.dateText || event.dateRange || event.date);
      const time = displayText(event.timeText || event.timeRange || event.time);
      const category = categoryOf(event);
      const startsAt = scheduleValue(event);
      const endsAt = scheduleEndValue(event, startsAt);
      const price = priceValue(event);
      const areaId = areaIdOf({ event, landmark });
      events.push({
        identity: eventIdentity(landmark.id, eventId), landmarkId: landmark.id, eventId, eventIndex,
        title, venue, date, time, category, anchor: landmark.anchor,
        scheduleValue: startsAt, scheduleEndValue: endsAt, priceKind: price.kind, priceValue: price.value,
        candidateId: eventCandidateIdentity(landmark.id, eventId),
        candidateAreaId: typeof areaId === "string" && areaId.trim() ? areaId.trim() : null,
        candidateCoordinates: candidateCoordinates(event, landmark),
        candidateEvidenceRefs: candidateEvidence(event),
        publicPlacement: event.publicPlacement ?? "mapped", mappingStatus: event.mappingStatus ?? "approved",
        offMapSubtype: event.offMapSubtype ?? null, lifecycleState: event.lifecycleState ?? "active", freshness: event.freshness ?? "current",
        scheduleKind: event.schedule?.kind ?? (Number.isFinite(startsAt) ? "exact" : "unverified"), sessions: event.sessions ?? [], venueOccurrences: event.venueOccurrences ?? [],
        sourceEvent: event,
        searchable: normalize([title, venue, landmark.label, date, time, category].join(" ")),
      });
    }
  }
  const offMapIds = new Set();
  for (const [eventIndex, event] of offMapEvents.entries()) {
    const eventId = event?.publishedEventId ?? event?.id;
    if (!eventId || offMapIds.has(eventId)) throw new Error(`Missing or duplicate off-map event identity: ${eventId ?? "unknown"}`);
    offMapIds.add(eventId);
    if (events.some((candidate) => candidate.eventId === eventId)) throw new Error(`Event identity appears in mapped and off-map projections: ${eventId}`);
    const title = displayText(event.title);
    if (!title || event.publicPlacement !== "off_map" || event.lifecycleState === "held") continue;
    const venue = displayText(event.venue ?? event.publishedVenueName ?? event.venueOccurrences?.[0]?.publishedVenueName);
    const startsAt = scheduleValue(event), endsAt = scheduleEndValue(event, startsAt), category = categoryOf(event), price = priceValue(event);
    events.push({
      identity: `off-map::${eventId}`, landmarkId: null, eventId, eventIndex, title, venue,
      date: displayText(event.dateText ?? event.schedule?.displayText), time: displayText(event.timeText), category, anchor: null,
      scheduleValue: startsAt, scheduleEndValue: endsAt, priceKind: price.kind, priceValue: price.value,
      candidateId: `event:off-map:${eventId}`, candidateAreaId: null, candidateCoordinates: null, candidateEvidenceRefs: candidateEvidence(event),
      publicPlacement: "off_map", mappingStatus: event.mappingStatus ?? "not_required", offMapSubtype: event.offMapSubtype ?? event.venueOccurrences?.[0]?.offMapSubtype ?? "geometry_unavailable",
      lifecycleState: event.lifecycleState ?? "active", freshness: event.freshness ?? "current", scheduleKind: event.schedule?.kind ?? "unverified",
      sessions: event.sessions ?? [], venueOccurrences: event.venueOccurrences ?? [], searchable: normalize([title, venue, event.schedule?.displayText, category].join(" ")),
      sourceEvent: event,
    });
  }
  events.sort((left, right) => left.scheduleValue - right.scheduleValue
    || (left.landmarkId ?? "").localeCompare(right.landmarkId ?? "")
    || left.eventIndex - right.eventIndex);

  const filter = ({ query = "", categories = [], dateRange = "any", dateStart = "", dateEnd = "", priceRange = "any", placementView = "all" } = {}) => {
    const normalizedQuery = normalize(query);
    const selectedCategories = new Set(categories);
    const window = dateWindow(dateRange, now(), dateStart, dateEnd);
    const matched = events.filter((event) => (!normalizedQuery || event.searchable.includes(normalizedQuery))
      && (selectedCategories.size === 0 || selectedCategories.has(event.category))
      && (placementView === "all" || placementView === "mapped" && event.publicPlacement === "mapped" || event.offMapSubtype === placementView)
      && (dateRange === "anytime" ? event.scheduleKind === "anytime" : !window || (Number.isFinite(event.scheduleValue) && event.scheduleValue <= window.end && event.scheduleEndValue >= window.start))
      && matchesPrice(event, priceRange));
    return {
      query: displayText(query),
      categories: [...selectedCategories],
      dateRange,
      dateStart,
      dateEnd,
      priceRange,
      placementView,
      identities: new Set(matched.map(({ identity }) => identity)),
      events: matched,
      matchedEvents: matched.length,
      matchedLandmarks: new Set(matched.map(({ landmarkId }) => landmarkId)).size,
    };
  };

  const approvedCandidates = () => {
    if (typeof sourceSnapshotId !== "string" || !sourceSnapshotId.trim()) return [];
    return events
      .filter((event) => event.candidateAreaId && event.candidateCoordinates && event.candidateEvidenceRefs.length)
      .map((event) => ({
        candidateId: event.candidateId,
        candidateType: "event",
        sourceSnapshotId: sourceSnapshotId.trim(),
        areaId: event.candidateAreaId,
        coordinates: [...event.candidateCoordinates],
        attributes: {
          name: event.title,
          venue: event.venue,
          category: event.category,
          date: event.date,
          time: event.time,
          priceKind: event.priceKind,
          priceValue: event.priceValue,
        },
        evidenceRefs: [...event.candidateEvidenceRefs],
      }));
  };

  const selectionForCandidate = (candidateId) => {
    if (!approvedCandidates().some((candidate) => candidate.candidateId === candidateId)) return null;
    const event = events.find((candidate) => candidate.candidateId === candidateId);
    return event ? { landmarkId: event.landmarkId, eventId: event.eventId, eventIndex: event.eventIndex } : null;
  };

  return {
    approvedCandidates,
    categories: () => [...new Set(events.map(({ category }) => category))].sort(),
    events: () => [...events],
    filter,
    selectionForCandidate,
  };
}

export function reconcileEventSelection(selection, discoveryResult) {
  if (!selection?.landmarkId || !selection?.eventId || !(discoveryResult?.identities instanceof Set)) return null;
  return discoveryResult.identities.has(eventIdentity(selection.landmarkId, selection.eventId)) ? selection : null;
}

export { eventCandidateIdentity, eventIdentity, normalize as normalizeDiscoveryText };
