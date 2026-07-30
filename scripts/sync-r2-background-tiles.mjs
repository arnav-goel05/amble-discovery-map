#!/usr/bin/env node

import { spawn } from "node:child_process";
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
  parseB3dmGmlIds,
  releaseDescriptor,
  synchronizeBackgroundRelease,
} from "./lib/background-geometry-release.mjs";

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

function normalizedEtag(value) {
  return value?.replace(/^W\//u, "").replace(/^"|"$/gu, "").toLowerCase() ?? null;
}

function objectUrl(item, query) {
  const url = new URL(
    item.objectKey
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/"),
    origin,
  );
  url.search = query;
  return url;
}

async function responseError(response, url) {
  const body = (await response.text().catch(() => "")).slice(0, 300);
  return new Error(
    `${response.status} ${response.statusText} for ${url}${body ? `: ${body}` : ""}`,
  );
}

async function fetchWithRetries(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(120_000),
      });
      if (
        response.ok ||
        ![408, 425, 429].includes(response.status) &&
          (response.status < 500 || response.status > 599) ||
        attempt === retryAttempts
      )
        return response;
      await response.body?.cancel();
      lastError = new Error(
        `${response.status} ${response.statusText} for ${url}`,
      );
    } catch (error) {
      lastError = error;
      if (attempt === retryAttempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw lastError;
}

function remoteFetcher(queryForItem) {
  let checked = 0;
  return async (item) => {
    const url = objectUrl(item, queryForItem(item));
    const head = await fetchWithRetries(url, {
      method: "HEAD",
    });
    if (!head.ok) throw await responseError(head, url);
    if (head.headers.get("x-amble-tile-source") !== "r2")
      throw new Error(`Object was not served by R2: ${item.objectKey}`);
    const length = Number(head.headers.get("content-length"));
    if (
      normalizedEtag(head.headers.get("etag")) === item.md5 &&
      (!Number.isFinite(length) || length === item.byteLength)
    )
      return {
        matchesLocal: true,
        remoteByteLength: Number.isFinite(length) ? length : item.byteLength,
      };
    const headerResponse = await fetchWithRetries(url, {
      headers: { range: "bytes=0-27" },
    });
    if (headerResponse.status !== 206)
      throw await responseError(headerResponse, url);
    const header = Buffer.from(await headerResponse.arrayBuffer());
    if (header.length !== 28 || header.toString("ascii", 0, 4) !== "b3dm")
      throw new Error(`Remote object has an invalid B3DM header: ${item.objectKey}`);
    const batchEnd =
      28 +
      header.readUInt32LE(12) +
      header.readUInt32LE(16) +
      header.readUInt32LE(20);
    const batchResponse = await fetchWithRetries(url, {
      headers: { range: `bytes=0-${batchEnd - 1}` },
    });
    if (batchResponse.status !== 206)
      throw await responseError(batchResponse, url);
    const prefix = Buffer.from(await batchResponse.arrayBuffer());
    checked += 1;
    if (checked % 50 === 0)
      console.error(`Inspected ${checked} mismatched remote B3DM objects.`);
    const remoteMd5 = normalizedEtag(head.headers.get("etag"));
    return {
      remoteGmlIds: parseB3dmGmlIds(prefix),
      remoteByteLength: Number.isFinite(length) ? length : null,
      remoteState: item.sourceMd5s?.includes(remoteMd5)
        ? "pristine"
        : "intermediate",
    };
  };
}

const runWrangler = (commandArgs) =>
  new Promise((resolve, reject) => {
    const executable = path.join(root, "node_modules/.bin/wrangler");
    const child = spawn(executable, commandArgs, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      reject(
        new Error(
          `Wrangler exited ${code}: ${(stderr || stdout).trim().slice(-1000)}`,
        ),
      );
    });
  });

async function upload(item) {
  await runWrangler([
    "r2",
    "object",
    "put",
    `amble-3d-tiles/${item.objectKey}`,
    "--remote",
    "--force",
    "--file",
    item.localPath,
    "--content-type",
    "application/octet-stream",
    "--cache-control",
    "public, max-age=86400, stale-while-revalidate=604800",
  ]);
}

const runToken = `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
const active = deriveActiveBackgroundObjects({ root });
const objects = await mapLimit(active.objects, concurrency, async (item, index) => {
  const hashes = await hashFile(item.localPath);
  if (hashes.sha256 !== item.sha256)
    throw new Error(
      `Local approved hash mismatch for ${item.objectKey}: expected ${item.sha256}, received ${hashes.sha256}`,
    );
  if ((index + 1) % 100 === 0)
    console.error(`Validated ${index + 1}/${active.objects.length} local objects.`);
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
});

const reportDirectory = path.join(root, "outputs/background-geometry-release");
mkdirSync(reportDirectory, { recursive: true });
const reportPath = path.resolve(
  root,
  option("report", `outputs/background-geometry-release/${runToken}-${mode}.json`),
);

let report;
if (mode === "audit") {
  report = await auditBackgroundObjects({
    snapshotId: active.snapshotId,
    objects,
    origin: origin.href,
    concurrency,
    fetchObject: remoteFetcher(
      () => `backgroundAudit=${encodeURIComponent(runToken)}`,
    ),
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
    fetchObject: remoteFetcher(
      () => `backgroundPreflight=${encodeURIComponent(runToken)}`,
    ),
    fetchVerifiedObject: remoteFetcher(
      (item) => `backgroundObject=${item.sha256}`,
    ),
    uploadObject: async (item) => {
      await upload(item);
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
      await runWrangler([
        "r2",
        "object",
        "put",
        "amble-3d-tiles/optimized-tiles/tileset.json",
        "--remote",
        "--force",
        "--file",
        stagedPath,
        "--content-type",
        "application/json; charset=utf-8",
        "--cache-control",
        "public, max-age=300, stale-while-revalidate=86400",
      ]);
      const url = new URL(
        `optimized-tiles/tileset.json?backgroundRelease=${identity.releaseId}`,
        origin,
      );
      const response = await fetchWithRetries(url);
      if (!response.ok) throw await responseError(response, url);
      const served = Buffer.from(await response.arrayBuffer());
      if (
        createHash("sha256").update(served).digest("hex") !==
        createHash("sha256").update(bytes).digest("hex")
      )
        throw new Error("Published tileset manifest did not verify byte-for-byte");
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
  const descriptorPath = path.join(root, "data/background-geometry-release.json");
  const temporaryPath = `${descriptorPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(descriptor, null, 2)}\n`, {
    mode: 0o644,
  });
  renameSync(temporaryPath, descriptorPath);
  report.releaseDescriptor = descriptor;
}

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
