import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APPROVED_POIS } from "../data/approved-pois.js";
import {
  b3dmIdentity,
  inspectGlb,
  makeBackgroundLite,
  readB3dm,
} from "./lib/background-lite-b3dm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const sourceRoot = path.resolve(ROOT, option("source", "optimized-tiles"));
const outputRoot = path.resolve(
  ROOT,
  option("output", "outputs/background-lite-pilot/round1-20"),
);
const tileCount = Number(option("count", "20"));
if (tileCount !== 20)
  throw new Error("Round-one background-lite pilot requires exactly 20 tiles");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relativeSource = (file) =>
  path.relative(ROOT, file).split(path.sep).join("/");
const contentPath = (value) =>
  String(value ?? "")
    .replace(/^\.\//u, "")
    .replace(/^optimized-tiles\//u, "");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile() && entry.name.endsWith(".b3dm"))
      files.push(absolute);
  }
  return files;
}

const excludedSourceTiles = new Set(
  APPROVED_POIS.flatMap((poi) => Object.keys(poi.tiles ?? {})).map(contentPath),
);
const candidates = walk(sourceRoot)
  .map((file) => ({
    file,
    relative: path.relative(sourceRoot, file).split(path.sep).join("/"),
    bytes: fs.statSync(file).size,
  }))
  .filter(
    ({ relative, bytes }) =>
      bytes >= 32_768 && !excludedSourceTiles.has(relative),
  )
  .sort(
    (left, right) =>
      left.bytes - right.bytes || left.relative.localeCompare(right.relative),
  );

if (candidates.length < tileCount)
  throw new Error(
    `Only ${candidates.length} eligible background tiles were found`,
  );

const chosen = new Map();
const add = (candidate, category, reason) => {
  if (!candidate || chosen.has(candidate.relative)) return false;
  chosen.set(candidate.relative, { ...candidate, category, reason });
  return true;
};
const closestUnused = (targetBytes) =>
  candidates
    .filter(({ relative }) => !chosen.has(relative))
    .reduce(
      (best, candidate) =>
        !best ||
        Math.abs(candidate.bytes - targetBytes) <
          Math.abs(best.bytes - targetBytes)
          ? candidate
          : best,
      null,
    );

for (const candidate of [...candidates].reverse()) {
  if (chosen.size >= 8) break;
  add(
    candidate,
    "heavy",
    "one of the eight largest eligible background assets",
  );
}

const median = candidates[Math.floor(candidates.length / 2)].bytes;
for (const multiplier of [0.72, 0.84, 0.94, 1.06, 1.18, 1.32])
  add(
    closestUnused(median * multiplier),
    "medium",
    `near ${(multiplier * 100).toFixed(0)}% of the median eligible asset size`,
  );

for (const percentile of [0.06, 0.12, 0.18, 0.24])
  add(
    candidates[Math.floor((candidates.length - 1) * percentile)],
    "small",
    `near the ${(percentile * 100).toFixed(0)}th eligible size percentile`,
  );

const complexitySample = Array.from(
  { length: 96 },
  (_, index) => candidates[Math.floor(((candidates.length - 1) * index) / 95)],
).filter(({ relative }) => !chosen.has(relative));
const complex = complexitySample
  .map((candidate) => {
    const bytes = fs.readFileSync(candidate.file);
    const parts = readB3dm(bytes, candidate.relative);
    const glb = inspectGlb(parts.glb);
    const identity = b3dmIdentity(parts);
    return {
      ...candidate,
      complexityScore: glb.triangles + identity.batchLength * 100,
      triangles: glb.triangles,
      buildings: identity.batchLength,
    };
  })
  .sort(
    (left, right) =>
      right.complexityScore - left.complexityScore || right.bytes - left.bytes,
  );
for (const candidate of complex) {
  if (chosen.size >= 20) break;
  add(
    candidate,
    "complex",
    `high structural proxy (${candidate.triangles} triangles, ${candidate.buildings} building batches)`,
  );
}
if (chosen.size !== 20)
  throw new Error(`Selection produced ${chosen.size}, expected 20`);

const sourceTileset = JSON.parse(
  fs.readFileSync(path.join(sourceRoot, "tileset.json"), "utf8"),
);
function tileIndex(tile, index = new Map()) {
  const uri = contentPath(tile.content?.uri ?? tile.content?.url);
  if (uri) index.set(uri, tile);
  for (const child of tile.children ?? []) tileIndex(child, index);
  return index;
}
const indexedTiles = tileIndex(sourceTileset.root);

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(outputRoot, "lite"), { recursive: true });
const records = [];
for (const selected of chosen.values()) {
  const sourceBytes = fs.readFileSync(selected.file);
  const sourceParts = readB3dm(sourceBytes, selected.relative);
  const sourceIdentity = b3dmIdentity(sourceParts);
  const sourceGlb = inspectGlb(sourceParts.glb);
  const liteBytes = await makeBackgroundLite(sourceBytes);
  const liteParts = readB3dm(liteBytes, selected.relative);
  const liteIdentity = b3dmIdentity(liteParts);
  const liteGlb = inspectGlb(liteParts.glb);
  const identityPreserved =
    JSON.stringify(sourceIdentity) === JSON.stringify(liteIdentity);
  const geometryContractPreserved =
    sourceGlb.triangles === liteGlb.triangles &&
    sourceGlb.retainedBufferViewSha256 === liteGlb.retainedBufferViewSha256 &&
    liteGlb.semantics.includes("POSITION") &&
    liteGlb.semantics.includes("NORMAL") &&
    liteGlb.semantics.includes("_BATCHID");
  if (!identityPreserved)
    throw new Error(`${selected.relative}: identity changed`);
  if (!geometryContractPreserved)
    throw new Error(`${selected.relative}: geometry contract changed`);
  if (
    liteGlb.images ||
    liteGlb.textures ||
    [...liteGlb.semantics, ...liteGlb.dracoSemantics].some((x) =>
      x.startsWith("TEXCOORD_"),
    )
  )
    throw new Error(
      `${selected.relative}: texture payload survived transformation`,
    );
  if (!liteGlb.extensionsRequired.includes("KHR_draco_mesh_compression"))
    throw new Error(`${selected.relative}: Draco is not required`);

  const destination = path.join(outputRoot, "lite", selected.relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, liteBytes);
  const sourceNode = indexedTiles.get(selected.relative);
  if (!sourceNode)
    throw new Error(
      `${selected.relative}: not reachable from the source tileset`,
    );
  const region = sourceNode.boundingVolume?.region ?? null;
  records.push({
    source: relativeSource(selected.file),
    lite: relativeSource(destination),
    category: selected.category,
    selectionReason: selected.reason,
    sourceBytes: sourceBytes.length,
    liteBytes: liteBytes.length,
    savedBytes: sourceBytes.length - liteBytes.length,
    reductionPercent: Number(
      (
        ((sourceBytes.length - liteBytes.length) / sourceBytes.length) *
        100
      ).toFixed(2),
    ),
    sourceSha256: sha256(sourceBytes),
    liteSha256: sha256(liteBytes),
    identity: sourceIdentity,
    sourceGlb,
    liteGlb,
    identityPreserved,
    geometryContractPreserved,
    boundingVolume: sourceNode.boundingVolume,
    transform: sourceNode.transform ?? null,
    camera:
      Array.isArray(region) && region.length === 6
        ? {
            longitude: ((region[0] + region[2]) / 2) * (180 / Math.PI),
            latitude: ((region[1] + region[3]) / 2) * (180 / Math.PI),
          }
        : null,
  });
  console.log(
    `${selected.category.padEnd(7)} ${selected.relative}: ${sourceBytes.length} -> ${liteBytes.length}`,
  );
}

function comparisonTileset(mode) {
  const children = records.map((record) => ({
    boundingVolume: record.boundingVolume,
    geometricError: 0,
    refine: "REPLACE",
    ...(record.transform ? { transform: record.transform } : {}),
    content: {
      uri:
        mode === "original"
          ? `original/${record.source.replace(/^optimized-tiles\//u, "")}`
          : `lite/${record.lite.replace(/^outputs\/background-lite-pilot\/round1-20\/lite\//u, "")}`,
    },
  }));
  const regions = records.map(({ boundingVolume }) => boundingVolume?.region);
  if (regions.some((region) => !Array.isArray(region) || region.length !== 6))
    throw new Error("Pilot comparison requires region bounding volumes");
  return {
    asset: sourceTileset.asset,
    geometricError: 512,
    root: {
      boundingVolume: {
        region: [
          Math.min(...regions.map((r) => r[0])),
          Math.min(...regions.map((r) => r[1])),
          Math.max(...regions.map((r) => r[2])),
          Math.max(...regions.map((r) => r[3])),
          Math.min(...regions.map((r) => r[4])),
          Math.max(...regions.map((r) => r[5])),
        ],
      },
      geometricError: 512,
      refine: "REPLACE",
      children,
    },
  };
}

const totals = records.reduce(
  (summary, record) => ({
    sourceBytes: summary.sourceBytes + record.sourceBytes,
    liteBytes: summary.liteBytes + record.liteBytes,
    savedBytes: summary.savedBytes + record.savedBytes,
  }),
  { sourceBytes: 0, liteBytes: 0, savedBytes: 0 },
);
totals.reductionPercent = Number(
  ((totals.savedBytes / totals.sourceBytes) * 100).toFixed(2),
);
const manifest = {
  schemaVersion: "background-lite-pilot-v1",
  generatedAt: new Date().toISOString(),
  productionChanged: false,
  selection: {
    eligibleTileCount: candidates.length,
    highlightedSourceTilesExcluded: excludedSourceTiles.size,
    categories: { heavy: 8, medium: 6, small: 4, complex: 2 },
    complexityProxy:
      "triangle count plus 100 times B3DM batch length over a 96-tile size-stratified sample",
  },
  transformation: {
    texturesRemoved: true,
    textureCoordinatesRemoved: true,
    neutralMaterial: true,
    meshSimplification: false,
    retiling: false,
    positionQuantizationBits: 14,
    draco: true,
  },
  totals,
  records,
};
for (const [name, value] of [
  ["manifest.json", manifest],
  ["original-tileset.json", comparisonTileset("original")],
  ["lite-tileset.json", comparisonTileset("lite")],
])
  fs.writeFileSync(
    path.join(outputRoot, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
console.log(
  JSON.stringify({ output: relativeSource(outputRoot), totals }, null, 2),
);
