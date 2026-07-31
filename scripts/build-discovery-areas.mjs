import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class DiscoveryAreaAssetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DiscoveryAreaAssetError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new DiscoveryAreaAssetError(code, message);
};
const canonical = (value) =>
  JSON.stringify(value, Object.keys(value || {}).sort());
const hash = (value) =>
  crypto
    .createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
const withinSingapore = ([lng, lat]) =>
  Number.isFinite(lng) &&
  Number.isFinite(lat) &&
  lng >= 103.4 &&
  lng <= 104.2 &&
  lat >= 1.1 &&
  lat <= 1.6;

function ringsFor(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates;
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.flat();
  fail(
    "area_geometry_invalid",
    "Discovery area geometry must be Polygon or MultiPolygon",
  );
}

function validateGeometry(geometry) {
  const rings = ringsFor(geometry);
  if (!rings.length)
    fail("area_geometry_invalid", "Discovery area has no rings");
  for (const ring of rings) {
    if (
      !Array.isArray(ring) ||
      ring.length < 4 ||
      ring.some(
        (point) =>
          !Array.isArray(point) || point.length < 2 || !withinSingapore(point),
      ) ||
      ring[0][0] !== ring.at(-1)[0] ||
      ring[0][1] !== ring.at(-1)[1]
    ) {
      const outside = ring?.some?.(
        (point) =>
          Array.isArray(point) && point.length >= 2 && !withinSingapore(point),
      );
      fail(
        outside ? "area_geometry_outside_singapore" : "area_geometry_invalid",
        "Discovery area geometry is invalid",
      );
    }
  }
  return structuredClone(geometry);
}

export function buildDiscoveryAreaAsset({
  sourceGeoJson,
  sourceBytes,
  sourceConfig,
  sourceObservedAt,
  generatedAt,
  generatorVersion,
} = {}) {
  if (
    sourceGeoJson?.type !== "FeatureCollection" ||
    !Array.isArray(sourceGeoJson.features) ||
    !sourceConfig?.datasetId ||
    Number.isNaN(Date.parse(sourceObservedAt)) ||
    Number.isNaN(Date.parse(generatedAt)) ||
    !generatorVersion
  )
    fail("area_source_invalid", "Discovery area source metadata is invalid");
  const identities = new Set();
  const features = sourceGeoJson.features
    .map((sourceFeature) => {
      const code = String(sourceFeature?.properties?.SUBZONE_C || "")
        .trim()
        .toLowerCase();
      if (!code) fail("area_identity_missing", "URA subzone code is required");
      if (identities.has(code))
        fail("area_identity_duplicate", "URA subzone code must be unique");
      identities.add(code);
      const geometry = validateGeometry(sourceFeature.geometry);
      return {
        type: "Feature",
        properties: {
          areaId: `ura-subzone:${code}`,
          subzoneCode: sourceFeature.properties.SUBZONE_C,
          areaName: sourceFeature.properties.SUBZONE_N,
          planningAreaCode: sourceFeature.properties.PLN_AREA_C,
          planningAreaName: sourceFeature.properties.PLN_AREA_N,
          regionName: sourceFeature.properties.REGION_N,
          sourceDatasetId: sourceConfig.datasetId,
          sourceObservedAt,
          sourceFeatureHash: hash({
            properties: sourceFeature.properties,
            geometry,
          }),
        },
        geometry,
      };
    })
    .sort((left, right) =>
      left.properties.areaId.localeCompare(right.properties.areaId),
    );
  const asset = { type: "FeatureCollection", features };
  const manifest = {
    schemaVersion: "1.0",
    assetId: "discovery-areas-v1",
    status: "review",
    generatorVersion,
    sourceDatasetIds: [sourceConfig.datasetId],
    authoritativeUrls: [sourceConfig.authoritativeUrl],
    licence: sourceConfig.licence,
    sourceObservedAt,
    generatedAt,
    sourceHashes: { [sourceConfig.datasetId]: hash(sourceBytes) },
    contentHash: hash(JSON.stringify(asset)),
    featureCount: features.length,
    validationReport: {
      valid: true,
      identity: true,
      geometry: true,
      wgs84: true,
    },
  };
  return { asset, manifest };
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    (polygon) =>
      pointInRing(point, polygon[0]) &&
      !polygon.slice(1).some((hole) => pointInRing(point, hole)),
  );
}

export function joinCandidatesToDiscoveryAreas(candidates = [], asset) {
  const joined = [];
  const review = [];
  for (const candidate of [...candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  )) {
    const matches = (asset?.features || []).filter((feature) =>
      pointInGeometry(candidate.coordinates, feature.geometry),
    );
    if (matches.length === 1)
      joined.push({
        candidateId: candidate.candidateId,
        areaId: matches[0].properties.areaId,
      });
    else
      review.push({
        candidateId: candidate.candidateId,
        reason: matches.length ? "area_ambiguous" : "area_not_resolved",
      });
  }
  return { joined, review };
}

export function reconcileDiscoveryAreaAsset(current, next) {
  if (!current) return { result: "create" };
  if (current.manifest.contentHash === next.manifest.contentHash)
    return { result: "noop" };
  if (next.manifest.featureCount < current.manifest.featureCount)
    return { result: "review", reason: "unexplained_feature_loss" };
  return { result: "update" };
}

export function publishStagedDiscoveryAreas({
  staging,
  final,
  requiredGates,
} = {}) {
  const failedGates = Object.entries(requiredGates || {})
    .filter(([, passed]) => passed !== true)
    .map(([gate]) => gate)
    .sort();
  if (failedGates.length)
    return { published: false, result: "review", failedGates };
  const asset = JSON.parse(fs.readFileSync(staging.assetPath, "utf8"));
  const manifest = {
    ...JSON.parse(fs.readFileSync(staging.manifestPath, "utf8")),
    status: "approved",
  };
  let existed = false;
  try {
    const currentManifest = JSON.parse(
      fs.readFileSync(final.manifestPath, "utf8"),
    );
    JSON.parse(fs.readFileSync(final.assetPath, "utf8"));
    existed = currentManifest.status === "approved";
  } catch {}
  fs.mkdirSync(path.dirname(final.assetPath), { recursive: true });
  const assetTemp = `${final.assetPath}.tmp`;
  const manifestTemp = `${final.manifestPath}.tmp`;
  fs.writeFileSync(assetTemp, `${JSON.stringify(asset, null, 2)}\n`);
  fs.writeFileSync(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(assetTemp, final.assetPath);
  fs.renameSync(manifestTemp, final.manifestPath);
  return {
    published: true,
    result: existed ? "update" : "create",
    failedGates: [],
  };
}

async function runCli() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/map-context-sources.json"), "utf8"),
  );
  const sourceConfig = policy.datasets.uraSubzones;
  const poll = await fetch(sourceConfig.pollDownloadUrl);
  if (!poll.ok) fail("area_source_unavailable", "URA download poll failed");
  const downloadUrl = (await poll.json())?.data?.url;
  if (!downloadUrl)
    fail("area_source_unavailable", "URA download URL is unavailable");
  const response = await fetch(downloadUrl);
  if (!response.ok)
    fail("area_source_unavailable", "URA source download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  const sourceGeoJson = JSON.parse(bytes.toString("utf8"));
  const generatedAt = new Date().toISOString();
  const built = buildDiscoveryAreaAsset({
    sourceGeoJson,
    sourceBytes: bytes,
    sourceConfig,
    sourceObservedAt: generatedAt,
    generatedAt,
    generatorVersion: "1.0.0",
  });
  const staging = policy.generatedOutputs.discoveryAreas.staging;
  for (const file of [staging.assetPath, staging.manifestPath])
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(
    path.join(root, staging.assetPath),
    `${JSON.stringify(built.asset, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, staging.manifestPath),
    `${JSON.stringify(built.manifest, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ staged: true, featureCount: built.manifest.featureCount, staging })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
