import assert from "node:assert/strict";
import test from "node:test";

import {
  EventConnectorError,
  createEventConnector,
} from "../activity-scenes/assistant/connectors/event-connector.js";
import { createEventDiscoveryModel } from "../activity-scenes/events/event-discovery-model.js";

const filterOptions = [
  {
    id: "what:music",
    dimension: "what",
    value: "Music",
    label: "Music",
    kind: "category",
  },
  {
    id: "what:theatre",
    dimension: "what",
    value: "Theatre",
    label: "Theatre",
    kind: "category",
  },
  {
    id: "when:custom",
    dimension: "when",
    value: "custom",
    label: "Choose dates",
    kind: "custom",
  },
  {
    id: "where:mystery-location",
    dimension: "where",
    value: "mystery-location",
    label: "Mystery Location",
    kind: "placement",
  },
  {
    id: "price:free",
    dimension: "price",
    value: "free",
    label: "Free",
    kind: "price",
  },
];

const primaryEvent = {
  candidateId: "event:venue-1:music-night",
  title: "Music Night",
  landmarkId: "venue-1",
  publicPlacement: "mapped",
  occurrences: Array.from({ length: 25 }, (_, index) => ({
    occurrenceId: `session:${index + 1}`,
  })),
  sourceOffers: [
    { referenceId: "official", url: "https://example.test/music" },
    { referenceId: "tickets", url: "https://tickets.example.test/music" },
  ],
};

function ownerFixture({
  events = [
    primaryEvent,
    ...Array.from({ length: 58 }, (_, index) => ({
      candidateId: `event:venue-${index + 2}:fixture-${index + 2}`,
      title: `Fixture ${index + 2}`,
      landmarkId: `venue-${index + 2}`,
      publicPlacement: "mapped",
      occurrences: [{ occurrenceId: `fixture-session:${index + 2}` }],
      sourceOffers: [],
    })),
  ],
} = {}) {
  const listeners = new Set();
  const calls = [];
  const state = {
    query: "",
    filterTokens: [],
    filterOptions,
    events,
    resultsOpen: true,
    detailOpen: false,
    selectedEventId: null,
    selectedOccurrenceId: null,
    sessionsExpanded: false,
    hasPrevious: false,
    hasNext: false,
    planCanAdd: true,
  };
  const publish = () => {
    for (const listener of listeners) listener(structuredClone(state));
  };
  const dispatch = (capabilityId, args = {}) => {
    calls.push([capabilityId, structuredClone(args)]);
    if (capabilityId === "event.applyquery") {
      publish();
      return {
        changed: true,
        data: {
          outcome: "applied",
          canonicalSentence: args.text,
          residualQuery: "",
          phrases: [],
          clarificationChoices: [],
          catalogRevision: "fixture-catalog",
          resultCount: events.length,
        },
      };
    } else if (capabilityId === "event.search")
      state.query = String(args.query ?? "");
    else if (capabilityId === "event.setfilter") {
      state.filterTokens = state.filterTokens.filter(
        ({ dimension }) => dimension !== args.facet,
      );
      for (const value of args.values) {
        const id =
          typeof value === "string"
            ? value
            : (value.filterId ?? value.optionId ?? value.id);
        const option = filterOptions.find(
          ({ id: candidate }) => candidate === id,
        );
        if (!option) continue;
        state.filterTokens.push({
          optionId: option.id,
          dimension: option.dimension,
          label: option.label,
          value: option.value,
          kind: option.kind,
          parameters: typeof value === "object" ? (value.parameters ?? {}) : {},
        });
      }
    } else if (capabilityId === "event.removefilter")
      state.filterTokens = state.filterTokens.filter(
        ({ optionId }) => optionId !== args.filterId,
      );
    else if (capabilityId === "event.clearfilters") {
      state.query = "";
      state.filterTokens = [];
    } else if (capabilityId === "event.selectresult") {
      state.selectedEventId = args.eventId;
    } else if (capabilityId === "event.opendetail") {
      state.selectedEventId = args.eventId;
      state.selectedOccurrenceId =
        events.find(({ candidateId }) => candidateId === args.eventId)
          ?.occurrences[0]?.occurrenceId ?? null;
      state.detailOpen = true;
      state.hasNext = true;
    } else if (capabilityId === "event.selectoccurrence") {
      state.selectedOccurrenceId = args.occurrenceId;
    } else if (capabilityId === "event.setsessionsexpanded") {
      state.sessionsExpanded = args.expanded;
    } else if (capabilityId === "event.previousevent") {
      state.hasPrevious = false;
      state.hasNext = true;
    } else if (capabilityId === "event.nextevent") {
      state.hasPrevious = true;
      state.hasNext = false;
    } else if (capabilityId === "event.closedetail") {
      state.detailOpen = false;
      state.sessionsExpanded = false;
    } else if (
      ![
        "event.addtoplan",
        "event.openreference",
        "event.opendirections",
      ].includes(capabilityId)
    )
      return false;
    publish();
    return true;
  };
  return {
    calls,
    snapshot: () => structuredClone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    direct: dispatch,
  };
}

test("event connector exposes only bounded approved IDs and canonical commands", () => {
  const connector = createEventConnector({
    eventController: ownerFixture(),
  });
  const snapshot = connector.snapshot();

  assert.equal(connector.connectorId, "events");
  assert.equal(snapshot.events.length, 50);
  assert.equal(snapshot.visibleTargets.length, 50);
  assert.equal(snapshot.events[0].occurrenceIds.length, 20);
  assert.deepEqual(snapshot.events[0].referenceIds, ["official", "tickets"]);
  assert.equal(JSON.stringify(snapshot).includes("https://"), false);
  assert.deepEqual(connector.legacyAliasIds, [
    "event.setcategory",
    "event.setdaterange",
    "event.setpricerange",
  ]);
  assert.equal(connector.capabilityIds.includes("event.setcategory"), false);
  assert.equal(connector.capabilityIds.includes("event.setfilter"), true);
  assert.equal(
    connector.isEligible("event.setcategory", {
      categoryId: "Unregistered",
    }),
    false,
  );
  assert.equal(
    connector.isEligible("event.selectresult", {
      eventId: primaryEvent.candidateId,
    }),
    true,
  );
  assert.equal(
    connector.isEligible("event.selectresult", {
      eventId: "event:not-visible",
    }),
    false,
  );
});

test("applyquery returns the first three authoritative event results for narration", async () => {
  const owner = ownerFixture();
  const connector = createEventConnector({ eventController: owner });

  const result = await connector.execute(
    "event.applyquery",
    {
      text: "events this weekend",
      mode: "replace",
      baseContextRevision: 0,
      catalogRevision: "",
    },
    { revision: 0 },
  );

  assert.deepEqual(result.data.topEvents, [
    { eventId: "event:venue-1:music-night", title: "Music Night" },
    { eventId: "event:venue-2:fixture-2", title: "Fixture 2" },
    { eventId: "event:venue-3:fixture-3", title: "Fixture 3" },
  ]);
  assert.equal(result.data.canAddToPlan, true);
});

test("model query state preserves multi-value filters and placement semantics", () => {
  const model = createEventDiscoveryModel(
    [
      {
        id: "venue-1",
        label: "Venue One",
        anchor: [103.85, 1.29],
        events: [
          {
            id: "music",
            title: "Music Night",
            category: "Music",
            price: "Free",
            publicPlacement: "mapped",
          },
          {
            id: "theatre",
            title: "Theatre Night",
            category: "Theatre",
            price: "$40",
            publicPlacement: "mapped",
          },
        ],
      },
    ],
    {
      offMapEvents: [
        {
          id: "secret-show",
          title: "Secret Music Show",
          category: "Music",
          price: "Free",
          publicPlacement: "off_map",
          offMapSubtype: "secret_tba",
        },
      ],
    },
  );
  const projected = model.queryState({
    query: "show",
    filterTokens: [
      {
        optionId: "what:music",
        dimension: "what",
        value: "Music",
        label: "Music",
        kind: "category",
      },
      {
        optionId: "what:theatre",
        dimension: "what",
        value: "Theatre",
        label: "Theatre",
        kind: "category",
      },
      {
        optionId: "where:mystery-location",
        dimension: "where",
        value: "mystery-location",
        label: "Mystery Location",
        kind: "placement",
      },
    ],
  });

  assert.deepEqual(
    projected.filterTokens.map(({ optionId }) => optionId),
    ["what:music", "what:theatre", "where:mystery-location"],
  );
  assert.deepEqual(
    projected.events.map(({ eventId }) => eventId),
    ["secret-show"],
  );
});

test("setfilter replaces one facet without collapsing others and removefilter is contextual", async () => {
  const owner = ownerFixture();
  owner.direct("event.setfilter", {
    facet: "price",
    values: ["price:free"],
  });
  const connector = createEventConnector({ eventController: owner });

  const result = await connector.execute("event.setfilter", {
    facet: "what",
    values: ["what:music", "what:theatre"],
  });
  assert.deepEqual(
    result.data.state.filterTokens.map(({ filterId }) => filterId),
    ["price:free", "what:music", "what:theatre"],
  );
  assert.equal(
    connector.isEligible("event.removefilter", {
      filterId: "what:music",
    }),
    true,
  );
  await connector.execute("event.removefilter", {
    filterId: "what:music",
  });
  assert.deepEqual(
    connector.snapshot().filterTokens.map(({ filterId }) => filterId),
    ["price:free", "what:theatre"],
  );
  await assert.rejects(
    connector.execute("event.removefilter", {
      filterId: "what:not-active",
    }),
    (error) =>
      error instanceof EventConnectorError &&
      error.code === "event_capability_unavailable",
  );
  await connector.execute("event.clearfilters");
  assert.deepEqual(connector.snapshot().filterTokens, []);
});

test("version-1 aliases delegate one-way to canonical filter commands", async () => {
  const owner = ownerFixture();
  const connector = createEventConnector({ eventController: owner });

  await connector.execute("event.setcategory", { categoryId: "Music" });
  await connector.execute("event.setdaterange", {
    startDate: "2026-07-30",
    endDate: "2026-07-31",
  });
  await connector.execute("event.setpricerange", { priceBand: "free" });

  assert.deepEqual(owner.calls, [
    ["event.setfilter", { facet: "what", values: ["what:music"] }],
    [
      "event.setfilter",
      {
        facet: "when",
        values: [
          {
            filterId: "when:custom",
            parameters: { start: "2026-07-30", end: "2026-07-31" },
          },
        ],
      },
    ],
    ["event.setfilter", { facet: "price", values: ["price:free"] }],
  ]);
  assert.deepEqual(
    connector.snapshot().filterTokens.map(({ filterId }) => filterId),
    ["what:music", "when:custom", "price:free"],
  );
});

test("occurrence selection is available only when the open event has a schedule choice", async () => {
  const singletonEvent = {
    candidateId: "event:venue-single:only-session",
    title: "Only Session",
    landmarkId: "venue-single",
    publicPlacement: "mapped",
    occurrences: [{ occurrenceId: "session:only" }],
    sourceOffers: [],
  };
  const singletonConnector = createEventConnector({
    eventController: ownerFixture({ events: [singletonEvent] }),
  });
  await singletonConnector.execute("event.opendetail", {
    eventId: singletonEvent.candidateId,
  });
  assert.equal(
    singletonConnector.isEligible("event.selectoccurrence", {
      eventId: singletonEvent.candidateId,
      occurrenceId: "session:only",
    }),
    false,
  );
  await assert.rejects(
    singletonConnector.execute("event.selectoccurrence", {
      eventId: singletonEvent.candidateId,
      occurrenceId: "session:only",
    }),
    (error) =>
      error instanceof EventConnectorError &&
      error.code === "event_capability_unavailable",
  );

  const multipleConnector = createEventConnector({
    eventController: ownerFixture({ events: [primaryEvent] }),
  });
  await multipleConnector.execute("event.opendetail", {
    eventId: primaryEvent.candidateId,
  });
  assert.equal(
    multipleConnector.isEligible("event.selectoccurrence", {
      eventId: primaryEvent.candidateId,
      occurrenceId: "session:2",
    }),
    true,
  );
});

test("detail, occurrence, session, navigation, plan, and external eligibility use stable visible targets", async () => {
  const owner = ownerFixture();
  const connector = createEventConnector({ eventController: owner });

  await connector.execute("event.selectresult", {
    eventId: primaryEvent.candidateId,
  });
  await connector.execute("event.opendetail", {
    eventId: primaryEvent.candidateId,
  });
  assert.equal(
    connector.isEligible("event.selectoccurrence", {
      eventId: primaryEvent.candidateId,
      occurrenceId: "session:20",
    }),
    true,
  );
  assert.equal(
    connector.isEligible("event.selectoccurrence", {
      eventId: primaryEvent.candidateId,
      occurrenceId: "session:25",
    }),
    false,
  );
  await connector.execute("event.selectoccurrence", {
    eventId: primaryEvent.candidateId,
    occurrenceId: "session:2",
  });
  await connector.execute("event.setsessionsexpanded", {
    eventId: primaryEvent.candidateId,
    expanded: true,
  });
  assert.equal(connector.snapshot().sessionsExpanded, true);
  assert.equal(connector.isEligible("event.previousevent"), false);
  assert.equal(connector.isEligible("event.nextevent"), true);
  await connector.execute("event.nextevent");
  assert.equal(connector.isEligible("event.previousevent"), true);
  await connector.execute("event.previousevent");
  assert.equal(
    connector.isEligible("event.openreference", {
      eventId: primaryEvent.candidateId,
      referenceId: "official",
    }),
    true,
  );
  assert.equal(
    connector.isEligible("event.openreference", {
      eventId: primaryEvent.candidateId,
      referenceId: "unapproved",
    }),
    false,
  );
  assert.equal(
    connector.isEligible("event.openreference", {
      eventId: "event:venue-2:fixture-2",
    }),
    false,
  );
  assert.equal(
    connector.isEligible("event.opendirections", {
      eventId: primaryEvent.candidateId,
    }),
    true,
  );
  assert.equal(
    connector.isEligible("event.addtoplan", {
      eventId: primaryEvent.candidateId,
    }),
    true,
  );
  await connector.execute("event.addtoplan", {
    eventId: primaryEvent.candidateId,
  });
  await connector.execute("event.openreference", {
    eventId: primaryEvent.candidateId,
    referenceId: "official",
  });
  await connector.execute("event.opendirections", {
    eventId: primaryEvent.candidateId,
  });
  const closed = await connector.execute("event.closedetail");
  assert.equal(closed.contextPatch.activeOverlayId, "event-search");
  assert.deepEqual(
    owner.calls.slice(-4).map(([capabilityId]) => capabilityId),
    [
      "event.addtoplan",
      "event.openreference",
      "event.opendirections",
      "event.closedetail",
    ],
  );
});

test("direct and assistant commands share owner state, revisions, and observable context", async () => {
  const owner = ownerFixture();
  const connector = createEventConnector({ eventController: owner });
  const revisions = [];
  connector.subscribe(({ revision }) => revisions.push(revision));

  owner.direct("event.search", { query: "direct" });
  assert.equal(connector.snapshot().query, "direct");
  const result = await connector.execute("event.search", {
    query: "assistant",
  });

  assert.deepEqual(owner.calls.slice(-2), [
    ["event.search", { query: "direct" }],
    ["event.search", { query: "assistant" }],
  ]);
  assert.deepEqual(revisions, [1, 2]);
  assert.equal(result.contextPatch.event.query, "assistant");
  assert.deepEqual(
    result.contextPatch.visibleTargets,
    connector.snapshot().visibleTargets,
  );
});
