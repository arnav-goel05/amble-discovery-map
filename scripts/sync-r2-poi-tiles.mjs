#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildIntegrityReleaseId,
  createIntegrityVerificationId,
  createR2ControlPlane,
  createWranglerCommandRunner,
  fetchR2BindingInventory,
  inventoryObjectMap,
  r2MetadataState,
} from "./lib/r2-binding-inventory.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] === "sync" ? "sync" : "audit";
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
};
const inventoryOrigin = option(
  "inventory-origin",
  process.env.R2_INVENTORY_ORIGIN ??
    "https://amble-tile-integrity.project-hub-arnav.workers.dev",
);
const concurrency = Number(option("concurrency", mode === "sync" ? "4" : "16"));

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  throw new Error("--concurrency must be an integer from 1 to 32");
}

function currentObjects() {
  const poiRoot = path.join(root, "public/poi-tiles");
  const objects = [];
  for (const directory of readdirSync(poiRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const manifestPath = path.join(
      poiRoot,
      directory.name,
      "extraction-manifest.json",
    );
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const tile of manifest.tiles ?? []) {
      if (
        !/^[a-z0-9][a-z0-9-]*$/u.test(directory.name) ||
        typeof tile.poiFile !== "string" ||
        tile.poiFile.includes("..") ||
        path.basename(tile.poiFile) !== tile.poiFile ||
        !tile.poiFile.endsWith(".b3dm") ||
        !/^[a-f0-9]{64}$/u.test(tile.poiSha256 ?? "")
      ) {
        throw new Error(
          `Invalid current POI tile manifest entry: ${directory.name}/${tile.poiFile}`,
        );
      }
      const localPath = path.join(poiRoot, directory.name, tile.poiFile);
      if (!existsSync(localPath)) {
        throw new Error(`Current POI tile is missing: ${localPath}`);
      }
      objects.push({
        objectKey: `poi-tiles/${directory.name}/${tile.poiFile}`,
        localPath,
        sha256: tile.poiSha256,
        byteLength: statSync(localPath).size,
      });
    }
  }
  return [
    ...new Map(objects.map((item) => [item.objectKey, item])).values(),
  ].sort((left, right) => left.objectKey.localeCompare(right.objectKey));
}

const hashFile = (filePath) =>
  new Promise((resolve, reject) => {
    const sha256 = createHash("sha256");
    const md5 = createHash("md5");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      sha256.update(chunk);
      md5.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () =>
      resolve({ sha256: sha256.digest("hex"), md5: md5.digest("hex") }),
    );
  });

async function mapLimit(items, limit, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
      completed += 1;
      if (completed % 100 === 0 || completed === items.length) {
        console.error(`Checked ${completed}/${items.length} POI R2 objects.`);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

const runWrangler = createWranglerCommandRunner({ root });
const r2 = createR2ControlPlane({ runCommand: runWrangler });
let controlPlaneObjectReads = 0;
const readR2Object = async (key) => {
  controlPlaneObjectReads += 1;
  return r2.getObjectBytes(key);
};

async function uploadOnce(item) {
  await r2.putObject({
    key: item.objectKey,
    filePath: item.localPath,
    contentType: "application/octet-stream",
    cacheControl: "public, max-age=86400, stale-while-revalidate=604800",
  });
}

async function upload(item) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await uploadOnce(item);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

const objects = await mapLimit(
  currentObjects(),
  Math.min(concurrency, 12),
  async (item) => {
    const hashes = await hashFile(item.localPath);
    if (hashes.sha256 !== item.sha256) {
      throw new Error(
        `Current POI hash mismatch for ${item.objectKey}: expected ${item.sha256}, received ${hashes.sha256}`,
      );
    }
    return { ...item, md5: hashes.md5 };
  },
);
const currentRelease = JSON.parse(
  readFileSync(
    path.join(root, "data/background-geometry-release.json"),
    "utf8",
  ),
);
const inventoryReport = await fetchR2BindingInventory({
  origin: inventoryOrigin,
  scope: "poi",
  releaseId: buildIntegrityReleaseId({
    backgroundReleaseId: currentRelease.releaseId,
    objects,
  }),
  verificationId: createIntegrityVerificationId(),
  allowIncomplete: true,
});
const remoteObjects = inventoryObjectMap(inventoryReport, {
  id: "highlighted",
  detail: "inventoryObjects",
});

let results = await mapLimit(objects, concurrency, async (item) => ({
  item,
  state: r2MetadataState(item, remoteObjects.get(item.objectKey)),
}));
const stale = results.filter(({ state }) => state !== "matched");

if (mode === "sync" && stale.length > 0) {
  console.error(`Uploading ${stale.length} missing or mismatched POI objects.`);
  await mapLimit(stale, Math.min(concurrency, 4), async ({ item }) => {
    await upload(item);
  });
  const uploadedKeys = new Set(stale.map(({ item }) => item.objectKey));
  results = await mapLimit(objects, concurrency, async (item) => {
    if (!uploadedKeys.has(item.objectKey))
      return {
        item,
        state: r2MetadataState(item, remoteObjects.get(item.objectKey)),
      };
    const bytes = await readR2Object(item.objectKey);
    return {
      item,
      state:
        createHash("md5").update(bytes).digest("hex") === item.md5 &&
        bytes.length === item.byteLength
          ? "matched"
          : "mismatched",
    };
  });
}

const summary = {
  mode,
  checkedObjects: results.length,
  matchedObjects: results.filter(({ state }) => state === "matched").length,
  missingObjects: results.filter(({ state }) => state === "missing").length,
  mismatchedObjects: results.filter(({ state }) => state === "mismatched")
    .length,
  unverifiableObjects: results.filter(({ state }) => state === "unverifiable")
    .length,
};
const complete =
  summary.missingObjects === 0 &&
  summary.mismatchedObjects === 0 &&
  summary.unverifiableObjects === 0;
console.log(
  JSON.stringify(
    {
      complete,
      ...summary,
      requestBudget: {
        publicIntegrityRequests: 1,
        publicObjectRequests: 0,
        controlPlaneObjectReads,
      },
    },
    null,
    2,
  ),
);
if (!complete) process.exitCode = 1;
