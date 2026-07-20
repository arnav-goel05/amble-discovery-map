import { createHash } from 'node:crypto';

export const SCHEDULE_KINDS = new Set(['exact', 'range', 'recurring', 'selectable', 'anytime', 'unverified']);
export const PUBLIC_PLACEMENTS = new Set(['mapped', 'off_map', 'none']);
export const MAPPING_STATUSES = new Set(['approved', 'not_required', 'pending_review']);
export const LIFECYCLE_STATES = new Set(['active', 'held', 'archived', 'excluded']);
export const FRESHNESS_STATES = new Set(['current', 'stale']);
export const OFF_MAP_SUBTYPES = new Set(['secret_tba', 'multiple_locations', 'mobile_route', 'broad_area', 'geometry_unavailable']);
export const EVIDENCE_LEVELS = new Set(['direct', 'direct_corroborated', 'editorial_authoritative', 'editorial_evidence_incomplete', 'evidence_conflict', 'excluded']);

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const normalized = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-SG').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const stableId = (prefix, parts) => `${prefix}:${sha(JSON.stringify(parts)).slice(0, 24)}`;
const validDate = (value) => clean(value) && Number.isFinite(Date.parse(value)) ? clean(value) : null;

export function normalizeSchedule(schedule = {}, record = {}) {
  const suppliedKind = clean(schedule.kind);
  let kind = SCHEDULE_KINDS.has(suppliedKind) ? suppliedKind : null;
  const displayText = clean(schedule.displayText ?? record.dateText);
  const unreliableText = /^(?:tba|tbc|to be (?:confirmed|announced|advised)|date to be confirmed|coming soon|details? forthcoming)$/i.test(displayText ?? '');
  if (unreliableText) kind = 'unverified';
  const start = validDate(schedule.start ?? record.startDateTime ?? record.dateText);
  const end = validDate(schedule.end ?? record.endDateTime ?? (start && !/\b(?:to|until|through)\b|\s[-–]\s/i.test(record.dateText ?? '') ? record.dateText : null));
  const sessionRefs = [...new Set((schedule.sessionRefs ?? []).filter(Boolean).map(String))].sort();
  if (!kind) {
    if (schedule.recurrence) kind = 'recurring';
    else if (sessionRefs.length || (record.performances?.length ?? 0) > 1) kind = 'selectable';
    else if (start && end && start !== end) kind = 'range';
    else if (start) kind = 'exact';
    else if (record.anytime === true || /\b(?:anytime|by appointment|choose (?:a |your )?date|selectable dates?)\b/i.test(schedule.displayText ?? record.dateText ?? '')) kind = 'anytime';
    else if (clean(schedule.displayText ?? record.dateText)) kind = /\b(?:daily|weekly|every\s+\w+)\b/i.test(schedule.displayText ?? record.dateText) ? 'recurring' : 'exact';
    else kind = 'unverified';
  }
  return {
    kind,
    start: ['exact', 'range'].includes(kind) ? start : start,
    end: ['exact', 'range'].includes(kind) ? (end ?? start) : end,
    recurrence: kind === 'recurring' ? schedule.recurrence ?? null : null,
    sessionRefs,
    displayText,
    finalKnownOccurrence: validDate(schedule.finalKnownOccurrence ?? end ?? record.endDateTime),
  };
}

export function isOrdinaryAttractionAdmission(record = {}) {
  const title = normalized(record.title);
  const primaryProduct = normalized(record.primaryProduct ?? record.productType ?? record.category);
  const description = normalized([record.title, record.description, record.schedule?.displayText, record.dateText].filter(Boolean).join(' '));
  const productText = [primaryProduct, title].filter(Boolean).join(' ');
  const fixedAttraction = /\b(?:permanent attraction|museum|heritage cent(?:re|er)|science cent(?:re|er)|experience studio|observation deck|theme park|waterpark|aquarium|zoo|bird park|planetarium|digital dome theatre|botanical garden)\b/;
  const generalEntry = record.generalAdmission === true
    || /\b(?:general|standard|regular) admission\b|\b(?:admission|entry) (?:ticket|tickets|to|for)\b|\btickets? include(?:s|d)? admission\b/.test(description);
  const continuous = record.continuouslyAvailable === true
    || /\b(?:daily|opening hours|open every day|valid any day|various dates?|select (?:a |your )?dates?|choose (?:a |your )?date|monday (?:to|through|-) sunday|regular range)\b/.test(description);
  const fixedPermanent = record.permanentFixedAttraction === true
    || fixedAttraction.test(productText)
    || (generalEntry && fixedAttraction.test(description))
    || /\bpermanent (?:fixed )?attraction\b/.test(description);
  const distinctProgramme = record.distinctProgramme === true
    || /\b(?:special|seasonal|festival|limited run|workshop|guided tour|facilitated|masterclass|concert|performance|programme|photography walk|astronomy night)\b/.test(productText);
  return (generalEntry || fixedAttraction.test(productText)) && continuous && fixedPermanent && !distinctProgramme;
}

export function assessActivityInclusion(record = {}, { asOf = Date.now() } = {}) {
  const schedule = normalizeSchedule(record.schedule, record);
  const physicalScope = normalized([record.scope, record.venue, record.address].filter(Boolean).join(' '));
  const final = Date.parse(schedule.finalKnownOccurrence ?? schedule.end ?? '');
  if (record.purePromotion === true || record.recordType === 'membership_offer') return { eligible: false, lifecycleState: 'excluded', reasonCode: 'pure_promotion', schedule };
  if (record.mode === 'online' || record.isOnline === true) return { eligible: false, lifecycleState: 'excluded', reasonCode: 'online_only', schedule };
  if (record.scope === 'overseas' || /\b(?:johor|malaysia|indonesia|batam|bintan|kuala lumpur)\b/.test(physicalScope)) return { eligible: false, lifecycleState: 'excluded', reasonCode: 'outside_sg', schedule };
  if (isOrdinaryAttractionAdmission(record)) return { eligible: false, lifecycleState: 'excluded', reasonCode: 'ordinary_attraction_admission', schedule };
  if (Number.isFinite(final) && final < Number(new Date(asOf))) return { eligible: false, lifecycleState: 'archived', reasonCode: 'expired', schedule };
  if (!clean(record.title)) return { eligible: false, lifecycleState: 'held', reasonCode: 'missing_title', schedule };
  if (schedule.kind === 'unverified') return { eligible: true, lifecycleState: 'held', reasonCode: 'schedule_unverified', schedule };
  return { eligible: true, lifecycleState: 'active', reasonCode: schedule.kind === 'anytime' ? 'anytime' : 'eligible_activity', schedule };
}

export function assessEditorialSufficiency(record = {}, directRecords = []) {
  if (record.conflict === true) return { decision: 'review', evidenceLevel: 'evidence_conflict', reasonCode: 'evidence_conflict' };
  if (record.purePromotion === true) return { decision: 'exclude', evidenceLevel: 'excluded', reasonCode: 'pure_promotion' };
  if (directRecords.length) return { decision: 'eligible', evidenceLevel: 'direct_corroborated', reasonCode: 'direct_corroborated', primaryEvidenceId: directRecords[0].sourceRecordId };
  const schedule = normalizeSchedule(record.schedule ?? { kind: record.scheduleKind }, record);
  const specific = record.specific !== false && Boolean(clean(record.title) ?? clean(record.claims?.title));
  const current = record.current !== false;
  const singapore = normalized(record.scope ?? record.claims?.scope) === 'singapore';
  const placement = record.publicPlacement ?? record.location?.publicPlacement;
  const usableSchedule = schedule.kind !== 'unverified';
  if (specific && current && singapore && usableSchedule && ['mapped', 'off_map'].includes(placement)) {
    return { decision: 'eligible', evidenceLevel: 'editorial_authoritative', reasonCode: 'editorial_sufficient', primaryEvidenceId: record.sourceRecordId };
  }
  return { decision: 'review', evidenceLevel: 'editorial_evidence_incomplete', reasonCode: 'editorial_evidence_incomplete' };
}

export function assessLocationState(location = {}) {
  if (location.approvedLocationId && location.geometryApproved === true) return { publicPlacement: 'mapped', mappingStatus: 'approved', offMapSubtype: null, lifecycleState: 'active', reasonCode: 'building_approved' };
  if (OFF_MAP_SUBTYPES.has(location.offMapSubtype)) return { publicPlacement: 'off_map', mappingStatus: 'not_required', offMapSubtype: location.offMapSubtype, lifecycleState: 'active', reasonCode: location.offMapSubtype };
  if (location.singaporeScopeReliable === true && location.generalLocationUsable === true) return { publicPlacement: 'off_map', mappingStatus: 'pending_review', offMapSubtype: 'geometry_unavailable', lifecycleState: 'active', reasonCode: 'location_conflict' };
  return { publicPlacement: 'none', mappingStatus: 'pending_review', offMapSubtype: null, lifecycleState: 'held', reasonCode: 'location_conflict' };
}

export function deriveEventFreshness(contributions = [], materialFields = []) {
  const fieldFreshness = Object.fromEntries(materialFields.map((field) => {
    const supporters = contributions.filter((item) => item.fields?.includes(field));
    return [field, supporters.some((item) => item.freshness === 'current') ? 'current' : 'stale'];
  }));
  const freshness = Object.values(fieldFreshness).every((value) => value === 'current') ? 'current' : 'stale';
  return { freshness, staleReason: freshness === 'stale' ? contributions.find((item) => item.freshness === 'stale')?.staleReason ?? 'source_incomplete' : null, fieldFreshness };
}

export function normalizeActivityContract(input = {}) {
  const sourceRecordIds = [...new Set([input.sourceRecordId, ...(input.sourceRecordIds ?? [])].filter(Boolean))].sort();
  const parentActivityId = input.parentActivityId ?? stableId('activity', [input.sourceName, sourceRecordIds, normalized(input.title)]);
  const schedule = normalizeSchedule(input.schedule, input);
  const sessions = (input.sessions ?? []).map((session, index) => ({
    sessionId: session.sessionId ?? stableId('session', [parentActivityId, session.sourceSessionId ?? index, session.schedule ?? schedule]),
    parentActivityId, sourceSessionIds: [session.sourceSessionId].filter(Boolean), schedule: normalizeSchedule(session.schedule ?? schedule, session),
    availability: session.availability ?? 'unknown', accessRestriction: session.accessRestriction ?? null, evidenceRefs: session.evidenceRefs ?? [], venueOccurrenceIds: [],
  }));
  const venueOccurrences = (input.venueOccurrences ?? []).map((venue, index) => ({
    venueOccurrenceId: venue.venueOccurrenceId ?? stableId('venue-occurrence', [parentActivityId, venue.venueKey ?? venue.publishedVenueName ?? index]),
    parentActivityId, sessionIds: venue.sessionIds ?? [], publishedVenueName: clean(venue.publishedVenueName ?? venue.name),
    address: clean(venue.address), postalCode: clean(venue.postalCode), unit: clean(venue.unit), sourceCoordinates: venue.sourceCoordinates ?? null,
    publicPlacement: venue.publicPlacement ?? 'none', mappingStatus: venue.mappingStatus ?? 'pending_review', offMapSubtype: venue.offMapSubtype ?? null,
    approvedLocationId: venue.approvedLocationId ?? null, locationAssessmentId: venue.locationAssessmentId ?? stableId('location-assessment', [parentActivityId, index, venue]),
  }));
  const placement = venueOccurrences.length && venueOccurrences.every((item) => item.publicPlacement === 'mapped') ? 'mapped'
    : venueOccurrences.some((item) => item.publicPlacement === 'off_map') ? 'off_map' : 'none';
  const mappingStatus = venueOccurrences.some((item) => item.mappingStatus === 'pending_review') ? 'pending_review'
    : venueOccurrences.length && venueOccurrences.every((item) => item.mappingStatus === 'approved') ? 'approved' : 'not_required';
  const sourceContributions = input.sourceContributions ?? sourceRecordIds.map((sourceRecordId) => ({ sourceRecordId, freshness: 'current', fields: ['title', 'schedule', 'location'] }));
  const freshnessState = deriveEventFreshness(sourceContributions, input.materialFields ?? ['title', 'schedule', 'location']);
  const lifecycleState = input.lifecycleState ?? (placement === 'none' ? 'held' : 'active');
  const activity = {
    schemaVersion: '3.0', parentActivityId, publishedEventId: input.publishedEventId ?? stableId('event', [parentActivityId]),
    sourceRecordIds, title: clean(input.title), schedule, sessions, venueOccurrences, sourceContributions,
    lifecycleState, publicPlacement: input.publicPlacement ?? placement, mappingStatus: input.mappingStatus ?? mappingStatus,
    freshness: input.freshness ?? freshnessState.freshness, staleReason: input.staleReason ?? freshnessState.staleReason, fieldFreshness: input.fieldFreshness ?? freshnessState.fieldFreshness,
    evidenceLevel: input.evidenceLevel ?? 'direct', primaryEvidenceId: input.primaryEvidenceId ?? sourceRecordIds[0] ?? null,
  };
  validateActivityContract(activity);
  return activity;
}

export function validateActivityContract(activity) {
  if (activity?.schemaVersion !== '3.0' || !activity.parentActivityId || !activity.publishedEventId) throw new Error('Activity contract requires stable v3 identities');
  if (!SCHEDULE_KINDS.has(activity.schedule?.kind)) throw new Error('Activity schedule kind is invalid');
  if (!PUBLIC_PLACEMENTS.has(activity.publicPlacement) || !MAPPING_STATUSES.has(activity.mappingStatus)
    || !LIFECYCLE_STATES.has(activity.lifecycleState) || !FRESHNESS_STATES.has(activity.freshness)) throw new Error('Activity state dimensions are invalid');
  if (activity.publicPlacement === 'mapped' && activity.mappingStatus !== 'approved') throw new Error('Mapped activity requires approved mapping');
  if (activity.publicPlacement === 'none' && activity.lifecycleState === 'active') throw new Error('Active activity requires mapped or off-map placement');
  for (const venue of activity.venueOccurrences ?? []) {
    if (!PUBLIC_PLACEMENTS.has(venue.publicPlacement) || !MAPPING_STATUSES.has(venue.mappingStatus)) throw new Error('Venue occurrence state is invalid');
    if (venue.publicPlacement === 'mapped' && (!venue.approvedLocationId || venue.mappingStatus !== 'approved')) throw new Error('Mapped venue occurrence requires approved location identity');
    if (venue.offMapSubtype && !OFF_MAP_SUBTYPES.has(venue.offMapSubtype)) throw new Error('Venue occurrence off-map subtype is invalid');
  }
  return activity;
}
