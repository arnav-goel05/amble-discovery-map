import assert from "node:assert/strict";
import test from "node:test";

import { createActionGateway } from "../activity-scenes/assistant/action-gateway.js";
import { createCapabilityRegistry } from "../activity-scenes/assistant/capability-registry.js";

const closed = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

function capability(overrides = {}) {
  return {
    capabilityId: "map.zoomin",
    version: "2.0",
    kind: "command",
    description: "Zoom the map in",
    connectorId: "map",
    argumentSchema: closed({
      steps: { type: "integer", minimum: 1, maximum: 3 },
    }),
    eligibleStates: ["map_ready"],
    confirmationClass: "reversible",
    contextProvider: "mapContext",
    resultSchema: closed({
      zoom: { type: "number", minimum: 0, maximum: 24 },
    }),
    ...overrides,
  };
}

function registryWith({
  contracts = [capability()],
  execute = async (_id, { steps }, context) => ({
    zoom: context.zoom + steps,
  }),
} = {}) {
  return createCapabilityRegistry({
    connectors: [{ connectorId: "map", execute }],
    capabilities: contracts,
  });
}

test("v2 gateway delegates closed arguments and observable results to the capability registry", async () => {
  const gateway = createActionGateway({ registry: registryWith() });

  const output = await gateway.execute(
    "map.zoomin",
    { steps: 2 },
    { states: ["map_ready"], revision: 7, zoom: 10 },
    { source: "voice", proposalRevision: 7 },
  );
  assert.deepEqual(output, {
    capabilityId: "map.zoomin",
    kind: "command",
    status: "completed",
    changed: true,
    affectedTargetIds: [],
    contextRevision: 8,
    data: { zoom: 12 },
    errorCode: null,
  });

  await assert.rejects(
    gateway.execute(
      "map.zoomin",
      { steps: 2, selector: "#admin" },
      { states: ["map_ready"], revision: 8, zoom: 12 },
      { proposalRevision: 8 },
    ),
    (error) => error.code === "invalid_capability_arguments",
  );
});

test("v2 gateway rejects stale proposal revisions before invocation", async () => {
  let calls = 0;
  const gateway = createActionGateway({
    registry: registryWith({
      execute: async () => {
        calls += 1;
        return { zoom: 12 };
      },
    }),
  });

  await assert.rejects(
    gateway.execute(
      "map.zoomin",
      { steps: 1 },
      { states: ["map_ready"], revision: 5, zoom: 11 },
      { proposalRevision: 4 },
    ),
    (error) => error.code === "stale_context",
  );
  assert.equal(calls, 0);
});

test("v2 gateway validates proposal target IDs against registered context", async () => {
  const gateway = createActionGateway({ registry: registryWith() });

  await assert.rejects(
    gateway.execute(
      "map.zoomin",
      { steps: 1 },
      {
        states: ["map_ready"],
        revision: 2,
        zoom: 10,
        registeredTargetIds: ["event:known"],
      },
      { proposalRevision: 2, targetIds: ["event:unknown"] },
    ),
    (error) => error.code === "unknown_target",
  );
});

test("consequential v2 commands delegate confirmation and block dependent calls", async () => {
  let executions = 0;
  const contract = capability({
    capabilityId: "navigation.openexternal",
    description: "Open the approved event reference",
    confirmationClass: "consequential",
    argumentSchema: closed({
      targetId: { type: "string", minLength: 1, maxLength: 256 },
    }),
    resultSchema: closed({
      opened: { type: "boolean" },
    }),
  });
  const registry = registryWith({
    contracts: [contract],
    execute: async () => {
      executions += 1;
      return { opened: true };
    },
  });
  const confirmationController = {
    request(input) {
      assert.equal(input.contextRevision, 3);
      return {
        confirmationId: "confirm-1",
        fingerprint: "fingerprint-1",
      };
    },
    consume(input) {
      assert.equal(input.confirmationId, "confirm-1");
      assert.equal(input.fingerprint, "fingerprint-1");
    },
  };
  const gateway = createActionGateway({ registry, confirmationController });
  const context = {
    states: ["map_ready"],
    revision: 3,
    registeredTargetIds: ["event:1"],
  };
  const first = await gateway.execute(
    "navigation.openexternal",
    { targetId: "event:1" },
    context,
    {
      proposalRevision: 3,
      targetIds: ["event:1"],
      effectSummary: "Open Event 1 in a new tab",
    },
  );

  assert.equal(first.status, "confirmation_required");
  assert.equal(first.capabilityId, "navigation.openexternal");
  assert.equal(executions, 0);
  await assert.rejects(
    gateway.execute(
      "navigation.openexternal",
      { targetId: "event:1" },
      context,
      { proposalRevision: 3, targetIds: ["event:1"] },
    ),
    (error) => error.code === "dependent_call_blocked",
  );

  const completed = await gateway.execute(
    "navigation.openexternal",
    { targetId: "event:1" },
    context,
    {
      proposalRevision: 3,
      targetIds: ["event:1"],
      confirmation: {
        confirmationId: "confirm-1",
        fingerprint: "fingerprint-1",
      },
    },
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.data.opened, true);
  assert.equal(executions, 1);
});

test("terminal confirmation dismissal releases only the matching dependent-call lock", async () => {
  const consequential = capability({
    capabilityId: "navigation.openexternal",
    description: "Open the approved event reference",
    confirmationClass: "consequential",
    argumentSchema: closed({
      targetId: { type: "string", minLength: 1, maxLength: 256 },
    }),
    resultSchema: closed({
      opened: { type: "boolean" },
    }),
  });
  const registry = registryWith({
    contracts: [consequential, capability()],
  });
  const confirmationController = {
    request() {
      return {
        confirmationId: "confirm-1",
        fingerprint: "fingerprint-1",
      };
    },
  };
  const gateway = createActionGateway({ registry, confirmationController });
  const context = {
    states: ["map_ready"],
    revision: 3,
    zoom: 10,
    registeredTargetIds: ["event:1"],
  };

  await gateway.execute(
    "navigation.openexternal",
    { targetId: "event:1" },
    context,
    { proposalRevision: 3, targetIds: ["event:1"] },
  );

  assert.equal(
    gateway.releasePendingConfirmation({
      confirmationId: "stale-confirmation",
      fingerprint: "fingerprint-1",
    }),
    false,
  );
  await assert.rejects(
    gateway.execute("map.zoomin", { steps: 1 }, context, {
      proposalRevision: 3,
    }),
    (error) => error.code === "dependent_call_blocked",
  );

  assert.equal(
    gateway.releasePendingConfirmation({
      confirmationId: "confirm-1",
      fingerprint: "fingerprint-1",
    }),
    true,
  );
  const completed = await gateway.execute("map.zoomin", { steps: 1 }, context, {
    proposalRevision: 3,
  });
  assert.equal(completed.status, "completed");
});

test("v2 gateway serializes concurrent dependent invocations", async () => {
  let active = 0;
  let maxActive = 0;
  const registry = registryWith({
    execute: async (_id, { steps }, context) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { zoom: context.zoom + steps };
    },
  });
  const gateway = createActionGateway({ registry });
  const context = { states: ["map_ready"], revision: 4, zoom: 10 };

  await Promise.all([
    gateway.execute("map.zoomin", { steps: 1 }, context, {
      proposalRevision: 4,
    }),
    gateway.execute("map.zoomin", { steps: 2 }, context, {
      proposalRevision: 4,
    }),
  ]);
  assert.equal(maxActive, 1);
});
