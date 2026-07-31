import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCapabilityRegistry } from "../activity-scenes/assistant/capability-registry.js";

const loadFixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`fixtures/voice/${name}`, import.meta.url), "utf8"),
  );

const contractFixture = loadFixture("capability-contracts.json");
const resultFixture = loadFixture("capability-results.json");
const parityFixture = loadFixture("environment-parity.json");

const sort = (values) => [...values].sort();
const contractById = new Map(
  contractFixture.capabilities.map((contract) => [
    contract.capabilityId,
    contract,
  ]),
);
const resultById = new Map(
  resultFixture.results.map((entry) => [entry.fixtureId, entry]),
);

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function assertBoundedSchema(schema, path = "$") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) {
    assert.equal(
      schema.additionalProperties,
      false,
      `${path} must be a closed object`,
    );
  }
  if (types.includes("array")) {
    assert.ok(Number.isInteger(schema.maxItems), `${path} must have maxItems`);
  }
  if (
    types.includes("string") &&
    !Number.isInteger(schema.maxLength) &&
    !Array.isArray(schema.enum)
  ) {
    assert.fail(`${path} must have maxLength or a finite enum`);
  }

  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    assertBoundedSchema(value, `${path}.properties.${key}`);
  }
  if (schema.items) assertBoundedSchema(schema.items, `${path}.items`);
  for (const [key, value] of Object.entries(schema.$defs ?? {})) {
    assertBoundedSchema(value, `${path}.$defs.${key}`);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    for (const [index, value] of (schema[keyword] ?? []).entries()) {
      assertBoundedSchema(value, `${path}.${keyword}[${index}]`);
    }
  }
}

function assertNoPrivateLocation(value, path = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(
      key,
      /^(?:coordinates|latitude|longitude|lat|lng|accuracyMeters)$/i,
      `${path}.${key} exposes exact location`,
    );
    assertNoPrivateLocation(child, `${path}.${key}`);
  }
}

test("capability fixtures define the canonical connector boundary and bounded contracts", () => {
  assert.equal(contractFixture.protocolVersion, "1.1");
  assert.deepEqual(
    contractFixture.registeredConnectorIds,
    parityFixture.expected.registeredConnectorIds,
  );
  assert.equal(contractFixture.conditionalConnector.registered, false);
  assert.equal(
    contractFixture.conditionalConnector.connectorId,
    "conditional-content",
  );
  assert.deepEqual(
    contractFixture.excludedExternalConnectorIds,
    parityFixture.expected.excludedExternalConnectorIds,
  );

  assertUnique(contractFixture.registeredConnectorIds, "connector IDs");
  assertUnique(
    contractFixture.capabilities.map(({ capabilityId }) => capabilityId),
    "capability IDs",
  );

  for (const contract of contractFixture.capabilities) {
    assert.match(
      contract.capabilityId,
      /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/,
    );
    assert.equal(contract.version, "2.0");
    assert.match(contract.kind, /^(?:query|command)$/);
    assert.ok(
      contractFixture.registeredConnectorIds.includes(contract.connectorId),
      `${contract.capabilityId} uses an unregistered connector`,
    );
    assert.ok(contract.eligibleStates.length > 0);
    assertUnique(contract.eligibleStates, `${contract.capabilityId} states`);
    if (contract.kind === "query") {
      assert.equal(contract.confirmationClass, "none");
    }
    assertBoundedSchema(
      contract.argumentSchema,
      `${contract.capabilityId}.argumentSchema`,
    );
    assertBoundedSchema(
      contract.resultSchema,
      `${contract.capabilityId}.resultSchema`,
    );
  }
});

test("result fixtures preserve envelope, catalogue, context, and confirmation invariants", () => {
  assert.equal(resultFixture.protocolVersion, "1.1");
  assertUnique(
    resultFixture.results.map(({ fixtureId }) => fixtureId),
    "result fixture IDs",
  );

  for (const entry of resultFixture.results) {
    const contract = contractById.get(entry.result.capabilityId);
    assert.ok(contract, `${entry.fixtureId} references an unknown capability`);
    assert.equal(entry.result.kind, contract.kind);
    assert.ok(Number.isInteger(entry.result.contextRevision));
    assert.ok(entry.result.contextRevision >= 0);
    assert.ok(entry.result.affectedTargetIds.length <= 20);
    assertUnique(
      entry.result.affectedTargetIds,
      `${entry.fixtureId} affected targets`,
    );

    if (contract.kind === "query") {
      assert.equal(entry.result.changed, null);
    } else {
      assert.equal(typeof entry.result.changed, "boolean");
      if (entry.result.changed) {
        assert.ok(entry.result.contextRevision > entry.proposalRevision);
      } else {
        assert.equal(entry.result.contextRevision, entry.proposalRevision);
      }
    }
    assertNoPrivateLocation(entry.result);
  }

  const search = resultById.get("catalog-search-page").result.data;
  assert.equal(search.truncated, search.total > search.items.length);
  assert.equal(search.nextCursor !== null, search.truncated);
  assert.ok(search.items.length <= 20);
  assert.ok(search.sources.length <= 12);

  const inspect = resultById.get("inspect-ready").result.data;
  assert.ok(inspect.visibleTargets.length <= 50);
  assert.ok(inspect.selectedTargetIds.length <= 20);
  assertUnique(inspect.availableCapabilityIds, "available capability IDs");

  const confirmation = resultFixture.confirmationCases[0];
  assert.equal(
    confirmation.pendingConfirmation.callId,
    confirmation.acceptedTransition.callId,
  );
  assert.equal(
    confirmation.pendingConfirmation.fingerprint,
    confirmation.acceptedTransition.fingerprint,
  );
  assert.equal(confirmation.acceptedTransition.executionCount, 1);
  assert.notEqual(
    confirmation.pendingConfirmation.fingerprint,
    confirmation.conflictingReplay.fingerprint,
  );
  assert.equal(confirmation.conflictingReplay.executionCount, 0);
});

test("local, test, preview, and production observations have exact semantic parity", () => {
  assert.deepEqual(
    sort(parityFixture.environments.map(({ environmentId }) => environmentId)),
    sort(parityFixture.requiredEnvironmentIds),
  );
  assertUnique(
    parityFixture.environments.map(({ environmentId }) => environmentId),
    "environment IDs",
  );

  const expectedEligibilityIds = sort(
    parityFixture.expected.eligibilityCases.map(({ fixtureId }) => fixtureId),
  );
  for (const environment of parityFixture.environments) {
    const { observed } = environment;
    assert.equal(observed.contractFixtureId, contractFixture.fixtureSetId);
    assert.deepEqual(
      observed.registeredConnectorIds,
      parityFixture.expected.registeredConnectorIds,
    );
    assert.deepEqual(
      observed.unregisteredConnectorIds,
      parityFixture.expected.unregisteredConnectorIds,
    );
    assert.deepEqual(
      observed.excludedExternalConnectorIds,
      parityFixture.expected.excludedExternalConnectorIds,
    );
    assert.deepEqual(
      observed.capabilityIds,
      parityFixture.expected.capabilityIds,
    );
    assert.deepEqual(
      sort(observed.eligibilityFixtureIds),
      expectedEligibilityIds,
    );
    assert.deepEqual(
      observed.resultFixtureIds,
      parityFixture.expected.resultFixtureIds,
    );
  }
});

test("the shared registry exposes the same IDs, versions, kinds, schemas, and eligibility", () => {
  const registry = createCapabilityRegistry({
    connectors: contractFixture.registeredConnectorIds.map((connectorId) => ({
      connectorId,
    })),
    capabilities: contractFixture.capabilities.map((contract) => ({
      contract,
      [contract.kind === "query" ? "query" : "execute"]() {
        return null;
      },
    })),
  });

  assert.deepEqual(registry.ids(), parityFixture.expected.capabilityIds);
  for (const expected of contractFixture.capabilities) {
    const actual = registry.get(expected.capabilityId);
    assert.equal(actual.capabilityId, expected.capabilityId);
    assert.equal(actual.version, expected.version);
    assert.equal(actual.kind, expected.kind);
    assert.equal(actual.connectorId, expected.connectorId);
    assert.deepEqual(actual.argumentSchema, expected.argumentSchema);
    assert.deepEqual(actual.resultSchema, expected.resultSchema);
  }

  for (const eligibilityCase of parityFixture.expected.eligibilityCases) {
    assert.deepEqual(
      registry
        .available({ states: eligibilityCase.states })
        .map(({ capabilityId }) => capabilityId)
        .sort(),
      eligibilityCase.eligibleCapabilityIds,
    );
  }
});
