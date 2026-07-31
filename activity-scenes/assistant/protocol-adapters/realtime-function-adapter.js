import {
  projectAvailableCapabilityDescriptors,
  projectCapabilityDescriptor,
} from "./capability-descriptor-projector.js";

const CANONICAL_CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const PROVIDER_FUNCTION_NAME = /^[a-zA-Z0-9_-]+$/;

export function toProviderFunctionName(capabilityId) {
  if (!CANONICAL_CAPABILITY_ID.test(capabilityId || ""))
    throw new TypeError("A canonical capability ID is required");
  const providerName = capabilityId.replaceAll(".", "__");
  if (!PROVIDER_FUNCTION_NAME.test(providerName))
    throw new TypeError("Provider function alias is invalid");
  return providerName;
}

export function fromProviderFunctionName(providerName) {
  if (
    typeof providerName !== "string" ||
    !PROVIDER_FUNCTION_NAME.test(providerName) ||
    providerName.includes("___")
  )
    throw new TypeError("Provider function alias is invalid");
  const capabilityId = providerName.replaceAll("__", ".");
  if (
    !CANONICAL_CAPABILITY_ID.test(capabilityId) ||
    toProviderFunctionName(capabilityId) !== providerName
  )
    throw new TypeError("Provider function alias is not reversible");
  return capabilityId;
}

export function createProviderCapabilityAliasMap(capabilityIds = []) {
  if (!Array.isArray(capabilityIds))
    throw new TypeError("Capability IDs must be an array");
  const canonicalToProvider = new Map();
  const providerToCanonical = new Map();
  for (const capabilityId of capabilityIds) {
    if (canonicalToProvider.has(capabilityId))
      throw new TypeError("Capability alias input contains a duplicate ID");
    const providerName = toProviderFunctionName(capabilityId);
    if (providerToCanonical.has(providerName))
      throw new TypeError("Provider capability alias collision");
    canonicalToProvider.set(capabilityId, providerName);
    providerToCanonical.set(providerName, capabilityId);
  }
  return Object.freeze({
    canonicalToProvider,
    providerToCanonical,
  });
}

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

const asDescriptor = (contractOrDescriptor) =>
  contractOrDescriptor?.inputSchema
    ? contractOrDescriptor
    : projectCapabilityDescriptor(contractOrDescriptor);

export function projectRealtimeFunctionTool(contractOrDescriptor) {
  const descriptor = asDescriptor(contractOrDescriptor);
  return deepFreeze({
    type: "function",
    name: toProviderFunctionName(descriptor.capabilityId),
    description: descriptor.description,
    parameters: structuredClone(descriptor.inputSchema),
  });
}

export function projectRealtimeFunctionTools(contracts = []) {
  if (!Array.isArray(contracts))
    throw new TypeError("Capability contracts must be an array");
  return deepFreeze(contracts.map(projectRealtimeFunctionTool));
}

export function projectAvailableRealtimeFunctionTools(registry, context = {}) {
  return deepFreeze(
    projectAvailableCapabilityDescriptors(registry, context).map(
      projectRealtimeFunctionTool,
    ),
  );
}

export async function invokeRealtimeFunctionFixture({
  gateway,
  tool,
  argumentsValue = {},
  context = {},
  metadata = {},
} = {}) {
  if (typeof gateway?.execute !== "function")
    throw new TypeError("A shared capability gateway is required");
  if (
    !tool ||
    tool.type !== "function" ||
    typeof tool.name !== "string" ||
    !tool.name
  )
    throw new TypeError("A Realtime function tool descriptor is required");
  return gateway.execute(
    fromProviderFunctionName(tool.name),
    structuredClone(argumentsValue),
    context,
    {
      ...metadata,
      callerOrigin: "voice",
    },
  );
}
