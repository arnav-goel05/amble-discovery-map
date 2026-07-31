import { classifyEventQuery } from "../../events/event-query-classifier.js";
import { verifyEventFacetProposal } from "../../events/event-facet-proposal.js";

const SUPPORTED_MODES = new Set(["replace", "refine", "remove"]);
const MAX_CLARIFICATION_CHOICES = 8;

const unsupported = ({
  normalizedUtterance,
  baseContextRevision,
  catalogRevision,
}) => ({
  domain: "event",
  normalizedUtterance,
  outcome: "unsupported",
  clarificationChoices: [],
  proposedCalls: [],
  baseContextRevision,
  catalogRevision,
});

const clarificationChoices = (ambiguous = []) => {
  const choices = [];
  const seen = new Set();
  for (const ambiguity of ambiguous)
    for (const candidate of ambiguity.candidates ?? []) {
      if (
        choices.length >= MAX_CLARIFICATION_CHOICES ||
        !candidate?.optionId ||
        seen.has(candidate.optionId)
      )
        continue;
      seen.add(candidate.optionId);
      choices.push({
        choiceId: String(candidate.optionId).slice(0, 120),
        label: String(candidate.label ?? "").slice(0, 160),
      });
    }
  return choices;
};

export function interpretEventQuery({
  text,
  mode = "replace",
  catalog,
  baseContextRevision,
  catalogRevision,
  facetProposal = null,
  currentFilterTokens = [],
} = {}) {
  const verifiedProposal = facetProposal
    ? verifyEventFacetProposal({
        utterance: text,
        proposal: facetProposal,
        catalog,
        mode,
        currentFilterTokens,
      })
    : null;
  const classified = verifiedProposal?.accepted
    ? verifiedProposal
    : classifyEventQuery(text, catalog);
  const validBaseContextRevision =
    Number.isInteger(baseContextRevision) && baseContextRevision >= 0;
  const validCatalogRevision =
    typeof catalogRevision === "string" &&
    catalogRevision.length > 0 &&
    catalogRevision.length <= 160;
  const common = {
    normalizedUtterance: classified.sourceText,
    baseContextRevision: validBaseContextRevision ? baseContextRevision : 0,
    catalogRevision: validCatalogRevision ? catalogRevision : null,
  };
  if (
    !SUPPORTED_MODES.has(mode) ||
    !validBaseContextRevision ||
    !validCatalogRevision ||
    !catalog?.all
  )
    return unsupported(common);

  if (
    verifiedProposal &&
    !verifiedProposal.accepted &&
    verifiedProposal.reason === "clarification_required"
  )
    return {
      domain: "event",
      ...common,
      outcome: "clarification_required",
      clarificationChoices: verifiedProposal.clarificationChoices,
      proposedCalls: [],
    };
  if (verifiedProposal && !verifiedProposal.accepted)
    return unsupported(common);

  if (classified.ambiguous.length)
    return {
      domain: "event",
      ...common,
      outcome: "clarification_required",
      clarificationChoices: clarificationChoices(classified.ambiguous),
      proposedCalls: [],
    };

  const hasRecognizedPhrase = classified.matches.length > 0;
  const hasResidualQuery = Boolean(classified.residualQuery);
  if (classified.matches.length > 24) return unsupported(common);
  const isApplicable =
    mode === "remove"
      ? hasRecognizedPhrase
      : hasRecognizedPhrase || hasResidualQuery;
  if (!isApplicable) return unsupported(common);

  return {
    domain: "event",
    ...common,
    outcome: "applicable",
    clarificationChoices: [],
    proposedCalls: [
      {
        capabilityId: "event.applyquery",
        arguments: {
          text: classified.sourceText,
          mode,
          baseContextRevision,
          catalogRevision,
          ...(facetProposal ? { facetProposal } : {}),
        },
      },
    ],
  };
}

export const EVENT_QUERY_MODES = Object.freeze([...SUPPORTED_MODES]);
