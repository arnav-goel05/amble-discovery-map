import { createHash } from 'node:crypto';

export const normalizeVenue = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const sourceIdentity = (event) => (event.sources || [])
  .map((source) => `${source.source || ''}:${source.sourceId || ''}`)
  .filter((value) => !value.endsWith(':'))
  .sort()[0];

export const stableEventKey = (event) => String(
  sourceIdentity(event) || event.occurrenceId || event.id || event.parentEventId
);

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
};

export const contentHash = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value)))
  .digest('hex');

export function reconcileLandmark(current, next, sourceVenues) {
  if (!current) return { action: 'create', landmark: next };
  const ownedVenues = new Set(sourceVenues.map(normalizeVenue));
  const retained = (current.events || []).filter((event) => !ownedVenues.has(normalizeVenue(event.venue)));
  const events = new Map(retained.map((event) => [stableEventKey(event), event]));
  for (const event of next.events || []) events.set(stableEventKey(event), event);
  const landmark = { ...current, ...next, events: [...events.values()] };
  return contentHash(current) === contentHash(landmark)
    ? { action: 'noop', landmark: current }
    : { action: 'update', landmark };
}

export function reconcilePoi(current, next) {
  if (!current) return { action: 'create', poi: next };
  return contentHash(current) === contentHash(next)
    ? { action: 'noop', poi: current }
    : { action: 'update', poi: next };
}

const parseEnd = (event) => {
  for (const value of [event.endDateTime, event.startDateTime]) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const dates = String(event.dateText || '').match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/g) || [];
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
    undatedReviewEventIds
  };
}
