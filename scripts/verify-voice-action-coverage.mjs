import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePublicActionInventory,
  verifyDirectVoiceParity,
} from "../activity-scenes/assistant/action-coverage.js";
import {
  createPublicActionContracts,
  PUBLIC_ACTION_PARITY_CASES,
} from "../activity-scenes/assistant/actions/index.js";
import { compileSchema } from "../activity-scenes/assistant/capability-result.js";
import { createCapabilityRegistry } from "../activity-scenes/assistant/capability-registry.js";
import {
  EVENT_APPLY_QUERY_CAPABILITY_CONTRACT,
  createLegacyCommandCapabilityDefinitions,
  createLegacyConnectorDescriptors,
} from "../activity-scenes/assistant/connectors/index.js";
import {
  fromProviderFunctionName,
  projectRealtimeFunctionTools,
} from "../activity-scenes/assistant/protocol-adapters/realtime-function-adapter.js";
import { projectMcpFoundationDescriptors } from "../activity-scenes/assistant/protocol-adapters/mcp-foundation-adapter.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/voice", name), "utf8"),
  );
const duplicates = (values) =>
  [
    ...new Set(
      values.filter((value, index) => values.indexOf(value) !== index),
    ),
  ].sort();
const sort = (values) => [...values].sort();

export const CONDITIONAL_PREFIXES = Object.freeze(["game.", "saved."]);
export const COMPATIBILITY_ALIAS_IDS = Object.freeze([
  "event.setcategory",
  "event.setdaterange",
  "event.setpricerange",
]);
export const PROTECTED_LIFECYCLE_IDS = Object.freeze([
  "session.consent",
  "session.confirm",
  "session.interrupt",
  "session.mute",
  "session.pushtotalk",
  "session.stop",
  "session.unmute",
]);

const isConditional = (capabilityId) =>
  CONDITIONAL_PREFIXES.some((prefix) => capabilityId.startsWith(prefix));
const isCompatibilityAlias = (capabilityId) =>
  COMPATIBILITY_ALIAS_IDS.includes(capabilityId);

export function loadCoverageInputs() {
  const inventory = parsePublicActionInventory(
    fs.readFileSync(
      path.join(
        root,
        "specs/004-conversational-voice-map/contracts/public-action-inventory.md",
      ),
      "utf8",
    ),
  );
  return {
    inventory,
    contractFixture: fixture("capability-contracts.json"),
    resultFixture: fixture("capability-results.json"),
    environmentFixture: fixture("environment-parity.json"),
  };
}

export function createRuntimeCapabilityDefinitions({
  dispatch = () => ({ changed: true }),
} = {}) {
  const actionContracts = createPublicActionContracts({ dispatch });
  const commands = createLegacyCommandCapabilityDefinitions(
    actionContracts,
  ).filter(
    ({ contract }) =>
      !isConditional(contract.capabilityId) &&
      !isCompatibilityAlias(contract.capabilityId),
  );
  return [
    ...commands,
    {
      contract: EVENT_APPLY_QUERY_CAPABILITY_CONTRACT,
      runtime: {
        execute(argumentsValue) {
          return {
            changed: true,
            data: {
              outcome: "applied",
              canonicalSentence: argumentsValue.text,
              residualQuery: argumentsValue.text,
              phrases: [],
              clarificationChoices: [],
              catalogRevision: argumentsValue.catalogRevision,
              resultCount: 0,
            },
          };
        },
      },
    },
  ];
}

function foundationalDefinitions(contractFixture) {
  return contractFixture.capabilities
    .filter(({ kind }) => kind === "query")
    .map((contract) => ({
      contract,
      runtime: {
        query() {
          return null;
        },
      },
    }));
}

export function auditEnvironmentParity({
  contractFixture,
  resultFixture,
  environmentFixture,
}) {
  const expected = environmentFixture.expected;
  const environmentIds = environmentFixture.environments.map(
    ({ environmentId }) => environmentId,
  );
  const failures = [];
  if (
    JSON.stringify(sort(environmentIds)) !==
    JSON.stringify(sort(environmentFixture.requiredEnvironmentIds))
  )
    failures.push("environment_ids");
  if (
    JSON.stringify(contractFixture.registeredConnectorIds) !==
    JSON.stringify(expected.registeredConnectorIds)
  )
    failures.push("connector_fixture");
  const resultFixtureIds = sort(
    resultFixture.results.map(({ fixtureId }) => fixtureId),
  );
  for (const environment of environmentFixture.environments) {
    const observed = environment.observed;
    if (observed.contractFixtureId !== contractFixture.fixtureSetId)
      failures.push(`${environment.environmentId}:contract`);
    for (const field of [
      "registeredConnectorIds",
      "unregisteredConnectorIds",
      "excludedExternalConnectorIds",
      "capabilityIds",
      "resultFixtureIds",
    ]) {
      const expectedValue =
        field === "resultFixtureIds" ? resultFixtureIds : expected[field];
      if (
        JSON.stringify(sort(observed[field] || [])) !==
        JSON.stringify(sort(expectedValue || []))
      )
        failures.push(`${environment.environmentId}:${field}`);
    }
  }
  return { complete: failures.length === 0, failures };
}

export function auditCapabilityCoverage({
  inventory,
  definitions,
  contractFixture,
  resultFixture,
  environmentFixture,
  executorOwners = null,
} = {}) {
  const activeInventory = inventory.filter(
    ({ actionId }) =>
      !isConditional(actionId) && !isCompatibilityAlias(actionId),
  );
  const foundational = foundationalDefinitions(contractFixture);
  const allDefinitions = [...foundational, ...definitions];
  const inventoryIds = activeInventory.map(({ actionId }) => actionId);
  const expectedIds = [
    ...contractFixture.capabilities
      .filter(({ kind }) => kind === "query")
      .map(({ capabilityId }) => capabilityId),
    ...inventoryIds,
  ];
  const actualIds = allDefinitions.map(({ contract }) => contract.capabilityId);
  const expectedSet = new Set(expectedIds);
  const actualSet = new Set(actualIds);
  const missingCapabilityIds = [...expectedSet]
    .filter((id) => !actualSet.has(id))
    .sort();
  const unlistedCapabilityIds = [...actualSet]
    .filter((id) => !expectedSet.has(id))
    .sort();
  const orphanDirectControlIds = inventoryIds
    .filter((id) => !actualSet.has(id))
    .sort();
  const conditionalCapabilityIds = actualIds.filter(isConditional).sort();
  const protectedCapabilityIds = actualIds
    .filter(
      (id) => id.startsWith("session.") || PROTECTED_LIFECYCLE_IDS.includes(id),
    )
    .sort();
  const schemaFailures = [];
  for (const { contract } of allDefinitions) {
    try {
      compileSchema(contract.argumentSchema);
      compileSchema(contract.resultSchema);
      if (contract.version !== "2.0")
        schemaFailures.push(`${contract.capabilityId}:version`);
    } catch (error) {
      schemaFailures.push(`${contract.capabilityId}:${error.code || "schema"}`);
    }
  }
  const owners =
    executorOwners ||
    allDefinitions.map(({ contract, runtime }) => ({
      capabilityId: contract.capabilityId,
      owner: `${contract.connectorId}:${
        runtime?.execute ? "execute" : "query"
      }`,
    }));
  const ownershipCounts = new Map();
  for (const { capabilityId, owner } of owners) {
    const records = ownershipCounts.get(capabilityId) || [];
    records.push(owner);
    ownershipCounts.set(capabilityId, records);
  }
  const missingExecutorIds = [...actualSet]
    .filter((capabilityId) => !ownershipCounts.has(capabilityId))
    .sort();
  const duplicateExecutorIds = [...actualSet]
    .filter(
      (capabilityId) => (ownershipCounts.get(capabilityId) || []).length > 1,
    )
    .sort();
  const environmentParity = auditEnvironmentParity({
    contractFixture,
    resultFixture,
    environmentFixture,
  });
  const contracts = allDefinitions.map(({ contract }) => contract);
  const realtimeTools = projectRealtimeFunctionTools(contracts);
  const mcpDescriptors = projectMcpFoundationDescriptors(contracts);
  const mcpProjectionFailures = [];
  for (const [index, descriptor] of mcpDescriptors.entries()) {
    const contract = contracts[index];
    const realtime = realtimeTools[index];
    if (
      descriptor.enabled !== false ||
      descriptor.capabilityId !== contract.capabilityId ||
      descriptor.name !== fromProviderFunctionName(realtime.name) ||
      descriptor.description !== realtime.description ||
      JSON.stringify(descriptor.inputSchema) !==
        JSON.stringify(realtime.parameters) ||
      JSON.stringify(descriptor.resultSchema) !==
        JSON.stringify(contract.resultSchema) ||
      descriptor.confirmationClass !== contract.confirmationClass ||
      descriptor.contextProvider !== contract.contextProvider
    )
      mcpProjectionFailures.push(contract.capabilityId);
  }
  const appInspectSchema = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "specs/004-conversational-voice-map/contracts/app-inspect-result.schema.json",
      ),
      "utf8",
    ),
  );
  const canonicalComposerStateCovered = Boolean(
    appInspectSchema.properties?.activeFilters?.properties?.eventComposerState,
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  const cloudflareSource = fs
    .readdirSync(path.join(root, "cloudflare"))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => fs.readFileSync(path.join(root, "cloudflare", name), "utf8"))
    .join("\n");
  const mcpRuntimeInactive =
    dependencyNames.every(
      (name) => !/(?:^|[/@_-])mcp(?:$|[/@_-])|modelcontextprotocol/i.test(name),
    ) &&
    !/[\"'`]\/mcp(?:[/?\"'`]|$)|\bMCP_(?:URL|TOKEN|SECRET|KEY)\b/.test(
      cloudflareSource,
    );
  const report = {
    inventoryCount: inventory.length,
    activeInventoryCount: activeInventory.length,
    capabilityCount: actualIds.length,
    missingCapabilityIds,
    unlistedCapabilityIds,
    orphanDirectControlIds,
    duplicateCapabilityIds: duplicates(actualIds),
    missingExecutorIds,
    duplicateExecutorIds,
    conditionalCapabilityIds,
    protectedCapabilityIds,
    schemaFailures,
    environmentParity,
    mcpProjectionFailures,
    canonicalComposerStateCovered,
    mcpRuntimeInactive,
  };
  report.complete =
    environmentParity.complete &&
    Object.entries(report)
      .filter(([key, value]) => key.endsWith("Ids") && Array.isArray(value))
      .every(([, value]) => value.length === 0) &&
    schemaFailures.length === 0 &&
    mcpProjectionFailures.length === 0 &&
    canonicalComposerStateCovered &&
    mcpRuntimeInactive;
  return report;
}

export async function auditObservableParity({
  definitions,
  parityCases = [
    ...PUBLIC_ACTION_PARITY_CASES,
    {
      actionId: "event.applyquery",
      argumentsValue: {
        text: "free events",
        mode: "replace",
        baseContextRevision: 1,
        catalogRevision: "fixture-catalog",
      },
      context: { states: ["application_ready"], revision: 1 },
    },
  ],
} = {}) {
  const activeCases = parityCases.filter(
    ({ actionId }) =>
      !isConditional(actionId) && !isCompatibilityAlias(actionId),
  );
  const connectors = createLegacyConnectorDescriptors(definitions);
  const capabilityRegistry = createCapabilityRegistry({
    connectors,
    capabilities: definitions,
  });
  return verifyDirectVoiceParity({
    registry: capabilityRegistry,
    parityCases: activeCases,
  });
}

export async function runVoiceCapabilityAudit() {
  const inputs = loadCoverageInputs();
  const parityResults = new Map(
    PUBLIC_ACTION_PARITY_CASES.map(({ actionId, result }) => [
      actionId,
      structuredClone(result),
    ]),
  );
  const definitions = createRuntimeCapabilityDefinitions({
    dispatch(capabilityId) {
      return structuredClone(
        parityResults.get(capabilityId) || { changed: true },
      );
    },
  });
  const coverage = auditCapabilityCoverage({
    ...inputs,
    definitions,
  });
  const parity = await auditObservableParity({ definitions });
  return {
    complete: coverage.complete && parity.complete,
    coverage,
    parity,
  };
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const report = await runVoiceCapabilityAudit();
  if (!report.complete) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      `Voice capability coverage verified: ${report.coverage.capabilityCount} v2 capabilities and ${report.parity.checkedCount} direct/conversational parity cases.`,
    );
  }
}
