import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { Accessor, NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { APPROVED_POIS } from "../data/approved-pois.js";

const TILESET_ROOT = "https://www.onemap.gov.sg/omapi/tilesets/sg_noterrain_tiles/";
const REQUEST_HEADERS = {
  Referer: "https://www.onemap.gov.sg/3d",
  Origin: "https://www.onemap.gov.sg",
  "User-Agent": "Mozilla/5.0",
};
const argument = (name, fallback = null) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; };
const SOURCE_CACHE_DIR = path.resolve(argument('source-cache', "public/poi-tiles/source"));
const SOURCE_TILESET_PATH = path.resolve(argument('source-tileset', "optimized-tiles/tileset.json"));
const STAGING_DIR = path.resolve(argument('work-root', path.join("tmp", `poi-extraction-${process.pid}`)));
const PUBLISH_ROOT = path.resolve(argument('publish-root', '.'));
const registryPath = argument('registry');

const onlyIdsArg = process.argv.indexOf('--ids');
const onlyIds = onlyIdsArg >= 0 ? new Set((process.argv[onlyIdsArg + 1] || '').split(',').filter(Boolean)) : null;
const configuredPois = registryPath ? JSON.parse(fs.readFileSync(path.resolve(registryPath), 'utf8')).records : APPROVED_POIS;
if (!Array.isArray(configuredPois)) throw new Error('--registry must contain { "records": [...] }');
const POIS = onlyIds ? configuredPois.filter((poi) => onlyIds.has(poi.id)) : configuredPois;
if (onlyIds && POIS.length !== onlyIds.size) throw new Error('One or more --ids values are not present in APPROVED_POIS');
const emptyMappings = POIS.filter((poi) => !Object.keys(poi.tiles || {}).length).map((poi) => poi.id);
if (emptyMappings.length) throw new Error(`Cannot extract POIs without source tile mappings: ${emptyMappings.join(', ')}`);

function readB3dm(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.toString("utf8", 0, 4) !== "b3dm") throw new Error(`${filePath} is not a b3dm tile`);

  const featureTableJsonByteLength = bytes.readUInt32LE(12);
  const featureTableBinaryByteLength = bytes.readUInt32LE(16);
  const batchTableJsonByteLength = bytes.readUInt32LE(20);
  const batchTableBinaryByteLength = bytes.readUInt32LE(24);
  const featureTableJsonStart = 28;
  const featureTableBinaryStart = featureTableJsonStart + featureTableJsonByteLength;
  const batchTableJsonStart = featureTableBinaryStart + featureTableBinaryByteLength;
  const batchTableBinaryStart = batchTableJsonStart + batchTableJsonByteLength;
  const glbStart = batchTableBinaryStart + batchTableBinaryByteLength;

  return {
    featureTableJson: bytes.subarray(featureTableJsonStart, featureTableBinaryStart),
    featureTableBinary: bytes.subarray(featureTableBinaryStart, batchTableJsonStart),
    batchTableJson: bytes.subarray(batchTableJsonStart, batchTableBinaryStart),
    batchTableBinary: bytes.subarray(batchTableBinaryStart, glbStart),
    glb: bytes.subarray(glbStart),
  };
}

function parsePaddedJson(buffer) {
  return JSON.parse(buffer.toString("utf8").trim());
}

function paddedJsonBuffer(value) {
  let json = JSON.stringify(value);
  while (json.length % 8 !== 0) json += " ";
  return Buffer.from(json, "utf8");
}

function sourceCachePath(sourceTile) {
  return path.join(SOURCE_CACHE_DIR, sourceTile.replace(/^(optimized-tiles|tiles)\//, ""));
}

function sourceTileForTileset(sourceTile) {
  return sourceTile.replace(/^tiles\//, "optimized-tiles/");
}

async function preserveSourceTile(sourceTile) {
  const cachePath = sourceCachePath(sourceTile);
  if (fs.existsSync(cachePath)) return;

  const sourceUri = sourceTile.replace(/^(optimized-tiles|tiles)\//, "");
  let response = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    response = await fetch(new URL(sourceUri, TILESET_ROOT), { headers: REQUEST_HEADERS });
    if (response.ok) break;
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  if (!response?.ok) throw new Error(`Failed ${response?.status} while downloading ${sourceUri}`);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, Buffer.from(await response.arrayBuffer()));
}

function readSourceB3dm(sourceTile) {
  const cachePath = sourceCachePath(sourceTile);
  return readB3dm(fs.existsSync(cachePath) ? cachePath : sourceTile);
}

function writeB3dm(parts, glb, filePath) {
  const byteLength =
    28 +
    parts.featureTableJson.byteLength +
    parts.featureTableBinary.byteLength +
    parts.batchTableJson.byteLength +
    parts.batchTableBinary.byteLength +
    glb.byteLength;
  const header = Buffer.alloc(28);
  header.write("b3dm", 0, 4, "utf8");
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(byteLength, 8);
  header.writeUInt32LE(parts.featureTableJson.byteLength, 12);
  header.writeUInt32LE(parts.featureTableBinary.byteLength, 16);
  header.writeUInt32LE(parts.batchTableJson.byteLength, 20);
  header.writeUInt32LE(parts.batchTableBinary.byteLength, 24);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    Buffer.concat([header, parts.featureTableJson, parts.featureTableBinary, parts.batchTableJson, parts.batchTableBinary, glb]),
  );
}

function getBatchIds(parts) {
  const featureTable = parsePaddedJson(parts.featureTableJson);
  return Array.from({ length: featureTable.BATCH_LENGTH }, (_, index) => index);
}

function makeBatchIdRemap(batchIds) {
  return new Map(batchIds.map((batchId, index) => [batchId, index]));
}

function buildB3dmParts(parts, batchIdRemap) {
  const featureTable = parsePaddedJson(parts.featureTableJson);
  const batchTable = parsePaddedJson(parts.batchTableJson);
  const keptBatchIds = [...batchIdRemap.keys()];
  const filteredBatchTable = {};

  for (const [key, value] of Object.entries(batchTable)) {
    filteredBatchTable[key] = Array.isArray(value) ? keptBatchIds.map((batchId) => value[batchId]) : value;
  }

  return {
    featureTableJson: paddedJsonBuffer({
      ...featureTable,
      BATCH_LENGTH: keptBatchIds.length,
    }),
    featureTableBinary: parts.featureTableBinary,
    batchTableJson: paddedJsonBuffer(filteredBatchTable),
    batchTableBinary: parts.batchTableBinary,
  };
}

function copyElement(accessor, sourceIndex, targetArray, targetIndex, mapValue = (value) => value) {
  const sourceArray = accessor.getArray();
  const elementSize = accessor.getElementSize();
  for (let componentIndex = 0; componentIndex < elementSize; componentIndex += 1) {
    targetArray[targetIndex * elementSize + componentIndex] = mapValue(sourceArray[sourceIndex * elementSize + componentIndex]);
  }
}

function createFilteredPrimitive(document, primitive, selectedTriangles, batchIdRemap) {
  const vertexMap = new Map();
  const oldIndices = primitive.getIndices().getArray();
  const newIndices = [];

  for (const triangleIndex of selectedTriangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const oldVertexIndex = oldIndices[triangleIndex * 3 + corner];
      let newVertexIndex = vertexMap.get(oldVertexIndex);
      if (newVertexIndex === undefined) {
        newVertexIndex = vertexMap.size;
        vertexMap.set(oldVertexIndex, newVertexIndex);
      }
      newIndices.push(newVertexIndex);
    }
  }

  const newPrimitive = document.createPrimitive().setMode(primitive.getMode()).setMaterial(primitive.getMaterial());
  const buffer = document.getRoot().listBuffers()[0] || document.createBuffer();
  const indexArray = vertexMap.size <= 65534 ? new Uint16Array(newIndices) : new Uint32Array(newIndices);
  newPrimitive.setIndices(document.createAccessor().setType(Accessor.Type.SCALAR).setArray(indexArray).setBuffer(buffer));

  const oldToNew = Array.from(vertexMap.entries());
  for (const semantic of primitive.listSemantics()) {
    const oldAccessor = primitive.getAttribute(semantic);
    const oldArray = oldAccessor.getArray();
    const ArrayType = oldArray.constructor;
    const newArray = new ArrayType(vertexMap.size * oldAccessor.getElementSize());
    const mapValue =
      semantic === "_BATCHID"
        ? (value) => {
            const remapped = batchIdRemap.get(Math.round(value));
            if (remapped === undefined) throw new Error(`Unexpected batch id ${value} in filtered primitive`);
            return remapped;
          }
        : (value) => value;
    for (const [oldVertexIndex, newVertexIndex] of oldToNew) {
      copyElement(oldAccessor, oldVertexIndex, newArray, newVertexIndex, mapValue);
    }
    newPrimitive.setAttribute(
      semantic,
      document.createAccessor().setType(oldAccessor.getType()).setArray(newArray).setNormalized(oldAccessor.getNormalized()).setBuffer(buffer),
    );
  }

  return newPrimitive;
}

function filterDocument(document, keepBatchIds, batchIdRemap) {
  let keptTriangles = 0;
  let removedPrimitives = 0;

  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of [...mesh.listPrimitives()]) {
      const batchAccessor = primitive.getAttribute("_BATCHID");
      const indexAccessor = primitive.getIndices();
      if (!batchAccessor || !indexAccessor) {
        mesh.removePrimitive(primitive);
        primitive.dispose();
        removedPrimitives += 1;
        continue;
      }

      const batchIds = batchAccessor.getArray();
      const indices = indexAccessor.getArray();
      const selectedTriangles = [];
      for (let triangleIndex = 0; triangleIndex < indices.length / 3; triangleIndex += 1) {
        const a = Math.round(batchIds[indices[triangleIndex * 3]]);
        const b = Math.round(batchIds[indices[triangleIndex * 3 + 1]]);
        const c = Math.round(batchIds[indices[triangleIndex * 3 + 2]]);
        if (keepBatchIds.has(a) && keepBatchIds.has(b) && keepBatchIds.has(c)) {
          selectedTriangles.push(triangleIndex);
        }
      }

      if (selectedTriangles.length === 0) {
        mesh.removePrimitive(primitive);
        primitive.dispose();
        removedPrimitives += 1;
        continue;
      }

      keptTriangles += selectedTriangles.length;
      const filteredPrimitive = createFilteredPrimitive(document, primitive, selectedTriangles, batchIdRemap);
      mesh.addPrimitive(filteredPrimitive);
      mesh.removePrimitive(primitive);
      primitive.dispose();
    }
  }

  for (const node of document.getRoot().listNodes()) {
    if (node.getMesh() && node.getMesh().listPrimitives().length === 0) {
      node.dispose();
    }
  }

  return { keptTriangles, removedPrimitives };
}

function findSourceTile(tile, sourceTile) {
  const contentUri = tile.content?.uri || tile.content?.url;
  if (contentUri === sourceTile.replace(/^optimized-tiles\//, "")) return tile;
  for (const child of tile.children || []) {
    const found = findSourceTile(child, sourceTile);
    if (found) return found;
  }
  return null;
}

function unionBoundingRegions(tiles) {
  const regions = tiles.map((tile) => tile.boundingVolume?.region);
  if (regions.some((region) => !Array.isArray(region) || region.length !== 6)) {
    throw new Error("POI tileset root union only supports region bounding volumes.");
  }

  return {
    region: [
      Math.min(...regions.map((region) => region[0])),
      Math.min(...regions.map((region) => region[1])),
      Math.max(...regions.map((region) => region[2])),
      Math.max(...regions.map((region) => region[3])),
      Math.min(...regions.map((region) => region[4])),
      Math.max(...regions.map((region) => region[5])),
    ],
  };
}

function poiTileFilename(sourceTile) {
  const extension = path.extname(sourceTile) || ".b3dm";
  const stem = path.basename(sourceTile, extension);
  const sourceHash = createHash("sha256").update(sourceTile).digest("hex").slice(0, 12);
  return `${stem}-${sourceHash}${extension}`;
}

function writePoiTileset(poi, sourceTileset, outputDir) {
  const sourceTileNodes = Object.keys(poi.tiles).map((sourceTile) => {
    const sourceTileNode = findSourceTile(sourceTileset.root, sourceTileForTileset(sourceTile));
    if (!sourceTileNode) throw new Error(`Could not find ${sourceTile} in source tileset`);
    return { sourceTile, sourceTileNode };
  });

  const children = sourceTileNodes.map(({ sourceTile, sourceTileNode }) => {
    return {
      boundingVolume: sourceTileNode.boundingVolume,
      geometricError: 0,
      refine: sourceTileNode.refine ?? "REPLACE",
      content: { uri: poiTileFilename(sourceTile) },
    };
  });

  const tileset = {
    asset: sourceTileset.asset,
    geometricError: 512,
    root: {
      boundingVolume: unionBoundingRegions(sourceTileNodes.map(({ sourceTileNode }) => sourceTileNode)),
      geometricError: 256,
      refine: "REPLACE",
      children,
    },
  };
  fs.writeFileSync(path.join(outputDir, "tileset.json"), `${JSON.stringify(tileset, null, 2)}\n`);
}

function validateBatchNames(sourceTile, parts, selectedBatchIds, expectedNames) {
  const batchTable = parsePaddedJson(parts.batchTableJson);
  const names = batchTable["gml:name"] || [];
  for (const batchId of selectedBatchIds) {
    const name = names[batchId];
    if (!expectedNames.includes(name)) {
      throw new Error(`${sourceTile} batch ${batchId} is "${name}", expected one of ${expectedNames.join(", ")}`);
    }
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const batchTable = (parts) => parsePaddedJson(parts.batchTableJson);
const identities = (parts) => batchTable(parts)["gml:id"] || [];
const sorted = (values) => [...values].sort();
const sameValues = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

function publishFile(stagedPath, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.next-${process.pid}`;
  fs.copyFileSync(stagedPath, temporary);
  fs.renameSync(temporary, destination);
}

const decoder = await draco3d.createDecoderModule();
const encoder = await draco3d.createEncoderModule();
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  "draco3d.decoder": decoder,
  "draco3d.encoder": encoder,
});

const sourceTileset = JSON.parse(fs.readFileSync(SOURCE_TILESET_PATH, "utf8"));
const allSourceTiles = new Set(POIS.flatMap((poi) => Object.keys(poi.tiles)));
for (const sourceTile of allSourceTiles) await preserveSourceTile(sourceTile);
fs.rmSync(STAGING_DIR, { recursive: true, force: true });
fs.mkdirSync(STAGING_DIR, { recursive: true });

// Validate the complete extraction set before writing any POI or background output.
// This prevents a late bad registry entry from leaving a partially updated map.
const claimedBatches = new Map();
for (const poi of POIS) {
  for (const [sourceTile, batchIds] of Object.entries(poi.tiles)) {
    validateBatchNames(sourceTile, readSourceB3dm(sourceTile), batchIds, poi.names);
    for (const batchId of batchIds) {
      const key = `${sourceTile}:${batchId}`;
      const owner = claimedBatches.get(key);
      if (owner && owner !== poi.id) throw new Error(`Source batch collision: ${key} is claimed by ${owner} and ${poi.id}`);
      claimedBatches.set(key, poi.id);
    }
  }
}

const removalsByTile = new Map();
const manifests = new Map();
for (const poi of POIS) {
  const outputDir = path.join(STAGING_DIR, "public", "poi-tiles", poi.id);
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = { schemaVersion: "1.0", poiId: poi.id, extractionPoiIds: POIS.map(({ id }) => id), generatedAt: new Date().toISOString(), tiles: [] };

  let poiTotalTriangles = 0;
  let poiTotalRemovedPrimitives = 0;
  for (const [sourceTile, batchIds] of Object.entries(poi.tiles)) {
    const b3dm = readSourceB3dm(sourceTile);
    validateBatchNames(sourceTile, b3dm, batchIds, poi.names);
    const batchIdRemap = makeBatchIdRemap(batchIds);
    const poiDocument = await io.readBinary(new Uint8Array(b3dm.glb));
    const poiStats = filterDocument(poiDocument, new Set(batchIds), batchIdRemap);
    if (poiStats.keptTriangles <= 0) throw new Error(`${poi.id}: ${sourceTile} produced no POI triangles`);
    await poiDocument.transform(prune());
    const poiGlb = Buffer.from(await io.writeBinary(poiDocument));
    const poiFile = poiTileFilename(sourceTile);
    const poiPath = path.join(outputDir, poiFile);
    writeB3dm(buildB3dmParts(b3dm, batchIdRemap), poiGlb, poiPath);
    const sourceBytes = fs.readFileSync(sourceCachePath(sourceTile));
    const sourceTable = batchTable(b3dm);
    manifest.tiles.push({
      sourceTile,
      sourceSha256: sha256(sourceBytes),
      originalBatchIds: batchIds,
      gmlIds: batchIds.map((batchId) => sourceTable["gml:id"]?.[batchId]),
      gmlNames: batchIds.map((batchId) => sourceTable["gml:name"]?.[batchId]),
      poiFile,
      poiSha256: sha256(fs.readFileSync(poiPath)),
      poiTriangles: poiStats.keptTriangles,
    });
    poiTotalTriangles += poiStats.keptTriangles;
    poiTotalRemovedPrimitives += poiStats.removedPrimitives;

    const removals = removalsByTile.get(sourceTile) || new Set();
    batchIds.forEach((batchId) => removals.add(batchId));
    removalsByTile.set(sourceTile, removals);
  }
  writePoiTileset(poi, sourceTileset, outputDir);
  manifests.set(poi.id, manifest);
  console.log(`${poi.id}: ${poiTotalTriangles} triangles kept, ${poiTotalRemovedPrimitives} primitives removed.`);
}

let backgroundTotalTriangles = 0;
let backgroundTotalRemovedPrimitives = 0;
for (const [sourceTile, removedBatchIds] of removalsByTile.entries()) {
  const b3dm = readSourceB3dm(sourceTile);
  const backgroundBatchIds = getBatchIds(b3dm).filter((batchId) => !removedBatchIds.has(batchId));
  const batchIdRemap = makeBatchIdRemap(backgroundBatchIds);
  const backgroundDocument = await io.readBinary(new Uint8Array(b3dm.glb));
  const backgroundStats = filterDocument(backgroundDocument, new Set(backgroundBatchIds), batchIdRemap);
  const expectedBackgroundIds = backgroundBatchIds.map((batchId) => identities(b3dm)[batchId]);
  if (backgroundStats.keptTriangles <= 0 && expectedBackgroundIds.length > 0) {
    throw new Error(`${sourceTile} lost unrelated background geometry`);
  }
  await backgroundDocument.transform(prune());
  const backgroundGlb = Buffer.from(await io.writeBinary(backgroundDocument));
  const stagedBackground = path.join(STAGING_DIR, sourceTileForTileset(sourceTile));
  writeB3dm(buildB3dmParts(b3dm, batchIdRemap), backgroundGlb, stagedBackground);
  const actualBackgroundIds = identities(readB3dm(stagedBackground));
  if (!sameValues(expectedBackgroundIds, actualBackgroundIds)) throw new Error(`${sourceTile} background identity set does not match pristine source minus selected batches`);
  for (const poi of POIS) {
    const entry = manifests.get(poi.id)?.tiles.find((tile) => tile.sourceTile === sourceTile);
    if (!entry) continue;
    const poiIds = identities(readB3dm(path.join(STAGING_DIR, "public", "poi-tiles", poi.id, entry.poiFile)));
    if (!sameValues(entry.gmlIds, poiIds)) throw new Error(`${poi.id}: ${sourceTile} POI identity set does not match selected pristine batches`);
    if (entry.gmlIds.some((gmlId) => actualBackgroundIds.includes(gmlId))) throw new Error(`${poi.id}: ${sourceTile} selected GML identity remains in background`);
    entry.backgroundFile = sourceTileForTileset(sourceTile);
    entry.backgroundRemovedGmlIds = [...removedBatchIds].map((batchId) => identities(b3dm)[batchId]);
    entry.backgroundSha256 = sha256(fs.readFileSync(stagedBackground));
    entry.backgroundTriangles = backgroundStats.keptTriangles;
  }
  backgroundTotalTriangles += backgroundStats.keptTriangles;
  backgroundTotalRemovedPrimitives += backgroundStats.removedPrimitives;
}

// Publish only after the complete extraction set passes identity and geometry checks.
for (const poi of POIS) {
  const stagedPoiDir = path.join(STAGING_DIR, "public", "poi-tiles", poi.id);
  const manifest = manifests.get(poi.id);
  fs.writeFileSync(path.join(stagedPoiDir, "extraction-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of fs.readdirSync(stagedPoiDir)) publishFile(path.join(stagedPoiDir, file), path.join(PUBLISH_ROOT, "public", "poi-tiles", poi.id, file));
}
for (const sourceTile of removalsByTile.keys()) publishFile(path.join(STAGING_DIR, sourceTileForTileset(sourceTile)), path.join(PUBLISH_ROOT, sourceTileForTileset(sourceTile)));
fs.rmSync(STAGING_DIR, { recursive: true, force: true });

console.log(
  `background: ${backgroundTotalTriangles} triangles kept, ${backgroundTotalRemovedPrimitives} primitives removed across ${removalsByTile.size} tiles.`,
);
