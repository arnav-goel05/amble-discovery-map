const STRUCTURAL_VENUE_LABELS = new Set([
  "accessibility",
  "about the venue",
  "description",
  "event information",
  "frequently asked questions",
  "general info",
  "general information",
  "getting there",
  "highlights",
  "venue accessibility",
  "venue description",
]);

const normalizeVenueLabel = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-SG")
    .replace(/&/g, " ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

export function isStructuralVenueLabel(value) {
  const normalized = normalizeVenueLabel(value);
  return normalized ? STRUCTURAL_VENUE_LABELS.has(normalized) : false;
}
