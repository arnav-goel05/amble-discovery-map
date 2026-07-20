export const ASSISTANT_PROTOCOL_VERSION = "1.0";

export { createActionGateway } from "./action-gateway.js";
export {
  ActionRegistryError,
  createActionRegistry,
} from "./action-registry.js";

export function finalizeAssistantModules(modules = []) {
  for (const module of [...modules].reverse()) module?.finalize?.();
}
