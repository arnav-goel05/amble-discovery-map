import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_ACTION_PARITY_CASES } from "../activity-scenes/assistant/actions/index.js";
import {
  COMPATIBILITY_ALIAS_IDS,
  CONDITIONAL_PREFIXES,
  PROTECTED_LIFECYCLE_IDS,
  auditCapabilityCoverage,
  auditEnvironmentParity,
  auditObservableParity,
  createRuntimeCapabilityDefinitions,
  loadCoverageInputs,
} from "../scripts/verify-voice-action-coverage.mjs";

const inputs = loadCoverageInputs();
const EXPECTED_CURRENT_INVENTORY_DRIFT = [
  "event.removefilter",
  "event.selectoccurrence",
  "event.setfilter",
  "event.setsessionsexpanded",
  "navigation.closeattribution",
  "navigation.openattribution",
  "navigation.openattributionreference",
];

const isConditional = (capabilityId) =>
  CONDITIONAL_PREFIXES.some((prefix) => capabilityId.startsWith(prefix));

test("reviewed inventory defines 75 version-2 command rows with direct owners", () => {
  assert.equal(inputs.inventory.length, 75);
  assert.equal(
    new Set(inputs.inventory.map(({ actionId }) => actionId)).size,
    inputs.inventory.length,
  );
  for (const entry of inputs.inventory) {
    assert.match(entry.release, /^(?:existing|004(?: amendment)?)$/);
    assert.ok(entry.arguments, `${entry.actionId} lacks arguments`);
    assert.ok(entry.eligibleState, `${entry.actionId} lacks eligibility`);
    assert.ok(entry.contextProvider, `${entry.actionId} lacks context`);
    assert.match(entry.confirmationClass, /^(reversible|consequential)$/);
    assert.ok(entry.result, `${entry.actionId} lacks an observable result`);
    assert.ok(
      entry.directControlOwner,
      `${entry.actionId} lacks a direct owner`,
    );
  }
});

test("capability audit compiles every current v2 contract and bounds known inventory drift", () => {
  const definitions = createRuntimeCapabilityDefinitions();
  const report = auditCapabilityCoverage({
    ...inputs,
    definitions,
  });

  assert.equal(report.inventoryCount, 75);
  assert.equal(report.activeInventoryCount, 61);
  assert.equal(report.capabilityCount, 64 - report.missingCapabilityIds.length);
  assert.deepEqual(report.schemaFailures, []);
  assert.deepEqual(report.duplicateCapabilityIds, []);
  assert.deepEqual(report.duplicateExecutorIds, []);
  assert.deepEqual(report.unlistedCapabilityIds, []);
  assert.deepEqual(report.mcpProjectionFailures, []);
  assert.equal(report.canonicalComposerStateCovered, true);
  assert.equal(report.mcpRuntimeInactive, true);
  assert.equal(
    report.missingCapabilityIds.every((capabilityId) =>
      EXPECTED_CURRENT_INVENTORY_DRIFT.includes(capabilityId),
    ),
    true,
  );
  assert.deepEqual(report.orphanDirectControlIds, report.missingCapabilityIds);
  assert.equal(report.complete, report.missingCapabilityIds.length === 0);
});

test("conditional content and protected browser lifecycle controls are not capabilities", () => {
  const definitions = createRuntimeCapabilityDefinitions();
  const report = auditCapabilityCoverage({
    ...inputs,
    definitions,
  });
  const capabilityIds = definitions.map(
    ({ contract }) => contract.capabilityId,
  );

  assert.deepEqual(report.conditionalCapabilityIds, []);
  assert.deepEqual(report.protectedCapabilityIds, []);
  assert.equal(
    capabilityIds.some(isConditional),
    false,
    "empty saved/game extensions must not be registered",
  );
  for (const protectedId of PROTECTED_LIFECYCLE_IDS)
    assert.equal(capabilityIds.includes(protectedId), false);
  for (const aliasId of COMPATIBILITY_ALIAS_IDS)
    assert.equal(
      capabilityIds.includes(aliasId),
      false,
      `${aliasId} must not be independently advertised`,
    );
});

test("coverage rejects duplicate executors and orphan direct controls", () => {
  const definitions = createRuntimeCapabilityDefinitions();
  const omitted = definitions[0].contract.capabilityId;
  const reduced = definitions.slice(1);
  const executorOwners = reduced.map(({ contract }) => ({
    capabilityId: contract.capabilityId,
    owner: `${contract.connectorId}:primary`,
  }));
  executorOwners.push(
    {
      capabilityId: reduced[0].contract.capabilityId,
      owner: "duplicate:first",
    },
    {
      capabilityId: reduced[0].contract.capabilityId,
      owner: "duplicate:second",
    },
  );
  const report = auditCapabilityCoverage({
    ...inputs,
    definitions: reduced,
    executorOwners,
  });

  assert.equal(report.complete, false);
  assert.ok(report.orphanDirectControlIds.includes(omitted));
  assert.deepEqual(report.duplicateExecutorIds, [
    reduced[0].contract.capabilityId,
  ]);
});

test("direct and conversational entry points share observable outcomes for every current executor", async () => {
  const results = new Map(
    PUBLIC_ACTION_PARITY_CASES.map(({ actionId, result }) => [
      actionId,
      structuredClone(result),
    ]),
  );
  const definitions = createRuntimeCapabilityDefinitions({
    dispatch(capabilityId) {
      return structuredClone(results.get(capabilityId) || { changed: true });
    },
  });
  const report = await auditObservableParity({ definitions });

  assert.equal(report.complete, true);
  assert.equal(report.checkedCount, definitions.length);
  assert.deepEqual(report.failedActionIds, []);
  assert.deepEqual(report.missingActionIds, []);
});

test("local, test, preview, and production fixtures retain exact capability parity", () => {
  assert.deepEqual(
    auditEnvironmentParity({
      contractFixture: inputs.contractFixture,
      resultFixture: inputs.resultFixture,
      environmentFixture: inputs.environmentFixture,
    }),
    { complete: true, failures: [] },
  );
});
