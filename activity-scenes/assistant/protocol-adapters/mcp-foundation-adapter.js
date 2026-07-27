import {
  projectAvailableCapabilityDescriptors,
  projectCapabilityDescriptor,
} from "./capability-descriptor-projector.js";

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

export function projectMcpFoundationDescriptor(contractOrDescriptor) {
  const descriptor = asDescriptor(contractOrDescriptor);
  return deepFreeze({
    protocol: "mcp_foundation",
    enabled: false,
    capabilityId: descriptor.capabilityId,
    version: descriptor.version,
    kind: descriptor.kind,
    name: descriptor.name,
    description: descriptor.description,
    connectorId: descriptor.connectorId,
    inputSchema: structuredClone(descriptor.inputSchema),
    resultSchema: structuredClone(descriptor.resultSchema),
    eligibleStates: [...descriptor.eligibleStates],
    confirmationClass: descriptor.confirmationClass,
    contextProvider: descriptor.contextProvider,
  });
}

export function projectMcpFoundationDescriptors(contracts = []) {
  if (!Array.isArray(contracts))
    throw new TypeError("Capability contracts must be an array");
  return deepFreeze(contracts.map(projectMcpFoundationDescriptor));
}

export function projectAvailableMcpFoundationDescriptors(
  registry,
  context = {},
) {
  return deepFreeze(
    projectAvailableCapabilityDescriptors(registry, context).map(
      projectMcpFoundationDescriptor,
    ),
  );
}

export async function invokeMcpFoundationFixture({
  gateway,
  descriptor,
  argumentsValue = {},
  context = {},
  metadata = {},
} = {}) {
  if (typeof gateway?.execute !== "function")
    throw new TypeError("A shared capability gateway is required");
  if (
    !descriptor ||
    descriptor.protocol !== "mcp_foundation" ||
    descriptor.enabled !== false
  )
    throw new TypeError("A disabled MCP foundation descriptor is required");
  return gateway.execute(
    descriptor.capabilityId,
    structuredClone(argumentsValue),
    context,
    { ...metadata, callerOrigin: "mcp_fixture" },
  );
}
