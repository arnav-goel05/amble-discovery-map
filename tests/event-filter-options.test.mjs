import assert from "node:assert/strict";
import test from "node:test";

import {
  createFilterOptionCatalog,
  filterOptionCatalog,
  projectFilterTokens,
  reconcileFilterTokens,
  recoverySuggestions,
  removeFilterToken,
  selectFilterToken,
} from "../activity-scenes/events/event-filter-options.js";

const sourceLocations = [
  {
    id: "landmark:library",
    kind: "landmark",
    value: "library",
    label: "National Library",
    availableCount: 2,
  },
  {
    id: "venue:drama-centre",
    kind: "venue",
    value: "drama centre",
    label: "Drama Centre",
    availableCount: 2,
  },
  {
    id: "area:city-hall",
    kind: "area",
    value: "ura-subzone:city-hall",
    label: "City Hall",
    availableCount: 3,
  },
];

const catalog = createFilterOptionCatalog({
  categories: ["Performances", "Exhibitions"],
  locations: sourceLocations,
});

const option = (id) => {
  const match = catalog.all.find((candidate) => candidate.id === id);
  assert.ok(match, `missing option ${id}`);
  return match;
};

test("catalog exposes all groups with stable recognized options", () => {
  assert.deepEqual(Object.keys(catalog.groups), [
    "what",
    "when",
    "where",
    "price",
  ]);
  assert.deepEqual(
    catalog.groups.what.map(({ id }) => id),
    ["what:exhibitions", "what:performances"],
  );
  assert.ok(option("when:this-weekend"));
  assert.ok(option("where:near-me"));
  assert.ok(option("where:map-area"));
  assert.ok(option("where:anywhere"));
  assert.ok(option("price:100-plus"));
});

test("option narrowing is accent, case, and punctuation insensitive", () => {
  const localCatalog = createFilterOptionCatalog({
    categories: ["História & Culture"],
    locations: sourceLocations,
  });
  assert.deepEqual(
    filterOptionCatalog(localCatalog, "HISTORIA culture").flatMap((group) =>
      group.options.map(({ label }) => label),
    ),
    ["História & Culture"],
  );
  assert.deepEqual(filterOptionCatalog(localCatalog, "not recognized"), []);
});

test("initial disclosure keeps all groups and caps only source locations", () => {
  const manyLocations = Array.from({ length: 12 }, (_, index) => ({
    id: `venue:${index}`,
    kind: "venue",
    value: `venue ${index}`,
    label: `Venue ${index}`,
    availableCount: 1,
  }));
  const localCatalog = createFilterOptionCatalog({
    categories: ["Performances"],
    locations: manyLocations,
  });
  const groups = filterOptionCatalog(localCatalog, "", {
    initialLocationLimit: 4,
  });
  assert.deepEqual(
    groups.map(({ dimension }) => dimension),
    ["what", "when", "where", "price"],
  );
  assert.equal(
    groups.find(({ dimension }) => dimension === "where").options.length,
    8,
  );
});

test("What toggles inclusively while single-value dimensions replace in selection order", () => {
  let tokens = [];
  tokens = selectFilterToken(tokens, option("when:today"));
  tokens = selectFilterToken(tokens, option("what:performances"));
  tokens = selectFilterToken(tokens, option("what:exhibitions"));
  tokens = selectFilterToken(tokens, option("price:under-25"));
  tokens = selectFilterToken(tokens, option("when:this-weekend"));

  assert.deepEqual(
    tokens.map(({ optionId }) => optionId),
    [
      "what:performances",
      "what:exhibitions",
      "price:under-25",
      "when:this-weekend",
    ],
  );
  assert.deepEqual(projectFilterTokens(tokens), {
    categories: ["Performances", "Exhibitions"],
    dateRange: "this-weekend",
    dateStart: "",
    dateEnd: "",
    placementView: "all",
    priceRange: "under-25",
    query: "",
    where: null,
  });

  tokens = selectFilterToken(tokens, option("what:performances"));
  assert.deepEqual(
    tokens.map(({ optionId }) => optionId),
    ["what:exhibitions", "price:under-25", "when:this-weekend"],
  );
});

test("custom dates and geographic parameters project without persisting unrelated input", () => {
  let tokens = selectFilterToken([], option("when:custom"), {
    start: "2026-08-02",
    end: "2026-08-04",
  });
  tokens = selectFilterToken(tokens, option("where:near-me"), {
    center: [103.85, 1.29],
    radiusKm: 3,
  });
  assert.deepEqual(projectFilterTokens(tokens), {
    categories: [],
    dateRange: "custom",
    dateStart: "2026-08-02",
    dateEnd: "2026-08-04",
    placementView: "all",
    priceRange: "any",
    query: "",
    where: {
      kind: "radius",
      center: [103.85, 1.29],
      radiusKm: 3,
    },
  });
});

test("Anywhere clears geographic restriction and token removal is stable", () => {
  let tokens = selectFilterToken([], option("where:map-area"), {
    west: 103.8,
    south: 1.2,
    east: 103.9,
    north: 1.4,
  });
  tokens = selectFilterToken(tokens, option("where:anywhere"));
  assert.deepEqual(tokens, []);
  assert.deepEqual(removeFilterToken(tokens, "missing"), []);
});

test("snapshot reconciliation removes only stale source-backed tokens", () => {
  let tokens = selectFilterToken([], option("what:performances"));
  tokens = selectFilterToken(tokens, option("venue:drama-centre"));
  const nextCatalog = createFilterOptionCatalog({
    categories: ["Performances"],
    locations: [],
  });
  const reconciled = reconcileFilterTokens(tokens, nextCatalog);
  assert.deepEqual(
    reconciled.tokens.map(({ optionId }) => optionId),
    ["what:performances"],
  );
  assert.deepEqual(
    reconciled.removed.map(({ optionId }) => optionId),
    ["venue:drama-centre"],
  );
});

test("recovery suggestions report exact positive counts and otherwise allow clear all", () => {
  let tokens = selectFilterToken([], option("what:performances"));
  tokens = selectFilterToken(tokens, option("price:free"));
  const counts = new Map([
    ["what:performances", 0],
    ["price:free", 4],
  ]);
  const suggestions = recoverySuggestions(tokens, (candidateTokens) => {
    const removed = tokens.find(
      ({ optionId }) =>
        !candidateTokens.some((candidate) => candidate.optionId === optionId),
    );
    return { matchedEvents: counts.get(removed.optionId) };
  });
  assert.deepEqual(suggestions, [
    {
      tokenId: "price:free",
      label: "Remove Free",
      restoredCount: 4,
    },
  ]);
  assert.deepEqual(
    recoverySuggestions(tokens, () => ({ matchedEvents: 0 })),
    [],
  );
});
