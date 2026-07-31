import { createHash } from "node:crypto";
import {
  reconcileActivityProjection,
  validateActivityReconciliation,
} from "./activity-reconciliation.mjs";

const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const unique = (values) => [...new Set(values.filter(Boolean))].sort();
const scheduleOf = (event) =>
  event.schedule ?? event.sessions?.[0]?.schedule ?? {};
const occurrenceIdOf = (event) => clean(event.occurrenceId ?? event.id);
const canonical = (value) =>
  JSON.stringify(value, Object.keys(value ?? {}).sort());
const monthNumber = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);
const genericParentTitleTokens = new Set([
  "activity",
  "admission",
  "admissions",
  "event",
  "exhibition",
  "general",
  "show",
  "tour",
  "workshop",
]);

function decodeMarkup(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function normalizedParentTitle(value) {
  return decodeMarkup(value)
    .normalize("NFKD")
    .toLocaleLowerCase("en-SG")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(?:tickets?|fever|sistic)\b/gu, " ")
    .replace(/\bsingapore\b$/u, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function genericParentTitle(value) {
  const parts = value.split(" ").filter(Boolean);
  return (
    !parts.length || parts.every((part) => genericParentTitleTokens.has(part))
  );
}

function singaporeDay(value) {
  const text = clean(value);
  if (!text) return null;
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (isoDate && !/[T\s]\d{1,2}:\d{2}/.test(text))
    return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  const humanDate = text.match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i,
  );
  if (humanDate) {
    const month = monthNumber.get(humanDate[2].toLocaleLowerCase("en-SG"));
    return `${humanDate[3]}-${String(month).padStart(2, "0")}-${String(
      Number(humanDate[1]),
    ).padStart(2, "0")}`;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(parsed));
  const field = Object.fromEntries(
    parts.map((item) => [item.type, item.value]),
  );
  return `${field.year}-${field.month}-${field.day}`;
}

const dayOrdinal = (value) => {
  const day = singaporeDay(value);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
};

function compactDisplayCoverage(value) {
  const match = clean(value).match(
    /\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]{3,9})\s*[’']?(\d{2,4})\b/,
  );
  if (!match) return null;
  const month = monthNumber.get(match[3].toLocaleLowerCase("en-SG"));
  if (!month) return null;
  const rawYear = Number(match[4]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return {
    start: Date.UTC(year, month - 1, Number(match[1])) / 86_400_000,
    end: Date.UTC(year, month - 1, Number(match[2])) / 86_400_000,
  };
}

function scheduleCoverage(events) {
  const bounds = [];
  const flexibleKinds = new Set();
  for (const event of events) {
    const schedule = scheduleOf(event);
    let start = dayOrdinal(
      schedule.start ?? event.startDateTime ?? event.startsAt ?? event.dateText,
    );
    let end =
      dayOrdinal(
        schedule.end ??
          event.endDateTime ??
          event.endsAt ??
          schedule.start ??
          event.startDateTime ??
          event.startsAt ??
          event.dateText,
      ) ?? start;
    if (start === null) {
      const compact = compactDisplayCoverage(
        schedule.displayText ?? event.dateText,
      );
      if (compact) ({ start, end } = compact);
    }
    if (start !== null) bounds.push({ start, end });
    else if (schedule.kind) flexibleKinds.add(schedule.kind);
  }
  return bounds.length
    ? {
        start: Math.min(...bounds.map((item) => item.start)),
        end: Math.max(...bounds.map((item) => item.end)),
        flexibleKinds: [],
      }
    : {
        start: null,
        end: null,
        flexibleKinds: [...flexibleKinds].sort(),
      };
}

function coverageCompatible(a, b) {
  if (a.start !== null && b.start !== null)
    return a.start <= b.end && b.start <= a.end;
  if (a.start === null && b.start === null)
    return a.flexibleKinds.some((kind) => b.flexibleKinds.includes(kind));
  const flexible = a.start === null ? a.flexibleKinds : b.flexibleKinds;
  if (
    flexible.some((kind) =>
      ["anytime", "recurring", "selectable"].includes(kind),
    )
  )
    return true;
  return false;
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href.replace(/\?$/, "");
  } catch {
    return null;
  }
}

function singleProductUrl(value) {
  const normalized = canonicalUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const path = url.pathname.replace(/\/+$/, "").toLocaleLowerCase("en-SG");
  if (
    !path ||
    path === "/" ||
    /\/whats-happening\/all-happenings$/.test(path) ||
    /\/(?:events?|experiences?|things-to-do|all-happenings)$/.test(path)
  )
    return null;
  return normalized;
}

function parentRecords(event) {
  const explicit = Array.isArray(event.sourceParentActivities)
    ? event.sourceParentActivities
    : [];
  const fallback =
    event.parentActivityId || event.parentListingId
      ? [
          {
            source: event.sourceName ?? event.sources?.[0]?.source ?? "unknown",
            parentActivityId: event.parentActivityId ?? null,
            parentListingId: event.parentListingId ?? null,
          },
        ]
      : [];
  return [...explicit, ...fallback]
    .map((item) => ({
      source: clean(item?.source) || "unknown",
      parentActivityId: clean(item?.parentActivityId) || null,
      parentListingId: clean(item?.parentListingId) || null,
    }))
    .filter((item) => item.parentActivityId || item.parentListingId)
    .filter(
      (item, index, rows) =>
        rows.findIndex(
          (candidate) => canonical(candidate) === canonical(item),
        ) === index,
    );
}

const parentKey = (record) =>
  record.parentActivityId ?? `listing:${record.parentListingId}`;
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
const venueFingerprint = (event) =>
  clean(
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

function approvedLocations(events) {
  return unique(
    events.flatMap((event) => [
      event.approvedLocationId,
      ...(event.venueOccurrences ?? []).map(
        (occurrence) => occurrence.approvedLocationId,
      ),
    ]),
  );
}

function authorityRefsOf(event) {
  return unique([
    ...(event.authorityRefs ?? []),
    ...(event.sources ?? []).flatMap((source) => source.authorityRefs ?? []),
  ]);
}

function parentSummary(root, rows) {
  const events = [
    ...new Map(
      rows.map((item) => [occurrenceIdOf(item.event), item.event]),
    ).values(),
  ];
  const titles = unique(
    events.map((event) => normalizedParentTitle(event.title)),
  );
  const organizers = unique(
    events.map((event) => normalizedParentTitle(event.organizer)),
  );
  const productUrls = unique(
    events.flatMap((event) =>
      (event.sources ?? []).map((source) =>
        singleProductUrl(source.sourceUrl ?? source.url ?? event.eventUrl),
      ),
    ),
  );
  const authorityRefs = unique(events.flatMap(authorityRefsOf));
  return {
    root,
    parentKeys: unique(rows.flatMap((item) => item.keys)),
    occurrenceIds: unique(events.map(occurrenceIdOf)),
    titles,
    organizers,
    productUrls,
    authorityRefs,
    approvedLocationIds: approvedLocations(events),
    scheduleCoverage: scheduleCoverage(events),
  };
}

function intersects(a, b) {
  const right = new Set(b);
  return a.some((value) => right.has(value));
}

function linkCompatibleParents({ eligible, find, union, reviews, runId }) {
  const byRoot = new Map();
  for (const item of eligible) {
    const root = find(item.keys[0]);
    const rows = byRoot.get(root) ?? [];
    rows.push(item);
    byRoot.set(root, rows);
  }
  const summaries = [...byRoot]
    .map(([root, rows]) => parentSummary(root, rows))
    .sort((a, b) => a.root.localeCompare(b.root));
  const indexes = [new Map(), new Map(), new Map()];
  const addIndex = (index, key, root) => {
    if (!key) return;
    const roots = index.get(key) ?? [];
    roots.push(root);
    index.set(key, roots);
  };
  for (const summary of summaries) {
    for (const title of summary.titles)
      if (!genericParentTitle(title)) addIndex(indexes[0], title, summary.root);
    for (const url of summary.productUrls)
      addIndex(indexes[1], url, summary.root);
    for (const authorityRef of summary.authorityRefs)
      addIndex(indexes[2], authorityRef, summary.root);
  }
  const pairKeys = new Set();
  for (const index of indexes)
    for (const roots of index.values()) {
      const ordered = unique(roots);
      for (let left = 0; left < ordered.length; left += 1)
        for (let right = left + 1; right < ordered.length; right += 1)
          pairKeys.add(`${ordered[left]}\0${ordered[right]}`);
    }
  const summaryByRoot = new Map(
    summaries.map((summary) => [summary.root, summary]),
  );
  const decisions = [];
  for (const pairKey of [...pairKeys].sort()) {
    const [aRoot, bRoot] = pairKey.split("\0");
    const a = summaryByRoot.get(aRoot);
    const b = summaryByRoot.get(bRoot);
    const sharedTitles = a.titles.filter(
      (title) => b.titles.includes(title) && !genericParentTitle(title),
    );
    const sharedProductUrls = a.productUrls.filter((url) =>
      b.productUrls.includes(url),
    );
    const sharedAuthorityRefs = a.authorityRefs.filter((value) =>
      b.authorityRefs.includes(value),
    );
    if (!sharedTitles.length) continue;
    const scheduleMatch = coverageCompatible(
      a.scheduleCoverage,
      b.scheduleCoverage,
    );
    const bothHaveLocations =
      a.approvedLocationIds.length > 0 && b.approvedLocationIds.length > 0;
    const venueMatch = intersects(a.approvedLocationIds, b.approvedLocationIds);
    const organizerConflict =
      a.organizers.length > 0 &&
      b.organizers.length > 0 &&
      !intersects(a.organizers, b.organizers);
    const candidateId = `parent-candidate:${sha(pairKey).slice(0, 24)}`;
    const base = {
      candidateId,
      parentKeys: unique([...a.parentKeys, ...b.parentKeys]),
      occurrenceIds: unique([...a.occurrenceIds, ...b.occurrenceIds]),
      evidence: {
        sharedTitles,
        sharedProductUrls,
        scheduleCompatible: scheduleMatch,
        approvedLocationIds: unique([
          ...a.approvedLocationIds,
          ...b.approvedLocationIds,
        ]),
        organizers: unique([...a.organizers, ...b.organizers]),
      },
    };
    if (organizerConflict) {
      decisions.push({
        ...base,
        decision: "kept_distinct",
        reasonCode: "parent_organizer_conflict",
      });
      continue;
    }
    if (bothHaveLocations && !venueMatch) {
      const conflict = {
        ...base,
        decision: "needs_review",
        reasonCode: "parent_venue_conflict",
      };
      decisions.push(conflict);
      reviews.push(
        review({
          runId,
          reasonCode: conflict.reasonCode,
          occurrenceIds: conflict.occurrenceIds,
          evidence: {
            parentKeys: conflict.parentKeys,
            approvedLocationIds: conflict.evidence.approvedLocationIds,
            sharedTitles,
            sharedProductUrls,
          },
        }),
      );
      continue;
    }
    if (
      sharedAuthorityRefs.length > 0 ||
      sharedProductUrls.length > 0 ||
      (scheduleMatch && (venueMatch || !bothHaveLocations))
    ) {
      union(find(aRoot), find(bRoot));
      decisions.push({
        ...base,
        decision: "merged",
        reasonCode:
          sharedProductUrls.length > 0
            ? "same_product_identity"
            : sharedAuthorityRefs.length > 0
              ? "same_authority_identity"
              : "compatible_parent_evidence",
      });
    } else
      decisions.push({
        ...base,
        decision: "kept_distinct",
        reasonCode: "insufficient_parent_evidence",
      });
  }
  return {
    schemaVersion: "1.0",
    runId,
    counts: {
      sourceParents: summaries.length,
      candidates: decisions.length,
      mergedParents: decisions.filter(({ decision }) => decision === "merged")
        .length,
      keptDistinct: decisions.filter(
        ({ decision }) => decision === "kept_distinct",
      ).length,
      reviews: decisions.filter(({ decision }) => decision === "needs_review")
        .length,
    },
    records: decisions,
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
  const accepted = [],
    reviews = [];
  for (const [id, rows] of [...byId].sort(([a], [b]) => a.localeCompare(b))) {
    if (!id) {
      reviews.push(
        review({
          runId,
          reasonCode: "missing_occurrence_identity",
          occurrenceIds: [],
          evidence: null,
        }),
      );
      continue;
    }
    const schedules = unique(rows.map(scheduleFingerprint));
    const venues = unique(rows.map(venueFingerprint));
    if (schedules.length > 1 || venues.length > 1) {
      reviews.push(
        review({
          runId,
          reasonCode:
            schedules.length > 1
              ? "contradictory_session_schedule"
              : "contradictory_session_venue",
          occurrenceIds: [id],
          evidence: { schedules, venues },
        }),
      );
    } else accepted.push(rows[0]);
  }
  return { accepted, reviews };
}

function sessionFor(
  activityId,
  event,
  venueEvent = event,
  scheduleEvent = event,
) {
  const occurrenceId = occurrenceIdOf(event);
  const schedule = structuredClone(scheduleOf(scheduleEvent));
  const fingerprint = equivalentSessionFingerprint(scheduleEvent, venueEvent);
  return {
    sessionId: `session:${sha(`${activityId}\0${fingerprint}`).slice(0, 24)}`,
    occurrenceIds: [occurrenceId],
    sourceSessionIds: unique(
      (event.sessions ?? []).flatMap((item) => [
        item.sessionId,
        ...(item.sourceSessionIds ?? []),
      ]),
    ),
    schedule,
    availability:
      event.availability ?? event.sessions?.[0]?.availability ?? "unknown",
    venueGroupIds: [],
    evidenceRefs: unique([
      ...(event.provenanceRefs ?? []),
      ...(event.sessions ?? []).flatMap((item) => item.evidenceRefs ?? []),
    ]),
    authorityRefs: authorityRefsOf(event),
  };
}

function singaporeMoment(value) {
  const text = clean(value);
  if (!text) return null;
  const hasTime = /(?:T|\s)\d{1,2}:\d{2}/.test(text);
  if (!hasTime) return singaporeDay(text);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text.toLocaleLowerCase("en-SG");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(parsed));
  const field = Object.fromEntries(
    parts.map((item) => [item.type, item.value]),
  );
  return `${field.year}-${field.month}-${field.day}T${field.hour}:${field.minute}`;
}

function displayClock(value) {
  const match = clean(value).match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (hour === 12) hour = 0;
  if (match[3].toLowerCase() === "pm") hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function explicitScheduleMoment(event) {
  const schedule = scheduleOf(event);
  const start =
    schedule.start ??
    event.startDateTime ??
    event.startsAt ??
    event.dateText ??
    null;
  const moment = singaporeMoment(start);
  if (!moment || moment.includes("T")) return moment;
  const clock = displayClock(schedule.displayText ?? event.timeText);
  return clock ? `${moment}T${clock}` : moment;
}

function equivalentSessionFingerprint(event, venueEvent = event) {
  const schedule = scheduleOf(event);
  const authorityRefs = authorityRefsOf(event);
  const end =
    schedule.end ??
    event.endDateTime ??
    event.endsAt ??
    schedule.start ??
    event.startDateTime ??
    event.startsAt ??
    event.dateText ??
    null;
  return canonical({
    venue: venueKey(venueEvent),
    start: explicitScheduleMoment(event),
    end: authorityRefs.length ? null : singaporeMoment(end),
    recurrence: clean(schedule.recurrence) || null,
    authorityRefs,
  });
}

function scheduleIsTimed(event) {
  if (event.allDay === true) return false;
  const moment = explicitScheduleMoment(event);
  return Boolean(moment?.includes("T"));
}

function genericVenue(event) {
  const placement =
    event.publicPlacement ?? event.venueOccurrences?.[0]?.publicPlacement;
  return (
    placement === "off_map" ||
    /^(?:offsite|location tba|venue tba|various venues|multiple locations)$/i.test(
      clean(event.venue ?? event.venueName),
    )
  );
}

function specificVenueRank(event) {
  if (genericVenue(event)) return 0;
  const occurrence = event.venueOccurrences?.[0] ?? {};
  const placement = event.publicPlacement ?? occurrence.publicPlacement;
  const mappingStatus = event.mappingStatus ?? occurrence.mappingStatus;
  const approvedLocationId =
    event.approvedLocationId ?? occurrence.approvedLocationId;
  if (placement === "mapped" && approvedLocationId) return 2;
  if (mappingStatus === "pending_review") return 1;
  return 0;
}

function coarseSchedulePlan(members) {
  const targets = new Map();
  const suppressed = new Set();
  for (const event of members) {
    if (scheduleIsTimed(event)) continue;
    const day = singaporeDay(
      scheduleOf(event).start ??
        event.startDateTime ??
        event.startsAt ??
        event.dateText,
    );
    if (!day) continue;
    const location = venueKey(event);
    const candidates = members.filter((candidate) => {
      if (candidate === event || !scheduleIsTimed(candidate)) return false;
      const candidateDay = singaporeDay(
        scheduleOf(candidate).start ??
          candidate.startDateTime ??
          candidate.startsAt ??
          candidate.dateText,
      );
      if (candidateDay !== day) return false;
      if (venueKey(candidate) === location) return true;
      return (
        genericVenue(event) &&
        specificVenueRank(candidate) > 0 &&
        intersects(authorityRefsOf(event), authorityRefsOf(candidate))
      );
    });
    if (!candidates.length) continue;
    const grounded =
      location !== "location-tba" ||
      candidates.some((candidate) =>
        intersects(authorityRefsOf(event), authorityRefsOf(candidate)),
      );
    if (!grounded) continue;
    if (candidates.length === 1)
      targets.set(occurrenceIdOf(event), candidates[0]);
    else {
      // Keep the occurrence attached to one deterministic session to satisfy
      // projection membership invariants, while its source offer remains
      // activity-scoped because the coarse evidence does not identify a
      // particular performance.
      targets.set(occurrenceIdOf(event), candidates[0]);
      suppressed.add(occurrenceIdOf(event));
    }
  }
  return { targets, suppressed };
}

function preferredVenueByOccurrence(members, scheduleTargets) {
  const bySchedule = new Map();
  for (const event of members) {
    const schedule = scheduleOf(event);
    const authorityRefs = authorityRefsOf(event);
    const key = canonical({
      start: singaporeMoment(schedule.start ?? event.startDateTime),
      end: authorityRefs.length
        ? null
        : singaporeMoment(schedule.end ?? event.endDateTime ?? schedule.start),
      recurrence: clean(schedule.recurrence) || null,
      authorityRefs,
    });
    const rows = bySchedule.get(key) ?? [];
    rows.push(event);
    bySchedule.set(key, rows);
  }
  const preferred = new Map();
  for (const rows of bySchedule.values()) {
    const specific = [...rows].sort(
      (left, right) =>
        specificVenueRank(right) - specificVenueRank(left) ||
        occurrenceIdOf(left).localeCompare(occurrenceIdOf(right)),
    )[0];
    if (!specificVenueRank(specific)) continue;
    const specificAuthority = authorityRefsOf(specific);
    for (const event of rows) {
      if (event === specific) continue;
      if (
        genericVenue(event) &&
        intersects(specificAuthority, authorityRefsOf(event))
      )
        preferred.set(occurrenceIdOf(event), specific);
    }
  }
  const byVenueOccurrence = new Map();
  for (const event of members)
    for (const occurrence of event.venueOccurrences ?? []) {
      const key = clean(occurrence.venueOccurrenceId);
      if (!key) continue;
      const rows = byVenueOccurrence.get(key) ?? [];
      rows.push(event);
      byVenueOccurrence.set(key, rows);
    }
  for (const rows of byVenueOccurrence.values()) {
    const specific = [...rows].sort(
      (left, right) =>
        specificVenueRank(right) - specificVenueRank(left) ||
        occurrenceIdOf(left).localeCompare(occurrenceIdOf(right)),
    )[0];
    if (!specificVenueRank(specific)) continue;
    for (const event of rows)
      if (
        event !== specific &&
        specificVenueRank(event) < specificVenueRank(specific)
      )
        preferred.set(occurrenceIdOf(event), specific);
  }
  for (const event of members) {
    if (!genericVenue(event)) continue;
    const target = scheduleTargets.get(occurrenceIdOf(event));
    if (
      target &&
      specificVenueRank(target) > 0 &&
      intersects(authorityRefsOf(event), authorityRefsOf(target))
    )
      preferred.set(
        occurrenceIdOf(event),
        preferred.get(occurrenceIdOf(target)) ?? target,
      );
  }
  return preferred;
}

function mergeEquivalentSessions(activityId, members) {
  const byFingerprint = new Map();
  const sessionByOccurrence = new Map();
  const schedulePlan = coarseSchedulePlan(members);
  const preferredVenue = preferredVenueByOccurrence(
    members,
    schedulePlan.targets,
  );
  for (const event of members) {
    const scheduleEvent =
      schedulePlan.targets.get(occurrenceIdOf(event)) ?? event;
    const venueEvent = preferredVenue.get(occurrenceIdOf(event)) ?? event;
    const fingerprint = equivalentSessionFingerprint(scheduleEvent, venueEvent);
    const current =
      byFingerprint.get(fingerprint) ??
      sessionFor(activityId, event, venueEvent, scheduleEvent);
    current.occurrenceIds = unique([
      ...current.occurrenceIds,
      occurrenceIdOf(event),
    ]);
    current.sourceSessionIds = unique([
      ...current.sourceSessionIds,
      ...(event.sessions ?? []).flatMap((item) => [
        item.sessionId,
        ...(item.sourceSessionIds ?? []),
      ]),
    ]);
    current.evidenceRefs = unique([
      ...current.evidenceRefs,
      ...(event.provenanceRefs ?? []),
      ...(event.sessions ?? []).flatMap((item) => item.evidenceRefs ?? []),
    ]);
    current.authorityRefs = unique([
      ...(current.authorityRefs ?? []),
      ...authorityRefsOf(event),
    ]);
    const availability =
      event.availability ?? event.sessions?.[0]?.availability ?? "unknown";
    if (current.availability === "unknown" && availability !== "unknown")
      current.availability = availability;
    byFingerprint.set(fingerprint, current);
    sessionByOccurrence.set(occurrenceIdOf(event), current.sessionId);
  }
  return {
    sessions: [...byFingerprint.values()].sort((a, b) =>
      a.sessionId.localeCompare(b.sessionId),
    ),
    sessionByOccurrence,
    preferredVenue,
    activityScopedOccurrences: schedulePlan.suppressed,
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

function displayHasClock(value) {
  return /\b(?:[01]?\d|2[0-3])[:.]\d{2}\b|\b\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)\b/i.test(
    clean(value),
  );
}

function singaporeScheduleLabel(schedule) {
  const supplied = clean(schedule?.displayText);
  if (supplied && displayHasClock(supplied)) return supplied;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(clean(schedule?.start)))
    return supplied || schedule?.start;
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(schedule.start));
  const field = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  const clock = `${field.hour}${
    field.minute === "00" ? "" : `.${field.minute}`
  }${field.dayPeriod.toLocaleLowerCase("en-SG")}`;
  return `${field.weekday}, ${field.day} ${field.month} ${field.year}, ${clock}`;
}

function scheduleSummary(sessions) {
  const exact = sessions
    .map((item) => item.schedule ?? {})
    .filter((item) => item.start)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (exact.length) {
    if (exact.length === 1)
      return {
        kind: exact[0].kind ?? "exact",
        label: singaporeScheduleLabel(exact[0]),
        sessionCount: sessions.length,
      };
    const first = exact[0].start,
      last = exact.at(-1).end ?? exact.at(-1).start;
    return {
      kind: "multiple",
      label: `${sessions.length} upcoming sessions · ${first} – ${last}`,
      sessionCount: sessions.length,
    };
  }
  const flexible = sessions.find((item) =>
    ["anytime", "selectable", "recurring"].includes(item.schedule?.kind),
  );
  return {
    kind: flexible?.schedule?.kind ?? "unverified",
    label:
      flexible?.schedule?.displayText ??
      (sessions.length
        ? `${sessions.length} sessions`
        : "Schedule unavailable"),
    sessionCount: sessions.length,
  };
}

function sourceOffers(
  activityId,
  members,
  sessionByOccurrence,
  activityScopedOccurrences,
  reviews,
  runId,
) {
  const offers = new Map();
  for (const event of members) {
    const sessionId = sessionByOccurrence.get(occurrenceIdOf(event));
    for (const source of event.sources ?? []) {
      const url = canonicalUrl(
        source.sourceUrl ?? source.url ?? event.eventUrl,
      );
      if (!url) {
        if (source.sourceUrl || source.url || event.eventUrl)
          reviews.push(
            review({
              runId,
              reasonCode: "invalid_source_offer_url",
              occurrenceIds: [occurrenceIdOf(event)],
              evidence: { source: source.source ?? event.sourceName },
            }),
          );
        continue;
      }
      const label =
        clean(source.source ?? event.sourceName) || new URL(url).hostname;
      const key = `${label}\0${url}`;
      const current = offers.get(key) ?? {
        offerId: `offer:${sha(key).slice(0, 24)}`,
        activityId,
        source: label,
        url,
        sessionIds: [],
        evidenceRefs: [],
        coversActivity: false,
      };
      if (activityScopedOccurrences.has(occurrenceIdOf(event)))
        current.coversActivity = true;
      else if (sessionId) current.sessionIds.push(sessionId);
      else current.coversActivity = true;
      current.evidenceRefs.push(
        source.recordRef,
        ...(event.provenanceRefs ?? []),
      );
      offers.set(key, current);
    }
  }
  const totalSessions = new Set(sessionByOccurrence.values()).size;
  return [...offers.values()]
    .map((offer) => {
      offer.sessionIds = unique(offer.sessionIds);
      offer.evidenceRefs = unique(offer.evidenceRefs);
      offer.scope =
        offer.coversActivity || offer.sessionIds.length === totalSessions
          ? "activity"
          : "sessions";
      delete offer.coversActivity;
      if (offer.scope === "activity") offer.sessionIds = [];
      return offer;
    })
    .sort(
      (a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
    );
}

export function projectEventActivities({
  events = [],
  previousActivities = [],
  runId = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const ordered = [...events].sort((a, b) =>
    occurrenceIdOf(a).localeCompare(occurrenceIdOf(b)),
  );
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
    const ar = find(a),
      br = find(b);
    if (ar !== br) parent.set(ar < br ? br : ar, ar < br ? ar : br);
  };
  const eligible = [];
  for (const event of accepted) {
    const parents = parentRecords(event);
    if (!parents.length) {
      reviews.push(
        review({
          runId,
          reasonCode: "missing_parent_activity_identity",
          occurrenceIds: [occurrenceIdOf(event)],
        }),
      );
      continue;
    }
    const keys = parents.map(parentKey);
    keys.slice(1).forEach((key) => union(keys[0], key));
    keys.forEach(find);
    eligible.push({ event, parents, keys });
  }
  const parentGrouping = linkCompatibleParents({
    eligible,
    find,
    union,
    reviews,
    runId,
  });
  const groups = new Map();
  for (const item of eligible) {
    const root = find(item.keys[0]);
    const rows = groups.get(root) ?? [];
    rows.push(item);
    groups.set(root, rows);
  }
  const records = [];
  let coarseEnvelopesSuppressed = 0;
  for (const rows of groups.values()) {
    const members = rows
      .map((item) => item.event)
      .sort((a, b) => occurrenceIdOf(a).localeCompare(occurrenceIdOf(b)));
    const parentActivities = unique(
      rows.flatMap((item) =>
        item.parents.map((record) => record.parentActivityId),
      ),
    );
    const preferred = unique(
      members.map((event) => clean(event.parentActivityId)),
    );
    const activityId =
      preferred.find((id) => id.startsWith("activity:")) ??
      parentActivities[0] ??
      `activity:${sha(unique(rows.flatMap((item) => item.keys)).join("\0")).slice(0, 24)}`;
    const {
      sessions,
      sessionByOccurrence,
      preferredVenue,
      activityScopedOccurrences,
    } = mergeEquivalentSessions(activityId, members);
    coarseEnvelopesSuppressed += activityScopedOccurrences.size;
    const sessionById = new Map(
      sessions.map((session) => [session.sessionId, session]),
    );
    const venueGroups = new Map();
    for (const event of members) {
      const occurrenceId = occurrenceIdOf(event);
      const venueEvent = preferredVenue.get(occurrenceId) ?? event;
      const key = venueKey(venueEvent);
      const venueOccurrence = venueEvent.venueOccurrences?.[0] ?? {};
      const id = `venue-group:${sha(`${activityId}\0${key}`).slice(0, 24)}`;
      const group = venueGroups.get(id) ?? {
        venueGroupId: id,
        activityId,
        label:
          clean(
            venueOccurrence.publishedVenueName ??
              venueEvent.venue ??
              venueEvent.venueName,
          ) || "Location TBA",
        address: clean(venueOccurrence.address ?? venueEvent.address) || null,
        publicPlacement:
          venueEvent.publicPlacement ??
          venueOccurrence.publicPlacement ??
          "none",
        mappingStatus:
          venueEvent.mappingStatus ??
          venueOccurrence.mappingStatus ??
          "pending_review",
        approvedLocationId:
          venueOccurrence.approvedLocationId ??
          venueEvent.approvedLocationId ??
          null,
        coordinates: venueEvent.coordinates ?? null,
        occurrenceIds: [],
        sessionIds: [],
      };
      const sessionId = sessionByOccurrence.get(occurrenceId);
      group.occurrenceIds.push(occurrenceId);
      if (sessionId) {
        group.sessionIds.push(sessionId);
        sessionById.get(sessionId).venueGroupIds.push(id);
      }
      venueGroups.set(id, group);
    }
    for (const session of sessions)
      session.venueGroupIds = unique(session.venueGroupIds);
    for (const group of venueGroups.values()) {
      group.occurrenceIds = unique(group.occurrenceIds);
      group.sessionIds = unique(group.sessionIds);
    }
    const primary = members[0];
    records.push({
      schemaVersion: "1.0",
      activityId,
      title: clean(primary.title),
      description:
        members.map((item) => clean(item.description)).find(Boolean) ?? null,
      category:
        members.map((item) => clean(item.category)).find(Boolean) ?? null,
      organizer:
        members.map((item) => clean(item.organizer)).find(Boolean) ?? null,
      price: members.map((item) => clean(item.price)).find(Boolean) ?? null,
      lifecycleState: members.some((item) => item.lifecycleState === "active")
        ? "active"
        : (primary.lifecycleState ?? "active"),
      freshness: members.some((item) => item.freshness === "stale")
        ? "stale"
        : "current",
      sourceParentActivityIds: parentActivities,
      sourceParentListingIds: unique(
        rows.flatMap((item) =>
          item.parents.map((record) => record.parentListingId),
        ),
      ),
      sources: unique(
        rows.flatMap((item) => item.parents.map((record) => record.source)),
      ),
      occurrenceIds: members.map(occurrenceIdOf),
      sessions,
      venueGroups: [...venueGroups.values()].sort((a, b) =>
        a.venueGroupId.localeCompare(b.venueGroupId),
      ),
      sourceOffers: sourceOffers(
        activityId,
        members,
        sessionByOccurrence,
        activityScopedOccurrences,
        reviews,
        runId,
      ),
      scheduleSummary: scheduleSummary(sessions),
      groupingDecision: {
        strategy:
          parentActivities.length > 1
            ? "parent_evidence_group"
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
    occurrences: records.reduce(
      (sum, item) => sum + item.occurrenceIds.length,
      0,
    ),
    activities: records.length,
    sessions: records.reduce((sum, item) => sum + item.sessions.length, 0),
    venueGroups: records.reduce(
      (sum, item) => sum + item.venueGroups.length,
      0,
    ),
    sourceOffers: records.reduce(
      (sum, item) => sum + item.sourceOffers.length,
      0,
    ),
    reviews: reviews.length,
    parentCandidates: parentGrouping.counts.candidates,
    parentMerges: parentGrouping.counts.mergedParents,
    parentGroupingReviews: parentGrouping.counts.reviews,
    coarseEnvelopesSuppressed,
  };
  const activities = {
    schemaVersion: "1.0",
    runId,
    generatedAt,
    counts,
    records,
  };
  const reviewArtifact = {
    schemaVersion: "1.0",
    runId,
    generatedAt,
    counts: { records: reviews.length },
    records: reviews,
  };
  const decisions = reconcileActivityProjection({
    runId,
    records,
    previousRecords: previousActivities,
    reviews,
    generatedAt,
  });
  validateActivityProjection(activities, reviewArtifact);
  validateParentActivityGrouping(parentGrouping);
  validateActivityReconciliation(decisions);
  return { activities, reviews: reviewArtifact, decisions, parentGrouping };
}

export function validateActivityProjection(activities, reviews) {
  if (activities?.schemaVersion !== "1.0" || reviews?.schemaVersion !== "1.0")
    throw new Error("activity_projection_schema_invalid");
  const activityIds = new Set(),
    occurrenceIds = new Set();
  for (const activity of activities.records ?? []) {
    if (!activity.activityId || activityIds.has(activity.activityId))
      throw new Error("activity_projection_identity_invalid");
    activityIds.add(activity.activityId);
    for (const occurrenceId of activity.occurrenceIds ?? []) {
      if (!occurrenceId || occurrenceIds.has(occurrenceId))
        throw new Error("activity_projection_occurrence_membership_invalid");
      occurrenceIds.add(occurrenceId);
    }
    const sessionIds = new Set();
    const sessionOccurrenceIds = new Set();
    for (const session of activity.sessions ?? []) {
      if (!session.sessionId || sessionIds.has(session.sessionId))
        throw new Error("activity_projection_session_identity_invalid");
      sessionIds.add(session.sessionId);
      for (const occurrenceId of session.occurrenceIds ?? []) {
        if (
          !activity.occurrenceIds.includes(occurrenceId) ||
          sessionOccurrenceIds.has(occurrenceId)
        )
          throw new Error("activity_projection_session_membership_invalid");
        sessionOccurrenceIds.add(occurrenceId);
      }
    }
    if (sessionOccurrenceIds.size !== activity.occurrenceIds.length)
      throw new Error("activity_projection_session_coverage_invalid");
    for (const group of activity.venueGroups ?? [])
      if ((group.sessionIds ?? []).some((id) => !sessionIds.has(id)))
        throw new Error("activity_projection_venue_session_invalid");
    for (const offer of activity.sourceOffers ?? [])
      if (
        !canonicalUrl(offer.url) ||
        (offer.scope === "sessions" &&
          offer.sessionIds.some((id) => !sessionIds.has(id)))
      )
        throw new Error("activity_projection_offer_invalid");
  }
  if (
    activities.counts.activities !== activityIds.size ||
    activities.counts.occurrences !== occurrenceIds.size
  )
    throw new Error("activity_projection_counts_invalid");
  return activities;
}

export function validateParentActivityGrouping(parentGrouping) {
  if (
    parentGrouping?.schemaVersion !== "1.0" ||
    !Array.isArray(parentGrouping.records)
  )
    throw new Error("parent_activity_grouping_schema_invalid");
  const candidateIds = new Set();
  for (const candidate of parentGrouping.records) {
    if (
      !candidate.candidateId ||
      candidateIds.has(candidate.candidateId) ||
      !["merged", "kept_distinct", "needs_review"].includes(
        candidate.decision,
      ) ||
      !candidate.reasonCode ||
      !Array.isArray(candidate.parentKeys) ||
      candidate.parentKeys.length < 2 ||
      !Array.isArray(candidate.occurrenceIds) ||
      !candidate.occurrenceIds.length
    )
      throw new Error("parent_activity_grouping_decision_invalid");
    candidateIds.add(candidate.candidateId);
  }
  const expected = {
    candidates: parentGrouping.records.length,
    mergedParents: parentGrouping.records.filter(
      ({ decision }) => decision === "merged",
    ).length,
    keptDistinct: parentGrouping.records.filter(
      ({ decision }) => decision === "kept_distinct",
    ).length,
    reviews: parentGrouping.records.filter(
      ({ decision }) => decision === "needs_review",
    ).length,
  };
  for (const [key, value] of Object.entries(expected))
    if (parentGrouping.counts?.[key] !== value)
      throw new Error(`parent_activity_grouping_count_invalid:${key}`);
  return parentGrouping;
}
