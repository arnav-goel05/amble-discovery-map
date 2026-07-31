export const ASSISTANT_PROTOCOL_VERSION = "1.1";

export { createActionGateway } from "./action-gateway.js";
export {
  ActionRegistryError,
  createActionRegistry,
} from "./action-registry.js";
export {
  CapabilityRegistryError,
  createCapabilityRegistry,
} from "./capability-registry.js";
export { createContextCoordinator } from "./context-coordinator.js";
export * from "./connectors/index.js";
export * from "./queries/index.js";

export function finalizeAssistantModules(modules = []) {
  for (const module of [...modules].reverse()) module?.finalize?.();
}
