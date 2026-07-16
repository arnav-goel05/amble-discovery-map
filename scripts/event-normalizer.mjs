import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const normalizeText = (value = '') => String(value).normalize('NFKC').toLocaleLowerCase('en-SG').replace(/[\p{P}\p{S}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const codePointCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

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
  const parsed = Date.parse(human ? `${human[1]} ${human[2]} ${human[3]} ${endOfDay ? '23:59:59' : '00:00:00'} +0800` : text);
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
  return { schemaVersion: '1.0', runId, createdAt: new Date().toISOString(), source, counts: { records: records.length }, records };
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
  return {
    schemaVersion: '1.0', id: occurrenceId, occurrenceId, parentListingId, mergedEventId: null,
    sourceName, sourceEventId: sourceId, sourceOccurrenceIds: [occurrenceId],
    title: typeof record.title === 'string' ? record.title.trim() : '', startsAt, endsAt,
    startDateTime: startsAt, endDateTime: endsAt,
    dateText: performance.dateText ?? record.dateText ?? null, timeText: performance.timeText ?? record.timeText ?? null,
    allDay: /^full day$/i.test(performance.timeText ?? record.timeText ?? ''), timezone: 'Asia/Singapore',
    venueId: null, venueName: record.venue?.trim() || null,
    venue: record.venue?.trim() || null, venueVerified: false, address: record.address ?? null,
    addressEvidence: record.address ? [{ value: record.address, recordRef }] : [],
    coordinates: null, category: record.category ?? null, price: record.price ?? null,
    description: record.description ?? null, organizer: record.organizer ?? null,
    officialUrl: record.detailUrl ?? null, eventUrl: record.detailUrl ?? null,
    isOnline: record.mode === 'online', parentEventId: record.sourceId,
    contentHash: null, provenanceRefs: [recordRef], reviewStatus: startsAt || performance.dateText || record.dateText ? 'eligible' : 'undated_review',
    sources: [{ source: sourceName, sourceId, sourceUrl: record.detailUrl ?? null, recordRef }]
  };
}

function sameEvent(a, b) {
  const ai = interval(a), bi = interval(b);
  return normalizeText(a.title) === normalizeText(b.title)
    && normalizeText(a.venue) === normalizeText(b.venue)
    && ai && bi && ai.start <= bi.end && bi.start <= ai.end;
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
        const eventInterval = interval(event);
        const overlaps = eventInterval && eventInterval.end >= Date.parse(run.window.start) && eventInterval.start <= Date.parse(run.window.end);
        const reasonCode = recordType === 'membership_offer' ? 'membership_offer'
          : !event.title ? 'missing_title' : eventInterval && !overlaps ? 'outside_window'
          : record.mode === 'online' ? 'online' : !event.venue ? 'missing_venue' : null;
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
    const existing = events.find((event) => sameEvent(event, candidate));
    if (!existing) {
      candidate.mergedEventId = mergedId(candidate.sources);
      events.push(candidate);
      decisions.push({ inputIds: candidate.sourceOccurrenceIds, outputId: candidate.occurrenceId, mergedEventId: candidate.mergedEventId, decision: 'retained', evidence: 'unique title, venue, and interval', primarySource: candidate.sources[0].source });
      continue;
    }
    existing.sources.push(...candidate.sources);
    existing.sourceOccurrenceIds.push(...candidate.sourceOccurrenceIds);
    existing.provenanceRefs.push(...candidate.provenanceRefs);
    const previousMergedEventId = existing.mergedEventId;
    existing.mergedEventId = mergedId(existing.sources);
    decisions.push({ inputIds: [previousMergedEventId, ...candidate.sourceOccurrenceIds], outputId: existing.occurrenceId, mergedEventId: existing.mergedEventId, decision: 'merged', evidence: 'normalized title and venue match with overlapping interval', primarySource: existing.sources.toSorted((a, b) => sourceOrder.get(a.source) - sourceOrder.get(b.source))[0].source });
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
    venueBranches: [...venues.values()], sourceAccounting, sourceReclassifications
  };
}

export { interval as normalizedEventInterval, normalizeText };
