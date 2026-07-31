import { interpretObviousCommand } from "./interpreters/obvious-command-interpreter.js";

const FAMILY_PATTERNS = Object.freeze([
  ["event", /\b(?:event|events|concert|concerts|exhibition|exhibitions)\b/i],
  [
    "restaurant",
    /\b(?:restaurant|restaurants|food|eat|meal|meals|dining|deal|deals)\b/i,
  ],
  ["plan", /\b(?:plan|plans|itinerary|itineraries|route|routes|stop|stops)\b/i],
  [
    "transit",
    /\b(?:mrt|train|public transport|transit|rail|station|stations)\b/i,
  ],
  ["map", /\b(?:map|zoom|pan|rotate|layer|layers)\b/i],
  ["location", /\b(?:my location|where am i|locate me|current location)\b/i],
  ["tour", /\b(?:tour|tutorial|walkthrough|help me use)\b/i],
  ["discovery", /\b(?:discover|recommend|explore|suggest|somewhere)\b/i],
  [
    "navigation",
    /\b(?:open|close|dismiss|exit|back|attribution|reference|official page|external link|assistant)\b/i,
  ],
]);

const OVERLAY_FAMILIES = Object.freeze([
  ["navigation", /\b(?:assistant|attribution)\b/i],
  ["event", /\bevent\b/i],
  ["restaurant", /\brestaurant\b/i],
  ["plan", /\bplan\b/i],
  ["tour", /\btour\b/i],
  ["map", /\b(?:map|area|discovery)\b/i],
]);

function familyForCapability(capabilityId, capabilityFamilies) {
  if (typeof capabilityId !== "string") return "";
  const declared = capabilityFamilies?.[capabilityId];
  if (typeof declared === "string") {
    if (declared === "events") return "event";
    if (declared === "restaurants") return "restaurant";
    if (declared === "discovery-areas") return "discovery";
    if (declared === "overlay-navigation") return "navigation";
    return declared;
  }
  const prefix = capabilityId.split(".", 1)[0];
  if (prefix === "discovery") return "discovery";
  return prefix;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

const EVENT_ACTION_PATTERN =
  /\b(?:open|select|next|previous|close|details?|directions?|reference|add to plan|expand|collapse)\b/i;

function eventQueryRoute({
  utterance,
  selectedFamily,
  activeOverlayId,
  baseContextRevision,
  catalogRevision,
}) {
  const eventContext =
    selectedFamily === "event" ||
    (typeof activeOverlayId === "string" &&
      /\bevents?\b/i.test(activeOverlayId));
  if (
    !eventContext ||
    EVENT_ACTION_PATTERN.test(utterance) ||
    typeof catalogRevision !== "string" ||
    !catalogRevision ||
    catalogRevision.length > 160
  )
    return null;
  const text = String(utterance).trim();
  if (!text || text.length > 500) return null;
  return Object.freeze({
    family: "event",
    capabilityId: "event.applyquery",
    arguments: Object.freeze({
      text,
      mode: "replace",
      baseContextRevision,
      catalogRevision,
    }),
  });
}

export function selectCapabilityTurnScope({
  utterance = "",
  availableCapabilityIds = [],
  capabilityFamilies = {},
  activeOverlayId = null,
  baseContextRevision = 0,
  catalogRevision = null,
} = {}) {
  const deterministic = interpretObviousCommand({
    text: utterance,
    baseContextRevision,
    catalogRevision: catalogRevision ?? "turn-scope",
  });
  const utteranceFamilies = uniqueStrings(
    FAMILY_PATTERNS.filter(([, pattern]) => pattern.test(utterance)).map(
      ([family]) => family,
    ),
  );
  const hasConflictingEventDomain =
    deterministic?.capabilityId === "event.applyquery" &&
    utteranceFamilies.includes("restaurant");
  const routedDeterministic = hasConflictingEventDomain ? null : deterministic;
  const families = routedDeterministic
    ? [routedDeterministic.family]
    : hasConflictingEventDomain
      ? []
      : [...utteranceFamilies];
  if (!families.length && !hasConflictingEventDomain && activeOverlayId)
    for (const [family, pattern] of OVERLAY_FAMILIES)
      if (pattern.test(activeOverlayId)) {
        families.push(family);
        break;
      }

  const matchedFamilies = uniqueStrings(families);
  const selectedFamilies =
    matchedFamilies.length === 1 ? [matchedFamilies[0]] : [];
  const eventRoute =
    routedDeterministic ??
    eventQueryRoute({
      utterance,
      selectedFamily: selectedFamilies[0] ?? null,
      activeOverlayId,
      baseContextRevision,
      catalogRevision,
    });
  if (eventRoute && !selectedFamilies.length)
    selectedFamilies.push(eventRoute.family);
  const capabilityIds = uniqueStrings(availableCapabilityIds).filter(
    (capabilityId) =>
      selectedFamilies.includes(
        familyForCapability(capabilityId, capabilityFamilies),
      ) && capabilityId !== eventRoute?.capabilityId,
  );

  return Object.freeze({
    families: Object.freeze(selectedFamilies),
    capabilityIds: Object.freeze(capabilityIds),
    deterministicCapabilityId: eventRoute?.capabilityId ?? null,
    deterministicArguments: eventRoute?.arguments ?? null,
  });
}
