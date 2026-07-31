const MAX_TEXT_LENGTH = 500;

function normalize(value) {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function validRevision(value) {
  return Number.isInteger(value) && value >= 0;
}

export function interpretObviousCommand({
  text,
  baseContextRevision = 0,
  catalogRevision = null,
} = {}) {
  const normalized = normalize(text);
  if (!normalized) return null;

  if (/^(?:please\s+)?zoom in(?:\s+please)?$/.test(normalized))
    return Object.freeze({
      family: "map",
      capabilityId: "map.zoomin",
      arguments: Object.freeze({}),
    });

  if (/^(?:please\s+)?zoom out(?:\s+please)?$/.test(normalized))
    return Object.freeze({
      family: "map",
      capabilityId: "map.zoomout",
      arguments: Object.freeze({}),
    });

  const mrtVisibility = normalized.match(
    /^(?:please\s+)?(show|hide)(?:\s+the)?\s+mrt\s+(lines?|stations?)(?:\s+please)?$/,
  );
  if (mrtVisibility)
    return Object.freeze({
      family: "map",
      capabilityId: "map.setlayervisibility",
      arguments: Object.freeze({
        layer: mrtVisibility[2].startsWith("line") ? "mrtLines" : "mrtStations",
        visible: mrtVisibility[1] === "show",
      }),
    });

  if (
    /^(?:please\s+)?(?:find|show)(?:\s+me)?\s+free\s+events?(?:\s+please)?$/.test(
      normalized,
    ) &&
    validRevision(baseContextRevision) &&
    typeof catalogRevision === "string" &&
    catalogRevision.length > 0 &&
    catalogRevision.length <= 160
  )
    return Object.freeze({
      family: "event",
      capabilityId: "event.applyquery",
      arguments: Object.freeze({
        text: normalized,
        mode: "replace",
        baseContextRevision,
        catalogRevision,
      }),
    });

  return null;
}
