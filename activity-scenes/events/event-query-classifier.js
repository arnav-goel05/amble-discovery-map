const MAX_QUERY_LENGTH = 500;
const SINGLE_VALUE_DIMENSIONS = new Set(["when", "where", "price"]);
const CONNECTORS =
  /^(?:(?:activities|something|events?|things|search|show|find|within|around|priced|costing|near|that|are|the|for|and|on|at|in|an|a|is)\s*)+|(?:(?:activities|something|events?|things|search|show|find|within|around|priced|costing|near|that|are|the|for|and|on|at|in|an|a|is)\s*)+$/gi;

const normalizeWithMap = (source) => {
  const characters = [];
  const map = [];
  for (let index = 0; index < source.length; index += 1) {
    const normalized = source[index]
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
    for (const character of normalized) {
      characters.push(/[a-z0-9]/.test(character) ? character : " ");
      map.push(index);
    }
  }
  let text = "";
  const compactMap = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === " " && (!text || text.endsWith(" "))) continue;
    text += character;
    compactMap.push(map[index]);
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    compactMap.pop();
  }
  return { text, map: compactMap };
};

const escaped = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+");

const sourceSpan = (normalized, start, end) => ({
  start: normalized.map[start] ?? 0,
  end: (normalized.map[end - 1] ?? normalized.map[start] ?? 0) + 1,
});

const grammarDefinitions = [
  ["when:today", "when", /\btoday\b/g],
  ["when:this-weekend", "when", /\b(?:this\s+)?weekend\b/g],
  ["when:7-days", "when", /\b(?:next\s+7\s+days|next\s+week)\b/g],
  ["when:30-days", "when", /\b(?:next\s+30\s+days|next\s+month)\b/g],
  ["price:free", "price", /\bfree\b/g],
  [
    "price:under-25",
    "price",
    /\b(?:under|below|less\s+than|up\s+to)\s+\$?\s*25\b/g,
  ],
  ["price:25-50", "price", /\b\$?\s*25\s*(?:to|-)\s*\$?\s*50\b/g],
  ["price:50-100", "price", /\b\$?\s*50\s*(?:to|-)\s*\$?\s*100\b/g],
  ["price:100-plus", "price", /\b(?:over|above|more\s+than)\s+\$?\s*100\b/g],
];

const candidateFor = ({
  option,
  source,
  normalized,
  start,
  end,
  confidence,
}) => {
  const span = sourceSpan(normalized, start, end);
  return {
    optionId: option.id,
    dimension: option.dimension,
    label: option.label,
    matchedText: source.slice(span.start, span.end),
    ...span,
    confidence,
  };
};

const overlap = (left, right) =>
  left.start < right.end && right.start < left.end;

const categoryAliases = (option) => {
  if (option.dimension !== "what") return [];
  const first = option.searchableLabel.split(" ")[0];
  if (!first || first.length < 5) return [];
  return [first, first.endsWith("s") ? first.slice(0, -1) : `${first}s`];
};

export function classifyEventQuery(value, catalog) {
  const sourceText = String(value ?? "")
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
  const normalized = normalizeWithMap(sourceText);
  const optionsById = new Map(
    (catalog?.all ?? []).map((option) => [option.id, option]),
  );
  const candidates = [];

  for (const [optionId, dimension, pattern] of grammarDefinitions) {
    const option = optionsById.get(optionId);
    if (!option) continue;
    pattern.lastIndex = 0;
    for (const match of normalized.text.matchAll(pattern))
      candidates.push(
        candidateFor({
          option,
          source: sourceText,
          normalized,
          start: match.index,
          end: match.index + match[0].length,
          confidence: 1,
        }),
      );
  }

  const normalizedLabels = new Map();
  for (const option of catalog?.all ?? []) {
    const label = option.searchableLabel?.trim();
    if (!label) continue;
    const pattern = new RegExp(`\\b${escaped(label)}\\b`, "g");
    for (const match of normalized.text.matchAll(pattern)) {
      const key = `${match.index}:${match[0].length}:${label}`;
      const sameLabel = normalizedLabels.get(key) ?? [];
      sameLabel.push(option);
      normalizedLabels.set(key, sameLabel);
    }
  }
  for (const [key, matchingOptions] of normalizedLabels) {
    const [startText, lengthText] = key.split(":");
    const start = Number(startText);
    const end = start + Number(lengthText);
    for (const option of matchingOptions)
      candidates.push(
        candidateFor({
          option,
          source: sourceText,
          normalized,
          start,
          end,
          confidence: 0.95,
        }),
      );
  }

  for (const option of catalog?.groups?.what ?? []) {
    for (const alias of categoryAliases(option)) {
      if (alias === option.searchableLabel) continue;
      const pattern = new RegExp(`\\b${escaped(alias)}\\b`, "g");
      for (const match of normalized.text.matchAll(pattern))
        candidates.push(
          candidateFor({
            option,
            source: sourceText,
            normalized,
            start: match.index,
            end: match.index + match[0].length,
            confidence: 0.85,
          }),
        );
    }
  }

  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.end - right.start - (left.end - left.start) ||
      left.start - right.start ||
      left.optionId.localeCompare(right.optionId),
  );
  const accepted = [];
  for (const candidate of candidates) {
    if (
      accepted.some(
        (current) =>
          overlap(current, candidate) ||
          current.optionId === candidate.optionId,
      )
    )
      continue;
    accepted.push(candidate);
  }

  const ambiguous = [];
  for (const dimension of SINGLE_VALUE_DIMENSIONS) {
    const matches = accepted.filter((item) => item.dimension === dimension);
    if (matches.length <= 1) continue;
    ambiguous.push({
      dimension,
      matchedText: matches.map((item) => item.matchedText).join(" / "),
      candidates: matches.map(({ optionId, label }) => ({ optionId, label })),
    });
  }
  const ambiguousDimensions = new Set(
    ambiguous.map(({ dimension }) => dimension),
  );
  const matches = accepted
    .filter(({ dimension }) => !ambiguousDimensions.has(dimension))
    .sort((left, right) => left.start - right.start);

  let residualQuery = sourceText;
  for (const match of [...matches].sort(
    (left, right) => right.start - left.start,
  ))
    residualQuery =
      residualQuery.slice(0, match.start) +
      " " +
      residualQuery.slice(match.end);
  residualQuery = residualQuery
    .replace(/[.,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(CONNECTORS, "")
    .replace(/\s+/g, " ")
    .trim();

  return { sourceText, matches, residualQuery, ambiguous };
}
