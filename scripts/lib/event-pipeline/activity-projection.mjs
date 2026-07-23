import { createHash } from "node:crypto";
import {
  reconcileActivityProjection,
  validateActivityReconciliation,
} from "./activity-reconciliation.mjs";

const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set(values.filter(Boolean))].sort();
const scheduleOf = (event) => event.schedule ?? event.sessions?.[0]?.schedule ?? {};
const occurrenceIdOf = (event) => clean(event.occurrenceId ?? event.id);
const canonical = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href.replace(/\?$/, "");
  } catch {
    return null;
  }
}

function parentRecords(event) {
  const explicit = Array.isArray(event.sourceParentActivities)
    ? event.sourceParentActivities
    : [];
  const fallback = event.parentActivityId || event.parentListingId
    ? [{
        source: event.sourceName ?? event.sources?.[0]?.source ?? "unknown",
        parentActivityId: event.parentActivityId ?? null,
        parentListingId: event.parentListingId ?? null,
      }]
    : [];
  return [...explicit, ...fallback]
    .map((item) => ({
      source: clean(item?.source) || "unknown",
      parentActivityId: clean(item?.parentActivityId) || null,
      parentListingId: clean(item?.parentListingId) || null,
    }))
    .filter((item) => item.parentActivityId || item.parentListingId)
    .filter((item, index, rows) =>
      rows.findIndex((candidate) => canonical(candidate) === canonical(item)) === index,
    );
}

const parentKey = (record) => record.parentActivityId ?? `listing:${record.parentListingId}`;
const scheduleFingerprint = (event) => {
  const schedule = scheduleOf(event);
  return canonical({
    kind: schedule.kind ?? null,
    start: schedule.start ?? event.startDateTime ?? event.startsAt ?? null,
    end: schedule.end ?? event.endDateTime ?? event.endsAt ?? null,
    recurrence: schedule.recurrence ?? null,
    displayText: schedule.displayText ?? event.dateText ?? null,
  });
};
const venueFingerprint = (event) => clean(
  event.venueOccurrences?.[0]?.approvedLocationId ??
    event.approvedLocationId ??
    event.venueId ??
    event.venue ??
    event.venueName,
).toLocaleLowerCase();

function review({ runId, reasonCode, occurrenceIds, evidence = null }) {
  const members = unique(occurrenceIds);
  return {
    reviewId: `activity-review:${sha(canonical({ reasonCode, members, evidence })).slice(0, 24)}`,
    runId,
    status: "needs_review",
    reasonCode,
    occurrenceIds: members,
    evidence,
  };
}

function deconflict(events, runId) {
  const byId = new Map();
  for (const event of events) {
    const id = occurrenceIdOf(event);
    const rows = byId.get(id) ?? [];
    rows.push(event);
    byId.set(id, rows);
  }
  const accepted = [], reviews = [];
  for (const [id, rows] of [...byId].sort(([a], [b]) => a.localeCompare(b))) {
    if (!id) {
      reviews.push(review({ runId, reasonCode: "missing_occurrence_identity", occurrenceIds: [], evidence: null }));
      continue;
    }
    const schedules = unique(rows.map(scheduleFingerprint));
    const venues = unique(rows.map(venueFingerprint));
    if (schedules.length > 1 || venues.length > 1) {
      reviews.push(review({
        runId,
        reasonCode: schedules.length > 1
          ? "contradictory_session_schedule"
          : "contradictory_session_venue",
        occurrenceIds: [id],
        evidence: { schedules, venues },
      }));
    } else accepted.push(rows[0]);
  }
  return { accepted, reviews };
}

function sessionFor(activityId, event) {
  const occurrenceId = occurrenceIdOf(event);
  const schedule = structuredClone(scheduleOf(event));
  return {
    sessionId: `session:${sha(`${activityId}\0${occurrenceId}`).slice(0, 24)}`,
    occurrenceIds: [occurrenceId],
    sourceSessionIds: unique((event.sessions ?? []).flatMap((item) => [
      item.sessionId,
      ...(item.sourceSessionIds ?? []),
    ])),
    schedule,
    availability: event.availability ?? event.sessions?.[0]?.availability ?? "unknown",
    venueGroupIds: [],
    evidenceRefs: unique([
      ...(event.provenanceRefs ?? []),
      ...(event.sessions ?? []).flatMap((item) => item.evidenceRefs ?? []),
    ]),
  };
}

function venueKey(event) {
  const occurrence = event.venueOccurrences?.[0] ?? {};
  return clean(
    occurrence.approvedLocationId ??
      event.approvedLocationId ??
      event.venueId ??
      occurrence.publishedVenueName ??
      event.venue ??
      event.venueName ??
      event.offMapSubtype ??
      "location-tba",
  ).toLocaleLowerCase();
}

function scheduleSummary(sessions) {
  const exact = sessions
    .map((item) => item.schedule ?? {})
    .filter((item) => item.start)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (exact.length) {
    if (exact.length === 1)
      return { kind: exact[0].kind ?? "exact", label: exact[0].displayText ?? exact[0].start, sessionCount: sessions.length };
    const first = exact[0].start, last = exact.at(-1).end ?? exact.at(-1).start;
    return { kind: "multiple", label: `${sessions.length} upcoming sessions · ${first} – ${last}`, sessionCount: sessions.length };
  }
  const flexible = sessions.find((item) => ["anytime", "selectable", "recurring"].includes(item.schedule?.kind));
  return {
    kind: flexible?.schedule?.kind ?? "unverified",
    label: flexible?.schedule?.displayText ?? (sessions.length ? `${sessions.length} sessions` : "Schedule unavailable"),
    sessionCount: sessions.length,
  };
}

function sourceOffers(activityId, members, sessionByOccurrence, reviews, runId) {
  const offers = new Map();
  for (const event of members) {
    const sessionId = sessionByOccurrence.get(occurrenceIdOf(event));
    for (const source of event.sources ?? []) {
      const url = canonicalUrl(source.sourceUrl ?? source.url ?? event.eventUrl);
      if (!url) {
        if (source.sourceUrl || source.url || event.eventUrl)
          reviews.push(review({
            runId,
            reasonCode: "invalid_source_offer_url",
            occurrenceIds: [occurrenceIdOf(event)],
            evidence: { source: source.source ?? event.sourceName },
          }));
        continue;
      }
      const label = clean(source.source ?? event.sourceName) || new URL(url).hostname;
      const key = `${label}\0${url}`;
      const current = offers.get(key) ?? {
        offerId: `offer:${sha(key).slice(0, 24)}`,
        activityId,
        source: label,
        url,
        sessionIds: [],
        evidenceRefs: [],
      };
      current.sessionIds.push(sessionId);
      current.evidenceRefs.push(source.recordRef, ...(event.provenanceRefs ?? []));
      offers.set(key, current);
    }
  }
  const totalSessions = new Set(sessionByOccurrence.values()).size;
  return [...offers.values()]
    .map((offer) => {
      offer.sessionIds = unique(offer.sessionIds);
      offer.evidenceRefs = unique(offer.evidenceRefs);
      offer.scope = offer.sessionIds.length === totalSessions ? "activity" : "sessions";
      if (offer.scope === "activity") offer.sessionIds = [];
      return offer;
    })
    .sort((a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url));
}

export function projectEventActivities({
  events = [],
  previousActivities = [],
  runId = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const ordered = [...events].sort((a, b) => occurrenceIdOf(a).localeCompare(occurrenceIdOf(b)));
  const { accepted, reviews } = deconflict(ordered, runId);
  const parent = new Map();
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const union = (a, b) => {
    const ar = find(a), br = find(b);
    if (ar !== br) parent.set(ar < br ? br : ar, ar < br ? ar : br);
  };
  const eligible = [];
  for (const event of accepted) {
    const parents = parentRecords(event);
    if (!parents.length) {
      reviews.push(review({ runId, reasonCode: "missing_parent_activity_identity", occurrenceIds: [occurrenceIdOf(event)] }));
      continue;
    }
    const keys = parents.map(parentKey);
    keys.slice(1).forEach((key) => union(keys[0], key));
    keys.forEach(find);
    eligible.push({ event, parents, keys });
  }
  const groups = new Map();
  for (const item of eligible) {
    const root = find(item.keys[0]);
    const rows = groups.get(root) ?? [];
    rows.push(item);
    groups.set(root, rows);
  }
  const records = [];
  for (const rows of groups.values()) {
    const members = rows.map((item) => item.event).sort((a, b) => occurrenceIdOf(a).localeCompare(occurrenceIdOf(b)));
    const parentActivities = unique(rows.flatMap((item) => item.parents.map((record) => record.parentActivityId)));
    const preferred = unique(members.map((event) => clean(event.parentActivityId)));
    const activityId = preferred.find((id) => id.startsWith("activity:")) ??
      parentActivities[0] ?? `activity:${sha(unique(rows.flatMap((item) => item.keys)).join("\0")).slice(0, 24)}`;
    const sessionByOccurrence = new Map();
    const sessions = members.map((event) => {
      const session = sessionFor(activityId, event);
      sessionByOccurrence.set(occurrenceIdOf(event), session.sessionId);
      return session;
    });
    const venueGroups = new Map();
    for (const [index, event] of members.entries()) {
      const key = venueKey(event);
      const venueOccurrence = event.venueOccurrences?.[0] ?? {};
      const id = `venue-group:${sha(`${activityId}\0${key}`).slice(0, 24)}`;
      const group = venueGroups.get(id) ?? {
        venueGroupId: id,
        activityId,
        label: clean(venueOccurrence.publishedVenueName ?? event.venue ?? event.venueName) || "Location TBA",
        address: clean(venueOccurrence.address ?? event.address) || null,
        publicPlacement: event.publicPlacement ?? venueOccurrence.publicPlacement ?? "none",
        mappingStatus: event.mappingStatus ?? venueOccurrence.mappingStatus ?? "pending_review",
        approvedLocationId: venueOccurrence.approvedLocationId ?? event.approvedLocationId ?? null,
        coordinates: event.coordinates ?? null,
        occurrenceIds: [],
        sessionIds: [],
      };
      const occurrenceId = occurrenceIdOf(event), sessionId = sessions[index].sessionId;
      group.occurrenceIds.push(occurrenceId);
      group.sessionIds.push(sessionId);
      sessions[index].venueGroupIds.push(id);
      venueGroups.set(id, group);
    }
    for (const group of venueGroups.values()) {
      group.occurrenceIds = unique(group.occurrenceIds);
      group.sessionIds = unique(group.sessionIds);
    }
    const primary = members[0];
    records.push({
      schemaVersion: "1.0",
      activityId,
      title: clean(primary.title),
      description: members.map((item) => clean(item.description)).find(Boolean) ?? null,
      category: members.map((item) => clean(item.category)).find(Boolean) ?? null,
      organizer: members.map((item) => clean(item.organizer)).find(Boolean) ?? null,
      price: members.map((item) => clean(item.price)).find(Boolean) ?? null,
      lifecycleState: members.some((item) => item.lifecycleState === "active") ? "active" : (primary.lifecycleState ?? "active"),
      freshness: members.some((item) => item.freshness === "stale") ? "stale" : "current",
      sourceParentActivityIds: parentActivities,
      sourceParentListingIds: unique(rows.flatMap((item) => item.parents.map((record) => record.parentListingId))),
      sources: unique(rows.flatMap((item) => item.parents.map((record) => record.source))),
      occurrenceIds: members.map(occurrenceIdOf),
      sessions,
      venueGroups: [...venueGroups.values()].sort((a, b) => a.venueGroupId.localeCompare(b.venueGroupId)),
      sourceOffers: sourceOffers(activityId, members, sessionByOccurrence, reviews, runId),
      scheduleSummary: scheduleSummary(sessions),
      groupingDecision: {
        strategy: parentActivities.length > 1
          ? "accepted_occurrence_dedup_bridge"
          : "source_parent_activity",
        selectedActivityId: activityId,
        memberOccurrenceIds: members.map(occurrenceIdOf),
      },
    });
  }
  records.sort((a, b) => a.activityId.localeCompare(b.activityId));
  reviews.sort((a, b) => a.reviewId.localeCompare(b.reviewId));
  const counts = {
    inputOccurrences: events.length,
    occurrences: records.reduce((sum, item) => sum + item.occurrenceIds.length, 0),
    activities: records.length,
    sessions: records.reduce((sum, item) => sum + item.sessions.length, 0),
    venueGroups: records.reduce((sum, item) => sum + item.venueGroups.length, 0),
    sourceOffers: records.reduce((sum, item) => sum + item.sourceOffers.length, 0),
    reviews: reviews.length,
  };
  const activities = { schemaVersion: "1.0", runId, generatedAt, counts, records };
  const reviewArtifact = { schemaVersion: "1.0", runId, generatedAt, counts: { records: reviews.length }, records: reviews };
  const decisions = reconcileActivityProjection({
    runId,
    records,
    previousRecords: previousActivities,
    reviews,
    generatedAt,
  });
  validateActivityProjection(activities, reviewArtifact);
  validateActivityReconciliation(decisions);
  return { activities, reviews: reviewArtifact, decisions };
}

export function validateActivityProjection(activities, reviews) {
  if (activities?.schemaVersion !== "1.0" || reviews?.schemaVersion !== "1.0")
    throw new Error("activity_projection_schema_invalid");
  const activityIds = new Set(), occurrenceIds = new Set();
  for (const activity of activities.records ?? []) {
    if (!activity.activityId || activityIds.has(activity.activityId))
      throw new Error("activity_projection_identity_invalid");
    activityIds.add(activity.activityId);
    for (const occurrenceId of activity.occurrenceIds ?? []) {
      if (!occurrenceId || occurrenceIds.has(occurrenceId))
        throw new Error("activity_projection_occurrence_membership_invalid");
      occurrenceIds.add(occurrenceId);
    }
    const sessionIds = new Set((activity.sessions ?? []).map((item) => item.sessionId));
    for (const group of activity.venueGroups ?? [])
      if ((group.sessionIds ?? []).some((id) => !sessionIds.has(id)))
        throw new Error("activity_projection_venue_session_invalid");
    for (const offer of activity.sourceOffers ?? [])
      if (!canonicalUrl(offer.url) || (offer.scope === "sessions" && offer.sessionIds.some((id) => !sessionIds.has(id))))
        throw new Error("activity_projection_offer_invalid");
  }
  if (activities.counts.activities !== activityIds.size || activities.counts.occurrences !== occurrenceIds.size)
    throw new Error("activity_projection_counts_invalid");
  return activities;
}
