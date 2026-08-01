import assert from "node:assert/strict";
import test from "node:test";

import { selectCapabilityTurnScope } from "../activity-scenes/assistant/capability-turn-scope.js";

const availableCapabilityIds = [
  "map.zoomin",
  "map.zoomout",
  "map.pan",
  "map.setlayervisibility",
  "event.applyquery",
  "event.select",
  "restaurant.search",
  "restaurant.open",
  "plan.addstop",
  "plan.removeitem",
  "tour.start",
  "navigation.closeoverlay",
  "navigation.openexternal",
  "location.show",
  "location.hide",
  "transit.showlines",
  "transit.hidelines",
  "discovery.presentareas",
  "discovery.selectarea",
];

const capabilityFamilies = {
  "map.zoomin": "map",
  "map.zoomout": "map",
  "map.pan": "map",
  "map.setlayervisibility": "map",
  "event.applyquery": "event",
  "event.select": "event",
  "restaurant.search": "restaurant",
  "restaurant.open": "restaurant",
  "plan.addstop": "plan",
  "plan.removeitem": "plan",
  "tour.start": "tour",
  "navigation.closeoverlay": "navigation",
  "navigation.openexternal": "navigation",
  "location.show": "location",
  "location.hide": "location",
  "transit.showlines": "transit",
  "transit.hidelines": "transit",
  "discovery.presentareas": "discovery-areas",
  "discovery.selectarea": "discovery-areas",
};

test("scopes an obvious command to its connector family and removes the locally routed tool", () => {
  const scope = selectCapabilityTurnScope({
    utterance: "zoom in",
    availableCapabilityIds,
    activeOverlayId: null,
  });

  assert.deepEqual(scope.families, ["map"]);
  assert.equal(scope.deterministicCapabilityId, "map.zoomin");
  assert.deepEqual(scope.capabilityIds, [
    "map.zoomout",
    "map.pan",
    "map.setlayervisibility",
  ]);
});

test("scopes requests to relevant connector families instead of the full registry", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "find a restaurant deal",
      availableCapabilityIds,
    }),
    {
      families: ["restaurant"],
      capabilityIds: ["restaurant.search", "restaurant.open"],
      deterministicCapabilityId: null,
      deterministicArguments: null,
    },
  );
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "find free events",
      availableCapabilityIds,
    }),
    {
      families: ["event"],
      capabilityIds: ["event.select"],
      deterministicCapabilityId: "event.applyquery",
      deterministicArguments: {
        text: "find free events",
        mode: "replace",
        baseContextRevision: 0,
        catalogRevision: "turn-scope",
      },
    },
  );
});

test("uses current interface state for an otherwise unclassified turn", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "remove that one",
      availableCapabilityIds,
      activeOverlayId: "plan-builder",
    }),
    {
      families: ["plan"],
      capabilityIds: ["plan.addstop", "plan.removeitem"],
      deterministicCapabilityId: null,
      deterministicArguments: null,
    },
  );
});

test("uses active domain context for its approved reference capability", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "open the official reference",
      availableCapabilityIds,
      capabilityFamilies,
      activeOverlayId: "event-panel",
    }),
    {
      families: ["event"],
      capabilityIds: ["event.applyquery", "event.select"],
      deterministicCapabilityId: null,
      deterministicArguments: null,
    },
  );
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "close this",
      availableCapabilityIds,
      capabilityFamilies,
      activeOverlayId: "map-attribution",
    }),
    {
      families: ["navigation"],
      capabilityIds: ["navigation.closeoverlay", "navigation.openexternal"],
      deterministicCapabilityId: null,
      deterministicArguments: null,
    },
  );
});

test("all 61 active canonical actions have a deterministic owning-family phrase", () => {
  const actions = [
    ["map.zoomin", "zoom in", "map"],
    ["map.zoomout", "zoom out", "map"],
    ["map.pan", "pan the map left", "map"],
    ["map.rotate", "rotate the map", "map"],
    ["map.focustarget", "focus this map target", "map"],
    ["map.resetview", "reset the map", "map"],
    ["map.openarea", "open this area", "discovery"],
    ["map.selectarea", "select this area", "discovery"],
    ["map.compareareas", "compare these areas", "discovery"],
    ["map.dismissarea", "dismiss this area", "discovery"],
    ["map.setlayervisibility", "hide the MRT lines", "map"],
    ["tour.start", "start the tour", "tour"],
    ["tour.previous", "previous tour step", "tour"],
    ["tour.next", "next tour step", "tour"],
    ["tour.finish", "finish the tour", "tour"],
    ["event.search", "search events for jazz", "event"],
    ["event.applyquery", "find free events this weekend", "event"],
    ["event.setfilter", "make the event filter free", "event"],
    ["event.removefilter", "remove this event filter", "event"],
    ["event.clearfilters", "clear event filters", "event"],
    ["event.selectresult", "select this event", "event"],
    ["event.opendetail", "open this event detail", "event"],
    ["event.selectoccurrence", "select this event occurrence", "event"],
    ["event.setsessionsexpanded", "expand event sessions", "event"],
    ["event.previousevent", "previous event", "event"],
    ["event.nextevent", "next event", "event"],
    ["event.closedetail", "close event details", "event"],
    ["event.addtoplan", "add this event to my plan", "event"],
    ["event.openreference", "open this event reference", "event"],
    ["event.opendirections", "get directions to this event", "event"],
    ["restaurant.search", "search restaurants", "restaurant"],
    [
      "restaurant.searchviewport",
      "search restaurants in this area",
      "restaurant",
    ],
    ["restaurant.setcategory", "set restaurant category", "restaurant"],
    ["restaurant.setcuisine", "set restaurant cuisine", "restaurant"],
    ["restaurant.clearfilters", "clear restaurant filters", "restaurant"],
    [
      "restaurant.selectcluster",
      "select this restaurant cluster",
      "restaurant",
    ],
    ["restaurant.selectresult", "select this restaurant", "restaurant"],
    ["restaurant.closeresults", "close restaurant results", "restaurant"],
    ["restaurant.closedetail", "close restaurant details", "restaurant"],
    ["restaurant.addtoplan", "add this restaurant to my plan", "restaurant"],
    [
      "restaurant.openreference",
      "open this restaurant reference",
      "restaurant",
    ],
    ["restaurant.opendealreference", "open this restaurant deal", "restaurant"],
    [
      "restaurant.opendirections",
      "get directions to this restaurant",
      "restaurant",
    ],
    ["plan.open", "open my plan", "plan"],
    ["plan.close", "close my plan", "plan"],
    ["plan.uselocation", "use my location", "plan"],
    ["plan.focuslocation", "focus on my location", "plan"],
    ["plan.settravelmode", "set plan travel mode to walking", "plan"],
    ["plan.addstop", "add this stop to my plan", "plan"],
    ["plan.removestop", "remove this plan stop", "plan"],
    ["plan.reorderstop", "reorder this plan stop", "plan"],
    ["plan.focusstop", "focus this plan stop", "plan"],
    ["plan.openroute", "open my plan route", "plan"],
    ["navigation.enterexperience", "enter experience", "navigation"],
    ["navigation.openassistant", "open the assistant", "navigation"],
    ["navigation.closeassistant", "close the assistant", "navigation"],
    ["navigation.closeoverlay", "close overlay", "navigation"],
    ["navigation.openattribution", "open attribution", "navigation"],
    ["navigation.closeattribution", "close attribution", "navigation"],
    [
      "navigation.openattributionreference",
      "open attribution reference",
      "navigation",
    ],
    ["navigation.openexternal", "open external link", "navigation"],
  ];

  assert.equal(actions.length, 61);
  for (const [capabilityId, utterance, expectedFamily] of actions) {
    const scope = selectCapabilityTurnScope({
      utterance,
      availableCapabilityIds,
      capabilityFamilies,
      catalogRevision: "events:v1",
    });
    assert.deepEqual(scope.families, [expectedFamily], capabilityId);
  }
});

test("unknown turns receive no unrelated command families", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "hello",
      availableCapabilityIds,
      activeOverlayId: null,
    }),
    {
      families: [],
      capabilityIds: [],
      deterministicCapabilityId: null,
      deterministicArguments: null,
    },
  );
});

const automatedRoutingScenarios = [
  {
    name: "date plus nearby location",
    utterance: "find events today nearby in my area",
    activeOverlayId: "events",
    expectedFamilies: ["event"],
    expectedCapabilityId: "event.applyquery",
  },
  {
    name: "type, price, date, and named venue",
    utterance: "find free exhibitions this weekend at Marina Bay Sands",
    activeOverlayId: "events",
    expectedFamilies: ["event"],
    expectedCapabilityId: "event.applyquery",
  },
  {
    name: "single event filter",
    utterance: "find concerts tomorrow",
    activeOverlayId: "events",
    expectedFamilies: ["event"],
    expectedCapabilityId: "event.applyquery",
  },
  {
    name: "event follow-up using current overlay",
    utterance: "only the free ones",
    activeOverlayId: "events",
    expectedFamilies: ["event"],
    expectedCapabilityId: "event.applyquery",
  },
  {
    name: "restaurant compound request",
    utterance: "find a restaurant deal nearby",
    activeOverlayId: null,
    expectedFamilies: ["restaurant"],
    expectedCapabilityId: null,
  },
  {
    name: "obvious map command",
    utterance: "zoom in",
    activeOverlayId: null,
    expectedFamilies: ["map"],
    expectedCapabilityId: "map.zoomin",
  },
  {
    name: "mixed domains require clarification",
    utterance: "find events and restaurants",
    activeOverlayId: null,
    expectedFamilies: [],
    expectedCapabilityId: null,
  },
  {
    name: "unsupported general request exposes nothing",
    utterance: "tell me tomorrow's weather",
    activeOverlayId: null,
    expectedFamilies: [],
    expectedCapabilityId: null,
  },
];

for (const scenario of automatedRoutingScenarios) {
  test(`automated native routing matrix: ${scenario.name}`, () => {
    const scope = selectCapabilityTurnScope({
      utterance: scenario.utterance,
      availableCapabilityIds,
      capabilityFamilies,
      activeOverlayId: scenario.activeOverlayId,
      baseContextRevision: 14,
      catalogRevision: "events:v14",
    });

    assert.deepEqual(scope.families, scenario.expectedFamilies);
    assert.equal(
      scope.deterministicCapabilityId,
      scenario.expectedCapabilityId,
    );
    if (scenario.expectedCapabilityId === "event.applyquery") {
      assert.equal(scope.deterministicArguments.baseContextRevision, 14);
      assert.equal(scope.deterministicArguments.text, scenario.utterance);
    }
    assert.ok(scope.capabilityIds.length <= 15);
  });
}

test("mixed-domain requests expose no action family instead of choosing one", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "find events and restaurants",
      availableCapabilityIds,
      capabilityFamilies,
      catalogRevision: "events:v1",
    }),
    {
      families: [],
      capabilityIds: [],
      deterministicCapabilityId: null,
      deterministicArguments: null,
    },
  );
});

test("every non-foundational connector family is reachable without exposing unrelated families", () => {
  for (const [utterance, family] of [
    ["show me restaurants", "restaurant"],
    ["what events are on", "event"],
    ["update my itinerary", "plan"],
    ["which MRT stations are visible", "transit"],
    ["where am i", "location"],
    ["start the tutorial", "tour"],
    ["recommend somewhere calm", "discovery"],
    ["open the attribution", "navigation"],
    ["pan the map", "map"],
  ]) {
    const scope = selectCapabilityTurnScope({
      utterance,
      availableCapabilityIds,
      capabilityFamilies,
    });
    assert.ok(scope.families.includes(family), `${utterance}: ${family}`);
    assert.ok(
      scope.capabilityIds.every(
        (capabilityId) =>
          capabilityFamilies[capabilityId] === family ||
          (family === "discovery" &&
            capabilityFamilies[capabilityId] === "discovery-areas"),
      ),
      `${utterance}: unrelated capability`,
    );
  }
});

test("active action vocabulary deterministically selects the owning family", () => {
  const phrasesByFamily = {
    event: [
      "show performances this weekend",
      "find workshops under $25",
      "expand event sessions",
      "add this event to my plan",
    ],
    restaurant: [
      "search restaurants in this area",
      "set restaurant cuisine to Thai",
      "open this restaurant deal",
      "get directions to this restaurant",
    ],
    plan: [
      "open my itinerary",
      "set travel mode to transit",
      "reorder this stop",
      "open the route",
    ],
    map: ["rotate the map", "reset map view", "hide recommendations"],
    tour: ["start the tour", "previous tour step", "finish the walkthrough"],
    discovery: [
      "recommend somewhere quiet",
      "show me a cultural area",
      "where should I go near MRT",
      "compare these areas",
    ],
    navigation: [
      "open the assistant",
      "close the attribution",
      "open the external link",
    ],
  };

  for (const [family, phrases] of Object.entries(phrasesByFamily))
    for (const utterance of phrases) {
      const scope = selectCapabilityTurnScope({
        utterance,
        availableCapabilityIds,
        capabilityFamilies,
        catalogRevision: "events:v1",
      });
      assert.deepEqual(scope.families, [family], utterance);
    }
});
