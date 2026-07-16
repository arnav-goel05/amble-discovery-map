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

function scheduleValue(event) {
  const value = Date.parse(event.startDateTime || event.startsAt || "");
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function scheduleEndValue(event, start) {
  const value = Date.parse(event.endDateTime || event.endsAt || "");
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
  const end = new Date(start);
  end.setDate(end.getDate() + ({ today: 1, "7-days": 7, "30-days": 30 }[range] || 0));
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

export function createEventDiscoveryModel(landmarks = [], { categoryOf = (event) => event.category || "Other", now = () => new Date() } = {}) {
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
      events.push({
        identity: eventIdentity(landmark.id, eventId), landmarkId: landmark.id, eventId, eventIndex,
        title, venue, date, time, category, anchor: landmark.anchor,
        scheduleValue: startsAt, scheduleEndValue: endsAt, priceKind: price.kind, priceValue: price.value,
        searchable: normalize([title, venue, landmark.label, date, time, category].join(" ")),
      });
    }
  }
  events.sort((left, right) => left.scheduleValue - right.scheduleValue
    || left.landmarkId.localeCompare(right.landmarkId)
    || left.eventIndex - right.eventIndex);

  const filter = ({ query = "", categories = [], dateRange = "any", dateStart = "", dateEnd = "", priceRange = "any" } = {}) => {
    const normalizedQuery = normalize(query);
    const selectedCategories = new Set(categories);
    const window = dateWindow(dateRange, now(), dateStart, dateEnd);
    const matched = events.filter((event) => (!normalizedQuery || event.searchable.includes(normalizedQuery))
      && (selectedCategories.size === 0 || selectedCategories.has(event.category))
      && (!window || (Number.isFinite(event.scheduleValue) && event.scheduleValue <= window.end && event.scheduleEndValue >= window.start))
      && matchesPrice(event, priceRange));
    return {
      query: displayText(query),
      categories: [...selectedCategories],
      dateRange,
      dateStart,
      dateEnd,
      priceRange,
      identities: new Set(matched.map(({ identity }) => identity)),
      events: matched,
      matchedEvents: matched.length,
      matchedLandmarks: new Set(matched.map(({ landmarkId }) => landmarkId)).size,
    };
  };

  return {
    categories: () => [...new Set(events.map(({ category }) => category))].sort(),
    events: () => [...events],
    filter,
  };
}

export function reconcileEventSelection(selection, discoveryResult) {
  if (!selection?.landmarkId || !selection?.eventId || !(discoveryResult?.identities instanceof Set)) return null;
  return discoveryResult.identities.has(eventIdentity(selection.landmarkId, selection.eventId)) ? selection : null;
}

export { eventIdentity, normalize as normalizeDiscoveryText };
