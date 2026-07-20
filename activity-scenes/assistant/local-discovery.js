import {
  orderSuggestedAreas,
  validateDiscoveryResult,
} from "./discovery-model.js";

const tokenize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
const attributeText = (attributes) =>
  Object.entries(attributes)
    .flatMap(([key, value]) => [
      key,
      ...(Array.isArray(value) ? value : [value]),
    ])
    .flatMap(tokenize);

const distanceMeters = ([leftLng, leftLat], [rightLng, rightLat]) => {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(rightLat - leftLat);
  const dLng = radians(rightLng - leftLng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(leftLat)) *
      Math.cos(radians(rightLat)) *
      Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export function matchLocalDiscovery(
  intent,
  envelope,
  { maxAreas = 5, transitStations = [] } = {},
) {
  const transitRequested =
    intent?.transitConstraint?.explicitlyRequested === true &&
    intent.transitConstraint.mode === "mrt";
  const stationCoordinates = transitStations
    .map((station) => station.geometry?.coordinates ?? station.coordinates)
    .filter(
      (coordinates) =>
        Array.isArray(coordinates) &&
        coordinates.length === 2 &&
        coordinates.every(Number.isFinite),
    );
  const query = new Set([
    ...tokenize(intent?.freeTextSummary),
    ...(intent?.interests || []).flatMap(tokenize),
    ...tokenize(intent?.crowdPreference),
    ...tokenize(intent?.priceRange),
    ...tokenize(intent?.timeWindow),
  ]);
  const exclusions = new Set((intent?.exclusions || []).flatMap(tokenize));
  const eligible = [];
  for (const candidate of envelope?.candidates || []) {
    const words = new Set(attributeText(candidate.attributes));
    if ([...exclusions].some((word) => words.has(word))) continue;
    const matched = [...query].filter((word) => words.has(word));
    const nearestMrtMeters = stationCoordinates.length
      ? Math.min(
          ...stationCoordinates.map((coordinates) =>
            distanceMeters(candidate.coordinates, coordinates),
          ),
        )
      : null;
    eligible.push({ candidate, matched, nearestMrtMeters });
  }
  const hasExactMatch = eligible.some(({ matched }) => matched.length > 0);
  const fallbackUsed = query.size > 0 && !hasExactMatch;
  const grouped = new Map();
  for (const { candidate, matched, nearestMrtMeters } of eligible) {
    if (query.size && hasExactMatch && matched.length === 0) continue;
    const current = grouped.get(candidate.areaId) || {
      candidates: [],
      score: 0,
      nearestMrtMeters: null,
    };
    const matchedKeys = [];
    for (const [key, value] of Object.entries(candidate.attributes)) {
      const valueWords = new Set(
        [key, ...(Array.isArray(value) ? value : [value])].flatMap(tokenize),
      );
      if (matched.some((word) => valueWords.has(word))) matchedKeys.push(key);
    }
    current.candidates.push({ candidate, matchedKeys });
    current.score += fallbackUsed ? 0.25 : Math.max(1, matched.length);
    if (
      nearestMrtMeters !== null &&
      (current.nearestMrtMeters === null ||
        nearestMrtMeters < current.nearestMrtMeters)
    )
      current.nearestMrtMeters = nearestMrtMeters;
    grouped.set(candidate.areaId, current);
  }
  const areas = [...grouped.entries()].map(([areaId, group]) => {
    const candidateIds = group.candidates
      .map(({ candidate }) => candidate.candidateId)
      .sort();
    const evidence = group.candidates
      .slice()
      .sort(
        (left, right) =>
          right.matchedKeys.length - left.matchedKeys.length ||
          left.candidate.candidateId.localeCompare(right.candidate.candidateId),
      )[0];
    const attributeKeys = [...new Set(evidence.matchedKeys)].sort();
    const name = evidence.candidate.attributes.name;
    return {
      areaId,
      rank: 1,
      confidence: Math.min(
        0.95,
        (fallbackUsed ? 0.5 : 0.55) +
          group.score * 0.08 +
          (transitRequested && group.nearestMrtMeters !== null
            ? Math.max(0, 0.16 - group.nearestMrtMeters / 10_000)
            : 0),
      ),
      reasons: [
        {
          text: fallbackUsed
            ? `${name || "An approved option"} is a grounded option available in this area.`
            : `${name || "An approved option"} matches ${attributeKeys.join(", ") || "the request"}.`,
          candidateIds: [evidence.candidate.candidateId],
          attributeKeys: attributeKeys.length ? attributeKeys : ["name"],
        },
      ],
      tradeoffs: [
        fallbackUsed
          ? "No exact saved-fact match was available, so these are broad options to help narrow the conversation."
          : transitRequested && group.nearestMrtMeters !== null
            ? `MRT access was explicitly requested, so this ranking favours options nearer an approved station (about ${Math.round(group.nearestMrtMeters / 50) * 50} m for the closest option).`
            : "This local match uses approved saved facts and may not reflect current crowd levels.",
      ],
      candidateIds,
    };
  });
  const result = {
    intentRevision: intent?.revision ?? 0,
    areas: orderSuggestedAreas(areas).slice(0, maxAreas),
    clarification: null,
  };
  return validateDiscoveryResult(result, envelope);
}
