import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  SWITCH_SCHEMA,
  atomicWriteJson,
  baseResult,
  missing,
  readJson,
  resolveContainedFile,
  sha256,
} from "./local-asset-migration-shared.mjs";
import {
  asRecoveryManifest,
  validateRecoveryManifest,
} from "./local-asset-recovery.mjs";
import {
  activeLocalSelectionId,
  terminalizeSwitchReport,
} from "./local-asset-switch-report.mjs";

export { activeLocalSelectionId } from "./local-asset-switch-report.mjs";

const verifyFileReference = async ({ repositoryRoot, reference, label }) => {
  const filename = await resolveContainedFile({
    repositoryRoot,
    reference: reference?.path,
  });
  const bytes = await readFile(filename);
  const observedHash = `sha256:${sha256(bytes)}`;
  if (!/^sha256:[a-f0-9]{64}$/u.test(reference?.sha256 ?? ""))
    throw new Error(`${label} hash is missing or invalid`);
  if (reference.sha256 !== observedHash)
    throw new Error(`${label} hash does not match ${filename}`);
  if (reference.complete !== true) throw new Error(`${label} is not complete`);
  return { filename, sha256: observedHash };
};

export const validateLocalSwitchManifest = async ({
  manifest,
  repositoryRoot,
}) => {
  if (manifest?.schemaVersion !== SWITCH_SCHEMA)
    throw new Error(`Expected ${SWITCH_SCHEMA}`);
  if (manifest.state !== "ready")
    throw new Error("Switch manifest is not ready");
  if (manifest.background?.opacity !== 0.3)
    throw new Error("Background opacity must be 0.3");
  if (manifest.overlays?.opacity !== 1)
    throw new Error("Overlay opacity must be 1");
  const validation = manifest.validation;
  if (
    validation?.complete !== true ||
    validation?.identityParity !== true ||
    validation?.sourceProvenance !== true ||
    validation?.browser !== true ||
    validation?.rollbackReady !== true
  )
    throw new Error("Validation gates are incomplete");
  const [background, overlays, report] = await Promise.all([
    verifyFileReference({
      repositoryRoot,
      reference: manifest.background,
      label: "background tileset",
    }),
    verifyFileReference({
      repositoryRoot,
      reference: manifest.overlays,
      label: "overlay catalogue",
    }),
    verifyFileReference({
      repositoryRoot,
      reference: validation,
      label: "validation report",
    }),
  ]);
  if (typeof manifest.policyId !== "string" || !manifest.policyId)
    throw new Error("Switch manifest policy identity is missing");
  if (typeof manifest.snapshotId !== "string" || !manifest.snapshotId)
    throw new Error("Switch manifest snapshot identity is missing");
  if (typeof manifest.catalogueId !== "string" || !manifest.catalogueId)
    throw new Error("Switch manifest catalogue identity is missing");
  const rollback = await verifyFileReference({
    repositoryRoot,
    reference: manifest.rollbackReference,
    label: "rollback manifest",
  });
  const rollbackManifest = JSON.parse(
    (await readFile(rollback.filename)).toString("utf8"),
  );
  const recovery = validateRecoveryManifest({
    manifest: rollbackManifest,
    repositoryRoot,
  });
  return { background, overlays, report, recovery, rollback, valid: true };
};

export const activateLocalSwitchManifest = async ({
  activeManifestPath,
  candidateManifestPath,
  now = Date.now(),
  repositoryRoot,
}) => {
  const resolvedRoot = await realpath(repositoryRoot);
  const candidatePath = await resolveContainedFile({
    repositoryRoot: resolvedRoot,
    reference: candidateManifestPath,
  });
  const destination = path.isAbsolute(activeManifestPath)
    ? path.normalize(activeManifestPath)
    : path.resolve(resolvedRoot, activeManifestPath);
  const candidate = await readJson(candidatePath);
  await validateLocalSwitchManifest({
    manifest: candidate,
    repositoryRoot: resolvedRoot,
  });
  let rollbackReference = null;
  try {
    const previousBytes = await readFile(destination);
    const previous = JSON.parse(previousBytes.toString("utf8"));
    const recovery = asRecoveryManifest(previous);
    validateRecoveryManifest({
      manifest: recovery,
      repositoryRoot: resolvedRoot,
    });
    const rollbackPath = `${destination}.rollback.json`;
    await atomicWriteJson(rollbackPath, recovery);
    const rollbackBytes = await readFile(rollbackPath);
    rollbackReference = {
      complete: true,
      path: rollbackPath,
      sha256: `sha256:${sha256(rollbackBytes)}`,
    };
  } catch (error) {
    if (!missing(error)) throw error;
    const recoveryBytes = await readFile(candidate.rollbackReference.path);
    const recovery = JSON.parse(recoveryBytes.toString("utf8"));
    validateRecoveryManifest({
      manifest: recovery,
      repositoryRoot: resolvedRoot,
    });
    const rollbackPath = `${destination}.rollback.json`;
    await atomicWriteJson(rollbackPath, recovery);
    const rollbackBytes = await readFile(rollbackPath);
    rollbackReference = {
      complete: true,
      path: rollbackPath,
      sha256: `sha256:${sha256(rollbackBytes)}`,
    };
  }
  const active = {
    ...candidate,
    activatedAt: new Date(now).toISOString(),
    localOnly: true,
    publicationActions: [],
    rollbackReference,
    state: "active-local",
  };
  await atomicWriteJson(destination, active);
  const terminal = await terminalizeSwitchReport({
    active,
    activeManifestPath: destination,
  });
  return {
    ...baseResult("switch-local"),
    activeManifestPath: destination,
    outcome: "active-local",
    rollbackReference,
    switchReport: terminal.switchReport,
    state: "active-local",
  };
};

export const finalizeActiveLocalSwitchReport = async ({
  activeManifestPath,
  candidateManifestPath,
  repositoryRoot,
}) => {
  const resolvedRoot = await realpath(repositoryRoot);
  const activePath = await resolveContainedFile({
    repositoryRoot: resolvedRoot,
    reference: activeManifestPath,
  });
  const candidatePath = await resolveContainedFile({
    repositoryRoot: resolvedRoot,
    reference: candidateManifestPath,
  });
  const [active, candidate] = await Promise.all([
    readJson(activePath),
    readJson(candidatePath),
  ]);
  if (active?.state !== "active-local")
    throw new Error("Local asset selection is not active");
  await validateLocalSwitchManifest({
    manifest: candidate,
    repositoryRoot: resolvedRoot,
  });
  for (const key of ["policyId", "snapshotId", "catalogueId"])
    if (active[key] !== candidate[key])
      throw new Error(`Active ${key} does not match the switch candidate`);
  if (
    active.background?.sha256 !== candidate.background?.sha256 ||
    active.overlays?.sha256 !== candidate.overlays?.sha256
  )
    throw new Error("Active assets do not match the switch candidate");
  const rollback = await verifyFileReference({
    repositoryRoot: resolvedRoot,
    reference: active.rollbackReference,
    label: "active rollback manifest",
  });
  validateRecoveryManifest({
    manifest: await readJson(rollback.filename),
    repositoryRoot: resolvedRoot,
  });
  const terminal = await terminalizeSwitchReport({
    active,
    activeManifestPath: activePath,
  });
  return {
    ...baseResult("finalize-switch-report"),
    activeManifestPath: activePath,
    activeSelectionId: activeLocalSelectionId(terminal.active),
    outcome: "active-local",
    state: "active-local",
    switchReport: terminal.switchReport,
  };
};

export const rebindActiveValidationReport = async ({
  activeManifestPath,
  reportPath,
  repositoryRoot,
}) => {
  const active = await readJson(activeManifestPath);
  const report = await readJson(reportPath);
  if (active?.state !== "active-local")
    throw new Error("Only an active-local manifest can be rebound");
  if (report?.state !== "active-local" || report.complete !== true)
    throw new Error("Only a complete active-local report can be rebound");
  if (
    report.migration?.switch?.activeSelectionId !==
    activeLocalSelectionId(active)
  )
    throw new Error("Active report selection does not match the manifest");
  await Promise.all([
    verifyFileReference({
      repositoryRoot,
      reference: active.background,
      label: "background tileset",
    }),
    verifyFileReference({
      repositoryRoot,
      reference: active.overlays,
      label: "overlay catalogue",
    }),
    verifyFileReference({
      repositoryRoot,
      reference: active.rollbackReference,
      label: "rollback manifest",
    }),
  ]);
  const rebound = {
    ...active,
    validation: {
      ...active.validation,
      complete: true,
      path: reportPath,
      sha256: `sha256:${sha256(await readFile(reportPath))}`,
    },
  };
  await atomicWriteJson(activeManifestPath, rebound);
  return rebound;
};

export const rollbackLocalSwitchManifest = async ({
  activeManifestPath,
  repositoryRoot,
}) => {
  const active = await readJson(activeManifestPath);
  if (!active?.rollbackReference?.path)
    throw new Error("Active manifest has no rollback reference");
  const verifiedReference = await verifyFileReference({
    repositoryRoot,
    reference: active.rollbackReference,
    label: "rollback manifest",
  });
  const bytes = await readFile(verifiedReference.filename);
  const rollback = JSON.parse(bytes.toString("utf8"));
  validateRecoveryManifest({ manifest: rollback, repositoryRoot });
  await atomicWriteJson(activeManifestPath, {
    ...rollback,
    rolledBackAt: new Date().toISOString(),
    state: "rolled-back",
  });
  return {
    ...baseResult("rollback-local"),
    activeManifestPath,
    outcome: "rolled-back",
    state: "rolled-back",
  };
};
