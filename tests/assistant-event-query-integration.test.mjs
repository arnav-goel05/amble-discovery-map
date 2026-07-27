import assert from "node:assert/strict";
import test from "node:test";

import { interpretEventQuery } from "../activity-scenes/assistant/interpreters/event-query-interpreter.js";
import { createEventQueryController } from "../activity-scenes/events/event-query-controller.js";
import { createFilterOptionCatalog } from "../activity-scenes/events/event-filter-options.js";

const createCatalog = ({ includeMarinaBay = true } = {}) =>
  createFilterOptionCatalog({
    categories: ["Concerts", "Exhibitions"],
    locations: includeMarinaBay
      ? [
          {
            id: "area:marina-bay",
            kind: "area",
            value: "ura-subzone:marina-bay",
            label: "Marina Bay",
            availableCount: 8,
          },
        ]
      : [],
  });

const createController = (overrides = {}) =>
  createEventQueryController({
    catalog: createCatalog(),
    catalogRevision: "events:v1",
    contextRevision: 7,
    countResults: ({ query, filterTokens }) =>
      query === "with friends" && filterTokens.length === 4 ? 3 : 9,
    ...overrides,
  });

const apply = (controller, text, mode = "replace", overrides = {}) =>
  controller.applyQuery({
    text,
    mode,
    baseContextRevision: controller.snapshot().contextRevision,
    catalogRevision: controller.snapshot().catalogRevision,
    ...overrides,
  });

test("direct and voice entry produce the same atomic canonical state", () => {
  const direct = createController();
  const voice = createController();
  const published = [];
  direct.subscribe((snapshot) => published.push(snapshot));
  const sentence = "free concerts this weekend near Marina Bay with friends";

  const directResult = apply(direct, sentence);
  const voiceInterpretation = interpretEventQuery({
    text: sentence,
    mode: "replace",
    catalog: createCatalog(),
    baseContextRevision: 7,
    catalogRevision: "events:v1",
  });
  const voiceResult = voice.applyInterpretation(voiceInterpretation);

  assert.deepEqual(voiceResult, directResult);
  assert.deepEqual(voice.snapshot(), direct.snapshot());
  assert.equal(directResult.changed, true);
  assert.equal(directResult.contextRevision, 8);
  assert.equal(directResult.data.outcome, "applied");
  assert.equal(directResult.data.residualQuery, "with friends");
  assert.equal(directResult.data.resultCount, 3);
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], direct.snapshot());
  assert.deepEqual(
    directResult.data.phrases.map(({ facet, valueId }) => [facet, valueId]),
    [
      ["what", "what:concerts"],
      ["when", "when:this-weekend"],
      ["where", "area:marina-bay"],
      ["price", "price:free"],
    ],
  );
});

test("refine replaces touched facets while preserving the other phrases and query", () => {
  const controller = createController();
  apply(controller, "romantic exhibitions today near Marina Bay under $25");
  const beforeRevision = controller.snapshot().contextRevision;

  const result = apply(controller, "concerts this weekend free", "refine");

  assert.equal(result.contextRevision, beforeRevision + 1);
  assert.equal(result.data.residualQuery, "romantic");
  assert.deepEqual(
    result.data.phrases.map(({ facet, valueId }) => [facet, valueId]),
    [
      ["what", "what:concerts"],
      ["when", "when:this-weekend"],
      ["where", "area:marina-bay"],
      ["price", "price:free"],
    ],
  );
});

test("remove deletes only recognized phrases and preserves the rest", () => {
  const controller = createController();
  apply(controller, "romantic concerts this weekend near Marina Bay free");

  const result = apply(controller, "free this weekend", "remove");

  assert.equal(result.data.residualQuery, "romantic");
  assert.deepEqual(
    result.data.phrases.map(({ facet }) => facet),
    ["what", "where"],
  );
});

test("ambiguity and invalid compound requests commit nothing", () => {
  const controller = createController();
  apply(controller, "concerts near Marina Bay");
  const before = controller.snapshot();

  const ambiguous = apply(controller, "today this weekend", "refine");
  assert.equal(ambiguous.changed, false);
  assert.equal(ambiguous.data.outcome, "clarification_required");
  assert.deepEqual(controller.snapshot(), before);

  const unsupported = apply(controller, "anything", "remove");
  assert.equal(unsupported.changed, false);
  assert.equal(unsupported.data.outcome, "unsupported");
  assert.deepEqual(controller.snapshot(), before);
});

test("stale context and catalogue revisions cause zero mutation", () => {
  const controller = createController();
  apply(controller, "concerts near Marina Bay");
  const before = controller.snapshot();

  const staleContext = controller.applyQuery({
    text: "free",
    mode: "refine",
    baseContextRevision: before.contextRevision - 1,
    catalogRevision: before.catalogRevision,
  });
  assert.equal(staleContext.data.outcome, "stale");
  assert.deepEqual(controller.snapshot(), before);

  controller.setCatalog(
    createCatalog({ includeMarinaBay: false }),
    "events:v2",
  );
  const staleCatalog = controller.applyQuery({
    text: "free",
    mode: "refine",
    baseContextRevision: before.contextRevision,
    catalogRevision: "events:v1",
  });
  assert.equal(staleCatalog.data.outcome, "stale");
  assert.deepEqual(controller.snapshot(), {
    ...before,
    catalogRevision: "events:v2",
  });
});

test("result-count failure leaves the complete composer state unchanged", () => {
  const controller = createController({
    countResults: () => {
      throw new Error("projection failed");
    },
  });
  const before = controller.snapshot();

  assert.throws(
    () => apply(controller, "free concerts this weekend"),
    /projection failed/,
  );
  assert.deepEqual(controller.snapshot(), before);
});
