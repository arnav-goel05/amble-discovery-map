import {
  compileSchema,
  createCapabilityResultValidator,
} from "./capability-result.js";
import { projectMcpFoundationDescriptors } from "./protocol-adapters/mcp-foundation-adapter.js";
import { projectRealtimeFunctionTools } from "./protocol-adapters/realtime-function-adapter.js";

const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const CONNECTOR_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+$/;
const CONTRACT_FIELDS = new Set([
  "capabilityId",
  "version",
  "kind",
  "description",
  "connectorId",
  "argumentSchema",
  "eligibleStates",
  "confirmationClass",
  "contextProvider",
  "resultSchema",
  "undoCapabilityId",
]);

export class CapabilityRegistryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "CapabilityRegistryError";
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new CapabilityRegistryError(code, message, details);
};

function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    seen.has(value)
  )
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function validateContractShape(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract))
    fail(
      "invalid_capability_contract",
      "Capability contract must be an object",
    );
  const keys = Object.keys(contract);
  if (keys.some((key) => !CONTRACT_FIELDS.has(key)))
    fail(
      "invalid_capability_contract",
      "Capability contract contains unsupported fields",
    );
  const required = [
    "capabilityId",
    "version",
    "kind",
    "description",
    "connectorId",
    "argumentSchema",
    "eligibleStates",
    "confirmationClass",
    "contextProvider",
    "resultSchema",
  ];
  const missing = required.filter((field) => contract[field] === undefined);
  if (missing.length)
    fail(
      "invalid_capability_contract",
      `Capability contract is missing ${missing.join(", ")}`,
    );
  if (
    !CAPABILITY_ID.test(contract.capabilityId) ||
    !VERSION.test(contract.version) ||
    !CONNECTOR_ID.test(contract.connectorId)
  )
    fail(
      "invalid_capability_contract",
      "Capability identity, version, or connector identity is invalid",
    );
  if (!["query", "command"].includes(contract.kind))
    fail("invalid_capability_contract", "Capability kind is invalid");
  if (
    typeof contract.description !== "string" ||
    !contract.description.trim() ||
    contract.description.length > 160 ||
    typeof contract.contextProvider !== "string" ||
    !contract.contextProvider
  )
    fail(
      "invalid_capability_contract",
      "Capability description or context provider is invalid",
    );
  if (
    !Array.isArray(contract.eligibleStates) ||
    !contract.eligibleStates.length ||
    new Set(contract.eligibleStates).size !== contract.eligibleStates.length ||
    contract.eligibleStates.some((state) => typeof state !== "string" || !state)
  )
    fail(
      "invalid_capability_contract",
      "Capability eligible states are invalid",
    );
  if (
    !["none", "reversible", "consequential"].includes(
      contract.confirmationClass,
    ) ||
    (contract.kind === "query" && contract.confirmationClass !== "none") ||
    (contract.kind === "command" && contract.confirmationClass === "none")
  )
    fail(
      "invalid_capability_contract",
      "Capability confirmation class is invalid",
    );
  if (
    contract.undoCapabilityId !== undefined &&
    contract.undoCapabilityId !== null &&
    !CAPABILITY_ID.test(contract.undoCapabilityId)
  )
    fail("invalid_capability_contract", "Capability undo identity is invalid");
}

function normalizeDefinition(definition) {
  if (definition?.contract)
    return {
      contract: definition.contract,
      runtime: definition.runtime || {
        query: definition.query,
        execute: definition.execute,
        isEligible: definition.isEligible,
      },
    };
  return { contract: definition, runtime: {} };
}

function stateEligible(contract, context) {
  const states = new Set(
    Array.isArray(context) ? context : context?.states || [],
  );
  return contract.eligibleStates.some((state) => states.has(state));
}

export function createCapabilityRegistry(configuration = {}) {
  const config = Array.isArray(configuration)
    ? { capabilities: configuration }
    : configuration || {};
  const connectors = new Map();
  const entries = new Map();

  const registerConnector = (connector) => {
    if (
      !connector ||
      typeof connector !== "object" ||
      !CONNECTOR_ID.test(connector.connectorId || "")
    )
      fail("invalid_connector", "Connector identity is invalid");
    if (connectors.has(connector.connectorId))
      fail(
        "duplicate_connector",
        `Connector ${connector.connectorId} is already registered`,
      );
    const frozen = Object.freeze({ ...connector });
    connectors.set(frozen.connectorId, frozen);
    for (const definition of connector.capabilities || [])
      register(
        definition.contract || definition,
        definition.runtime || definition,
      );
    return frozen;
  };

  const register = (contractValue, runtimeValue = {}) => {
    const { contract, runtime } = normalizeDefinition(
      contractValue?.contract
        ? contractValue
        : { contract: contractValue, runtime: runtimeValue },
    );
    validateContractShape(contract);
    if (entries.has(contract.capabilityId))
      fail(
        "duplicate_capability",
        `Capability ${contract.capabilityId} is already registered`,
      );
    const connector = connectors.get(contract.connectorId);
    if (!connector)
      fail(
        "unknown_connector",
        `Connector ${contract.connectorId} is not registered`,
      );

    let validateArguments;
    let validateResult;
    try {
      validateArguments = compileSchema(contract.argumentSchema);
      validateResult = createCapabilityResultValidator(contract);
    } catch (error) {
      fail(
        "invalid_capability_contract",
        `Capability ${contract.capabilityId} contains an invalid schema`,
        { cause: error },
      );
    }
    const ownHandler =
      contract.kind === "query" ? runtime.query : runtime.execute;
    const connectorHandler =
      contract.kind === "query" ? connector.query : connector.execute;
    const handler =
      typeof ownHandler === "function"
        ? (args, context, metadata) => ownHandler(args, context, metadata)
        : typeof connectorHandler === "function"
          ? (args, context, metadata) =>
              connectorHandler(contract.capabilityId, args, context, metadata)
          : null;
    if (!handler)
      fail(
        contract.kind === "query" ? "missing_query" : "missing_executor",
        `Capability ${contract.capabilityId} has no runtime owner`,
      );

    const frozen = deepFreeze(structuredClone(contract));
    entries.set(frozen.capabilityId, {
      contract: frozen,
      connector,
      handler,
      isEligible:
        typeof runtime.isEligible === "function"
          ? runtime.isEligible
          : connector.isEligible,
      validateArguments,
      validateResult,
    });
    return frozen;
  };

  for (const connector of config.connectors || []) registerConnector(connector);
  for (const definition of config.capabilities || []) {
    const normalized = normalizeDefinition(definition);
    register(normalized.contract, normalized.runtime);
  }

  const getEntry = (capabilityId) => {
    const entry = entries.get(capabilityId);
    if (!entry)
      fail(
        "unknown_capability",
        `Capability ${capabilityId} is not registered`,
      );
    return entry;
  };

  const isEligible = (capabilityId, context = {}) => {
    const entry = getEntry(capabilityId);
    if (!stateEligible(entry.contract, context)) return false;
    return typeof entry.isEligible !== "function"
      ? true
      : entry.isEligible(entry.contract, context) === true;
  };

  const executeData = async (
    capabilityId,
    argumentsValue = {},
    context = {},
    metadata = {},
  ) => {
    const entry = getEntry(capabilityId);
    if (!isEligible(capabilityId, context))
      fail(
        "capability_ineligible",
        `Capability ${capabilityId} is unavailable in the current state`,
      );
    const argumentValidation = entry.validateArguments(argumentsValue);
    if (!argumentValidation.valid)
      fail(
        "invalid_capability_arguments",
        `Arguments for ${capabilityId} violate its contract`,
        argumentValidation.errors,
      );
    return entry.handler(structuredClone(argumentsValue), context, metadata);
  };

  const invoke = async (
    capabilityId,
    argumentsValue = {},
    context = {},
    metadata = {},
  ) => {
    const entry = getEntry(capabilityId);
    const raw = await executeData(
      capabilityId,
      argumentsValue,
      context,
      metadata,
    );
    const isEnvelope =
      raw &&
      typeof raw === "object" &&
      raw.capabilityId === capabilityId &&
      raw.kind === entry.contract.kind;
    const changed =
      entry.contract.kind === "command" ? raw?.changed !== false : null;
    const contextRevision =
      raw?.contextRevision ??
      Math.max(
        0,
        Number.isInteger(context.revision)
          ? context.revision + (changed === true ? 1 : 0)
          : 0,
      );
    const envelope = isEnvelope
      ? raw
      : {
          capabilityId,
          kind: entry.contract.kind,
          status: raw?.status || "completed",
          changed,
          affectedTargetIds: raw?.affectedTargetIds || [],
          contextRevision,
          data: raw?.data ?? raw ?? {},
          errorCode: raw?.errorCode ?? null,
        };
    return entry.validateResult(envelope, {
      proposalRevision: metadata.proposalRevision,
    });
  };

  return Object.freeze({
    registerConnector,
    register,
    registerCapability: register,
    get: (capabilityId) => getEntry(capabilityId).contract,
    ids: () => [...entries.keys()].sort(),
    available(context = {}) {
      return [...entries.values()]
        .filter(({ contract }) => isEligible(contract.capabilityId, context))
        .map(({ contract }) => contract);
    },
    projectRealtimeTools(context = {}) {
      return projectRealtimeFunctionTools(
        [...entries.values()]
          .filter(({ contract }) => isEligible(contract.capabilityId, context))
          .map(({ contract }) => contract),
      );
    },
    projectMcpFoundation(context = {}) {
      return projectMcpFoundationDescriptors(
        [...entries.values()]
          .filter(({ contract }) => isEligible(contract.capabilityId, context))
          .map(({ contract }) => contract),
      );
    },
    isEligible,
    invoke,
  });
}
