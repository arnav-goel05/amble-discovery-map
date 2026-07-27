import { interpretObviousCommand } from "./interpreters/obvious-command-interpreter.js";

const FAMILY_PATTERNS = Object.freeze([
  [
    "navigation",
    /\b(?:open|close|dismiss|exit|back|attribution|reference|official page|external link|assistant)\b/i,
  ],
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
  const families = [];

  if (deterministic) families.push(deterministic.family);
  else {
    for (const [family, pattern] of FAMILY_PATTERNS)
      if (pattern.test(utterance)) families.push(family);
    if (!families.length && typeof activeOverlayId === "string")
      for (const [family, pattern] of OVERLAY_FAMILIES)
        if (pattern.test(activeOverlayId)) {
          families.push(family);
          break;
        }
  }

  const selectedFamilies = uniqueStrings(families);
  const capabilityIds = uniqueStrings(availableCapabilityIds).filter(
    (capabilityId) =>
      selectedFamilies.includes(
        familyForCapability(capabilityId, capabilityFamilies),
      ) && capabilityId !== deterministic?.capabilityId,
  );

  return Object.freeze({
    families: Object.freeze(selectedFamilies),
    capabilityIds: Object.freeze(capabilityIds),
    deterministicCapabilityId: deterministic?.capabilityId ?? null,
  });
}
