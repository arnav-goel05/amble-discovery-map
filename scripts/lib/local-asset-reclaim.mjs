import { randomBytes } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  RECLAIM_ACTION,
  TOKEN_SCHEMA,
  baseResult,
  decodeConfirmationToken,
  encodeConfirmationToken,
  exactPaths,
  filesystemCapacity,
  inventoryDirectory,
  missing,
  numeric,
  rejectedReclaim,
  validateTileset,
} from "./local-asset-migration-shared.mjs";
import { inspectLocalPreflightScope } from "./local-asset-preflight-scope.mjs";

export const createMigrationPreflight = async ({
  batchSize = 20,
  now = Date.now(),
  repositoryRoot,
  targetPath = path.join(repositoryRoot, "optimized-tiles"),
  tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
}) => {
  const pathResolution = await exactPaths({ repositoryRoot, targetPath });
  const blockers = [...pathResolution.blockers];
  let source = null;
  let deletionCandidate = null;
  let sourceValidation = { valid: false };
  let capacity = null;
  let preflightScope = null;
  let targetIntentionallyUnavailable = false;
  if (blockers.length === 0) {
    try {
      source = await inventoryDirectory(pathResolution.sourcePath);
      const tileset = await validateTileset(pathResolution.sourcePath);
      sourceValidation = {
        ...tileset,
        noSpecialEntries: source.specialEntryCount === 0,
        noSymlinks: source.symlinkCount === 0,
        valid:
          tileset.valid &&
          source.specialEntryCount === 0 &&
          source.symlinkCount === 0,
      };
      if (!sourceValidation.valid) blockers.push("source-invalid");
      if (sourceValidation.valid) {
        try {
          preflightScope = await inspectLocalPreflightScope({
            batchSize,
            repositoryRoot: pathResolution.repositoryRoot,
            sourceInventoryId: source.inventoryId,
            sourcePath: pathResolution.sourcePath,
          });
          if (!preflightScope.activeHighlights.complete)
            blockers.push("highlight-scope-unresolved");
        } catch (error) {
          blockers.push(`scope-invalid: ${error.message}`);
        }
      }
    } catch (error) {
      sourceValidation = { error: error.message, valid: false };
      blockers.push("source-invalid");
    }
    try {
      const targetStat = await lstat(pathResolution.targetPath, {
        bigint: true,
      });
      if (targetStat.isSymbolicLink()) throw new Error("target is a symlink");
      deletionCandidate = await inventoryDirectory(pathResolution.targetPath);
      const parentStat = await lstat(pathResolution.repositoryRoot, {
        bigint: true,
      });
      if (targetStat.dev !== parentStat.dev)
        throw new Error("target crosses a filesystem mount boundary");
      if (
        deletionCandidate.symlinkCount > 0 ||
        deletionCandidate.specialEntryCount > 0
      )
        throw new Error("target contains a symlink or special entry");
    } catch (error) {
      if (missing(error)) targetIntentionallyUnavailable = true;
      else blockers.push(`target-invalid: ${error.message}`);
    }
    try {
      capacity = await filesystemCapacity(pathResolution.repositoryRoot);
    } catch (error) {
      blockers.push(`capacity-unavailable: ${error.message}`);
    }
  }
  const requestedTtl = Number.isFinite(tokenTtlMs)
    ? Math.trunc(tokenTtlMs)
    : DEFAULT_TOKEN_TTL_MS;
  const ttl = Math.min(Math.max(1, requestedTtl), MAX_TOKEN_TTL_MS);
  let confirmation = null;
  if (blockers.length === 0 && deletionCandidate) {
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttl).toISOString();
    const claims = {
      action: RECLAIM_ACTION,
      expiresAt,
      issuedAt,
      nonce: randomBytes(16).toString("hex"),
      repositoryRoot: pathResolution.repositoryRoot,
      schema: TOKEN_SCHEMA,
      sourceExclusionEvidenceIdentity:
        preflightScope.sourceExclusions.evidenceIdentity,
      highlightIdentitySetIdentity:
        preflightScope.activeHighlights.identitySetIdentity,
      sourceInventoryId: source.inventoryId,
      targetDevice: deletionCandidate.device,
      targetInode: deletionCandidate.inode,
      targetInventoryId: deletionCandidate.inventoryId,
      targetPath: pathResolution.targetPath,
    };
    confirmation = {
      action: RECLAIM_ACTION,
      expiresAt,
      issuedAt,
      token: encodeConfirmationToken(claims),
    };
  }
  return {
    ...baseResult("preflight"),
    blockers,
    capacity,
    confirmation,
    deletionCandidate,
    deletionCandidateAllocatedBytes: deletionCandidate?.allocatedBytes ?? 0,
    expectedReclaimedBytes: null,
    expectedReclaimedBytesReason:
      "Filesystem clones and snapshots prevent an exact pre-deletion free-space estimate",
    repositoryRoot: pathResolution.repositoryRoot ?? repositoryRoot,
    source,
    sourceValidation,
    scope: preflightScope,
    state: confirmation
      ? "awaiting-confirmation"
      : targetIntentionallyUnavailable && blockers.length === 0
        ? "intentionally-unavailable"
        : "preparing",
  };
};

export const reclaimOptimizedTiles = async ({
  confirmationToken,
  now = Date.now(),
  repositoryRoot,
  targetPath,
}) => {
  const pathResolution = await exactPaths({ repositoryRoot, targetPath });
  if (pathResolution.blockers.length)
    return rejectedReclaim("confirmation-invalid", {
      blockers: pathResolution.blockers,
    });
  const claims = decodeConfirmationToken(confirmationToken);
  if (
    !claims ||
    claims.action !== RECLAIM_ACTION ||
    claims.repositoryRoot !== pathResolution.repositoryRoot ||
    claims.targetPath !== pathResolution.targetPath ||
    Date.parse(claims.issuedAt) > now ||
    Date.parse(claims.expiresAt) <= now
  )
    return rejectedReclaim("confirmation-invalid");
  let source;
  try {
    source = await inventoryDirectory(pathResolution.sourcePath);
    const sourceValidation = await validateTileset(pathResolution.sourcePath);
    const sourceScope = await inspectLocalPreflightScope({
      repositoryRoot: pathResolution.repositoryRoot,
      sourceInventoryId: source.inventoryId,
      sourcePath: pathResolution.sourcePath,
    });
    if (
      !sourceValidation.valid ||
      source.symlinkCount > 0 ||
      source.specialEntryCount > 0 ||
      source.inventoryId !== claims.sourceInventoryId ||
      sourceScope.sourceExclusions.evidenceIdentity !==
        claims.sourceExclusionEvidenceIdentity ||
      sourceScope.activeHighlights.complete !== true ||
      sourceScope.activeHighlights.identitySetIdentity !==
        claims.highlightIdentitySetIdentity
    )
      return rejectedReclaim("source-invalid");
  } catch (error) {
    return rejectedReclaim("source-invalid", { error: error.message });
  }
  let target;
  try {
    target = await inventoryDirectory(pathResolution.targetPath);
  } catch (error) {
    if (missing(error))
      return {
        ...baseResult("reclaim"),
        actualReclaimedBytes: 0,
        deletedPath: null,
        outcome: "no-op",
        state: "intentionally-unavailable",
      };
    return rejectedReclaim("target-changed", { error: error.message });
  }
  if (
    target.inventoryId !== claims.targetInventoryId ||
    target.device !== claims.targetDevice ||
    target.inode !== claims.targetInode ||
    target.symlinkCount > 0 ||
    target.specialEntryCount > 0
  )
    return rejectedReclaim("target-changed");
  const parentStat = await lstat(pathResolution.repositoryRoot, {
    bigint: true,
  });
  if (numeric(parentStat.dev) !== target.device)
    return rejectedReclaim("target-changed", {
      error: "target crosses a filesystem mount boundary",
    });
  const capacityBefore = await filesystemCapacity(
    pathResolution.repositoryRoot,
  );
  try {
    await rm(pathResolution.targetPath, { recursive: true });
  } catch (error) {
    return {
      ...rejectedReclaim("deletion-failed", { error: error.message }),
      state: "reclaiming-space",
    };
  }
  try {
    await lstat(pathResolution.targetPath);
    return {
      ...rejectedReclaim("deletion-failed", {
        error: "target still exists after deletion",
      }),
      state: "reclaiming-space",
    };
  } catch (error) {
    if (!missing(error))
      return {
        ...rejectedReclaim("deletion-failed", { error: error.message }),
        state: "reclaiming-space",
      };
  }
  const [capacityAfter, sourceAfter] = await Promise.all([
    filesystemCapacity(pathResolution.repositoryRoot),
    inventoryDirectory(pathResolution.sourcePath),
  ]);
  if (sourceAfter.inventoryId !== source.inventoryId)
    return {
      ...rejectedReclaim("source-invalid", {
        error: "source inventory changed during reclaim",
      }),
      state: "intentionally-unavailable",
    };
  return {
    ...baseResult("reclaim"),
    actualFilesystemAvailableIncreaseBytes: Math.max(
      0,
      capacityAfter.availableBytes - capacityBefore.availableBytes,
    ),
    deletedTreeAllocatedBytes: target.allocatedBytes,
    actualReclaimedBytes: Math.max(
      0,
      capacityAfter.availableBytes - capacityBefore.availableBytes,
    ),
    completedAt: new Date(now).toISOString(),
    deletedPath: pathResolution.targetPath,
    outcome: "intentionally-unavailable",
    sourceInventoryId: sourceAfter.inventoryId,
    state: "intentionally-unavailable",
  };
};
