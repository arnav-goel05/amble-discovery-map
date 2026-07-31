import { resolveCoarseAreaFromFeatures } from "../location/location-model.js";

const clone = (value) => structuredClone(value);

function canonicalAreaId(areaId, knownAreaIds) {
  const value = String(areaId || "").trim();
  if (!value) return null;
  if (knownAreaIds.has(value)) return value;
  const normalized = value
    .toLowerCase()
    .replace(/^ura-subzone:/, "")
    .replace(/[^a-z0-9]+/g, "");
  const candidate = `ura-subzone:${normalized}`;
  return knownAreaIds.has(candidate) ? candidate : null;
}

function createResolver(featureCollection) {
  const knownAreaIds = new Set(
    (featureCollection?.features || [])
      .map((feature) => feature.properties?.areaId)
      .filter(Boolean),
  );
  return (candidate) => {
    const areaId =
      canonicalAreaId(candidate?.areaId, knownAreaIds) ||
      resolveCoarseAreaFromFeatures(candidate?.coordinates, featureCollection);
    return areaId ? { ...clone(candidate), areaId } : null;
  };
}

export function resolveCandidateArea(candidate, featureCollection) {
  return createResolver(featureCollection)(candidate);
}

export function resolveCandidateEnvelopeAreas(envelope, featureCollection) {
  const resolve = createResolver(featureCollection);
  const candidates = (envelope?.candidates || []).map(resolve).filter(Boolean);
  return {
    ...clone(envelope),
    candidates,
  };
}
