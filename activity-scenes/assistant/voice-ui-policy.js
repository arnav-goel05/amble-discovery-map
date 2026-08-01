export function resolveVoiceUiEnabled({
  configuredValue,
  development = false,
} = {}) {
  if (configuredValue === "true") return true;
  if (configuredValue === "false") return false;
  if (configuredValue !== undefined && configuredValue !== "") return false;
  return development === true;
}
