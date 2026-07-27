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

export function projectRealtimeFunctionTool(contractOrDescriptor) {
  const descriptor = asDescriptor(contractOrDescriptor);
  return deepFreeze({
    type: "function",
    name: descriptor.capabilityId,
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
  return gateway.execute(tool.name, structuredClone(argumentsValue), context, {
    ...metadata,
    callerOrigin: "voice",
  });
}
