import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlanStop, createPlanningCandidateState, createPlanState, movePlanStop, planWarnings, removePlanStop, routeStops,
} from "../activity-scenes/planning/plan-model.js";

const event = { id: "event-1", type: "event", title: "Jazz", place: "Esplanade", latitude: 1.2897, longitude: 103.8559, endsAt: "2026-07-15T12:00:00Z" };
const restaurant = { id: "food-1", type: "restaurant", title: "Dinner", place: "Marina Bay", latitude: 1.283, longitude: 103.86 };

test("mixed stops deduplicate by stable type and identity without replacing order", () => {
  let state = createPlanState();
  ({ state } = addPlanStop(state, event));
  ({ state } = addPlanStop(state, restaurant));
  const duplicate = addPlanStop(state, { ...event, title: "Changed presentation" });
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.deepEqual(duplicate.state.stops.map(({ id }) => id), ["event-1", "food-1"]);
  assert.equal(duplicate.state.stops[0].title, "Jazz");
});

test("remove and reorder preserve stable stop data and reject invalid indices", () => {
  let state = createPlanState({ stops: [event, restaurant] });
  state = movePlanStop(state, 1, 0);
  assert.deepEqual(state.stops.map(({ id }) => id), ["food-1", "event-1"]);
  assert.equal(movePlanStop(state, -1, 0), state);
  state = removePlanStop(state, "restaurant:food-1");
  assert.deepEqual(state.stops.map(({ id }) => id), ["event-1"]);
});

test("warnings are deterministic and route ordering excludes invalid coordinates", () => {
  const now = new Date("2026-07-16T00:00:00Z");
  const invalid = { id: "bad", type: "event", title: "Bad", place: "Unknown", latitude: NaN, longitude: 103.8 };
  const state = createPlanState({ stops: [event, restaurant, invalid] });
  assert.deepEqual(planWarnings(state, { now }), [
    "1 event has expired.",
    "Opening hours are missing for 1 food stop.",
    "1 stop has invalid coordinates and cannot be routed.",
  ]);
  assert.deepEqual(routeStops(state).map(({ id }) => id), ["event-1", "food-1"]);
});

test("plan state enforces twenty stops and isolates caller mutations", () => {
  const stops = Array.from({ length: 20 }, (_, index) => ({ ...event, id: `event-${index}` }));
  const state = createPlanState({ stops });
  const full = addPlanStop(state, restaurant);
  assert.equal(full.added, false);
  assert.equal(full.reason, "limit");
  stops[0].title = "Mutated";
  assert.equal(state.stops[0].title, "Jazz");
});

test("planning candidate state exposes immutable ordered stops and allowlisted games", () => {
  const state = createPlanState({ stops: [event, restaurant] });
  const games = [
    { id: "hunt-2", title: "Night hunt", status: "available", theme: "history", areaId: "city-hall", latitude: 1.29, longitude: 103.85, secret: "omit" },
    { id: "hunt-1", title: "Garden hunt", status: "paused" },
    { id: "hunt-1", title: "Duplicate" },
  ];
  const candidates = createPlanningCandidateState(state, { games });

  assert.deepEqual(candidates.planStops.map(({ candidateId, position }) => ({ candidateId, position })), [
    { candidateId: "plan-stop:event:event-1", position: 1 },
    { candidateId: "plan-stop:restaurant:food-1", position: 2 },
  ]);
  assert.deepEqual(candidates.games.map(({ candidateId }) => candidateId), ["game:hunt-1", "game:hunt-2"]);
  assert.equal("secret" in candidates.games[1], false);
  assert.equal(Object.isFrozen(candidates), true);
  assert.equal(Object.isFrozen(candidates.planStops), true);
  assert.equal(Object.isFrozen(candidates.games[1]), true);
});
