import assert from "node:assert/strict";
import test from "node:test";

import { createActionGateway } from "../activity-scenes/assistant/action-gateway.js";
import {
  ActionRegistryError,
  createActionRegistry,
} from "../activity-scenes/assistant/action-registry.js";

const action = (overrides = {}) => ({
  actionId: "map.zoom_in",
  version: "1.0",
  description: "Zoom the map in",
  argumentSchema: {
    type: "object",
    additionalProperties: false,
    properties: { steps: { type: "integer", minimum: 1, maximum: 3 } },
    required: ["steps"],
  },
  eligibleStates: ["map_ready"],
  confirmationClass: "reversible",
  contextProvider: "map",
  resultSchema: {
    type: "object",
    additionalProperties: false,
    properties: { zoom: { type: "number" } },
    required: ["zoom"],
  },
  execute: ({ steps }, context) => ({ zoom: context.zoom + steps }),
  ...overrides,
});

test("registry accepts a closed, versioned action contract and exposes immutable metadata", () => {
  const registry = createActionRegistry([action()]);
  assert.equal(registry.get("map.zoom_in").actionId, "map.zoom_in");
  assert.deepEqual(registry.ids(), ["map.zoom_in"]);
  assert.throws(
    () => registry.get("map.zoom_in").eligibleStates.push("other"),
    TypeError,
  );
});

test("registry rejects duplicate IDs, open argument objects, and malformed identifiers", () => {
  assert.throws(
    () => createActionRegistry([action(), action()]),
    (error) =>
      error instanceof ActionRegistryError && error.code === "duplicate_action",
  );
  assert.throws(
    () =>
      createActionRegistry([
        action({ argumentSchema: { type: "object", properties: {} } }),
      ]),
    (error) => error.code === "invalid_action_contract",
  );
  assert.throws(
    () => createActionRegistry([action({ actionId: "clickAnything" })]),
    (error) => error.code === "invalid_action_contract",
  );
});

test("gateway validates current eligibility and closed arguments before execution", async () => {
  const gateway = createActionGateway({
    registry: createActionRegistry([action()]),
  });
  await assert.rejects(
    gateway.execute(
      "map.zoom_in",
      { steps: 1 },
      { states: ["intro"], zoom: 10 },
    ),
    (error) => error.code === "action_ineligible",
  );
  await assert.rejects(
    gateway.execute(
      "map.zoom_in",
      { steps: 1, selector: "#admin" },
      { states: ["map_ready"], zoom: 10 },
    ),
    (error) => error.code === "invalid_action_arguments",
  );
});

test("direct and voice entry points reach the same observable result through one executor", async () => {
  const gateway = createActionGateway({
    registry: createActionRegistry([action()]),
  });
  const context = { states: ["map_ready"], zoom: 10 };
  const direct = await gateway.execute("map.zoom_in", { steps: 2 }, context, {
    source: "direct",
  });
  const voice = await gateway.execute("map.zoom_in", { steps: 2 }, context, {
    source: "voice",
  });
  assert.deepEqual(direct, {
    status: "executed",
    actionId: "map.zoom_in",
    result: { zoom: 12 },
  });
  assert.deepEqual(voice, direct);
});

test("gateway rejects executor output that violates the declared result schema", async () => {
  const bad = action({ execute: () => ({ zoom: "far" }) });
  const gateway = createActionGateway({
    registry: createActionRegistry([bad]),
  });
  await assert.rejects(
    gateway.execute(
      "map.zoom_in",
      { steps: 1 },
      { states: ["map_ready"], zoom: 10 },
    ),
    (error) => error.code === "invalid_action_result",
  );
});
