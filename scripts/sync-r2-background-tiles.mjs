#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  auditBackgroundObjects,
  deriveActiveBackgroundObjects,
  releaseDescriptor,
  synchronizeBackgroundRelease,
} from "./lib/background-geometry-release.mjs";
import {
  createR2ControlPlane,
  createWranglerCommandRunner,
  createIntegrityVerificationId,
  fetchR2BindingInventory,
  inventoryObjectMap,
  r2MetadataState,
} from "./lib/r2-binding-inventory.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = args[0] === "sync" ? "sync" : "audit";
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const origin = new URL(
  option("origin", "https://amble.project-hub-arnav.workers.dev"),
);
const inventoryOrigin = option(
  "inventory-origin",
  process.env.R2_INVENTORY_ORIGIN ??
    "https://amble-tile-integrity.project-hub-arnav.workers.dev",
);
const concurrency = Number(option("concurrency", mode === "sync" ? "4" : "8"));
const retryAttempts = Number(option("retry-attempts", "3"));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
  throw new Error("--concurrency must be an integer from 1 to 32");
if (!Number.isInteger(retryAttempts) || retryAttempts < 1 || retryAttempts > 10)
  throw new Error("--retry-attempts must be an integer from 1 to 10");

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
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
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

const runToken = `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
const active = deriveActiveBackgroundObjects({ root });
const objects = await mapLimit(
  active.objects,
  concurrency,
  async (item, index) => {
    const hashes = await hashFile(item.localPath);
    if (hashes.sha256 !== item.sha256)
      throw new Error(
        `Local approved hash mismatch for ${item.objectKey}: expected ${item.sha256}, received ${hashes.sha256}`,
      );
    if ((index + 1) % 100 === 0)
      console.error(
        `Validated ${index + 1}/${active.objects.length} local objects.`,
      );
    const sourceHashes = [];
    for (const sourcePath of item.sourcePaths ?? []) {
      if (!existsSync(sourcePath)) continue;
      const source = await hashFile(sourcePath);
      sourceHashes.push(source);
    }
    const expectedSourceHashes = new Set(item.sourceSha256s ?? []);
    return {
      ...item,
      md5: hashes.md5,
      sourceMd5s: [
        ...new Set(
          sourceHashes
            .filter(
              ({ sha256 }) =>
                expectedSourceHashes.size === 0 ||
                expectedSourceHashes.has(sha256),
            )
            .map(({ md5 }) => md5),
        ),
      ],
    };
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
  releaseId: currentRelease.releaseId,
  verificationId: createIntegrityVerificationId(),
  retryAttempts,
  allowIncomplete: true,
});
const remoteMetadata = inventoryObjectMap(inventoryReport, {
  id: "background",
  detail: "versionedObjects",
});
if (remoteMetadata.size !== objects.length)
  throw new Error(
    `R2 background inventory metadata is incomplete: expected ${objects.length}, received ${remoteMetadata.size}`,
  );
const uploadedKeys = new Set();
const inventoryFetcher = async (item) => {
  const metadata = remoteMetadata.get(item.objectKey);
  const state = r2MetadataState(item, metadata);
  if (state === "matched")
    return { matchesLocal: true, remoteByteLength: metadata.size };
  if (state === "missing")
    return {
      remoteGmlIds: [],
      remoteByteLength: null,
      remoteState: "unavailable",
    };
  return readR2Object(item.objectKey);
};
const verifiedFetcher = async (item) =>
  uploadedKeys.has(item.objectKey)
    ? readR2Object(item.objectKey)
    : inventoryFetcher(item);

const reportDirectory = path.join(root, "outputs/background-geometry-release");
mkdirSync(reportDirectory, { recursive: true });
const reportPath = path.resolve(
  root,
  option(
    "report",
    `outputs/background-geometry-release/${runToken}-${mode}.json`,
  ),
);

let report;
if (mode === "audit") {
  report = await auditBackgroundObjects({
    snapshotId: active.snapshotId,
    objects,
    origin: origin.href,
    concurrency,
    fetchObject: inventoryFetcher,
  });
} else {
  const sourceTileset = JSON.parse(
    readFileSync(path.join(root, "optimized-tiles/tileset.json"), "utf8"),
  );
  let uploaded = 0;
  let publishedManifestBytes = null;
  report = await synchronizeBackgroundRelease({
    snapshotId: active.snapshotId,
    objects,
    sourceTileset,
    origin: origin.href,
    concurrency,
    retryAttempts,
    fetchObject: inventoryFetcher,
    fetchVerifiedObject: verifiedFetcher,
    uploadObject: async (item) => {
      await r2.putObject({
        key: item.objectKey,
        filePath: item.localPath,
        contentType: "application/octet-stream",
        cacheControl: "public, max-age=86400, stale-while-revalidate=604800",
      });
      uploadedKeys.add(item.objectKey);
      uploaded += 1;
      if (uploaded % 10 === 0)
        console.error(`Uploaded ${uploaded} stale background objects.`);
    },
    publishManifest: async (manifest, identity) => {
      const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
      const stagedPath = path.join(
        reportDirectory,
        `${identity.releaseId}-tileset.json`,
      );
      writeFileSync(stagedPath, bytes);
      await r2.putObject({
        key: "optimized-tiles/tileset.json",
        filePath: stagedPath,
        contentType: "application/json; charset=utf-8",
        cacheControl: "public, max-age=300, stale-while-revalidate=86400",
      });
      const served = await readR2Object("optimized-tiles/tileset.json");
      if (
        createHash("sha256").update(served).digest("hex") !==
        createHash("sha256").update(bytes).digest("hex")
      )
        throw new Error(
          "Published tileset manifest did not verify byte-for-byte",
        );
      publishedManifestBytes = bytes;
    },
  });
  if (!publishedManifestBytes)
    throw new Error("Synchronization completed without a published manifest");
  const descriptor = releaseDescriptor({
    snapshotId: active.snapshotId,
    objects,
    manifestBytes: publishedManifestBytes,
  });
  const descriptorPath = path.join(
    root,
    "data/background-geometry-release.json",
  );
  const temporaryPath = `${descriptorPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(descriptor, null, 2)}\n`, {
    mode: 0o644,
  });
  renameSync(temporaryPath, descriptorPath);
  report.releaseDescriptor = descriptor;
}

report.requestBudget = {
  publicIntegrityRequests: 1,
  publicObjectRequests: 0,
  controlPlaneObjectReads,
};

mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
});
console.log(
  JSON.stringify(
    {
      complete: report.complete,
      mode,
      releaseId: report.releaseId,
      snapshotId: report.snapshotId,
      summary: report.summary,
      report: path.relative(root, reportPath),
    },
    null,
    2,
  ),
);
if (!report.complete) process.exitCode = 1;
