import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CapabilityRegistryError,
  createCapabilityRegistry,
} from "../activity-scenes/assistant/capability-registry.js";
import { createActionRegistry } from "../activity-scenes/assistant/action-registry.js";
import {
  compileSchema,
  SchemaContractError,
} from "../activity-scenes/assistant/capability-result.js";

const closed = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

const command = (overrides = {}) => ({
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
});

test("all checked-in capability schemas compile as Draft 2020-12", async () => {
  const names = [
    "capability-contract",
    "capability-result",
    "app-inspect-result",
    "catalog-get-result",
    "catalog-search-result",
    "discovery-result",
  ];
  for (const name of names) {
    const url = new URL(
      `../specs/004-conversational-voice-map/contracts/${name}.schema.json`,
      import.meta.url,
    );
    const schema = JSON.parse(await readFile(url, "utf8"));
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.doesNotThrow(() =>
      compileSchema(schema, {
        requireClosedRoot: false,
        requireBounds: false,
      }),
    );
  }
});

test("compileSchema validates closed and bounded Draft 2020-12 schemas", () => {
  const validate = compileSchema(
    closed({
      label: { type: "string", maxLength: 20 },
      ids: {
        type: "array",
        maxItems: 3,
        items: { type: "string", maxLength: 32 },
      },
    }),
  );

  assert.equal(validate({ label: "Marina Bay", ids: ["event:1"] }).valid, true);
  assert.equal(
    validate({ label: "Marina Bay", ids: ["1", "2", "3", "4"] }).valid,
    false,
  );
});

test("compileSchema rejects open roots, unbounded branches, and unsupported drafts", () => {
  for (const schema of [
    { type: "object", properties: {} },
    closed({ text: { type: "string" } }),
    closed({ values: { type: "array", items: { type: "boolean" } } }),
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      ...closed({}),
    },
  ]) {
    assert.throws(
      () => compileSchema(schema),
      (error) =>
        error instanceof SchemaContractError &&
        error.code === "invalid_schema_contract",
    );
  }
});

test("registry enforces connector ownership, unique IDs, and immutable contracts", () => {
  const registry = createCapabilityRegistry({
    connectors: [
      {
        connectorId: "map",
        execute: async (_id, { steps }, context) => ({
          zoom: context.zoom + steps,
        }),
      },
    ],
  });
  const registered = registry.register(command());

  assert.equal(registered.capabilityId, "map.zoomin");
  assert.deepEqual(registry.ids(), ["map.zoomin"]);
  assert.throws(() => registered.eligibleStates.push("other"), TypeError);
  assert.throws(
    () => registry.register(command()),
    (error) =>
      error instanceof CapabilityRegistryError &&
      error.code === "duplicate_capability",
  );
  assert.throws(
    () =>
      registry.register(
        command({
          capabilityId: "map.zoomout",
          connectorId: "missing",
        }),
      ),
    (error) => error.code === "unknown_connector",
  );
});

test("registry derives eligibility from state and connector policy", () => {
  const registry = createCapabilityRegistry({
    connectors: [
      {
        connectorId: "map",
        execute: async () => ({ zoom: 12 }),
        isEligible: (_contract, context) => context.mapReady === true,
      },
    ],
    capabilities: [command()],
  });

  assert.equal(
    registry.isEligible("map.zoomin", {
      states: ["map_ready"],
      mapReady: true,
    }),
    true,
  );
  assert.equal(
    registry.isEligible("map.zoomin", {
      states: ["map_ready"],
      mapReady: false,
    }),
    false,
  );
  assert.deepEqual(
    registry.available({ states: ["intro"], mapReady: true }),
    [],
  );
});

test("queries require no confirmation and commands require one runtime owner", () => {
  const registry = createCapabilityRegistry({
    connectors: [{ connectorId: "map" }],
  });
  assert.throws(
    () =>
      registry.register(
        command({
          kind: "query",
          confirmationClass: "reversible",
        }),
      ),
    (error) => error.code === "invalid_capability_contract",
  );
  assert.throws(
    () => registry.register(command()),
    (error) => error.code === "missing_executor",
  );
});

test("v2 capabilities execute directly without a generated v1 action view", async () => {
  const capabilityRegistry = createCapabilityRegistry({
    connectors: [
      {
        connectorId: "map",
        execute: async (_id, { steps }, context) => ({
          zoom: context.zoom + steps,
        }),
      },
    ],
    capabilities: [command()],
  });
  const result = await capabilityRegistry.invoke(
    "map.zoomin",
    { steps: 2 },
    { states: ["map_ready"], zoom: 10 },
  );
  assert.equal(result.capabilityId, "map.zoomin");
  assert.equal(result.kind, "command");
  assert.equal(result.status, "completed");
  assert.equal(result.changed, true);
  assert.deepEqual(result.data, { zoom: 12 });
  assert.throws(
    () => createActionRegistry(capabilityRegistry),
    (error) => error.code === "invalid_action_contract",
  );
});
