import { interpretEventQuery } from "../assistant/interpreters/event-query-interpreter.js";
import {
  removeFilterToken,
  selectFilterToken,
} from "./event-filter-options.js";
import { classifyEventQuery } from "./event-query-classifier.js";

const DIMENSION_ORDER = ["what", "when", "where", "price"];
const dimensionRank = new Map(
  DIMENSION_ORDER.map((dimension, index) => [dimension, index]),
);

const clone = (value) => structuredClone(value);

const orderedTokens = (tokens) =>
  [...tokens]
    .sort(
      (left, right) =>
        (dimensionRank.get(left.dimension) ?? DIMENSION_ORDER.length) -
          (dimensionRank.get(right.dimension) ?? DIMENSION_ORDER.length) ||
        left.selectionOrder - right.selectionOrder ||
        left.optionId.localeCompare(right.optionId),
    )
    .map((token, selectionOrder) => ({ ...token, selectionOrder }));

const phrasesFor = (tokens) =>
  orderedTokens(tokens).map((token) => ({
    phraseId: `phrase:${token.optionId}`.slice(0, 120),
    facet: token.dimension,
    valueId: token.optionId,
    label: String(token.label).slice(0, 160),
  }));

const canonicalSentenceFor = (phrases, residualQuery) =>
  [...phrases.map(({ label }) => label), String(residualQuery ?? "").trim()]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);

const comparableState = (state) =>
  JSON.stringify({
    canonicalSentence: state.canonicalSentence,
    residualQuery: state.residualQuery,
    phrases: state.phrases,
    filterTokens: state.filterTokens,
    resultCount: state.resultCount,
  });

export function createEventQueryController({
  catalog,
  catalogRevision,
  contextRevision = 0,
  initialState = {},
  countResults = () => 0,
} = {}) {
  if (!catalog?.all) throw new TypeError("catalog is required");
  if (typeof catalogRevision !== "string" || !catalogRevision)
    throw new TypeError("catalogRevision is required");
  if (!Number.isInteger(contextRevision) || contextRevision < 0)
    throw new TypeError("contextRevision must be a non-negative integer");
  if (typeof countResults !== "function")
    throw new TypeError("countResults must be a function");

  let currentCatalog = catalog;
  let currentCatalogRevision = catalogRevision;
  let currentContextRevision = contextRevision;
  const initialTokens = orderedTokens(clone(initialState.filterTokens ?? []));
  const initialResidualQuery = String(
    initialState.residualQuery ?? initialState.query ?? "",
  ).slice(0, 500);
  let state = {
    canonicalSentence: canonicalSentenceFor(
      phrasesFor(initialTokens),
      initialResidualQuery,
    ),
    residualQuery: initialResidualQuery,
    phrases: phrasesFor(initialTokens),
    filterTokens: initialTokens,
    resultCount: Number.isInteger(initialState.resultCount)
      ? initialState.resultCount
      : 0,
  };
  const listeners = new Set();

  const snapshot = () => ({
    ...clone(state),
    catalogRevision: currentCatalogRevision,
    contextRevision: currentContextRevision,
  });

  const result = (outcome, { choices = [], changed = false } = {}) => ({
    changed,
    contextRevision: currentContextRevision,
    data: {
      outcome,
      canonicalSentence: state.canonicalSentence,
      residualQuery: state.residualQuery,
      phrases: clone(state.phrases),
      clarificationChoices: clone(choices),
      catalogRevision: currentCatalogRevision,
      resultCount: state.resultCount,
    },
  });
  const publish = () => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };

  const applyQuery = ({
    text,
    mode = "replace",
    baseContextRevision,
    catalogRevision: proposedCatalogRevision,
  } = {}) => {
    if (
      baseContextRevision !== currentContextRevision ||
      proposedCatalogRevision !== currentCatalogRevision
    )
      return result("stale");

    const interpretation = interpretEventQuery({
      text,
      mode,
      catalog: currentCatalog,
      baseContextRevision,
      catalogRevision: proposedCatalogRevision,
    });
    if (interpretation.outcome === "clarification_required")
      return result("clarification_required", {
        choices: interpretation.clarificationChoices,
      });
    if (interpretation.outcome !== "applicable") return result("unsupported");

    const classification = classifyEventQuery(
      interpretation.normalizedUtterance,
      currentCatalog,
    );
    const optionsById = new Map(
      currentCatalog.all.map((option) => [option.id, option]),
    );
    let nextTokens = mode === "replace" ? [] : clone(state.filterTokens ?? []);
    if (mode === "remove") {
      for (const match of classification.matches)
        nextTokens = removeFilterToken(nextTokens, match.optionId);
    } else {
      const touchedDimensions = new Set(
        classification.matches.map(({ dimension }) => dimension),
      );
      if (mode === "refine")
        nextTokens = nextTokens.filter(
          ({ dimension }) => !touchedDimensions.has(dimension),
        );
      for (const match of classification.matches) {
        const option = optionsById.get(match.optionId);
        if (!option) return result("unsupported");
        nextTokens = selectFilterToken(nextTokens, option);
      }
    }
    nextTokens = orderedTokens(nextTokens);

    const nextResidualQuery =
      mode === "replace"
        ? classification.residualQuery
        : mode === "refine" && classification.residualQuery
          ? classification.residualQuery
          : state.residualQuery;
    const nextPhrases = phrasesFor(nextTokens);
    const nextState = {
      canonicalSentence: canonicalSentenceFor(nextPhrases, nextResidualQuery),
      residualQuery: nextResidualQuery,
      phrases: nextPhrases,
      filterTokens: nextTokens,
      resultCount: 0,
    };
    const projectedCount = countResults({
      query: nextResidualQuery,
      filterTokens: clone(nextTokens),
    });
    if (
      projectedCount instanceof Promise ||
      !Number.isInteger(projectedCount) ||
      projectedCount < 0
    )
      throw new TypeError(
        "countResults must synchronously return a non-negative integer",
      );
    nextState.resultCount = projectedCount;

    const changed = comparableState(nextState) !== comparableState(state);
    if (changed) {
      state = nextState;
      currentContextRevision += 1;
      publish();
    }
    return result("applied", { changed });
  };

  const applyInterpretation = (interpretation) => {
    if (interpretation?.domain !== "event") return result("unsupported");
    if (interpretation.outcome === "clarification_required") {
      if (
        interpretation.baseContextRevision !== currentContextRevision ||
        interpretation.catalogRevision !== currentCatalogRevision
      )
        return result("stale");
      const verified = interpretEventQuery({
        text: interpretation.normalizedUtterance,
        mode: "replace",
        catalog: currentCatalog,
        baseContextRevision: currentContextRevision,
        catalogRevision: currentCatalogRevision,
      });
      return verified.outcome === "clarification_required"
        ? result("clarification_required", {
            choices: verified.clarificationChoices,
          })
        : result("unsupported");
    }
    const proposal = interpretation.proposedCalls?.[0];
    if (
      interpretation.outcome !== "applicable" ||
      interpretation.proposedCalls?.length !== 1 ||
      proposal?.capabilityId !== "event.applyquery"
    )
      return result("unsupported");
    return applyQuery(proposal.arguments);
  };

  return {
    applyInterpretation,
    applyQuery,
    interpret: ({ text, mode = "replace" } = {}) =>
      interpretEventQuery({
        text,
        mode,
        catalog: currentCatalog,
        baseContextRevision: currentContextRevision,
        catalogRevision: currentCatalogRevision,
      }),
    setCatalog(nextCatalog, nextCatalogRevision) {
      if (!nextCatalog?.all) throw new TypeError("catalog is required");
      if (typeof nextCatalogRevision !== "string" || !nextCatalogRevision)
        throw new TypeError("catalogRevision is required");
      currentCatalog = nextCatalog;
      currentCatalogRevision = nextCatalogRevision;
      publish();
      return snapshot();
    },
    setContextRevision(nextContextRevision) {
      if (
        !Number.isInteger(nextContextRevision) ||
        nextContextRevision < currentContextRevision
      )
        throw new TypeError(
          "contextRevision must be a monotonic non-negative integer",
        );
      if (nextContextRevision !== currentContextRevision) {
        currentContextRevision = nextContextRevision;
        publish();
      }
      return snapshot();
    },
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        throw new TypeError("listener must be a function");
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => listeners.delete(listener);
    },
    snapshot,
  };
}
