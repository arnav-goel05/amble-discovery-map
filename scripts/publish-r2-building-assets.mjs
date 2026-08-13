#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildBuildingReleaseInventory,
  releaseObjectKey,
} from "./lib/building-release-publish.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "outputs/background-lite-local");
const publishRoot = path.join(outputRoot, "publication");
const mode = process.argv[2] ?? "plan";
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
};
const chunkSize = Number(option("chunk-size", "1000"));
// Cloudflare's OAuth control-plane endpoint permits roughly 1,100 writes per
// five-minute window. Three concurrent uploads keep a sustained run below that
// ceiling without retrying 429 responses.
const concurrency = Number(option("concurrency", "3"));
if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1100)
  throw new Error("--chunk-size must be an integer from 1 to 1100");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
  throw new Error("--concurrency must be an integer from 1 to 32");

const json = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));
const report = json(path.join(outputRoot, "final/report.json"));
report.background.records = json(
  path.join(outputRoot, "reports/background.json"),
).records;
const backgroundTileset = json(
  path.join(outputRoot, "background-lite/tileset.json"),
);
const overlayTileset = json(path.join(outputRoot, "overlays/tileset.json"));
const overlayCatalogue = json(path.join(outputRoot, "overlays/catalogue.json"));
const inventory = buildBuildingReleaseInventory({
  outputRoot,
  report,
  backgroundTileset,
  overlayTileset,
  overlayCatalogue,
});
mkdirSync(publishRoot, { recursive: true });

const descriptor = {
  schemaVersion: "building-asset-release-v1",
  releaseId: inventory.releaseId,
  snapshotId: inventory.snapshotId,
  background: {
    tilesetUrl: `optimized-tiles/releases/${inventory.releaseId}/tileset.json?buildingRelease=${inventory.releaseId}`,
    manifestSha256: inventory.backgroundManifestSha256,
    objectCount: inventory.background.length,
    bytes: inventory.backgroundBytes,
    opacity: 0.3,
  },
  overlays: {
    tilesetUrl: `poi-tiles/releases/${inventory.releaseId}/tileset.json?buildingRelease=${inventory.releaseId}`,
    manifestSha256: inventory.overlayManifestSha256,
    objectCount: inventory.overlays.length,
    bytes: inventory.overlayBytes,
    opacity: 1,
    identityCount: 199,
    ownerCount: 136,
    catalogueId: inventory.catalogueId,
  },
  previous: json(path.join(root, "data/background-geometry-release.json")),
};
const descriptorPath = path.join(
  publishRoot,
  `${inventory.releaseId}-descriptor.json`,
);
writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);

const manifestEntries = [
  ...inventory.background.map((item) => ({
    key: releaseObjectKey("background", inventory.releaseId, item.relativePath),
    file: item.localPath,
  })),
  ...inventory.overlays.map((item) => ({
    key: releaseObjectKey("overlay", inventory.releaseId, item.relativePath),
    file: item.localPath,
  })),
];
const checkpointPath = path.join(
  publishRoot,
  `${inventory.releaseId}-checkpoint.json`,
);
let checkpoint = { releaseId: inventory.releaseId, completedChunks: [] };
try {
  checkpoint = json(checkpointPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (checkpoint.releaseId !== inventory.releaseId)
  throw new Error("Publication checkpoint belongs to another release");

const saveCheckpoint = () => {
  const temporary = `${checkpointPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, checkpointPath);
};
const run = (args) => {
  const result = spawnSync(
    path.join(root, "node_modules/.bin/wrangler"),
    args,
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error(`Wrangler exited ${result.status}`);
};

if (mode === "stage") {
  for (let offset = 0; offset < manifestEntries.length; offset += chunkSize) {
    const chunkIndex = offset / chunkSize;
    if (checkpoint.completedChunks.includes(chunkIndex)) continue;
    const chunkPath = path.join(
      publishRoot,
      `${inventory.releaseId}-chunk-${String(chunkIndex).padStart(3, "0")}.json`,
    );
    writeFileSync(
      chunkPath,
      `${JSON.stringify(manifestEntries.slice(offset, offset + chunkSize))}\n`,
      { mode: 0o600 },
    );
    run([
      "r2",
      "bulk",
      "put",
      "amble-3d-tiles",
      "--remote",
      "--force",
      "--filename",
      chunkPath,
      "--concurrency",
      String(concurrency),
      "--content-type",
      "application/octet-stream",
      "--cache-control",
      "public, max-age=31536000, immutable",
    ]);
    checkpoint.completedChunks.push(chunkIndex);
    saveCheckpoint();
  }
  const backgroundManifestPath = path.join(
    publishRoot,
    `${inventory.releaseId}-background-tileset.json`,
  );
  const overlayManifestPath = path.join(
    publishRoot,
    `${inventory.releaseId}-overlay-tileset.json`,
  );
  writeFileSync(
    backgroundManifestPath,
    `${JSON.stringify(backgroundTileset)}\n`,
  );
  writeFileSync(overlayManifestPath, `${JSON.stringify(overlayTileset)}\n`);
  for (const [key, file] of [
    [
      releaseObjectKey("background", inventory.releaseId, "tileset.json"),
      backgroundManifestPath,
    ],
    [
      releaseObjectKey("overlay", inventory.releaseId, "tileset.json"),
      overlayManifestPath,
    ],
  ])
    run([
      "r2",
      "object",
      "put",
      `amble-3d-tiles/${key}`,
      "--remote",
      "--force",
      "--file",
      file,
      "--content-type",
      "application/json; charset=utf-8",
      "--cache-control",
      "public, max-age=31536000, immutable",
    ]);
  checkpoint.manifestsPublished = true;
  saveCheckpoint();
}

console.log(
  JSON.stringify(
    {
      mode,
      releaseId: inventory.releaseId,
      objectCount: manifestEntries.length,
      bytes: inventory.backgroundBytes + inventory.overlayBytes,
      completedChunks: checkpoint.completedChunks.length,
      completedObjects: checkpoint.completedKeys?.length ?? 0,
      totalChunks: Math.ceil(manifestEntries.length / chunkSize),
      manifestsPublished: checkpoint.manifestsPublished === true,
      descriptor: path.relative(root, descriptorPath),
      advisoryEvidence: {
        visualParity: report.validation.visualParity,
        performanceComplete: report.validation.performance?.complete === true,
      },
    },
    null,
    2,
  ),
);
if (!["plan", "stage"].includes(mode)) process.exitCode = 2;
