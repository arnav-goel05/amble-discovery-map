import assert from "node:assert/strict";
import test from "node:test";
import { createFilterOptionCatalog } from "../activity-scenes/events/event-filter-options.js";
import { classifyEventQuery } from "../activity-scenes/events/event-query-classifier.js";

const catalog = createFilterOptionCatalog({
  categories: ["Exhibitions", "Performances", "Workshops & Classes"],
  locations: [
    {
      id: "venue:esplanade",
      kind: "venue",
      value: "Esplanade",
      label: "Esplanade",
      availableCount: 12,
    },
    {
      id: "venue:esplanade-concert-hall",
      kind: "venue",
      value: "Esplanade Concert Hall",
      label: "Esplanade Concert Hall",
      availableCount: 8,
    },
  ],
});

test("classifies a complete request across all four dimensions", () => {
  const result = classifyEventQuery(
    "Find workshops this weekend near Esplanade under $25",
    catalog,
  );
  assert.deepEqual(
    result.matches.map(({ optionId }) => optionId),
    [
      "what:workshops-classes",
      "when:this-weekend",
      "venue:esplanade",
      "price:under-25",
    ],
  );
  assert.equal(result.residualQuery, "");
  assert.deepEqual(result.ambiguous, []);
});

test("preserves unmatched meaningful wording as a What query", () => {
  const result = classifyEventQuery(
    "romantic exhibitions this weekend",
    catalog,
  );
  assert.deepEqual(
    result.matches.map(({ optionId }) => optionId),
    ["what:exhibitions", "when:this-weekend"],
  );
  assert.equal(result.residualQuery, "romantic");
});

test("prefers the longest normalized catalog label", () => {
  const result = classifyEventQuery("at Esplanade Concert Hall", catalog);
  assert.deepEqual(
    result.matches.map(({ optionId }) => optionId),
    ["venue:esplanade-concert-hall"],
  );
  assert.equal(result.residualQuery, "");
});

test("normalizes case, accents, punctuation, and supported aliases", () => {
  const result = classifyEventQuery(
    "EXHIBITIONS, next 7 days; at Ésplanade — free!",
    catalog,
  );
  assert.deepEqual(
    result.matches.map(({ optionId }) => optionId),
    ["what:exhibitions", "when:7-days", "venue:esplanade", "price:free"],
  );
});

test("does not guess between competing single-value phrases", () => {
  const result = classifyEventQuery("today this weekend", catalog);
  assert.deepEqual(result.matches, []);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].dimension, "when");
});

test("classification is deterministic and bounded", () => {
  const text = `${"romantic ".repeat(1000)}under $25`;
  const first = classifyEventQuery(text, catalog);
  const second = classifyEventQuery(text, catalog);
  assert.deepEqual(first, second);
  assert.ok(first.sourceText.length <= 500);
});
