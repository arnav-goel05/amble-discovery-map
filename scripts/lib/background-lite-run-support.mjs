import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { verifiedSourceExclusions } from "./background-source-exclusions.mjs";

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

export function canonicalJson(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, normalize(input[key])]),
      );
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function canonicalSourcePath(value) {
  const normalized = String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/^(?:tiles|optimized-tiles)\//u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized
      .split("/")
      .some((segment) => segment === ".." || segment === ".") ||
    !normalized.endsWith(".b3dm")
  )
    throw new Error(`Unsafe source tile path: ${value}`);
  return normalized;
}

export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object")
    throw new Error("Background-lite policy must be an object");
  if (policy.schemaVersion !== "background-lite-policy-v1")
    throw new Error("Unsupported background-lite policy schema");
  if (
    !Number.isInteger(policy.maximumTextureDimension) ||
    policy.maximumTextureDimension < 1
  )
    throw new Error("maximumTextureDimension must be a positive integer");
  if (
    !Number.isInteger(policy.jpegQuality) ||
    policy.jpegQuality < 1 ||
    policy.jpegQuality > 100
  )
    throw new Error("jpegQuality must be between 1 and 100");
  if (
    typeof policy.backgroundOpacity !== "number" ||
    policy.backgroundOpacity < 0 ||
    policy.backgroundOpacity > 1
  )
    throw new Error("backgroundOpacity must be between 0 and 1");
  return policy;
}

export function indexTileset(tileset) {
  if (!tileset?.root) throw new Error("Source tileset has no root");
  const records = [];
  const visit = (tile) => {
    const raw = tile.content?.uri ?? tile.content?.url;
    if (raw) {
      const canonicalPath = canonicalSourcePath(raw.split("?")[0]);
      records.push({
        canonicalPath,
        boundingVolume: tile.boundingVolume ?? null,
        geometricError: tile.geometricError ?? 0,
        transform: tile.transform ?? null,
      });
    }
    for (const child of tile.children ?? []) visit(child);
  };
  visit(tileset.root);
  const unique = new Map();
  for (const record of records) {
    if (unique.has(record.canonicalPath))
      throw new Error(`Duplicate source tile: ${record.canonicalPath}`);
    unique.set(record.canonicalPath, record);
  }
  return [...unique.values()].sort((a, b) =>
    a.canonicalPath.localeCompare(b.canonicalPath),
  );
}

export function inventorySource({ sourceRoot }) {
  const resolvedRoot = path.resolve(sourceRoot);
  const realRoot = fs.realpathSync(resolvedRoot);
  const tilesetPath = path.join(resolvedRoot, "tileset.json");
  const tilesetBytes = fs.readFileSync(tilesetPath);
  const tileset = JSON.parse(tilesetBytes);
  const indexedRecords = indexTileset(tileset);
  const missingPaths = indexedRecords
    .filter(
      (record) => !fs.existsSync(path.join(resolvedRoot, record.canonicalPath)),
    )
    .map(({ canonicalPath }) => canonicalPath);
  const exclusions = verifiedSourceExclusions({
    sourceRoot: resolvedRoot,
    referencedPaths: indexedRecords.map(({ canonicalPath }) => canonicalPath),
    missingPaths,
  });
  const excludedPaths = new Set(
    exclusions.records.map(({ canonicalPath }) => canonicalPath),
  );
  const records = indexedRecords
    .filter(({ canonicalPath }) => !excludedPaths.has(canonicalPath))
    .map((record) => {
      const sourcePath = path.join(resolvedRoot, record.canonicalPath);
      if (!sourcePath.startsWith(`${resolvedRoot}${path.sep}`))
        throw new Error(`Source escaped root: ${record.canonicalPath}`);
      const realSourcePath = fs.realpathSync(sourcePath);
      if (!realSourcePath.startsWith(`${realRoot}${path.sep}`))
        throw new Error(
          `Source tile escaped root through a link: ${record.canonicalPath}`,
        );
      const bytes = fs.readFileSync(sourcePath);
      return {
        ...record,
        sourcePath,
        sourceBytes: bytes.length,
        sourceSha256: sha256(bytes),
      };
    });
  const inventoryId = sha256(
    canonicalJson({
      tilesetSha256: sha256(tilesetBytes),
      exclusionEvidenceIdentity: exclusions.evidenceIdentity,
      exclusions: exclusions.records.map(({ canonicalPath, reason }) => ({
        canonicalPath,
        reason,
      })),
      records: records.map(({ canonicalPath, sourceBytes, sourceSha256 }) => ({
        canonicalPath,
        sourceBytes,
        sourceSha256,
      })),
    }),
  ).slice(0, 16);
  return {
    resolvedRoot,
    tileset,
    tilesetSha256: sha256(tilesetBytes),
    records,
    exclusions: exclusions.records,
    totalRecordCount: indexedRecords.length,
    inventoryId,
  };
}

export function atomicWrite(destination, bytes) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function atomicLink(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs.linkSync(source, temporary);
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function availableCapacity(destination) {
  const target = fs.existsSync(destination)
    ? destination
    : path.dirname(destination);
  const { bavail, bsize } = fs.statfsSync(target);
  return Number(bavail) * Number(bsize);
}

export function assertCapacity({
  destination,
  requiredBytes,
  reserveBytes = 1_073_741_824,
}) {
  const availableBytes = availableCapacity(destination);
  if (availableBytes - reserveBytes < requiredBytes) {
    const error = new Error(
      "Insufficient capacity for the next background-lite batch",
    );
    error.code = "BACKGROUND_LITE_CAPACITY";
    error.details = { availableBytes, reserveBytes, requiredBytes };
    throw error;
  }
  return { availableBytes, reserveBytes, requiredBytes };
}

export function assembleTileset(sourceTileset, selectedPaths) {
  const selected = new Set([...selectedPaths].map(canonicalSourcePath));
  const visit = (tile, isRoot = false) => {
    const output = structuredClone(tile);
    const raw = output.content?.uri ?? output.content?.url;
    if (raw && !selected.has(canonicalSourcePath(raw.split("?")[0])))
      delete output.content;
    output.children = (output.children ?? [])
      .map((child) => visit(child))
      .filter(Boolean);
    if (!output.children.length) delete output.children;
    return isRoot || output.content || output.children ? output : null;
  };
  const assembled = structuredClone(sourceTileset);
  assembled.root = visit(sourceTileset.root, true);
  const assembledPaths = indexTileset(assembled).map(
    ({ canonicalPath }) => canonicalPath,
  );
  const expectedPaths = [...selected].sort((a, b) => a.localeCompare(b));
  if (canonicalJson(assembledPaths) !== canonicalJson(expectedPaths))
    throw new Error(
      "Assembled tileset does not exactly match selected inventory",
    );
  return assembled;
}

export function readCheckpoint(checkpointPath, expectedRunId) {
  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  } catch (error) {
    throw new Error(`Checkpoint is corrupt: ${error.message}`, {
      cause: error,
    });
  }
  if (checkpoint.schemaVersion !== "local-background-lite-run-v1")
    throw new Error("Checkpoint has an unsupported schema");
  if (checkpoint.runId !== expectedRunId)
    throw new Error("Existing checkpoint belongs to a different run");
  if (!Array.isArray(checkpoint.records))
    throw new Error("Checkpoint records must be an array");
  const identities = checkpoint.records.map(({ canonicalPath }) =>
    canonicalSourcePath(canonicalPath),
  );
  if (new Set(identities).size !== identities.length)
    throw new Error("Checkpoint contains duplicate tile identities");
  return checkpoint;
}
