import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const INPUT_DIR = process.env.INPUT_DIR || "tiles";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "optimized-tiles";
const OPTIMIZE_LIMIT = Number(process.env.OPTIMIZE_LIMIT || 0);
const HARDLINK_EXISTING = process.env.HARDLINK_EXISTING !== "0";

const stats = {
  processed: 0,
  alreadyDraco: 0,
  optimizedDraco: 0,
  fallbackLinked: 0,
  failed: 0,
};
const failures = [];

function walkB3dmFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkB3dmFiles(filePath, files);
    else if (entry.isFile() && entry.name.endsWith(".b3dm")) files.push(filePath);
  }
  return files;
}

function readJsonChunkFromGlb(buffer, offset) {
  if (buffer.toString("utf8", offset, offset + 4) !== "glTF") return null;
  const jsonChunkLength = buffer.readUInt32LE(offset + 12);
  const jsonChunkType = buffer.toString("utf8", offset + 16, offset + 20);
  if (jsonChunkType !== "JSON") return null;
  return JSON.parse(buffer.toString("utf8", offset + 20, offset + 20 + jsonChunkLength));
}

function readB3dmGltfJson(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("utf8", 0, 4) !== "b3dm") return null;

  const featureTableJsonLength = buffer.readUInt32LE(12);
  const featureTableBinaryLength = buffer.readUInt32LE(16);
  const batchTableJsonLength = buffer.readUInt32LE(20);
  const batchTableBinaryLength = buffer.readUInt32LE(24);
  const glbOffset = 28 + featureTableJsonLength + featureTableBinaryLength + batchTableJsonLength + batchTableBinaryLength;
  return readJsonChunkFromGlb(buffer, glbOffset);
}

function usesDraco(gltf) {
  if (!gltf) return false;
  if ((gltf.extensionsUsed || []).includes("KHR_draco_mesh_compression")) return true;
  return (gltf.meshes || []).some((mesh) =>
    (mesh.primitives || []).some((primitive) => primitive.extensions?.KHR_draco_mesh_compression),
  );
}

function linkOrCopy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  if (HARDLINK_EXISTING) {
    try {
      fs.linkSync(source, target);
      return;
    } catch {
      // Fall through to copying when hard links are unavailable.
    }
  }
  fs.copyFileSync(source, target);
}

function run(command, args) {
  execFileSync(command, args, { stdio: "pipe" });
}

function optimizeTile(source, target) {
  const tempBase = `${target}.tmp`;
  const tempGlb = `${tempBase}.glb`;
  const tempProcessedGlb = `${tempBase}-processed.glb`;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(tempGlb, { force: true });
  fs.rmSync(tempProcessedGlb, { force: true });

  run("./node_modules/.bin/3d-tiles-tools", ["b3dmToGlb", "-f", "-i", source, "-o", tempGlb]);
  run("./node_modules/.bin/gltf-pipeline", [
    "-i",
    tempGlb,
    "-o",
    tempProcessedGlb,
    "-d",
    "--draco.quantizePositionBits",
    "14",
    "--draco.compressionLevel",
    "10",
  ]);
  run("./node_modules/.bin/3d-tiles-tools", ["glbToB3dm", "-f", "-i", tempProcessedGlb, "-o", target]);

  fs.rmSync(tempGlb, { force: true });
  fs.rmSync(tempProcessedGlb, { force: true });
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.copyFileSync(path.join(INPUT_DIR, "tileset.json"), path.join(OUTPUT_DIR, "tileset.json"));

const sourceFiles = walkB3dmFiles(INPUT_DIR).sort();
const selectedFiles = OPTIMIZE_LIMIT > 0 ? sourceFiles.slice(0, OPTIMIZE_LIMIT) : sourceFiles;

for (const source of selectedFiles) {
  const relativePath = path.relative(INPUT_DIR, source);
  const target = path.join(OUTPUT_DIR, relativePath);
  stats.processed += 1;

  try {
    const gltf = readB3dmGltfJson(source);
    if (usesDraco(gltf)) {
      linkOrCopy(source, target);
      stats.alreadyDraco += 1;
    } else {
      try {
        optimizeTile(source, target);
        stats.optimizedDraco += 1;
      } catch (error) {
        linkOrCopy(source, target);
        stats.fallbackLinked += 1;
        failures.push({ file: relativePath, stage: "draco-optimize", error: error.message });
      }
    }
  } catch (error) {
    stats.failed += 1;
    failures.push({ file: relativePath, stage: "inspect", error: error.message });
  }

  if (stats.processed % 100 === 0 || stats.processed === selectedFiles.length) {
    console.log(JSON.stringify(stats));
  }
}

if (failures.length > 0) {
  fs.writeFileSync(path.join(OUTPUT_DIR, "optimization-failures.json"), `${JSON.stringify(failures, null, 2)}\n`);
}

console.log(`Optimized ${stats.processed} tile files into ${OUTPUT_DIR}.`);
console.log(JSON.stringify(stats, null, 2));
