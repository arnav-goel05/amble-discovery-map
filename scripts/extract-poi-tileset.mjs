import fs from "node:fs";
import path from "node:path";

import { Accessor, NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const TILESET_ROOT = "https://www.onemap.gov.sg/omapi/tilesets/sg_noterrain_tiles/";
const REQUEST_HEADERS = {
  Referer: "https://www.onemap.gov.sg/3d",
  Origin: "https://www.onemap.gov.sg",
  "User-Agent": "Mozilla/5.0",
};
const POI_SOURCE_TILE = "optimized-tiles/7/78/12_0.b3dm";
const BACKGROUND_SOURCE_TILES = [
  "optimized-tiles/7/78/12_0.b3dm",
  "optimized-tiles/7/78/12_1.b3dm",
  "optimized-tiles/7/78/12_2.b3dm",
  "optimized-tiles/7/78/12_3.b3dm",
  "optimized-tiles/7/78/12_4.b3dm",
  "optimized-tiles/7/78/12_5.b3dm",
];
const OUTPUT_DIR = "public/poi-tiles/esplanade";
const SOURCE_BACKUP_DIR = path.join(OUTPUT_DIR, "source");
const POI_OUTPUT_TILE = "esplanade.b3dm";
const POI_BATCH_IDS = [4, 6, 7, 8];

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

function sourceBackupPath(sourceTile) {
  return path.join(SOURCE_BACKUP_DIR, sourceTile.replace(/^optimized-tiles\//, ""));
}

async function preserveSourceTile(sourceTile) {
  const backupPath = sourceBackupPath(sourceTile);
  if (fs.existsSync(sourceTile) || fs.existsSync(backupPath)) {
    return;
  }
  if (!fs.existsSync(backupPath)) {
    const sourceUri = sourceTile.replace(/^optimized-tiles\//, "");
    const response = await fetch(new URL(sourceUri, TILESET_ROOT), { headers: REQUEST_HEADERS });
    if (!response.ok) throw new Error(`Failed ${response.status} while downloading ${sourceUri}`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, Buffer.from(await response.arrayBuffer()));
  }
}

function readSourceB3dm(sourceTile) {
  const backupPath = sourceBackupPath(sourceTile);
  return readB3dm(fs.existsSync(backupPath) ? backupPath : sourceTile);
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
  fs.writeFileSync(filePath, Buffer.concat([header, parts.featureTableJson, parts.featureTableBinary, parts.batchTableJson, parts.batchTableBinary, glb]));
}

function parsePaddedJson(buffer) {
  return JSON.parse(buffer.toString("utf8").trim());
}

function paddedJsonBuffer(value) {
  let json = JSON.stringify(value);
  while (json.length % 8 !== 0) json += " ";
  return Buffer.from(json, "utf8");
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

function makeBatchIdRemap(batchIds) {
  return new Map(batchIds.map((batchId, index) => [batchId, index]));
}

function getBatchIds(parts) {
  const featureTable = parsePaddedJson(parts.featureTableJson);
  return Array.from({ length: featureTable.BATCH_LENGTH }, (_, index) => index);
}

function writePoiTileset(sourceTilesetPath) {
  const sourceTileset = JSON.parse(fs.readFileSync(sourceTilesetPath, "utf8"));
  const sourceTile = findSourceTile(sourceTileset.root);
  if (!sourceTile) throw new Error(`Could not find ${POI_SOURCE_TILE} in source tileset`);

  const tileset = {
    asset: sourceTileset.asset,
    geometricError: 2,
    root: {
      boundingVolume: sourceTile.boundingVolume,
      geometricError: 1,
      refine: "REPLACE",
      content: { uri: POI_OUTPUT_TILE },
    },
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "tileset.json"), `${JSON.stringify(tileset, null, 2)}\n`);
}

function findSourceTile(tile) {
  const contentUri = tile.content?.uri || tile.content?.url;
  if (contentUri === POI_SOURCE_TILE.replace(/^optimized-tiles\//, "")) return tile;
  for (const child of tile.children || []) {
    const found = findSourceTile(child);
    if (found) return found;
  }
  return null;
}

const decoder = await draco3d.createDecoderModule();
const encoder = await draco3d.createEncoderModule();
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  "draco3d.decoder": decoder,
  "draco3d.encoder": encoder,
});
for (const sourceTile of BACKGROUND_SOURCE_TILES) {
  await preserveSourceTile(sourceTile);
}

const b3dm = readSourceB3dm(POI_SOURCE_TILE);
const allBatchIds = getBatchIds(b3dm);
const poiBatchIdRemap = makeBatchIdRemap(POI_BATCH_IDS);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const poiDocument = await io.readBinary(new Uint8Array(b3dm.glb));
const poiStats = filterDocument(poiDocument, new Set(POI_BATCH_IDS), poiBatchIdRemap);
await poiDocument.transform(prune());
const poiGlb = Buffer.from(await io.writeBinary(poiDocument));
writeB3dm(buildB3dmParts(b3dm, poiBatchIdRemap), poiGlb, path.join(OUTPUT_DIR, POI_OUTPUT_TILE));
writePoiTileset("optimized-tiles/tileset.json");

let totalBackgroundTriangles = 0;
let totalBackgroundRemovedPrimitives = 0;
for (const sourceTile of BACKGROUND_SOURCE_TILES) {
  const backgroundB3dm = readSourceB3dm(sourceTile);
  const backgroundBatchIds = getBatchIds(backgroundB3dm).filter((batchId) => !POI_BATCH_IDS.includes(batchId));
  const backgroundBatchIdRemap = makeBatchIdRemap(backgroundBatchIds);
  const backgroundDocument = await io.readBinary(new Uint8Array(backgroundB3dm.glb));
  const backgroundStats = filterDocument(backgroundDocument, new Set(backgroundBatchIds), backgroundBatchIdRemap);
  await backgroundDocument.transform(prune());
  const backgroundGlb = Buffer.from(await io.writeBinary(backgroundDocument));
  const outputTile = sourceTile.replace(/^optimized-tiles\//, "background/");
  fs.mkdirSync(path.dirname(path.join(OUTPUT_DIR, outputTile)), { recursive: true });
  writeB3dm(buildB3dmParts(backgroundB3dm, backgroundBatchIdRemap), backgroundGlb, path.join(OUTPUT_DIR, outputTile));
  writeB3dm(buildB3dmParts(backgroundB3dm, backgroundBatchIdRemap), backgroundGlb, sourceTile);
  totalBackgroundTriangles += backgroundStats.keptTriangles;
  totalBackgroundRemovedPrimitives += backgroundStats.removedPrimitives;
}

console.log(
  `Extracted Esplanade POI tile: ${poiStats.keptTriangles} triangles kept, ${poiStats.removedPrimitives} primitives removed.`,
);
console.log(
  `Extracted Esplanade background tiles: ${totalBackgroundTriangles} triangles kept, ${totalBackgroundRemovedPrimitives} primitives removed.`,
);
