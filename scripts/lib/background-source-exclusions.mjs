import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const EXCLUSION_SCHEMA = "background-source-exclusions-v1";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const canonicalJson = (value) => JSON.stringify([...value].sort());

function canonicalSourcePath(value) {
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

function sameValues(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function readBoundJson(filename, expectedSha256, label) {
  const bytes = fs.readFileSync(filename);
  const actual = sha256(bytes);
  if (actual !== expectedSha256)
    throw new Error(
      `${label} hash changed: expected ${expectedSha256}, received ${actual}`,
    );
  return JSON.parse(bytes);
}

export function verifiedSourceExclusions({
  sourceRoot,
  referencedPaths,
  missingPaths,
  exclusionsPath = path.resolve(
    sourceRoot,
    "..",
    "data",
    "background-source-exclusions.json",
  ),
} = {}) {
  const referenced = [...referencedPaths].map(canonicalSourcePath);
  const missing = [...missingPaths].map(canonicalSourcePath);
  if (!fs.existsSync(exclusionsPath)) {
    if (missing.length) throw new Error(`Missing source tile: ${missing[0]}`);
    return { evidenceIdentity: null, records: [] };
  }

  const ledgerBytes = fs.readFileSync(exclusionsPath);
  const ledger = JSON.parse(ledgerBytes);
  if (ledger.schemaVersion !== EXCLUSION_SCHEMA)
    throw new Error("Source exclusion ledger has an unsupported schema");
  const sourceTilesetPath = path.join(sourceRoot, "tileset.json");
  const sourceTilesetSha256 = sha256(fs.readFileSync(sourceTilesetPath));
  if (ledger.sourceTilesetSha256 !== sourceTilesetSha256)
    throw new Error("Source exclusion ledger does not match tileset.json");

  const repositoryRoot = path.resolve(sourceRoot, "..");
  const failureEvidence = ledger.providerFailureEvidence;
  if (failureEvidence?.path !== "tiles/download-failures.json")
    throw new Error("Provider failure evidence path is not authoritative");
  const failurePath = path.resolve(repositoryRoot, failureEvidence?.path ?? "");
  const failures = readBoundJson(
    failurePath,
    failureEvidence?.sha256,
    "Provider failure evidence",
  );
  const descriptorEvidence = ledger.releaseEvidence;
  if (
    descriptorEvidence?.descriptorPath !==
    "data/background-geometry-release.json"
  )
    throw new Error("Release descriptor evidence path is not authoritative");
  const descriptorPath = path.resolve(
    repositoryRoot,
    descriptorEvidence?.descriptorPath ?? "",
  );
  const descriptor = readBoundJson(
    descriptorPath,
    descriptorEvidence?.descriptorSha256,
    "Release descriptor evidence",
  );
  if (
    descriptor.releaseId !== descriptorEvidence.releaseId ||
    descriptor.manifestSha256 !== descriptorEvidence.tilesetSha256
  )
    throw new Error("Release exclusion evidence does not match its descriptor");

  const excluded = (ledger.paths ?? []).map(canonicalSourcePath);
  if (new Set(excluded).size !== excluded.length)
    throw new Error("Source exclusion ledger contains duplicate paths");
  if (!sameValues(excluded, missing))
    throw new Error(
      "Missing source paths do not exactly match the exclusion ledger",
    );
  const referencedSet = new Set(referenced);
  if (excluded.some((entry) => !referencedSet.has(entry)))
    throw new Error("Source exclusion ledger contains an unreferenced path");

  const failuresByPath = new Map(failures.map((entry) => [entry.uri, entry]));
  for (const canonicalPath of excluded) {
    const failure = failuresByPath.get(canonicalPath);
    const expectedUrl = new URL(
      canonicalPath,
      failureEvidence.urlRoot,
    ).toString();
    if (
      failure?.url !== expectedUrl ||
      !failure?.error?.startsWith(`Failed ${failureEvidence.requiredStatus} `)
    )
      throw new Error(
        `Missing authoritative provider evidence for ${canonicalPath}`,
      );
  }
  if (!sameValues(failuresByPath.keys(), excluded))
    throw new Error(
      "Provider failure evidence does not exactly match exclusions",
    );

  const evidenceIdentity = sha256(ledgerBytes);
  return {
    evidenceIdentity,
    records: excluded.sort().map((canonicalPath) => ({
      canonicalPath,
      evidenceIdentity,
      outcome: "excluded",
      reason: ledger.reason,
      sourceBytes: 0,
      outputBytes: 0,
      sourceSha256: null,
      outputSha256: null,
    })),
  };
}
