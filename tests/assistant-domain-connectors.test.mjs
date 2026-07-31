import assert from "node:assert/strict";
import test from "node:test";

import { createConditionalContentConnector } from "../activity-scenes/assistant/connectors/conditional-content-connector.js";
import {
  OverlayNavigationConnectorError,
  createOverlayNavigationConnector,
} from "../activity-scenes/assistant/connectors/overlay-navigation-connector.js";
import {
  PlanConnectorError,
  createPlanConnector,
} from "../activity-scenes/assistant/connectors/plan-connector.js";
import {
  RestaurantConnectorError,
  createRestaurantConnector,
} from "../activity-scenes/assistant/connectors/restaurant-connector.js";
import { createTourConnector } from "../activity-scenes/assistant/connectors/tour-connector.js";

function ownerFixture(initial, reducer) {
  let state = structuredClone(initial);
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    snapshot: () => structuredClone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(id, args) {
      calls.push([id, structuredClone(args)]);
      const next = reducer?.(structuredClone(state), id, args);
      if (next === false) return false;
      if (next) state = next;
      for (const listener of listeners) listener(structuredClone(state));
      return true;
    },
    direct(id, args = {}) {
      return this.dispatch(id, args);
    },
  };
}

test("restaurant connector projects bounded state and delegates contextual commands", async () => {
  const owner = ownerFixture(
    {
      resultsOpen: true,
      detailOpen: false,
      query: "",
      categoryId: null,
      cuisineId: null,
      categories: ["cafe"],
      cuisines: ["local"],
      results: [
        { restaurantId: "restaurant:one" },
        ...Array.from({ length: 60 }, (_, index) => ({
          restaurantId: `restaurant:extra-${index}`,
        })),
      ],
      clusters: [{ clusterId: "cluster:one" }],
      deals: { "restaurant:one": ["deal:lunch"] },
      selectedRestaurantId: null,
    },
    (state, id, args) => {
      if (id === "restaurant.search") state.query = args.query;
      if (id === "restaurant.selectresult") {
        state.selectedRestaurantId = args.restaurantId;
        state.detailOpen = true;
      }
      return state;
    },
  );
  const connector = createRestaurantConnector({
    restaurantController: owner,
  });
  assert.equal(connector.snapshot().resultIds.length, 50);
  assert.equal(
    connector.isEligible("restaurant.opendealreference", {
      restaurantId: "restaurant:one",
      dealId: "deal:lunch",
    }),
    true,
  );
  assert.equal(
    connector.isEligible("restaurant.opendealreference", {
      restaurantId: "restaurant:one",
      dealId: "deal:invented",
    }),
    false,
  );

  owner.direct("restaurant.search", { query: "cafe" });
  const selected = await connector.execute("restaurant.selectresult", {
    restaurantId: "restaurant:one",
  });
  assert.deepEqual(selected.affectedTargetIds, ["restaurant:one"]);
  assert.equal(selected.contextPatch.focusedTargetId, "restaurant:one");
  assert.equal(selected.contextPatch.activeOverlayId, "restaurant-detail");
  assert.deepEqual(owner.calls, [
    ["restaurant.search", { query: "cafe" }],
    ["restaurant.selectresult", { restaurantId: "restaurant:one" }],
  ]);
});

test("restaurant connector rejects unknown targets and missing owners", async () => {
  assert.throws(
    () => createRestaurantConnector(),
    (error) =>
      error instanceof RestaurantConnectorError &&
      error.code === "restaurant_owner_invalid",
  );
  const connector = createRestaurantConnector({
    restaurantController: ownerFixture(
      { resultsOpen: true, results: [] },
      (state) => state,
    ),
  });
  await assert.rejects(
    connector.execute("restaurant.selectresult", {
      restaurantId: "restaurant:unknown",
    }),
    { code: "restaurant_capability_unavailable" },
  );
});

test("plan connector enforces ordered-stop, target, mode, and route eligibility", async () => {
  const owner = ownerFixture(
    {
      open: true,
      planId: "plan:today",
      travelMode: "walking",
      routeAvailable: true,
      locationAvailable: true,
      addableTargetIds: ["event:new"],
      stops: [
        { stopId: "stop:one", targetId: "event:one", title: "One" },
        { stopId: "stop:two", targetId: "restaurant:two", title: "Two" },
      ],
    },
    (state, id, args) => {
      if (id === "plan.settravelmode") state.travelMode = args.mode;
      if (id === "plan.reorderstop") {
        const index = state.stops.findIndex(
          ({ stopId }) => stopId === args.stopId,
        );
        const [stop] = state.stops.splice(index, 1);
        state.stops.splice(args.toIndex, 0, stop);
      }
      return state;
    },
  );
  const connector = createPlanConnector({ planController: owner });
  assert.equal(
    connector.isEligible("plan.addstop", { targetId: "event:new" }),
    true,
  );
  assert.equal(
    connector.isEligible("plan.addstop", { targetId: "event:unknown" }),
    false,
  );
  assert.equal(
    connector.isEligible("plan.openroute", { segmentIndex: 0 }),
    true,
  );
  await connector.execute("plan.settravelmode", { mode: "transit" });
  const reordered = await connector.execute("plan.reorderstop", {
    stopId: "stop:two",
    toIndex: 0,
  });
  assert.deepEqual(
    reordered.data.state.stops.map(({ stopId }) => stopId),
    ["stop:two", "stop:one"],
  );
  assert.deepEqual(reordered.contextPatch.plan, {
    stopIds: ["stop:two", "stop:one"],
    travelMode: "transit",
    routeAvailable: true,
  });
});

test("plan connector keeps consequential effects delegated and rejects stale IDs", async () => {
  const connector = createPlanConnector({
    planController: ownerFixture(
      {
        open: true,
        stops: [{ stopId: "stop:one" }],
        routeAvailable: false,
      },
      (state) => state,
    ),
  });
  await assert.rejects(
    connector.execute("plan.removestop", { stopId: "stop:missing" }),
    (error) =>
      error instanceof PlanConnectorError &&
      error.code === "plan_capability_unavailable",
  );
  await assert.rejects(connector.execute("plan.openroute", {}), {
    code: "plan_capability_unavailable",
  });
});

test("overlay navigation accepts only approved target and link-kind pairs", async () => {
  const owner = ownerFixture(
    {
      introVisible: true,
      assistantOpen: false,
      activeOverlayId: "attribution",
      closableOverlayIds: ["attribution"],
      attributionOpen: true,
      attributionReferenceIds: ["attribution:onemap"],
      approvedLinks: {
        "event:one": ["reference", "directions"],
      },
    },
    (state, id) => {
      if (id === "navigation.openassistant") state.assistantOpen = true;
      return state;
    },
  );
  const connector = createOverlayNavigationConnector({
    navigationController: owner,
  });
  assert.equal(
    connector.isEligible("navigation.openexternal", {
      targetId: "event:one",
      linkKind: "reference",
    }),
    true,
  );
  for (const args of [
    {
      targetId: "event:unknown",
      linkKind: "reference",
    },
    {
      targetId: "event:one",
      linkKind: "private",
    },
    {
      targetId: "https://evil.example",
      linkKind: "reference",
    },
  ])
    await assert.rejects(
      connector.execute("navigation.openexternal", args),
      (error) =>
        error instanceof OverlayNavigationConnectorError &&
        error.code === "external_target_unapproved",
    );
  const opened = await connector.execute("navigation.openexternal", {
    targetId: "event:one",
    linkKind: "directions",
  });
  assert.deepEqual(opened.affectedTargetIds, ["event:one"]);
  assert.equal(Object.hasOwn(owner.calls.at(-1)[1], "url"), false);
});

test("overlay and attribution state use the shared direct-control owner", async () => {
  const owner = ownerFixture(
    {
      introVisible: false,
      assistantOpen: false,
      activeOverlayId: null,
      closableOverlayIds: [],
      attributionOpen: false,
      attributionReferenceIds: ["attribution:onemap"],
      approvedLinks: {},
    },
    (state, id) => {
      if (id === "navigation.openassistant") state.assistantOpen = true;
      if (id === "navigation.openattribution") {
        state.attributionOpen = true;
        state.activeOverlayId = "attribution";
        state.closableOverlayIds = ["attribution"];
      }
      return state;
    },
  );
  const connector = createOverlayNavigationConnector({
    navigationController: owner,
  });
  owner.direct("navigation.openassistant");
  const attribution = await connector.execute("navigation.openattribution", {});
  assert.equal(attribution.data.attributionOpen, true);
  assert.equal(attribution.contextPatch.activeOverlayId, "attribution");
  assert.deepEqual(
    owner.calls.map(([id]) => id),
    ["navigation.openassistant", "navigation.openattribution"],
  );
});

test("tour connector exposes step eligibility and delegates shared controls", async () => {
  let active = false;
  let stepIndex = 0;
  const calls = [];
  const owner = {
    isActive: () => active,
    snapshot: () => ({ active, stepIndex, available: true }),
    start(options) {
      calls.push(["start", options]);
      active = true;
      stepIndex = 0;
      return true;
    },
    previous() {
      calls.push(["previous"]);
      stepIndex -= 1;
      return true;
    },
    next() {
      calls.push(["next"]);
      stepIndex += 1;
      return true;
    },
    finish() {
      calls.push(["finish"]);
      active = false;
      return true;
    },
  };
  const connector = createTourConnector({
    tourController: owner,
    stepCount: 3,
  });
  await connector.execute("tour.start", {});
  assert.equal(connector.isEligible("tour.previous"), false);
  await connector.execute("tour.next", {});
  assert.equal(connector.isEligible("tour.previous"), true);
  await connector.execute("tour.finish", {});
  assert.equal(connector.snapshot().active, false);
  assert.deepEqual(calls, [["start", { force: true }], ["next"], ["finish"]]);
});

test("conditional adapter remains unregistered and empty without real data and controls", () => {
  for (const connector of [
    createConditionalContentConnector(),
    createConditionalContentConnector({
      savedOwner: {
        snapshot: () => ({ items: [] }),
        dispatch() {},
      },
      gameOwner: {
        snapshot: () => ({ games: [] }),
        dispatch() {},
      },
    }),
  ]) {
    assert.equal(connector.connectorId, "conditional-content");
    assert.equal(connector.registered, false);
    assert.equal(connector.availability(), "empty");
    assert.deepEqual(connector.capabilityIds, []);
    assert.deepEqual(connector.snapshot(), {
      revision: 0,
      savedItemIds: [],
      gameIds: [],
      availableCapabilityIds: [],
    });
    let emitted = null;
    const unsubscribe = connector.subscribe(
      (snapshot) => {
        emitted = snapshot;
      },
      { emitCurrent: true },
    );
    assert.deepEqual(emitted, connector.snapshot());
    assert.equal(typeof unsubscribe, "function");
    unsubscribe();
    assert.equal(connector.isEligible("saved.open"), false);
  }
});
