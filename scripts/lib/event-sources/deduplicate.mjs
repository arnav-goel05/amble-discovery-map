import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const canonicalEventTitle = (value = "") => String(value).normalize("NFKC").toLocaleLowerCase("en-SG")
  .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
const tokens = (value) => new Set(canonicalEventTitle(value).split(" ").filter((token) => token.length > 2));
const genericTitles = new Set(["event", "workshop", "concert", "exhibition", "festival", "show", "tour", "activity"]);
const interval = (event) => {
  const start = Date.parse(event.startDateTime ?? event.startsAt ?? event.dateText);
  const end = Date.parse(event.endDateTime ?? event.endsAt ?? event.startDateTime ?? event.startsAt ?? event.dateText);
  return Number.isFinite(start) ? { start, end: Number.isFinite(end) ? end : start } : null;
};
const scheduleKind = (event) => event.schedule?.kind ?? (interval(event) ? "exact" : "unverified");
const scheduleCompatible = (a, b) => {
  const ai = interval(a), bi = interval(b);
  if (ai && bi) return ai.start <= bi.end && bi.start <= ai.end;
  return scheduleKind(a) === "anytime" && scheduleKind(b) === "anytime";
};
const titleCompatible = (a, b) => {
  const at = tokens(a), bt = tokens(b); if (!at.size || !bt.size) return false;
  if ([...at].every((token) => genericTitles.has(token)) || [...bt].every((token) => genericTitles.has(token))) return false;
  const shared = [...at].filter((token) => bt.has(token)).length;
  const yearsA = new Set([...at].filter((token) => /^20\d{2}$/.test(token))), yearsB = new Set([...bt].filter((token) => /^20\d{2}$/.test(token)));
  if (yearsA.size && yearsB.size && [...yearsA].every((year) => !yearsB.has(year))) return false;
  return shared / Math.min(at.size, bt.size) >= 0.7;
};
const strongerDuplicateEvidence = (a, b) => Boolean(
  a.authorityRecordId && a.authorityRecordId === b.authorityRecordId
  || a.canonicalAuthorityUrl && a.canonicalAuthorityUrl === b.canonicalAuthorityUrl
  || (a.explicitDuplicateKeys ?? []).some((key) => (b.explicitDuplicateKeys ?? []).includes(key))
);
const organizersCompatible = (a, b) => {
  const organizerA = canonicalEventTitle(a.organizer), organizerB = canonicalEventTitle(b.organizer);
  return !organizerA || !organizerB || organizerA === organizerB || strongerDuplicateEvidence(a, b);
};

export function generateDedupCandidates(events) {
  const candidates = [];
  const sorted = [...events].sort((a, b) => compare(a.occurrenceId ?? a.id, b.occurrenceId ?? b.id));
  for (let left = 0; left < sorted.length; left += 1) for (let right = left + 1; right < sorted.length; right += 1) {
    const a = sorted[left], b = sorted[right];
    const aSources = new Set((a.sources ?? []).map(({ source }) => source));
    const sharesSource = (b.sources ?? []).some(({ source }) => aSources.has(source));
    if (sharesSource && a.parentActivityId !== b.parentActivityId && a.parentListingId !== b.parentListingId) continue;
    if (!scheduleCompatible(a, b) || !titleCompatible(a.title, b.title) || !organizersCompatible(a, b)) continue;
    const aOffMapSubtype = offMapSubtypeOf(a), bOffMapSubtype = offMapSubtypeOf(b);
    const offMapCompatible = a.publicPlacement === "off_map" && b.publicPlacement === "off_map"
      && aOffMapSubtype === bOffMapSubtype && Boolean(aOffMapSubtype)
      && canonicalEventTitle(a.venue) === canonicalEventTitle(b.venue);
    candidates.push({ candidateId: `candidate:${sha(`${a.occurrenceId}:${b.occurrenceId}`)}`, occurrenceIds: [a.occurrenceId, b.occurrenceId].sort(), reasons: ["compatible_title", "compatible_schedule", ...(offMapCompatible ? ["compatible_off_map_state"] : []), ...(sharesSource ? ["same_parent_repeat"] : [])], rawVenueCompatible: canonicalEventTitle(a.venue) === canonicalEventTitle(b.venue), offMapCompatible, sameParentRepeat: sharesSource });
  }
  return candidates;
}

function approvedLocation(event, resolutions) {
  const resolution = resolutions[event.venueId];
  if (resolution?.resolutionStatus !== "approved") return null;
  return resolution.poiId ?? ([...(resolution.gmlIds ?? [resolution.gmlId].filter(Boolean))].sort().join("|") || null);
}

const eventSources = (event) => [...new Set((event?.sources ?? []).map(({ source }) => source).filter(Boolean))];
const offMapSubtypeOf = (event) => event.offMapSubtype ?? event.venueOccurrences?.find(({ offMapSubtype }) => offMapSubtype)?.offMapSubtype ?? null;

function ambiguousSiblingCandidates(candidates, byId) {
  const partnersByOccurrenceAndSource = new Map();
  const addPartner = (occurrenceId, source, partnerId) => {
    const key = `${occurrenceId}\0${source}`;
    if (!partnersByOccurrenceAndSource.has(key)) partnersByOccurrenceAndSource.set(key, new Set());
    partnersByOccurrenceAndSource.get(key).add(partnerId);
  };
  for (const { occurrenceIds: [aId, bId] } of candidates) {
    const a = byId.get(aId), b = byId.get(bId);
    for (const source of eventSources(b)) addPartner(aId, source, bId);
    for (const source of eventSources(a)) addPartner(bId, source, aId);
  }
  return new Set(candidates.filter(({ occurrenceIds: [aId, bId] }) => {
    const a = byId.get(aId), b = byId.get(bId);
    return eventSources(b).some((source) => partnersByOccurrenceAndSource.get(`${aId}\0${source}`)?.size > 1)
      || eventSources(a).some((source) => partnersByOccurrenceAndSource.get(`${bId}\0${source}`)?.size > 1);
  }).map(({ candidateId }) => candidateId));
}

export function finalizeDeduplication({ events, candidates = generateDedupCandidates(events), resolutions = {}, priorClusters = [], sourcePrecedence = {} }) {
  const byId = new Map(events.map((event) => [event.occurrenceId, structuredClone(event)]));
  const ambiguousCandidateIds = ambiguousSiblingCandidates(candidates, byId);
  const parent = new Map(events.map((event) => [event.occurrenceId, event.occurrenceId]));
  const find = (id) => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  const union = (a, b) => { const ar = find(a), br = find(b); if (ar !== br) parent.set(br, ar < br ? ar : br), parent.set(ar, ar < br ? ar : br); };
  const priorByMember = new Map(priorClusters.flatMap((cluster) => cluster.memberIds.map((id) => [id, cluster])));
  const decisions = [], blockingReviews = [];
  for (const candidate of candidates) {
    const [aId, bId] = candidate.occurrenceIds, a = byId.get(aId), b = byId.get(bId);
    const aLocation = approvedLocation(a, resolutions), bLocation = approvedLocation(b, resolutions);
    const priorA = priorByMember.get(aId), priorB = priorByMember.get(bId);
    if (ambiguousCandidateIds.has(candidate.candidateId)) {
      decisions.push({ ...candidate, decision: "potential_duplicate_kept_distinct", evidence: { aLocation, bLocation, reason: "ambiguous_sibling_mapping" } });
      continue;
    }
    if (priorA && priorB && priorA.identityAnchor !== priorB.identityAnchor) {
      const decision = { ...candidate, decision: "prior_cluster_join_review", evidence: { aLocation, bLocation, priorAnchors: [priorA.identityAnchor, priorB.identityAnchor] } };
      decisions.push(decision); blockingReviews.push(decision); continue;
    }
    if (aLocation && aLocation === bLocation) { union(aId, bId); decisions.push({ ...candidate, decision: "merged", evidence: { approvedLocationId: aLocation } }); }
    else if (candidate.offMapCompatible || candidate.sameParentRepeat && candidate.rawVenueCompatible) { union(aId, bId); decisions.push({ ...candidate, decision: "merged", evidence: { offMapSubtype: offMapSubtypeOf(a), sameParentRepeat: candidate.sameParentRepeat } }); }
    else decisions.push({ ...candidate, decision: "potential_duplicate_kept_distinct", evidence: { aLocation, bLocation } });
  }
  const groups = new Map();
  for (const event of events) { const root = find(event.occurrenceId); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(byId.get(event.occurrenceId)); }
  const finalized = [...groups.values()].map((members) => {
    members.sort((a, b) => {
      const ap = Math.min(...(a.sources ?? []).map(({ source }) => sourcePrecedence[source] ?? 9999));
      const bp = Math.min(...(b.sources ?? []).map(({ source }) => sourcePrecedence[source] ?? 9999));
      return ap - bp || compare(a.occurrenceId, b.occurrenceId);
    });
    const memberIds = members.map(({ occurrenceId }) => occurrenceId).sort();
    const prior = priorClusters.find((cluster) => cluster.memberIds.some((id) => memberIds.includes(id)));
    const identityAnchor = prior?.identityAnchor ?? members[0].identityAnchor ?? members[0].occurrenceId;
    const primary = members[0];
    const uniqueBy = (items, keyOf) => [...new Map(items.filter(Boolean).map((item) => [keyOf(item), item])).values()];
    const sessions = uniqueBy(members.flatMap(({ sessions = [] }) => sessions), (session) => session.sessionId ?? JSON.stringify(session));
    const venueOccurrences = uniqueBy(members.flatMap(({ venueOccurrences = [] }) => venueOccurrences), (venue) => venue.venueOccurrenceId ?? JSON.stringify(venue));
    const sourceContributions = uniqueBy(members.flatMap(({ sourceContributions = [] }) => sourceContributions), (item) => item.sourceRecordId ?? JSON.stringify(item));
    return {
      ...primary, id: identityAnchor, occurrenceId: identityAnchor, identityAnchor,
      mergedEventId: `merged:${sha(JSON.stringify(memberIds))}`, membershipHash: sha(JSON.stringify(memberIds)),
      sourceOccurrenceIds: memberIds,
      sources: members.flatMap(({ sources = [] }) => sources).toSorted((a, b) => (sourcePrecedence[a.source] ?? 9999) - (sourcePrecedence[b.source] ?? 9999) || compare(a.sourceId, b.sourceId)),
      provenanceRefs: [...new Set(members.flatMap(({ provenanceRefs = [] }) => provenanceRefs))].sort(),
      supportingDiscoveryIds: [...new Set(members.flatMap(({ supportingDiscoveryIds = [] }) => supportingDiscoveryIds))].sort(),
      sessions, venueOccurrences, sourceContributions,
      publishedEventId: identityAnchor,
      evidenceLevel: members.some(({ evidenceLevel }) => evidenceLevel === "direct_corroborated") || members.some(({ evidenceLevel }) => evidenceLevel === "editorial_authoritative") && members.some(({ evidenceLevel }) => evidenceLevel === "direct") ? "direct_corroborated" : primary.evidenceLevel ?? "direct",
    };
  }).sort((a, b) => compare(a.identityAnchor, b.identityAnchor));
  return { events: finalized, decisions, blockingReviews, counts: { eligiblePreDedup: events.length, crossSourceDuplicateCollapsed: events.length - finalized.length, acceptedPrimary: finalized.length, blockingReviewOccurrences: blockingReviews.length } };
}
