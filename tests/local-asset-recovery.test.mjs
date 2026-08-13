import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  asRecoveryManifest,
  validateRecoveryManifest,
} from "../scripts/lib/local-asset-migration.mjs";
import { readValidationInputs } from "../scripts/lib/local-background-validation.mjs";

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const fixture = async () => {
  const repositoryRoot = await mkdtemp(
    path.join(os.tmpdir(), "amble-recovery-contract-"),
  );
  const outputRoot = path.join(
    repositoryRoot,
    "outputs",
    "background-lite-local",
  );
  const backgroundPath = path.join(repositoryRoot, "tiles", "tileset.json");
  const overlaysPath = path.join(
    repositoryRoot,
    "public",
    "poi-tiles",
    "event-venues",
    "tileset.json",
  );
  const backgroundBytes = Buffer.from('{"root":{"prior":"background"}}');
  const overlayBytes = Buffer.from('{"root":{"prior":"overlays"}}');
  await Promise.all([
    mkdir(path.dirname(backgroundPath), { recursive: true }),
    mkdir(path.dirname(overlaysPath), { recursive: true }),
    mkdir(outputRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(backgroundPath, backgroundBytes),
    writeFile(overlaysPath, overlayBytes),
  ]);
  const recovery = asRecoveryManifest({
    background: {
      complete: true,
      opacity: 0.3,
      path: backgroundPath,
      sha256: digest(backgroundBytes),
      url: backgroundPath,
    },
    overlays: {
      complete: true,
      empty: false,
      opacity: 1,
      path: overlaysPath,
      sha256: digest(overlayBytes),
      url: overlaysPath,
    },
  });
  const recoveryPath = path.join(outputRoot, "recovery-building-assets.json");
  await writeFile(recoveryPath, JSON.stringify(recovery));
  return {
    backgroundPath,
    outputRoot,
    recovery,
    recoveryPath,
    repositoryRoot,
  };
};

test("recovery readiness proves the exact hash-bound prior local selection", async () => {
  const value = await fixture();
  try {
    const verified = validateRecoveryManifest({
      manifest: value.recovery,
      repositoryRoot: value.repositoryRoot,
    });
    assert.equal(verified.valid, true);
    assert.equal(verified.selectionId, value.recovery.selectionId);
    const rollback = readValidationInputs(value.outputRoot).rollback;
    assert.equal(rollback.complete, true);
    assert.equal(rollback.innerAssetHashesVerified, true);
    assert.equal(rollback.selectionId, value.recovery.selectionId);
    assert.equal(rollback.sha256, digest(await readFile(value.recoveryPath)));
  } finally {
    await rm(value.repositoryRoot, { force: true, recursive: true });
  }
});

test("recovery readiness becomes false when an inner prior asset changes", async () => {
  const value = await fixture();
  try {
    await writeFile(value.backgroundPath, "tampered");
    const rollback = readValidationInputs(value.outputRoot).rollback;
    assert.equal(rollback.complete, false);
    assert.equal(rollback.innerAssetHashesVerified, false);
    assert.match(rollback.error, /background recovery hash does not match/u);
  } finally {
    await rm(value.repositoryRoot, { force: true, recursive: true });
  }
});
