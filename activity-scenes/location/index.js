export const LOCATION_CONTEXT_VERSION = "1.0";

export function finalizeLocationModules(modules = []) {
  for (const module of [...modules].reverse()) module?.finalize?.();
}
