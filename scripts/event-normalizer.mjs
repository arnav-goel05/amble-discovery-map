import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assessActivityInclusion, isOrdinaryAttractionAdmission, normalizeSchedule } from './lib/event-sources/activity-policy.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const normalizeText = (value = '') => String(value).normalize('NFKC').toLocaleLowerCase('en-SG').replace(/[\p{P}\p{S}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const codePointCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function buildActivityHierarchy(input = {}) {
  const parentActivityId = input.parentActivityId ?? `activity:${sha(JSON.stringify([input.sourceName, input.sourceRecordId, normalizeText(input.title)] )).slice(0, 24)}`;
  const sessions = (input.sessions ?? []).map((session, index) => ({
    sessionId: session.sessionId ?? `session:${sha(JSON.stringify([parentActivityId, session.sourceSessionId ?? index, session.schedule ?? input.schedule])).slice(0, 24)}`,
    parentActivityId, sourceSessionIds: [session.sourceSessionId].filter(Boolean), schedule: normalizeSchedule(session.schedule ?? input.schedule, session),
    availability: session.availability ?? 'unknown', accessRestriction: session.accessRestriction ?? null,
    venueOccurrenceIds: [], evidenceRefs: session.evidenceRefs ?? [], venueKey: session.venueKey ?? null,
  }));
  const venues = input.venues ?? [];
  const reliablePairs = sessions.length > 0 && sessions.every((session) => session.venueKey && venues.some((venue) => venue.venueKey === session.venueKey));
  let venueOccurrences;
  if (venues.length > 1 && !reliablePairs) {
    venueOccurrences = [{
      venueOccurrenceId: `venue-occurrence:${sha(JSON.stringify([parentActivityId, 'multiple_locations'])).slice(0, 24)}`,
      parentActivityId, sessionIds: sessions.map(({ sessionId }) => sessionId), publishedVenueName: 'Multiple locations', address: null, postalCode: null, unit: null,
      publicPlacement: 'off_map', mappingStatus: 'not_required', offMapSubtype: 'multiple_locations', approvedLocationId: null,
    }];
  } else {
    const selected = venues.length ? venues : [{ name: input.venue ?? null, address: input.address ?? null }];
    venueOccurrences = selected.filter((venue) => venue.name).map((venue, index) => {
      const linkedSessions = reliablePairs ? sessions.filter((session) => session.venueKey === venue.venueKey) : sessions;
      const venueOccurrenceId = venue.venueOccurrenceId ?? `venue-occurrence:${sha(JSON.stringify([parentActivityId, venue.venueKey ?? venue.name ?? index])).slice(0, 24)}`;
      for (const session of linkedSessions) session.venueOccurrenceIds.push(venueOccurrenceId);
      const name = venue.name ?? venue.publishedVenueName;
      const normalizedName = normalizeText(name);
      const subtype = /\bsecret\b|\btba\b|\bto be announced\b/.test(normalizedName) ? 'secret_tba'
        : /\bvarious venues\b|\bmultiple locations\b/.test(normalizedName) ? 'multiple_locations'
          : /\bmobile\b|\broute\b|\bmoving\b/.test(normalizedName) ? 'mobile_route'
            : /\bpark\b|\bdistrict\b|\barea\b/.test(normalizedName) && !venue.address ? 'broad_area' : null;
      return {
        venueOccurrenceId, parentActivityId, sessionIds: linkedSessions.map(({ sessionId }) => sessionId), publishedVenueName: name,
        address: venue.address ?? null, postalCode: venue.postalCode ?? null, unit: venue.unit ?? null,
        publicPlacement: subtype ? 'off_map' : 'none', mappingStatus: subtype ? 'not_required' : 'pending_review', offMapSubtype: subtype, approvedLocationId: venue.approvedLocationId ?? null,
      };
    });
  }
  return { parentActivityId, schedule: normalizeSchedule(input.schedule, input), sessions, venueOccurrences };
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function parseBoundary(value, endOfDay = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const human = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const normalized = human
    ? `${human[1]} ${human[2]} ${human[3]} ${endOfDay ? '23:59:59' : '00:00:00'} +0800`
    : isoDate ? `${text}T${endOfDay ? '23:59:59' : '00:00:00'}+08:00` : text;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function interval(record) {
  let start = parseBoundary(record.startDateTime);
  let end = parseBoundary(record.endDateTime, true);
  if (start === null && typeof record.dateText === 'string') {
    const parts = record.dateText.split(/\s+to\s+/i);
    start = parseBoundary(parts[0]);
    end = parseBoundary(parts.at(-1), true);
  }
  return start === null ? null : { start, end: end ?? start };
}

function envelope(runId, source, records) {
  return { schemaVersion: '3.0', runId, createdAt: new Date().toISOString(), source, counts: { records: records.length }, records };
}

export function migrateNormalizedArtifactV2(artifact) {
  if (artifact?.schemaVersion === '3.0') return structuredClone(artifact);
  if (!artifact || !['1.0', '2.0'].includes(artifact.schemaVersion) || !Array.isArray(artifact.records)) throw new Error('A v1/v2 normalized artifact is required');
  return {
    ...artifact, schemaVersion: '3.0', migratedFromSchemaVersion: artifact.schemaVersion,
    records: artifact.records.map((record) => {
      const parentActivityId = record.parentActivityId ?? record.parentListingId ?? record.parentEventId ?? record.id;
      const schedule = normalizeSchedule(record.schedule, record);
      const publishedEventId = record.publishedEventId ?? record.identityAnchor ?? record.id;
      return {
        ...record, schemaVersion: '3.0', parentActivityId, publishedEventId,
        schedule, sessions: record.sessions ?? [], venueOccurrences: record.venueOccurrences ?? [],
        publicPlacement: record.publicPlacement ?? (record.venueVerified ? 'mapped' : 'none'),
        mappingStatus: record.mappingStatus ?? (record.venueVerified ? 'approved' : 'pending_review'),
        lifecycleState: record.lifecycleState ?? (record.reviewStatus === 'eligible' && record.venueVerified ? 'active' : 'held'),
        freshness: record.freshness ?? 'current', fieldFreshness: record.fieldFreshness ?? { title: 'current', schedule: 'current', location: 'current' },
        sourceContributions: record.sourceContributions ?? (record.sources ?? []).map((source) => ({ sourceRecordId: `${source.source}:${source.sourceId}`, freshness: 'current', fields: ['title', 'schedule', 'location'] })),
      };
    }),
  };
}

function sourceOccurrenceId(record, performance, index) {
  if (performance.startDateTime) return `${record.sourceId}#${performance.startDateTime}`;
  const dateText = performance.dateText ?? record.dateText;
  const parsed = parseBoundary(String(dateText ?? '').split(/\s+to\s+/i)[0]);
  const date = parsed === null ? null : new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(parsed));
  return date ? `${record.sourceId}#${date}#${index + 1}` : `${record.sourceId}#${index + 1}`;
}

const qualifiedOccurrenceId = (sourceName, sourceId) => `${sourceName}:${sourceId}`;

function visibleContentHash(event) {
  return sha(JSON.stringify({
    title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, dateText: event.dateText,
    timeText: event.timeText, venueId: event.venueId, venueName: event.venueName,
    address: event.address, category: event.category, price: event.price,
    description: event.description, organizer: event.organizer, officialUrl: event.officialUrl,
    sourceOccurrenceIds: event.sourceOccurrenceIds,
  }));
}

function canonicalEvent(sourceName, recordRef, record, performance, index) {
  const sourceId = sourceOccurrenceId(record, performance, index);
  const occurrenceId = qualifiedOccurrenceId(sourceName, sourceId);
  const parentListingId = `${sourceName}:${record.sourceId}`;
  const startsAt = performance.startDateTime ?? null;
  const endsAt = performance.endDateTime ?? null;
  const hierarchy = buildActivityHierarchy({
    sourceName, sourceRecordId: record.sourceId, title: record.title, schedule: record.schedule,
    sessions: (record.performances?.length ? record.performances : [record]).map((item, sessionIndex) => ({ sourceSessionId: sourceOccurrenceId(record, item, sessionIndex), schedule: normalizeSchedule(item.schedule, { ...record, ...item }), availability: item.availability ?? record.availability, accessRestriction: item.accessRestriction ?? record.accessRestriction, venueKey: item.venue ?? record.venue })),
    venues: [...new Map((record.performances?.length ? record.performances : [record]).map((item) => [item.venue ?? record.venue, { venueKey: item.venue ?? record.venue, name: item.venue ?? record.venue, address: item.address ?? record.address }])).values()],
  });
  const schedule = normalizeSchedule(performance.schedule ?? record.schedule, { ...record, ...performance });
  return {
    schemaVersion: '3.0', id: occurrenceId, occurrenceId, identityAnchor: occurrenceId, publishedEventId: occurrenceId,
    parentActivityId: hierarchy.parentActivityId, parentListingId, mergedEventId: null,
    sourceName, sourceEventId: sourceId, sourceOccurrenceIds: [occurrenceId],
    title: typeof (performance.title ?? record.title) === 'string' ? (performance.title ?? record.title).trim() : '', startsAt, endsAt,
    startDateTime: startsAt, endDateTime: endsAt,
    dateText: performance.dateText ?? record.dateText ?? null, timeText: performance.timeText ?? record.timeText ?? null,
    allDay: /^full day$/i.test(performance.timeText ?? record.timeText ?? ''), timezone: 'Asia/Singapore',
    venueId: null, venueName: (performance.venue ?? record.venue)?.trim() || null,
    venue: (performance.venue ?? record.venue)?.trim() || null, venueVerified: false, address: performance.address ?? record.address ?? null,
    addressEvidence: (performance.address ?? record.address) ? [{ value: performance.address ?? record.address, recordRef }] : [],
    coordinates: null, category: record.category ?? null, price: record.price ?? null,
    description: record.description ?? null, organizer: record.organizer ?? null,
    officialUrl: record.detailUrl ?? null, eventUrl: record.detailUrl ?? null,
    isOnline: record.mode === 'online', parentEventId: record.sourceId,
    contentHash: null, provenanceRefs: [recordRef], reviewStatus: startsAt || performance.dateText || record.dateText ? 'eligible' : 'undated_review',
    schedule, sessions: hierarchy.sessions, venueOccurrences: hierarchy.venueOccurrences,
    publicPlacement: record.publicPlacement ?? (hierarchy.venueOccurrences.some((item) => item.publicPlacement === 'off_map') ? 'off_map' : 'none'),
    mappingStatus: record.mappingStatus ?? (hierarchy.venueOccurrences.some((item) => item.mappingStatus === 'pending_review') ? 'pending_review' : 'not_required'), lifecycleState: record.lifecycleState ?? (schedule.kind === 'unverified' ? 'held' : 'active'),
    freshness: 'current', fieldFreshness: { title: 'current', schedule: 'current', location: 'current' },
    supportingDiscoveryIds: record.supportingDiscoveryIds ?? (record.recordType === 'discovery' ? [record.discoveryRecordId] : []),
    evidenceLevel: record.evidenceLevel ?? 'direct', primaryEvidenceId: record.primaryEvidenceId ?? occurrenceId,
    sourceContributions: record.sourceContributions ?? [{ sourceRecordId: occurrenceId, freshness: 'current', fields: ['title', 'schedule', 'location'] }],
    sources: [{ source: sourceName, sourceId, sourceUrl: record.detailUrl ?? null, recordRef }]
  };
}

function normalizationReason(record, event) {
  const title = normalizeText(event.title), schedule = normalizeText([record.dateText, event.dateText, event.timeText].filter(Boolean).join(' '));
  if (isOrdinaryAttractionAdmission({
    ...record, title: event.title, description: record.description,
    generalAdmission: record.generalAdmission === true || /\b(?:general|standard|regular) admission\b/.test(normalizeText([title, record.description].join(' '))),
    continuouslyAvailable: record.continuouslyAvailable === true || /\b(?:daily|opening hours|normal operations)\b/.test(schedule),
    permanentFixedAttraction: record.permanentFixedAttraction === true || /\bpermanent(?: fixed)? attraction\b/.test(normalizeText(record.description)),
  })) return 'ordinary_attraction_admission';
  if (/\b(?:johor|kuala lumpur|malaysia|batam|bintan|indonesia)\b/.test(normalizeText([event.venue, event.address].filter(Boolean).join(' ')))) return 'outside_singapore';
  return null;
}

function sameEvent(a, b) {
  const ai = interval(a), bi = interval(b);
  return normalizeText(a.title) === normalizeText(b.title)
    && normalizeText(a.venue) === normalizeText(b.venue)
    && ai && bi && ai.start <= bi.end && bi.start <= ai.end;
}

function schedulePrecision(event) {
  return Number(Boolean(event.startsAt)) * 2 + Number(Boolean(event.endsAt));
}

function mergedId(sources) {
  const identity = sources.map(({ source, sourceId }) => ({ source, sourceId }))
    .sort((a, b) => codePointCompare(a.source, b.source) || codePointCompare(a.sourceId, b.sourceId));
  return `merged:${sha(JSON.stringify(identity))}`;
}

export function normalizeRun({ runDir, state, run }) {
  const eligible = [], excluded = [], invalid = [], decisions = [];
  const sourceReclassifications = {};
  const sourceOrder = new Map(Object.keys(state.sources).map((name, index) => [name, index]));
  const sourceAccounting = Object.fromEntries(Object.keys(state.sources).map((name) => [name, {
    occurrencesEmitted: 0, excludedOccurrences: 0, eligiblePreDedup: 0, duplicateCollapsed: 0, acceptedPrimary: 0
  }]));
  for (const [sourceName, source] of Object.entries(state.sources)) {
    if (source.status !== 'success') continue;
    if (source.operatingMode === 'pilot') {
      sourceReclassifications[sourceName] = [];
      continue;
    }
    const reclassifiedRefs = (source.invalidSourceRecordRefs ?? []).filter((recordRef) => {
      const reason = source.invalidReasonCodes?.[recordRef];
      return ['invalid_date', 'invalid_mode'].includes(reason)
        && recordRef.includes('#/records/') && existsSync(join(runDir, recordRef.split('#')[0]));
    });
    sourceReclassifications[sourceName] = reclassifiedRefs;
    for (const recordRef of source.invalidSourceRecordRefs ?? []) {
      if (reclassifiedRefs.includes(recordRef)) continue;
      invalid.push({ reasonCode: source.invalidReasonCodes?.[recordRef] ?? 'invalid_source_record', sourceRecordRef: recordRef });
    }
    for (const recordRef of [...(source.processedSourceRecordRefs ?? []), ...reclassifiedRefs]) {
      const [artifact, pointer] = recordRef.split('#');
      const document = JSON.parse(readFileSync(join(runDir, artifact), 'utf8'));
      const index = Number(pointer.match(/^\/records\/(\d+)$/)?.[1]);
      const record = document.records?.[index];
      if (!record) throw new Error(`Processed source record does not resolve: ${recordRef}`);
      let recordType = record.recordType ?? 'event';
      if (recordType === 'event' && artifact.startsWith('raw/catch/details/')) {
        const responsePath = join(runDir, artifact.replace(/\.json$/, '.response.json'));
        if (existsSync(responsePath)) {
          const response = JSON.parse(readFileSync(responsePath, 'utf8')).data ?? {};
          const admission = String(response.AdmissionRule ?? '').replace(/<[^>]+>/g, ' ').trim();
          if (response.MembershipExclusivesPromo && /^\s*(?:[•*-]\s*)?offer\b/i.test(admission)) recordType = 'membership_offer';
        }
      }
      const performances = record.performances?.length ? record.performances : [record];
      performances.forEach((performance, performanceIndex) => {
        sourceAccounting[sourceName].occurrencesEmitted += 1;
        const event = canonicalEvent(sourceName, recordRef, record, performance, performanceIndex);
        const policy = assessActivityInclusion({ ...record, ...event, schedule: event.schedule }, { asOf: run.window.start });
        const reasonCode = record.reasonCode ?? normalizationReason(record, event) ?? (recordType === 'membership_offer' ? 'membership_offer'
          : !event.title ? 'missing_title'
          : record.mode === 'online' ? 'online' : !event.venue ? 'missing_venue' : !policy.eligible ? policy.reasonCode : null);
        if (reasonCode) {
          sourceAccounting[sourceName].excludedOccurrences += 1;
          excluded.push({ reasonCode, sourceRecordRef: recordRef, occurrenceIndex: performanceIndex, event });
        } else {
          sourceAccounting[sourceName].eligiblePreDedup += 1;
          eligible.push(event);
        }
      });
    }
  }

  const events = [];
  for (const candidate of eligible) {
    const existing = events.find((event) => event.sourceName === candidate.sourceName && sameEvent(event, candidate));
    if (!existing) {
      candidate.mergedEventId = mergedId(candidate.sources);
      events.push(candidate);
      decisions.push({ inputIds: candidate.sourceOccurrenceIds, outputId: candidate.occurrenceId, mergedEventId: candidate.mergedEventId, decision: 'retained', evidence: 'unique title, venue, and interval', primarySource: candidate.sources[0].source });
      continue;
    }
    const combinedSources = [...existing.sources, ...candidate.sources];
    const combinedOccurrenceIds = [...existing.sourceOccurrenceIds, ...candidate.sourceOccurrenceIds];
    const combinedProvenanceRefs = [...existing.provenanceRefs, ...candidate.provenanceRefs];
    const previousMergedEventId = existing.mergedEventId;
    const retained = schedulePrecision(candidate) > schedulePrecision(existing)
      ? Object.assign(existing, candidate)
      : existing;
    retained.sources = combinedSources;
    retained.sourceOccurrenceIds = combinedOccurrenceIds;
    retained.provenanceRefs = combinedProvenanceRefs;
    retained.mergedEventId = mergedId(combinedSources);
    decisions.push({ inputIds: [previousMergedEventId, ...candidate.sourceOccurrenceIds], outputId: retained.occurrenceId, mergedEventId: retained.mergedEventId, decision: 'merged', evidence: 'normalized title and venue match with overlapping interval; retained the most precise schedule', primarySource: combinedSources.toSorted((a, b) => sourceOrder.get(a.source) - sourceOrder.get(b.source))[0].source });
  }
  events.sort((a, b) => (interval(a)?.start ?? Infinity) - (interval(b)?.start ?? Infinity) || codePointCompare(a.id, b.id));
  for (const event of events) {
    event.sources.sort((a, b) => sourceOrder.get(a.source) - sourceOrder.get(b.source) || codePointCompare(a.sourceId, b.sourceId));
    event.sourceOccurrenceIds = event.sources.map((source) => qualifiedOccurrenceId(source.source, source.sourceId));
    event.provenanceRefs = event.sources.map((source) => source.recordRef);
    event.occurrenceId = event.sourceOccurrenceIds[0];
    event.id = event.occurrenceId;
    event.sourceName = event.sources[0].source;
    event.sourceEventId = event.sources[0].sourceId;
    event.parentListingId = `${event.sourceName}:${event.parentEventId}`;
    event.mergedEventId = mergedId(event.sources);
    event.eventUrl = event.sources.find((source) => {
      try { return ['http:', 'https:'].includes(new URL(source.sourceUrl).protocol); } catch { return false; }
    })?.sourceUrl ?? null;
    event.officialUrl = event.eventUrl;
    sourceAccounting[event.sources[0].source].acceptedPrimary += 1;
    for (const duplicate of event.sources.slice(1)) sourceAccounting[duplicate.source].duplicateCollapsed += 1;
  }

  const venues = new Map(), branchIds = new Map();
  for (const event of events) {
    if ((event.publicPlacement === 'off_map' && event.mappingStatus !== 'pending_review') || event.lifecycleState !== 'active') {
      event.venueId = null;
      event.contentHash = visibleContentHash(event);
      continue;
    }
    const key = normalizeText(event.venue);
    if (!venues.has(key)) {
      const hash = sha(key);
      let id = `venue-${hash.slice(0, 16)}`;
      if (branchIds.has(id) && branchIds.get(id) !== key) {
        const previousKey = branchIds.get(id);
        const previous = venues.get(previousKey);
        branchIds.delete(id);
        previous.id = `venue-${sha(previousKey)}`;
        branchIds.set(previous.id, previousKey);
        id = `venue-${hash}`;
      }
      branchIds.set(id, key);
      venues.set(key, { id, venue: event.venue, eventIds: [] });
    }
    venues.get(key).eventIds.push(event.id);
    event.venueId = venues.get(key).id;
    event.contentHash = visibleContentHash(event);
  }
  const artifactRefs = ['normalized/events.json', 'normalized/excluded.json', 'normalized/invalid.json', 'normalized/dedup-decisions.json'];
  atomicJson(join(runDir, artifactRefs[0]), envelope(run.runId, null, events));
  atomicJson(join(runDir, artifactRefs[1]), envelope(run.runId, null, excluded));
  atomicJson(join(runDir, artifactRefs[2]), envelope(run.runId, null, invalid));
  atomicJson(join(runDir, artifactRefs[3]), envelope(run.runId, null, decisions));
  return {
    status: 'success', artifactRefs,
    counts: { eligiblePreDedup: eligible.length, duplicateCollapsed: eligible.length - events.length, acceptedPostDedup: events.length, acceptedPrimary: events.length },
    venueBranches: [...venues.values()], sourceAccounting, sourceReclassifications,
    evidence: {
      uniqueActivities: events.length,
      levels: Object.fromEntries([...new Set(events.map((event) => event.evidenceLevel ?? 'direct'))].sort().map((level) => [level, events.filter((event) => (event.evidenceLevel ?? 'direct') === level).length])),
      upgrades: {},
    },
    sourceReconciliation: {
      accounted: Object.values(state.sources).every((source) => ['success', 'blocked', 'failed', 'pilot_failed', 'disabled'].includes(source.status)),
      statuses: Object.fromEntries(Object.entries(state.sources).map(([name, source]) => [name, source.status])),
    },
  };
}

export { interval as normalizedEventInterval, normalizeText };
