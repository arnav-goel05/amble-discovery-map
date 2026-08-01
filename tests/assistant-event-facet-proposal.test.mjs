import assert from "node:assert/strict";
import test from "node:test";

import { verifyEventFacetProposal } from "../activity-scenes/events/event-facet-proposal.js";

const options = [
  ["what:exhibitions", "what", "Exhibitions"],
  ["when:today", "when", "Today"],
  ["when:this-weekend", "when", "This weekend"],
  ["area:marina-bay", "where", "Marina Bay"],
  ["price:free", "price", "Free"],
].map(([id, dimension, label]) => ({
  id,
  dimension,
  label,
  searchableLabel: label.toLowerCase(),
}));
const catalog = {
  all: options,
  groups: Object.fromEntries(
    ["what", "when", "where", "price"].map((dimension) => [
      dimension,
      options.filter((option) => option.dimension === dimension),
    ]),
  ),
};

const proposal = (overrides = {}) => ({
  what: [{ label: "Exhibitions", evidence: "exhibitions" }],
  when: { label: "Today", evidence: "today" },
  where: { label: "Marina Bay", evidence: "Marina Bay" },
  price: null,
  residualQuery: "immersive",
  unresolved: [],
  ...overrides,
});

test("verifies current labels and exact utterance evidence", () => {
  const result = verifyEventFacetProposal({
    utterance: "Please find immersive exhibitions today at Marina Bay",
    proposal: proposal(),
    catalog,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.residualQuery, "immersive");
  assert.deepEqual(
    result.matches.map(({ optionId, dimension }) => [optionId, dimension]),
    [
      ["what:exhibitions", "what"],
      ["when:today", "when"],
      ["area:marina-bay", "where"],
    ],
  );
});

test("rejects invented labels, absent evidence, and conflicting single facets", () => {
  assert.equal(
    verifyEventFacetProposal({
      utterance: "exhibitions today at Marina Bay",
      proposal: proposal({
        where: { label: "Orchard", evidence: "Marina Bay" },
      }),
      catalog,
    }).accepted,
    false,
  );
  assert.equal(
    verifyEventFacetProposal({
      utterance: "exhibitions today at Marina Bay",
      proposal: proposal({
        when: { label: "Today", evidence: "tomorrow" },
      }),
      catalog,
    }).reason,
    "unverified_evidence",
  );
  assert.equal(
    verifyEventFacetProposal({
      utterance: "exhibitions today at Marina Bay",
      proposal: proposal({
        what: [
          { label: "Exhibitions", evidence: "exhibitions" },
          { label: "Exhibitions", evidence: "exhibitions" },
        ],
      }),
      catalog,
    }).reason,
    "conflicting_selection",
  );
});

test("evidence cannot name a generic domain while selecting a specific category", () => {
  const concert = {
    id: "what:concerts",
    dimension: "what",
    label: "Concerts",
    searchableLabel: "concerts",
  };
  const expandedCatalog = {
    all: [...catalog.all, concert],
    groups: {
      ...catalog.groups,
      what: [...catalog.groups.what, concert],
    },
  };
  const result = verifyEventFacetProposal({
    utterance: "find events today",
    proposal: proposal({
      what: [{ label: "Concerts", evidence: "events" }],
      where: null,
      residualQuery: "",
    }),
    catalog: expandedCatalog,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "unverified_evidence");
});

test("a unique public venue name verifies a catalogue label with a parenthetical qualifier", () => {
  const venue = {
    id: "where:marina-bay-sands",
    dimension: "where",
    label: "MARINA BAY SANDS (MICE)",
    searchableLabel: "marina bay sands mice",
  };
  const expandedCatalog = {
    all: [...catalog.all, venue],
    groups: {
      ...catalog.groups,
      where: [...catalog.groups.where, venue],
    },
  };
  const result = verifyEventFacetProposal({
    utterance: "Can you help me find events near Marina Bay Sands today?",
    proposal: proposal({
      what: [],
      where: {
        label: "MARINA BAY SANDS (MICE)",
        evidence: "Marina Bay Sands",
      },
      residualQuery: "Marina Bay Sands today",
      unresolved: ["what"],
    }),
    catalog: expandedCatalog,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.residualQuery, "");
  assert.deepEqual(
    result.matches.map(({ optionId }) => optionId),
    ["when:today", "where:marina-bay-sands"],
  );
});

test("an ambiguous public venue name cannot discard distinguishing qualifiers", () => {
  const venues = ["EXPO (EAST)", "EXPO (WEST)"].map((label, index) => ({
    id: `where:expo-${index}`,
    dimension: "where",
    label,
    searchableLabel: label.toLowerCase().replaceAll(/[()]/g, ""),
  }));
  const expandedCatalog = {
    all: [...catalog.all, ...venues],
    groups: {
      ...catalog.groups,
      where: [...catalog.groups.where, ...venues],
    },
  };
  const result = verifyEventFacetProposal({
    utterance: "find events at Expo today",
    proposal: proposal({
      what: [],
      where: { label: "EXPO (EAST)", evidence: "Expo" },
      residualQuery: "",
    }),
    catalog: expandedCatalog,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "unverified_evidence");
});

test("unresolved facets request clarification without accepting a mutation", () => {
  const result = verifyEventFacetProposal({
    utterance: "find something today",
    proposal: proposal({
      what: [],
      where: null,
      residualQuery: "",
      unresolved: ["what"],
    }),
    catalog,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "clarification_required");
  assert.deepEqual(result.clarificationChoices, [
    { choiceId: "what:exhibitions", label: "Exhibitions" },
  ]);
});

test("absent optional facets are not material unresolved requirements", () => {
  const result = verifyEventFacetProposal({
    utterance: "find events today",
    proposal: proposal({
      what: [],
      where: null,
      residualQuery: "",
      unresolved: ["where", "price"],
    }),
    catalog,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(
    result.matches.map(({ optionId }) => optionId),
    ["when:today"],
  );
});

test("two explicitly requested values in one single facet require clarification", () => {
  const result = verifyEventFacetProposal({
    utterance: "find events today or this weekend",
    proposal: proposal({
      what: [],
      when: null,
      where: null,
      residualQuery: "",
      unresolved: ["when"],
    }),
    catalog,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "clarification_required");
  assert.deepEqual(
    result.clarificationChoices.map(({ choiceId }) => choiceId),
    ["when:today", "when:this-weekend"],
  );
});

test("refinement may restate only an unchanged authoritative facet without new evidence", () => {
  const retained = [
    {
      optionId: "what:exhibitions",
      dimension: "what",
      label: "Exhibitions",
    },
    {
      optionId: "area:marina-bay",
      dimension: "where",
      label: "Marina Bay",
    },
  ];
  const accepted = verifyEventFacetProposal({
    utterance: "Make those free this weekend",
    proposal: proposal({
      what: [{ label: "Exhibitions", evidence: "Exhibitions" }],
      when: { label: "This weekend", evidence: "this weekend" },
      where: { label: "Marina Bay", evidence: "Marina Bay" },
      price: { label: "Free", evidence: "free" },
      residualQuery: "",
    }),
    catalog,
    mode: "refine",
    currentFilterTokens: retained,
  });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(
    accepted.matches.map(({ optionId }) => optionId),
    ["when:this-weekend", "price:free"],
  );

  const invented = verifyEventFacetProposal({
    utterance: "Make those free",
    proposal: proposal({
      what: [{ label: "Exhibitions", evidence: "Exhibitions" }],
      when: null,
      where: null,
      price: { label: "Free", evidence: "free" },
      residualQuery: "",
    }),
    catalog,
    mode: "refine",
    currentFilterTokens: [],
  });
  assert.equal(invented.accepted, false);
  assert.equal(invented.reason, "unverified_evidence");
});

test("residual cleanup keeps only meaningful utterance-derived words", () => {
  const result = verifyEventFacetProposal({
    utterance: "Can you please find immersive exhibitions today",
    proposal: proposal({
      where: null,
      residualQuery: "please immersive exhibitions invented",
    }),
    catalog,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.residualQuery, "immersive");
});

test("evidence must be a complete normalized phrase rather than part of another word", () => {
  const result = verifyEventFacetProposal({
    utterance: "find a party today",
    proposal: proposal({
      what: [{ label: "Exhibitions", evidence: "art" }],
      where: null,
      residualQuery: "party",
    }),
    catalog,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "unverified_evidence");
});
