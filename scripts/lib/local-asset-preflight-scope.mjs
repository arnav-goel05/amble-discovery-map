import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";

import { verifiedSourceExclusions } from "./background-source-exclusions.mjs";
import { deriveHighlightEvidence } from "./highlight-overlay-evidence.mjs";
import { selectCanonicalHighlightRecords } from "./highlight-overlay-selection.mjs";
import { stableBuildingIdentity } from "./highlight-overlay-reconcile.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};

const canonicalJson = (value) => JSON.stringify(canonical(value));

const canonicalSourcePath = (value) => {
  const normalized = String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/^(?:tiles|optimized-tiles)\//u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    !normalized.endsWith(".b3dm") ||
    normalized.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(`unsafe source path: ${value}`);
  return normalized;
};

const resolveContained = (root, reference) => {
  if (typeof reference !== "string" || !reference)
    throw new Error("snapshot reference is missing");
  const resolved = path.resolve(root, reference);
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error("snapshot reference escapes its directory");
  return resolved;
};

const readJson = async (filename) =>
  JSON.parse(await readFile(filename, "utf8"));

const tilesetPaths = (tileset) => {
  if (!tileset?.root) throw new Error("tileset has no root");
  const paths = [];
  const visit = (tile) => {
    const reference = tile?.content?.uri ?? tile?.content?.url;
    if (reference) paths.push(canonicalSourcePath(reference.split("?")[0]));
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(tileset.root);
  if (new Set(paths).size !== paths.length)
    throw new Error("tileset contains duplicate source paths");
  return paths.sort((left, right) => left.localeCompare(right));
};

async function approvedHighlights(
  repositoryRoot,
  sourcePath,
  sourcePaths,
  sourceTileset,
) {
  const pointer = await readJson(
    path.join(repositoryRoot, "data", "approved-snapshot.json"),
  );
  if (
    typeof pointer?.snapshotId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.test(pointer.snapshotId)
  )
    throw new Error("approved snapshot identity is invalid");
  const snapshotDirectory = path.join(
    repositoryRoot,
    "data",
    "snapshots",
    pointer.snapshotId,
  );
  const manifestPath = path.join(snapshotDirectory, "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.snapshotId !== pointer.snapshotId)
    throw new Error(
      "approved snapshot manifest identity does not match pointer",
    );
  const pois = await readJson(
    resolveContained(snapshotDirectory, manifest.poisRef),
  );
  if (!Array.isArray(pois)) throw new Error("approved POIs must be an array");

  const referencedTiles = new Set();
  let claimCount = 0;
  for (const poi of pois) {
    if (typeof poi?.id !== "string" || !poi.id)
      throw new Error("approved POI identity is missing");
    for (const [rawPath, batchIds] of Object.entries(poi.tiles ?? {})) {
      const sourcePath = canonicalSourcePath(rawPath);
      if (!Array.isArray(batchIds) || batchIds.length === 0)
        throw new Error(`highlight has no batch identities: ${poi.id}`);
      referencedTiles.add(sourcePath);
      for (const batchId of batchIds) {
        if (!Number.isInteger(batchId) || batchId < 0)
          throw new Error(`highlight batch identity is invalid: ${poi.id}`);
        claimCount += 1;
      }
    }
  }

  // Use exactly the same source-backed GML resolver and finest-LOD selection
  // as the overlay builder. A requested historical batch number is not itself
  // an authoritative building identity.
  const evidence = deriveHighlightEvidence({
    snapshotId: pointer.snapshotId,
    sourceRoot: sourcePath,
    sourceTileset,
    pois,
  });
  const selection = selectCanonicalHighlightRecords({
    records: evidence.resolved,
    sourceTileset,
  });
  const review = [...evidence.review, ...selection.review].map((record) => ({
    state: "review",
    sourcePath: record.sourcePath ?? null,
    batchId: record.batchId ?? null,
    ownerPoiIds: [...(record.ownerPoiIds ?? [])].sort(),
    reason: record.reason ?? "unresolved_source_evidence",
    ...(record.buildingIdentity
      ? { buildingIdentity: record.buildingIdentity }
      : {}),
  }));
  const resolved = selection.resolved.map((record) => ({
    state: "resolved",
    buildingIdentity: stableBuildingIdentity(record),
    gmlId: record.gmlId,
    gmlName: record.gmlName ?? null,
    sourcePath: record.sourcePath,
    sourceSha256: record.sourceSha256,
    batchId: record.batchId,
    requestedBatchId: record.requestedBatchId,
    ownerPoiIds: [...(record.ownerPoiIds ?? [])].sort(),
    sourceAuthority: record.sourceAuthority,
    sourceArtifactPath: record.sourceArtifactPath ?? null,
    resolution: record.resolution,
  }));
  const identitySetContract = resolved.map(
    ({
      buildingIdentity,
      gmlId,
      sourcePath: resolvedSourcePath,
      sourceSha256,
      batchId,
      ownerPoiIds,
      sourceAuthority,
      sourceArtifactPath,
    }) => ({
      buildingIdentity,
      gmlId,
      sourcePath: resolvedSourcePath,
      sourceSha256,
      batchId,
      ownerPoiIds,
      sourceAuthority,
      sourceArtifactPath,
    }),
  );
  return {
    snapshotId: pointer.snapshotId,
    snapshotIdentity: `sha256:${sha256(manifestBytes)}`,
    activePoiCount: pois.length,
    claimCount,
    resolvedClaimCount: evidence.resolved.length,
    resolvedBuildingCount: resolved.length,
    uniqueIdentityCount: resolved.length,
    referencedSourceTileCount: referencedTiles.size,
    identitySetIdentity: `sha256:${sha256(canonicalJson(identitySetContract))}`,
    evidenceIdentity: `sha256:${evidence.evidenceIdentity}`,
    complete: review.length === 0,
    outcomes: { resolved, review },
  };
}

export async function inspectLocalPreflightScope({
  repositoryRoot,
  sourcePath,
  sourceInventoryId,
  batchSize = 20,
  policyIdentity = "background-lite-policy-v1:128:55:no-blur:colour-preserving",
}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new Error("batch size must be a positive integer");
  const tileset = await readJson(path.join(sourcePath, "tileset.json"));
  const sourcePaths = tilesetPaths(tileset);
  const missingPaths = [];
  for (const sourceTile of sourcePaths) {
    let stat;
    try {
      stat = await lstat(path.join(sourcePath, sourceTile));
    } catch (error) {
      if (error?.code === "ENOENT") {
        missingPaths.push(sourceTile);
        continue;
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`source tile is not a regular file: ${sourceTile}`);
  }
  const exclusions = verifiedSourceExclusions({
    sourceRoot: sourcePath,
    referencedPaths: sourcePaths,
    missingPaths,
  });
  const highlights = await approvedHighlights(
    repositoryRoot,
    sourcePath,
    sourcePaths,
    tileset,
  );
  const backgroundRunId = `sha256:${sha256(
    canonicalJson({ policyIdentity, sourceInventoryId }),
  )}`;
  const overlayRunId = `sha256:${sha256(
    canonicalJson({
      backgroundRunId,
      highlightIdentitySetIdentity: highlights.identitySetIdentity,
      snapshotIdentity: highlights.snapshotIdentity,
    }),
  )}`;
  return {
    activeHighlights: highlights,
    batching: {
      batchSize,
      batchCount: Math.ceil(sourcePaths.length / batchSize),
      sourceTileCount: sourcePaths.length,
      processableTileCount: sourcePaths.length - exclusions.records.length,
      excludedTileCount: exclusions.records.length,
    },
    sourceExclusions: {
      count: exclusions.records.length,
      evidenceIdentity: exclusions.evidenceIdentity,
      records: exclusions.records,
    },
    proposedRuns: {
      backgroundRunId,
      overlayRunId,
      policyIdentity,
    },
  };
}
