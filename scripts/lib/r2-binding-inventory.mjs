import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const normalizedEtag = (value) =>
  typeof value === "string"
    ? value.replace(/^W\//u, "").replace(/^"|"$/gu, "").toLowerCase()
    : null;

export function buildIntegrityReleaseId({ backgroundReleaseId, objects = [] }) {
  if (!/^[a-f0-9]{16}$/u.test(backgroundReleaseId ?? ""))
    throw new Error("A 16-character background release identity is required");
  const objectIdentity = objects
    .map((item) => {
      const key = item.objectKey ?? item.pathname?.replace(/^\/+/, "");
      if (
        typeof key !== "string" ||
        !Number.isInteger(item.byteLength) ||
        item.byteLength < 0 ||
        !/^[a-f0-9]{32}$/u.test(item.md5 ?? "")
      )
        throw new Error("Highlighted object metadata is incomplete");
      return `${key}\0${item.byteLength}\0${item.md5}`;
    })
    .sort()
    .join("\n");
  return createHash("sha256")
    .update(`${backgroundReleaseId}\n${objectIdentity}`)
    .digest("hex")
    .slice(0, 16);
}

export const createIntegrityVerificationId = () =>
  randomBytes(8).toString("hex");

export function r2MetadataState(item, metadata) {
  if (!metadata || metadata.missing === true) return "missing";
  const md5 =
    metadata.md5 ??
    (/^[a-f0-9]{32}$/u.test(normalizedEtag(metadata.etag) ?? "")
      ? normalizedEtag(metadata.etag)
      : null);
  if (!md5) return "unverifiable";
  return md5 === item.md5 && metadata.size === item.byteLength
    ? "matched"
    : "mismatched";
}

export function inventoryObjectMap(report, { id, detail }) {
  const tileset = report?.tilesets?.find((item) => item.id === id);
  if (!tileset) throw new Error(`R2 inventory omitted tileset ${id}`);
  const records = tileset[detail];
  if (!Array.isArray(records))
    throw new Error(`R2 inventory omitted ${id}.${detail}`);
  return new Map(records.map((item) => [item.key, item]));
}

export async function fetchR2BindingInventory({
  origin,
  scope = null,
  releaseId = null,
  verificationId = null,
  fetchImpl = fetch,
  retryAttempts = 1,
  allowIncomplete = false,
}) {
  const url = new URL("/api/tile-integrity", origin);
  if (scope) url.searchParams.set("scope", scope);
  if (releaseId) url.searchParams.set("release", releaseId);
  if (verificationId) {
    if (!/^[a-f0-9]{16}$/u.test(verificationId))
      throw new Error(
        "A 16-character integrity verification identity is required",
      );
    url.searchParams.set("verification", verificationId);
  }
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok || (allowIncomplete && response.status === 503))
        return await response.json();
      const body = (await response.text()).slice(0, 300);
      if (response.status === 429)
        throw Object.assign(
          new Error(`429 rate limit at ${url}; inventory verification stopped`),
          { code: "PUBLIC_RATE_LIMIT" },
        );
      lastError = new Error(
        `${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
      );
      if (![408, 425].includes(response.status) && response.status < 500) break;
    } catch (error) {
      if (error.code === "PUBLIC_RATE_LIMIT") throw error;
      lastError = error;
    }
    if (attempt < retryAttempts)
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error(
    `R2 binding inventory is unavailable at ${url}: ${lastError?.message ?? lastError}`,
  );
}

export function createWranglerCommandRunner({ root, spawnImpl = spawn }) {
  return (commandArgs) =>
    new Promise((resolve, reject) => {
      const child = spawnImpl(
        path.join(root, "node_modules/.bin/wrangler"),
        commandArgs,
        {
          cwd: root,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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
        if (code === 0) resolve(stdout);
        else
          reject(
            new Error(
              `Wrangler exited ${code}: ${(stderr || stdout).trim().slice(-1000)}`,
            ),
          );
      });
    });
}

export function createR2ControlPlane({
  runCommand,
  bucket = "amble-3d-tiles",
  temporaryRoot = os.tmpdir(),
}) {
  return {
    async getObjectBytes(key) {
      const directory = await mkdtemp(
        path.join(temporaryRoot, "amble-r2-object-"),
      );
      const filePath = path.join(directory, "object.bin");
      try {
        await runCommand([
          "r2",
          "object",
          "get",
          `${bucket}/${key}`,
          "--remote",
          "--file",
          filePath,
        ]);
        return await readFile(filePath);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async putObject({ key, filePath, contentType, cacheControl }) {
      await runCommand([
        "r2",
        "object",
        "put",
        `${bucket}/${key}`,
        "--remote",
        "--force",
        "--file",
        filePath,
        "--content-type",
        contentType,
        ...(cacheControl ? ["--cache-control", cacheControl] : []),
      ]);
    },
  };
}
