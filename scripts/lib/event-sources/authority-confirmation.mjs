import { createHash } from "node:crypto";
import { assertAuthorityUrlAllowed } from "../provider-policy.mjs";
import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";
import { normalized } from "./rendered-adapter-utils.mjs";
import {
  assessEditorialSufficiency,
  normalizeSchedule,
} from "./activity-policy.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const REJECTED_HOSTS =
  /(?:^|\.)(?:facebook|instagram|tiktok|x|twitter|linkedin)\.com$/i;
const EDITORIAL_HOSTS =
  /(?:^|\.)(?:timeout|thehoneycombers|artsequator)\.com$/i;

export function classifyAuthorityLink(value, registry) {
  let url;
  try {
    url = new URL(canonicalRenderedUrl(value));
  } catch {
    return { decision: "invalid_authority_link", authority: null };
  }
  if (REJECTED_HOSTS.test(url.hostname))
    return { decision: "invalid_authority_link", authority: null };
  if (EDITORIAL_HOSTS.test(url.hostname))
    return { decision: "invalid_authority_link", authority: null };
  if (url.pathname === "/" || url.pathname === "")
    return { decision: "generic_authority_page", authority: null };
  try {
    return {
      decision: null,
      authority: assertAuthorityUrlAllowed(registry, url.href),
    };
  } catch (error) {
    return {
      decision:
        error.code === "authority_domain_review"
          ? "authority_domain_review"
          : "invalid_authority_link",
      authority: null,
    };
  }
}

const tokenSet = (value) =>
  new Set(
    normalized(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );
function titleCompatibility(discovery, authority) {
  const a = tokenSet(discovery),
    b = tokenSet(authority);
  if (!a.size || !b.size) return "unavailable";
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.min(a.size, b.size) >= 0.6 ? "compatible" : "conflict";
}
const textCompatibility = (discovery, authority) =>
  !discovery || !authority
    ? "unavailable"
    : normalized(discovery) === normalized(authority) ||
        normalized(discovery).includes(normalized(authority)) ||
        normalized(authority).includes(normalized(discovery))
      ? "compatible"
      : "conflict";

function compatibleCorroboration(discovery, record) {
  const claims = record.claims ?? record;
  if (!claims.title) return true;
  return (
    titleCompatibility(discovery.claims?.title, claims.title) ===
      "compatible" &&
    textCompatibility(discovery.claims?.dateText, claims.dateText) !==
      "conflict" &&
    textCompatibility(discovery.claims?.venue, claims.venue) !== "conflict"
  );
}

function editorialCandidate(discovery) {
  const claims = discovery.claims ?? {};
  const venue = claims.venue ?? "";
  const offMapSubtype = /secret|tba|to be announced/i.test(venue)
    ? "secret_tba"
    : /multiple|various venues|locations/i.test(venue)
      ? "multiple_locations"
      : "geometry_unavailable";
  return {
    sourceRecordId: discovery.discoveryRecordId,
    title: claims.title,
    scope: claims.scope ?? "Singapore",
    current: discovery.current !== false,
    specific: discovery.specific !== false,
    purePromotion:
      discovery.reasonCode === "pure_promotion" ||
      discovery.purePromotion === true,
    conflict: discovery.conflict === true,
    schedule: {
      kind: claims.dateText
        ? /anytime|choose|select/i.test(claims.dateText)
          ? "anytime"
          : "exact"
        : "unverified",
      displayText: claims.dateText,
    },
    publicPlacement: venue ? "off_map" : "none",
    location: { publicPlacement: venue ? "off_map" : "none", offMapSubtype },
  };
}

export async function confirmDiscoveryRecord({
  discovery,
  registry,
  fetchAuthority,
  policyVersion = "2.0",
  sourceMode = "required",
  directRecords = [],
  editorialPeers = [],
  priorAssessment = null,
}) {
  const compatibleDirectRecords = directRecords.filter((record) =>
    compatibleCorroboration(discovery, record),
  );
  const compatibleEditorialPeers = editorialPeers.filter((record) =>
    compatibleCorroboration(discovery, record),
  );
  const classifiedLinks = (discovery.outboundLinks ?? []).map((outbound) => ({
    outbound,
    classified: classifyAuthorityLink(outbound.url, registry),
  }));
  const selected =
    classifiedLinks.find(({ classified }) => !classified.decision) ??
    classifiedLinks.find(
      ({ classified }) => classified.decision === "authority_domain_review",
    ) ??
    classifiedLinks[0];
  const outbound = selected?.outbound;
  const base = {
    confirmationId: `confirmation:${sha(`${discovery.discoveryRecordId}:${outbound?.url ?? "missing"}:${policyVersion}`)}`,
    discoveryRecordId: discovery.discoveryRecordId,
    requestedUrl: outbound?.url ?? null,
    canonicalFinalUrl: null,
    linkClass: null,
    authorityRecordId: null,
    mappedAuthorityOccurrenceIds: [],
    sourceMode,
    evidenceRefs: [...(discovery.evidenceRefs ?? [])],
    corroborationAttempted: true,
    corroboratingEditorialIds: compatibleEditorialPeers
      .map((record) => record.discoveryRecordId)
      .filter(Boolean),
    upgradedFrom: priorAssessment?.evidenceLevel ?? null,
  };
  if (discovery.reasonCode)
    return { ...base, compatibility: {}, decision: discovery.reasonCode };
  const candidate = editorialCandidate(discovery);
  if (
    candidate.schedule.displayText &&
    normalizeSchedule(candidate.schedule).kind === "unverified"
  )
    return {
      ...base,
      compatibility: {},
      decision: "schedule_unverified",
      evidenceLevel: "editorial_evidence_incomplete",
      primaryEvidenceId: null,
    };
  const directAssessment = assessEditorialSufficiency(
    candidate,
    compatibleDirectRecords,
  );
  if (
    compatibleDirectRecords.length &&
    directAssessment.decision === "eligible"
  )
    return {
      ...base,
      compatibility: {
        title: "compatible",
        schedule: "compatible",
        venue: "compatible",
        scope: "singapore",
      },
      authorityRecordId: directAssessment.primaryEvidenceId,
      decision: "direct_reused",
      evidenceLevel: directAssessment.evidenceLevel,
      primaryEvidenceId: directAssessment.primaryEvidenceId,
    };
  if (!outbound) {
    const assessment = assessEditorialSufficiency(candidate);
    return {
      ...base,
      compatibility: {},
      decision: assessment.reasonCode,
      evidenceLevel: assessment.evidenceLevel,
      primaryEvidenceId: assessment.primaryEvidenceId ?? null,
    };
  }
  const classified = selected.classified;
  if (classified.decision) {
    const assessment = assessEditorialSufficiency(candidate);
    return assessment.decision === "eligible"
      ? {
          ...base,
          compatibility: {},
          decision: assessment.reasonCode,
          evidenceLevel: assessment.evidenceLevel,
          primaryEvidenceId: assessment.primaryEvidenceId ?? null,
          corroborationFailureReason: classified.decision,
        }
      : {
          ...base,
          compatibility: {},
          decision: classified.decision,
          evidenceLevel: assessment.evidenceLevel,
          primaryEvidenceId: null,
        };
  }
  let authority;
  try {
    authority = await fetchAuthority(classified.authority);
  } catch {
    const assessment = assessEditorialSufficiency(candidate);
    return {
      ...base,
      compatibility: {},
      decision:
        assessment.decision === "eligible"
          ? assessment.reasonCode
          : "authority_fetch_failed",
      evidenceLevel: assessment.evidenceLevel,
      primaryEvidenceId: assessment.primaryEvidenceId ?? null,
      linkClass: classified.authority.authorityType,
    };
  }
  const compatibility = {
    title: titleCompatibility(discovery.claims.title, authority.title),
    schedule: textCompatibility(discovery.claims.dateText, authority.dateText),
    venue: textCompatibility(discovery.claims.venue, authority.venue),
    scope:
      !discovery.claims.scope || /singapore/i.test(discovery.claims.scope)
        ? "singapore"
        : "conflict",
  };
  if (
    [
      compatibility.title,
      compatibility.schedule,
      compatibility.venue,
      compatibility.scope,
    ].includes("conflict")
  )
    return {
      ...base,
      canonicalFinalUrl: authority.canonicalUrl,
      linkClass: classified.authority.authorityType,
      authorityRecordId: authority.authorityRecordId,
      compatibility,
      decision: "authority_details_conflict",
    };
  const occurrences = authority.performances ?? [];
  if (occurrences.length > 1 && !discovery.claims.timeText)
    return {
      ...base,
      canonicalFinalUrl: authority.canonicalUrl,
      linkClass: classified.authority.authorityType,
      authorityRecordId: authority.authorityRecordId,
      compatibility,
      decision: "authority_occurrence_ambiguous",
    };
  return {
    ...base,
    canonicalFinalUrl: authority.canonicalUrl,
    linkClass: classified.authority.authorityType,
    authorityRecordId: authority.authorityRecordId,
    mappedAuthorityOccurrenceIds: occurrences.map(
      ({ authorityOccurrenceId }) => authorityOccurrenceId,
    ),
    compatibility,
    evidenceLevel: "direct_corroborated",
    primaryEvidenceId: authority.authorityRecordId,
    decision: authority.alreadyCollected
      ? "already_collected_authority"
      : "authority_confirmed",
  };
}
