import assert from "node:assert/strict";
import test from "node:test";

import {
  projectCapabilityDescriptor,
  projectCapabilityDescriptors,
} from "../activity-scenes/assistant/protocol-adapters/capability-descriptor-projector.js";
import {
  invokeRealtimeFunctionFixture,
  projectAvailableRealtimeFunctionTools,
  projectRealtimeFunctionTool,
} from "../activity-scenes/assistant/protocol-adapters/realtime-function-adapter.js";
import {
  invokeMcpFoundationFixture,
  projectAvailableMcpFoundationDescriptors,
  projectMcpFoundationDescriptor,
} from "../activity-scenes/assistant/protocol-adapters/mcp-foundation-adapter.js";

const argumentSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 120 },
  },
});

const resultSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      maxItems: 20,
      items: { type: "string", maxLength: 100 },
    },
  },
});

const queryContract = Object.freeze({
  capabilityId: "catalog.search",
  version: "2.0",
  kind: "query",
  description: "Search the approved bounded catalogue.",
  connectorId: "approved-catalog",
  argumentSchema,
  eligibleStates: Object.freeze(["application_initialized"]),
  confirmationClass: "none",
  contextProvider: "approved-catalog",
  resultSchema,
});

const commandContract = Object.freeze({
  capabilityId: "map.reset",
  version: "2.0",
  kind: "command",
  description: "Reset the map camera.",
  connectorId: "map",
  argumentSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: {},
  }),
  eligibleStates: Object.freeze(["map_ready"]),
  confirmationClass: "reversible",
  contextProvider: "map",
  resultSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["camera"],
    properties: {
      camera: { type: "string", enum: ["default"] },
    },
  }),
});

function registryFixture() {
  return Object.freeze({
    available(context = {}) {
      const states = new Set(context.states || []);
      return [commandContract, queryContract].filter((contract) =>
        contract.eligibleStates.some((state) => states.has(state)),
      );
    },
  });
}

test("the neutral projector preserves version-2 contract semantics without an executor", () => {
  const descriptor = projectCapabilityDescriptor(queryContract);

  assert.deepEqual(descriptor, {
    capabilityId: queryContract.capabilityId,
    version: queryContract.version,
    kind: queryContract.kind,
    name: queryContract.capabilityId,
    description: queryContract.description,
    connectorId: queryContract.connectorId,
    inputSchema: queryContract.argumentSchema,
    resultSchema: queryContract.resultSchema,
    eligibleStates: queryContract.eligibleStates,
    confirmationClass: queryContract.confirmationClass,
    contextProvider: queryContract.contextProvider,
  });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.inputSchema), true);
  assert.notEqual(descriptor.inputSchema, queryContract.argumentSchema);
  assert.equal("execute" in descriptor, false);
  assert.equal("query" in descriptor, false);
});

test("descriptor projection is deterministic and retains caller order", () => {
  const first = projectCapabilityDescriptors([queryContract, commandContract]);
  const second = projectCapabilityDescriptors([queryContract, commandContract]);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map(({ capabilityId }) => capabilityId),
    ["catalog.search", "map.reset"],
  );
  assert.equal(Object.isFrozen(first), true);
});

test("Realtime tools preserve protocol-1.1 provider shape and current eligibility", () => {
  assert.deepEqual(projectRealtimeFunctionTool(queryContract), {
    type: "function",
    name: queryContract.capabilityId,
    description: queryContract.description,
    parameters: queryContract.argumentSchema,
  });

  const tools = projectAvailableRealtimeFunctionTools(registryFixture(), {
    states: ["map_ready"],
  });
  assert.deepEqual(
    tools.map(({ name }) => name),
    ["map.reset"],
  );
  assert.equal(Object.isFrozen(tools), true);
});

test("MCP foundation descriptors remain disabled and preserve contract policy", () => {
  const descriptor = projectMcpFoundationDescriptor(commandContract);

  assert.deepEqual(descriptor, {
    protocol: "mcp_foundation",
    enabled: false,
    capabilityId: commandContract.capabilityId,
    version: commandContract.version,
    kind: commandContract.kind,
    name: commandContract.capabilityId,
    description: commandContract.description,
    connectorId: commandContract.connectorId,
    inputSchema: commandContract.argumentSchema,
    resultSchema: commandContract.resultSchema,
    eligibleStates: commandContract.eligibleStates,
    confirmationClass: commandContract.confirmationClass,
    contextProvider: commandContract.contextProvider,
  });
  assert.equal("handler" in descriptor, false);
  assert.equal("route" in descriptor, false);
  assert.equal("listener" in descriptor, false);
  assert.equal("credential" in descriptor, false);

  const descriptors = projectAvailableMcpFoundationDescriptors(
    registryFixture(),
    { states: ["application_initialized"] },
  );
  assert.deepEqual(
    descriptors.map(({ capabilityId }) => capabilityId),
    ["catalog.search"],
  );
  assert.ok(descriptors.every(({ enabled }) => enabled === false));
});

test("Realtime and MCP fixture invocations use only the supplied shared gateway", async () => {
  const calls = [];
  const connector = {
    execute() {
      assert.fail("projection adapters must never execute a connector");
    },
  };
  const result = Object.freeze({
    capabilityId: "catalog.search",
    kind: "query",
    status: "completed",
    changed: null,
    affectedTargetIds: [],
    contextRevision: 7,
    data: { items: ["event:one"] },
    errorCode: null,
  });
  const gateway = Object.freeze({
    async execute(capabilityId, argumentsValue, context, metadata) {
      calls.push({ capabilityId, argumentsValue, context, metadata });
      return result;
    },
  });
  const context = Object.freeze({
    revision: 7,
    states: Object.freeze(["application_initialized"]),
  });
  const args = Object.freeze({ query: "concert" });
  const realtimeTool = projectRealtimeFunctionTool(queryContract);
  const mcpDescriptor = projectMcpFoundationDescriptor(queryContract);

  const directResult = await gateway.execute(
    queryContract.capabilityId,
    args,
    context,
    { callerOrigin: "direct", proposalRevision: 7 },
  );
  const realtimeResult = await invokeRealtimeFunctionFixture({
    gateway,
    tool: realtimeTool,
    argumentsValue: args,
    context,
    metadata: { proposalRevision: 7 },
  });
  const mcpResult = await invokeMcpFoundationFixture({
    gateway,
    descriptor: mcpDescriptor,
    argumentsValue: args,
    context,
    metadata: { proposalRevision: 7 },
  });

  assert.deepEqual(realtimeResult, directResult);
  assert.deepEqual(mcpResult, directResult);
  assert.deepEqual(
    calls.map(({ metadata }) => metadata.callerOrigin),
    ["direct", "voice", "mcp_fixture"],
  );
  assert.ok(
    calls.every(
      ({ capabilityId, argumentsValue }) =>
        capabilityId === "catalog.search" && argumentsValue.query === "concert",
    ),
  );
  assert.equal(typeof connector.execute, "function");
});

test("fixture invocation rejects active MCP descriptors and missing gateways", async () => {
  const descriptor = {
    ...projectMcpFoundationDescriptor(queryContract),
    enabled: true,
  };

  await assert.rejects(
    invokeMcpFoundationFixture({
      gateway: { execute: async () => ({}) },
      descriptor,
    }),
    /disabled MCP foundation descriptor/,
  );
  await assert.rejects(
    invokeMcpFoundationFixture({
      gateway: {},
      descriptor: projectMcpFoundationDescriptor(queryContract),
    }),
    /shared capability gateway/,
  );
});
