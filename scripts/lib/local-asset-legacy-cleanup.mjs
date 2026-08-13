import { randomBytes } from "node:crypto";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_TOKEN_TTL_MS,
  LEGACY_CLEANUP_ACTION,
  MAX_TOKEN_TTL_MS,
  SWITCH_SCHEMA,
  TOKEN_SCHEMA,
  baseResult,
  decodeConfirmationToken,
  encodeConfirmationToken,
  inventoryDirectory,
  readJson,
  rejectedReclaim,
  sha256,
} from "./local-asset-migration-shared.mjs";

const resolveExactLegacyPoiPath = async ({ repositoryRoot, targetPath }) => {
  const resolvedRoot = await realpath(repositoryRoot);
  const expectedTarget = path.join(resolvedRoot, "public", "poi-tiles");
  if (!path.isAbsolute(targetPath) || path.normalize(targetPath) !== targetPath)
    throw new Error("Legacy target must be an absolute normalized path");
  const targetStat = await lstat(targetPath, { bigint: true });
  if (targetStat.isSymbolicLink())
    throw new Error("Legacy target is a symlink");
  const resolvedTarget = await realpath(targetPath);
  if (resolvedTarget !== expectedTarget)
    throw new Error("Target is not the exact public/poi-tiles directory");
  const rootStat = await lstat(resolvedRoot, { bigint: true });
  if (targetStat.dev !== rootStat.dev)
    throw new Error("Legacy target crosses a filesystem mount boundary");
  return { repositoryRoot: resolvedRoot, targetPath: expectedTarget };
};

export const createLegacyPoiCleanupPreflight = async ({
  activeManifestPath,
  now = Date.now(),
  repositoryRoot,
  targetPath = path.join(repositoryRoot, "public", "poi-tiles"),
  tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
}) => {
  const blockers = [];
  let paths;
  let target = null;
  try {
    paths = await resolveExactLegacyPoiPath({ repositoryRoot, targetPath });
  } catch (error) {
    blockers.push(error.message);
  }
  if (paths) {
    try {
      const active = await readJson(activeManifestPath);
      if (
        active?.schemaVersion !== SWITCH_SCHEMA ||
        active?.state !== "active-local"
      )
        throw new Error("local switch is not active");
      const gates = active.validation;
      if (
        gates?.complete !== true ||
        gates?.identityParity !== true ||
        gates?.sourceProvenance !== true ||
        gates?.browser !== true ||
        gates?.rollbackReady !== true ||
        !active.rollbackReference?.path ||
        !active.rollbackReference?.sha256
      )
        throw new Error("parity or rollback gates are incomplete");
      const rollbackBytes = await readFile(active.rollbackReference.path);
      if (`sha256:${sha256(rollbackBytes)}` !== active.rollbackReference.sha256)
        throw new Error("rollback reference changed");
      target = await inventoryDirectory(paths.targetPath);
      if (target.symlinkCount || target.specialEntryCount)
        throw new Error("legacy target contains unsafe entries");
    } catch (error) {
      blockers.push(error.message);
    }
  }
  let confirmation = null;
  if (blockers.length === 0) {
    const ttl = Math.min(
      Math.max(
        1,
        Number.isFinite(tokenTtlMs)
          ? Math.trunc(tokenTtlMs)
          : DEFAULT_TOKEN_TTL_MS,
      ),
      MAX_TOKEN_TTL_MS,
    );
    const activeBytes = await readFile(activeManifestPath);
    const claims = {
      action: LEGACY_CLEANUP_ACTION,
      activeManifestSha256: `sha256:${sha256(activeBytes)}`,
      expiresAt: new Date(now + ttl).toISOString(),
      issuedAt: new Date(now).toISOString(),
      nonce: randomBytes(16).toString("hex"),
      repositoryRoot: paths.repositoryRoot,
      schema: TOKEN_SCHEMA,
      targetDevice: target.device,
      targetInode: target.inode,
      targetInventoryId: target.inventoryId,
      targetPath: paths.targetPath,
    };
    confirmation = {
      action: LEGACY_CLEANUP_ACTION,
      expiresAt: claims.expiresAt,
      issuedAt: claims.issuedAt,
      token: encodeConfirmationToken(claims),
    };
  }
  return {
    ...baseResult("legacy-poi-preflight"),
    blockers,
    confirmation,
    deletionCandidate: target,
    state: confirmation ? "awaiting-confirmation" : "ready-to-switch",
  };
};

export const cleanupLegacyPoiTiles = async ({
  activeManifestPath,
  confirmationToken,
  now = Date.now(),
  repositoryRoot,
  targetPath,
}) => {
  let paths;
  try {
    paths = await resolveExactLegacyPoiPath({ repositoryRoot, targetPath });
  } catch (error) {
    return rejectedReclaim("confirmation-invalid", { error: error.message });
  }
  const claims = decodeConfirmationToken(confirmationToken);
  if (
    !claims ||
    claims.action !== LEGACY_CLEANUP_ACTION ||
    claims.repositoryRoot !== paths.repositoryRoot ||
    claims.targetPath !== paths.targetPath ||
    Date.parse(claims.issuedAt) > now ||
    Date.parse(claims.expiresAt) <= now
  )
    return rejectedReclaim("confirmation-invalid");
  const activeBytes = await readFile(activeManifestPath);
  if (`sha256:${sha256(activeBytes)}` !== claims.activeManifestSha256)
    return rejectedReclaim("switch-changed");
  const active = JSON.parse(activeBytes.toString("utf8"));
  if (active?.state !== "active-local" || !active?.rollbackReference?.path)
    return rejectedReclaim("switch-invalid");
  const target = await inventoryDirectory(paths.targetPath);
  if (
    target.inventoryId !== claims.targetInventoryId ||
    target.device !== claims.targetDevice ||
    target.inode !== claims.targetInode ||
    target.symlinkCount ||
    target.specialEntryCount
  )
    return rejectedReclaim("target-changed");
  await rm(paths.targetPath, { recursive: true });
  return {
    ...baseResult("legacy-poi-cleanup"),
    actualReclaimedBytes: target.allocatedBytes,
    deletedPath: paths.targetPath,
    outcome: "complete",
    state: "complete",
  };
};
