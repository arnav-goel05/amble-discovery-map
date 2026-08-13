import fs from "node:fs";
import path from "node:path";

import { sha256, SWITCH_SCHEMA } from "./local-asset-migration-shared.mjs";

export const RECOVERY_CONTRACT_SCHEMA = "local-building-assets-recovery-v1";

const selectionProjection = ({ background, overlays }) => ({
  background: {
    complete: background?.complete,
    opacity: background?.opacity,
    path: background?.path,
    sha256: background?.sha256,
    url: background?.url,
  },
  overlays: {
    complete: overlays?.complete,
    empty: overlays?.empty === true,
    opacity: overlays?.opacity,
    path: overlays?.path,
    sha256: overlays?.sha256,
    url: overlays?.url,
  },
});

export const recoverySelectionId = (selection) =>
  `sha256:${sha256(JSON.stringify(selectionProjection(selection)))}`;

export const recoveryContract = (selection) => ({
  schemaVersion: RECOVERY_CONTRACT_SCHEMA,
  kind: "exact-prior-local-selection",
  selectionId: recoverySelectionId(selection),
});

const verifiedRecoveryAsset = ({ reference, repositoryRoot, label }) => {
  if (reference?.complete !== true)
    throw new Error(`${label} recovery reference is not complete`);
  if (
    typeof reference.path !== "string" ||
    !path.isAbsolute(reference.path) ||
    reference.path !== path.normalize(reference.path)
  )
    throw new Error(`${label} recovery path is not exact and absolute`);
  const resolvedRoot = fs.realpathSync(repositoryRoot);
  const resolvedFile = fs.realpathSync(reference.path);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`${label} recovery path escapes the repository`);
  const stat = fs.lstatSync(reference.path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${label} recovery path is not a regular file`);
  if (reference.url !== reference.path)
    throw new Error(`${label} recovery URL does not name the exact file`);
  const observedSha256 = `sha256:${sha256(fs.readFileSync(resolvedFile))}`;
  if (!/^sha256:[a-f0-9]{64}$/u.test(reference.sha256 ?? ""))
    throw new Error(`${label} recovery hash is missing or invalid`);
  if (reference.sha256 !== observedSha256)
    throw new Error(`${label} recovery hash does not match ${resolvedFile}`);
  return { filename: resolvedFile, sha256: observedSha256 };
};

export function validateRecoveryManifest({ manifest, repositoryRoot }) {
  if (manifest?.schemaVersion !== SWITCH_SCHEMA)
    throw new Error(`Recovery manifest must use ${SWITCH_SCHEMA}`);
  if (manifest.state !== "rolled-back")
    throw new Error("Recovery manifest must select the rolled-back state");
  if (manifest.localOnly !== true)
    throw new Error("Recovery manifest must be local-only");
  if (
    !Array.isArray(manifest.publicationActions) ||
    manifest.publicationActions.length !== 0
  )
    throw new Error("Recovery manifest cannot contain publication actions");
  if (manifest.background?.opacity !== 0.3)
    throw new Error("Recovery background opacity must be 0.3");
  if (manifest.overlays?.opacity !== 1)
    throw new Error("Recovery overlay opacity must be 1");

  const selectionId = recoverySelectionId(manifest);
  if (manifest.selectionId !== selectionId)
    throw new Error("Recovery selection identity does not match its assets");
  if (manifest.manifestId !== `recovery:${selectionId.slice(7)}`)
    throw new Error("Recovery manifest identity does not match its selection");
  if (
    manifest.recoveryContract?.schemaVersion !== RECOVERY_CONTRACT_SCHEMA ||
    manifest.recoveryContract?.kind !== "exact-prior-local-selection" ||
    manifest.recoveryContract?.selectionId !== selectionId
  )
    throw new Error("Exact prior-selection recovery contract is missing");

  const background = verifiedRecoveryAsset({
    reference: manifest.background,
    repositoryRoot,
    label: "background",
  });
  const overlays = verifiedRecoveryAsset({
    reference: manifest.overlays,
    repositoryRoot,
    label: "overlay",
  });
  return { background, overlays, selectionId, valid: true };
}

export function asRecoveryManifest(selection) {
  const selectionId = recoverySelectionId(selection);
  return {
    ...selection,
    schemaVersion: SWITCH_SCHEMA,
    state: "rolled-back",
    manifestId: `recovery:${selectionId.slice(7)}`,
    selectionId,
    localOnly: true,
    publicationActions: [],
    recoveryContract: recoveryContract(selection),
  };
}
