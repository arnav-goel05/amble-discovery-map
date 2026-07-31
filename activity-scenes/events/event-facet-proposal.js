import { classifyEventQuery } from "./event-query-classifier.js";

const FACETS = Object.freeze(["what", "when", "where", "price"]);
const SINGLE_VALUE_FACETS = new Set(["when", "where", "price"]);
const GENERIC_AMBIGUITY = Object.freeze({
  what: /\b(?:anything|something|whatever)\b/i,
  when: /\b(?:anytime|sometime|whenever)\b/i,
  where: /\b(?:anywhere|somewhere|wherever)\b/i,
  price: /\b(?:any price|whatever price|any budget)\b/i,
});
const FILLER_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "can",
  "could",
  "events",
  "event",
  "find",
  "for",
  "i",
  "in",
  "me",
  "of",
  "on",
  "please",
  "search",
  "show",
  "the",
  "things",
  "to",
  "want",
  "you",
]);

const normalized = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const words = (value) => normalized(value).split(" ").filter(Boolean);

const meaningfulResidual = (value, utterance, excludedWords = new Set()) => {
  const utteranceWords = new Set(words(utterance));
  const retained = words(value).filter(
    (word) =>
      utteranceWords.has(word) &&
      !FILLER_WORDS.has(word) &&
      !excludedWords.has(word),
  );
  return retained.join(" ").slice(0, 200);
};

const phraseIndex = (source, phrase) => {
  const index = ` ${source} `.indexOf(` ${phrase} `);
  return index < 0 ? -1 : Math.max(0, index - 1);
};

const clarificationChoices = (catalog, facets, utterance) =>
  facets
    .flatMap((facet) => {
      const options = catalog?.groups?.[facet] ?? [];
      const source = normalized(utterance);
      const explicit = options.filter(
        ({ label }) => phraseIndex(source, normalized(label)) >= 0,
      );
      return explicit.length > 1 ? explicit : options;
    })
    .slice(0, 8)
    .map((option) => ({
      choiceId: String(option.id).slice(0, 120),
      label: String(option.label).slice(0, 160),
    }));

const reject = (reason, unresolved = []) => ({
  accepted: false,
  reason,
  matches: [],
  residualQuery: "",
  ambiguous: unresolved.map((dimension) => ({
    dimension,
    matchedText: "",
    candidates: [],
  })),
  clarificationChoices: [],
});

export function verifyEventFacetProposal({
  utterance,
  proposal,
  catalog,
  mode = "replace",
  currentFilterTokens = [],
} = {}) {
  const sourceText = String(utterance ?? "")
    .slice(0, 500)
    .trim();
  if (!sourceText || !proposal || typeof proposal !== "object" || !catalog?.all)
    return reject("invalid_proposal");

  const proposedUnresolved = [
    ...new Set(
      (Array.isArray(proposal.unresolved) ? proposal.unresolved : []).filter(
        (facet) => FACETS.includes(facet),
      ),
    ),
  ];
  const utteranceNormalized = normalized(sourceText);
  const unresolved = proposedUnresolved.filter((facet) => {
    const matchingLabels = (catalog?.groups?.[facet] ?? []).filter(
      ({ label }) => phraseIndex(utteranceNormalized, normalized(label)) >= 0,
    );
    return (
      matchingLabels.length > 1 || GENERIC_AMBIGUITY[facet]?.test(sourceText)
    );
  });
  if (unresolved.length) {
    const result = reject("clarification_required", unresolved);
    result.clarificationChoices = clarificationChoices(
      catalog,
      unresolved,
      sourceText,
    );
    return result;
  }

  const optionsByFacetAndLabel = new Map();
  for (const option of catalog.all) {
    const key = `${option.dimension}:${normalized(option.label)}`;
    const current = optionsByFacetAndLabel.get(key) ?? [];
    current.push(option);
    optionsByFacetAndLabel.set(key, current);
  }

  const selections = FACETS.flatMap((facet) => {
    const value = proposal[facet];
    if (facet === "what") return Array.isArray(value) ? value : [];
    return value && typeof value === "object" ? [value] : [];
  });
  if (selections.length > 9) return reject("too_many_selections");

  const matches = [];
  const evidenceWords = new Set();
  const seenOptions = new Set();
  const seenSingleFacets = new Set();
  const currentKeys = new Set(
    (Array.isArray(currentFilterTokens) ? currentFilterTokens : []).map(
      ({ dimension, label }) => `${dimension}:${normalized(label)}`,
    ),
  );
  for (const selection of selections) {
    const facet = FACETS.find((candidate) =>
      candidate === "what"
        ? Array.isArray(proposal.what) && proposal.what.includes(selection)
        : proposal[candidate] === selection,
    );
    const label = normalized(selection?.label);
    const evidence = normalized(selection?.evidence);
    const start = phraseIndex(utteranceNormalized, evidence);
    if (
      facet &&
      label &&
      evidence &&
      start < 0 &&
      mode === "refine" &&
      currentKeys.has(`${facet}:${label}`)
    )
      continue;
    if (!facet || !label || !evidence || start < 0)
      return reject("unverified_evidence");
    const candidates = optionsByFacetAndLabel.get(`${facet}:${label}`) ?? [];
    if (candidates.length !== 1) return reject("unknown_or_ambiguous_label");
    const option = candidates[0];
    const evidenceClassification = classifyEventQuery(
      selection.evidence,
      catalog,
    );
    if (
      !evidenceClassification.matches.some(
        (match) =>
          match.optionId === option.id && match.dimension === option.dimension,
      )
    )
      return reject("unverified_evidence");
    if (
      seenOptions.has(option.id) ||
      (SINGLE_VALUE_FACETS.has(facet) && seenSingleFacets.has(facet))
    )
      return reject("conflicting_selection");
    seenOptions.add(option.id);
    seenSingleFacets.add(facet);
    for (const word of words(evidence)) evidenceWords.add(word);
    matches.push({
      optionId: option.id,
      dimension: facet,
      label: option.label,
      matchedText: selection.evidence,
      start,
      end: start + evidence.length,
      confidence: 1,
    });
  }

  return {
    accepted: true,
    reason: "verified",
    sourceText,
    matches,
    residualQuery: meaningfulResidual(
      proposal.residualQuery,
      sourceText,
      evidenceWords,
    ),
    ambiguous: [],
    clarificationChoices: [],
  };
}

export const EVENT_FACETS = FACETS;
