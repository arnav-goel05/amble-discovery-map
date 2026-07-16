import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateApprovedSnapshot } from "./contracts/baseline-contracts.mjs";

export class ApprovedSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApprovedSnapshotError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new ApprovedSnapshotError(code, message); };
export const hashBuffer = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const hashFile = (file) => hashBuffer(fs.readFileSync(file));
export function computeSnapshotContentHash(manifest) {
  const { contentHash: _contentHash, ...contract } = manifest;
  return hashBuffer(JSON.stringify(contract));
}

function readJson(file, code) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(code, `${path.basename(file)} could not be read: ${error.message}`); }
}

function safeSnapshotId(snapshotId) {
  if (typeof snapshotId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(snapshotId)) fail("snapshot_id_invalid", "Active snapshot identity is invalid");
  return snapshotId;
}

function resolveInside(directory, reference) {
  const resolved = path.resolve(directory, reference);
  if (resolved === directory || !resolved.startsWith(`${directory}${path.sep}`)) fail("snapshot_reference_invalid", `Snapshot reference escapes its directory: ${reference}`);
  return resolved;
}

export function writeActiveSnapshotPointer({ root, snapshotId, manifestPath, pointerPath = path.join(root, "data/approved-snapshot.json") }) {
  safeSnapshotId(snapshotId);
  if (!fs.existsSync(manifestPath)) fail("snapshot_manifest_missing", "Cannot activate a missing snapshot manifest");
  const pointer = { schemaVersion: "1.0", snapshotId, manifestHash: hashFile(manifestPath) };
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  const temporary = `${pointerPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporary, pointerPath);
  return pointer;
}

export function loadApprovedSnapshot({ root, pointerPath = path.join(root, "data/approved-snapshot.json"), now = new Date() } = {}) {
  if (!root) fail("snapshot_root_missing", "Snapshot root is required");
  if (!fs.existsSync(pointerPath)) fail("snapshot_pointer_missing", "No active approved snapshot is configured");
  const pointer = readJson(pointerPath, "snapshot_pointer_invalid");
  if (pointer.schemaVersion !== "1.0" || !/^[a-f0-9]{64}$/i.test(pointer.manifestHash ?? "")) fail("snapshot_pointer_invalid", "Active snapshot pointer is invalid");
  const snapshotId = safeSnapshotId(pointer.snapshotId);
  const snapshotDirectory = path.join(root, "data/snapshots", snapshotId);
  const manifestPath = path.join(snapshotDirectory, "manifest.json");
  if (!fs.existsSync(manifestPath)) fail("snapshot_manifest_missing", `Manifest for ${snapshotId} is missing`);
  if (hashFile(manifestPath) !== pointer.manifestHash) fail("snapshot_manifest_hash_mismatch", "Active snapshot manifest hash does not match its pointer");
  let manifest;
  try { manifest = validateApprovedSnapshot(readJson(manifestPath, "snapshot_manifest_invalid")); }
  catch (error) { if (error instanceof ApprovedSnapshotError) throw error; fail(error.code ?? "snapshot_manifest_invalid", error.message); }
  if (manifest.snapshotId !== snapshotId) fail("snapshot_identity_mismatch", "Pointer and manifest snapshot identities differ");
  if (computeSnapshotContentHash(manifest) !== manifest.contentHash) fail("snapshot_content_hash_mismatch", "Snapshot content hash does not match its manifest contract");
  if (!manifest.artifactHashes || typeof manifest.artifactHashes !== "object") fail("snapshot_artifact_hashes_missing", "Snapshot artifact hashes are required");
  for (const reference of [manifest.landmarksRef, manifest.poisRef, manifest.tilesetRef]) {
    const file = resolveInside(snapshotDirectory, reference);
    const expectedHash = manifest.artifactHashes[reference];
    if (!fs.existsSync(file)) fail("snapshot_artifact_missing", `Snapshot artifact is missing: ${reference}`);
    if (!/^[a-f0-9]{64}$/i.test(expectedHash ?? "") || hashFile(file) !== expectedHash) fail("snapshot_artifact_hash_mismatch", `Snapshot artifact hash mismatch: ${reference}`);
  }
  const stale = new Date(now) > new Date(manifest.staleAfter);
  const publicBase = `/api/snapshot/assets/${encodeURIComponent(snapshotId)}/`;
  return {
    ...manifest,
    freshness: stale ? "potentially_outdated" : manifest.freshness,
    stale,
    warning: stale ? `Event data may be potentially outdated; last published ${manifest.publishedAt}.` : null,
    publicRefs: {
      landmarks: `${publicBase}${manifest.landmarksRef.split("/").map(encodeURIComponent).join("/")}`,
      pois: `${publicBase}${manifest.poisRef.split("/").map(encodeURIComponent).join("/")}`,
      tileset: `${publicBase}${manifest.tilesetRef.split("/").map(encodeURIComponent).join("/")}`,
    },
    directory: snapshotDirectory,
    manifestHash: pointer.manifestHash,
  };
}

export function resolveActiveSnapshotAsset({ root, snapshotId, reference }) {
  const active = loadApprovedSnapshot({ root });
  if (active.snapshotId !== snapshotId) fail("snapshot_asset_not_active", "Only active snapshot assets are public");
  const allowed = new Set([active.landmarksRef, active.poisRef, active.tilesetRef]);
  if (!allowed.has(reference)) fail("snapshot_asset_unapproved", "Snapshot asset is not part of the public contract");
  return resolveInside(active.directory, reference);
}

export function stageImmutableSnapshot({ root, snapshot, artifacts, commitEligibility }) {
  if (commitEligibility?.eligible !== true) fail("snapshot_commit_ineligible", `Snapshot is not publishable: ${commitEligibility?.reason ?? "commit_gate_failed"}`);
  if (!snapshot || typeof artifacts !== "object" || Array.isArray(artifacts)) fail("snapshot_stage_invalid", "Snapshot metadata and artifacts are required");
  const snapshotId = safeSnapshotId(snapshot.snapshotId);
  const snapshotDirectory = path.join(root, "data/snapshots", snapshotId);
  if (fs.existsSync(snapshotDirectory)) fail("snapshot_immutable_exists", `Immutable snapshot ${snapshotId} already exists`);
  const entries = Object.entries(artifacts);
  if (!entries.length) fail("snapshot_stage_invalid", "Snapshot artifacts are empty");
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  try {
    for (const [reference, contents] of entries) {
      const file = resolveInside(snapshotDirectory, reference);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }
    const references = entries.map(([reference]) => reference);
    const landmarksRef = snapshot.landmarksRef && references.includes(snapshot.landmarksRef) ? snapshot.landmarksRef : references.find((item) => /landmarks/i.test(item));
    const poisRef = snapshot.poisRef && references.includes(snapshot.poisRef) ? snapshot.poisRef : references.find((item) => /pois/i.test(item));
    const tilesetRef = snapshot.tilesetRef && references.includes(snapshot.tilesetRef) ? snapshot.tilesetRef : references.find((item) => /tileset/i.test(item));
    if (!landmarksRef || !poisRef || !tilesetRef) fail("snapshot_stage_invalid", "Landmark, POI, and tileset artifacts are required");
    const artifactHashes = Object.fromEntries(references.map((reference) => [reference, hashFile(resolveInside(snapshotDirectory, reference))]));
    const base = { ...snapshot, landmarksRef, poisRef, tilesetRef, artifactHashes };
    delete base.contentHash;
    const manifest = validateApprovedSnapshot({ ...base, contentHash: computeSnapshotContentHash(base) });
    const manifestPath = path.join(snapshotDirectory, "manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { snapshotId, snapshotDirectory, manifestPath, manifestHash: hashFile(manifestPath), commitEligibility };
  } catch (error) {
    fs.rmSync(snapshotDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function activateStagedSnapshot({ root, staged }) {
  if (!staged?.manifestPath || !fs.existsSync(staged.manifestPath)) fail("snapshot_stage_missing", "Staged snapshot manifest is missing");
  if (hashFile(staged.manifestPath) !== staged.manifestHash) fail("snapshot_stage_changed", "Staged snapshot changed after verification");
  const pointerPath = path.join(root, "data/approved-snapshot.json");
  const previousPointer = fs.existsSync(pointerPath) ? fs.readFileSync(pointerPath) : null;
  let pointer;
  try {
    pointer = writeActiveSnapshotPointer({ root, snapshotId: staged.snapshotId, manifestPath: staged.manifestPath, pointerPath });
    const active = loadApprovedSnapshot({ root, pointerPath });
    if (active.snapshotId !== staged.snapshotId) fail("snapshot_activation_failed", "Active pointer did not select the staged snapshot");
    return { pointer, active };
  } catch (error) {
    if (previousPointer) {
      const temporary = `${pointerPath}.rollback-${process.pid}-${crypto.randomUUID()}`;
      fs.writeFileSync(temporary, previousPointer);
      fs.renameSync(temporary, pointerPath);
    } else {
      fs.rmSync(pointerPath, { force: true });
    }
    throw error;
  }
}
