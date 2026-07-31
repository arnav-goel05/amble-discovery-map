const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const VERSION = /^\d+\.\d+$/;

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

function assertContract(contract) {
  if (
    !contract ||
    typeof contract !== "object" ||
    Array.isArray(contract) ||
    !CAPABILITY_ID.test(contract.capabilityId || "") ||
    !VERSION.test(contract.version || "") ||
    !["query", "command"].includes(contract.kind) ||
    typeof contract.description !== "string" ||
    !contract.description ||
    typeof contract.connectorId !== "string" ||
    !contract.connectorId ||
    !contract.argumentSchema ||
    typeof contract.argumentSchema !== "object" ||
    !contract.resultSchema ||
    typeof contract.resultSchema !== "object" ||
    !Array.isArray(contract.eligibleStates) ||
    !contract.eligibleStates.length ||
    !["none", "reversible", "consequential"].includes(
      contract.confirmationClass,
    ) ||
    typeof contract.contextProvider !== "string" ||
    !contract.contextProvider
  )
    throw new TypeError(
      "A registered version-2 capability contract is required",
    );
}

/**
 * Create the transport-neutral, executor-free view of one registered v2
 * capability contract.
 */
export function projectCapabilityDescriptor(contract) {
  assertContract(contract);
  return deepFreeze({
    capabilityId: contract.capabilityId,
    version: contract.version,
    kind: contract.kind,
    name: contract.capabilityId,
    description: contract.description,
    connectorId: contract.connectorId,
    inputSchema: structuredClone(contract.argumentSchema),
    resultSchema: structuredClone(contract.resultSchema),
    eligibleStates: [...contract.eligibleStates],
    confirmationClass: contract.confirmationClass,
    contextProvider: contract.contextProvider,
  });
}

/**
 * Preserve the caller's registry order so existing Realtime tool ordering is
 * unchanged. Given the same ordered contracts, the projection is identical.
 */
export function projectCapabilityDescriptors(contracts = []) {
  if (!Array.isArray(contracts))
    throw new TypeError("Capability contracts must be an array");
  return deepFreeze(contracts.map(projectCapabilityDescriptor));
}

export function projectAvailableCapabilityDescriptors(registry, context = {}) {
  if (typeof registry?.available !== "function")
    throw new TypeError("A shared capability registry is required");
  return projectCapabilityDescriptors(registry.available(context));
}
