import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCapacity,
  atomicWrite,
} from "../scripts/lib/background-lite-run.mjs";
import { syntheticTile } from "./fixtures/background-lite-local/fixture.mjs";
import {
  activateLocalSwitchManifest,
  asRecoveryManifest,
  cleanupLegacyPoiTiles,
  createLegacyPoiCleanupPreflight,
  createMigrationPreflight,
  reclaimOptimizedTiles,
  rollbackLocalSwitchManifest,
  validateLocalSwitchManifest,
} from "../scripts/lib/local-asset-migration.mjs";

const FIXED_NOW = Date.parse("2026-08-13T04:00:00.000Z");
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const makeRepository = async () => {
  const repositoryRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "amble-local-migration-")),
  );
  const sourcePath = path.join(repositoryRoot, "tiles");
  const targetPath = path.join(repositoryRoot, "optimized-tiles");
  const legacyPoiPath = path.join(repositoryRoot, "public", "poi-tiles");
  const snapshotPath = path.join(
    repositoryRoot,
    "data",
    "snapshots",
    "fixture-snapshot",
  );

  await Promise.all([
    mkdir(path.join(sourcePath, "3", "4"), { recursive: true }),
    mkdir(path.join(targetPath, "3", "4"), { recursive: true }),
    mkdir(legacyPoiPath, { recursive: true }),
    mkdir(path.join(legacyPoiPath, "poi-a"), { recursive: true }),
    mkdir(path.join(legacyPoiPath, "poi-b"), { recursive: true }),
    mkdir(snapshotPath, { recursive: true }),
  ]);
  const sourceBytes = await syntheticTile({
    ids: ["building-a", "building-b", "building-c"],
    names: ["Building A", "Building B", "Building C"],
  });
  const approvedExtraction = (poiId) =>
    JSON.stringify({
      schemaVersion: "1.0",
      poiId,
      tiles: [
        {
          sourceTile: "tiles/3/4/source.b3dm",
          originalBatchIds: [0, 1, 2],
          gmlIds: ["building-a", "building-b", "building-c"],
          gmlNames: ["Building A", "Building B", "Building C"],
        },
      ],
    });
  await Promise.all([
    writeFile(
      path.join(sourcePath, "tileset.json"),
      JSON.stringify({
        asset: { version: "1.0" },
        root: { content: { uri: "3/4/source.b3dm" } },
      }),
    ),
    writeFile(path.join(sourcePath, "3", "4", "source.b3dm"), sourceBytes),
    writeFile(
      path.join(targetPath, "tileset.json"),
      JSON.stringify({ asset: { version: "1.0" }, root: {} }),
    ),
    writeFile(path.join(targetPath, "3", "4", "background.b3dm"), "background"),
    writeFile(path.join(legacyPoiPath, "highlight.b3dm"), "highlight"),
    writeFile(
      path.join(legacyPoiPath, "poi-a", "extraction-manifest.json"),
      approvedExtraction("poi-a"),
    ),
    writeFile(
      path.join(legacyPoiPath, "poi-b", "extraction-manifest.json"),
      approvedExtraction("poi-b"),
    ),
    writeFile(
      path.join(repositoryRoot, "data", "approved-snapshot.json"),
      JSON.stringify({ schemaVersion: "1.0", snapshotId: "fixture-snapshot" }),
    ),
    writeFile(
      path.join(snapshotPath, "manifest.json"),
      JSON.stringify({ snapshotId: "fixture-snapshot", poisRef: "pois.json" }),
    ),
    writeFile(
      path.join(snapshotPath, "pois.json"),
      JSON.stringify([
        { id: "poi-a", tiles: { "tiles/3/4/source.b3dm": [0] } },
        { id: "poi-b", tiles: { "optimized-tiles/3/4/source.b3dm": [0, 1] } },
      ]),
    ),
  ]);

  return { legacyPoiPath, repositoryRoot, sourcePath, targetPath };
};

const withRepository = async (run) => {
  const fixture = await makeRepository();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.repositoryRoot, { force: true, recursive: true });
  }
};

test("capacity reserve rejects an unsafe batch before writes", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const destination = path.join(repositoryRoot, "candidate", "tile.b3dm");
    assert.throws(
      () =>
        assertCapacity({
          destination: repositoryRoot,
          requiredBytes: Number.MAX_SAFE_INTEGER,
          reserveBytes: 1,
        }),
      (error) => error.code === "BACKGROUND_LITE_CAPACITY",
    );
    await assert.rejects(readFile(destination));
  });
});

test("atomic candidate writes replace the destination without temp residue", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const destination = path.join(repositoryRoot, "candidate", "tile.b3dm");
    atomicWrite(destination, Buffer.from("first"));
    atomicWrite(destination, Buffer.from("second"));
    assert.equal(await readFile(destination, "utf8"), "second");
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual(await readdir(path.dirname(destination)), ["tile.b3dm"]);
  });
});

const makeSwitchCandidate = async (repositoryRoot) => {
  const output = path.join(repositoryRoot, "outputs", "background-lite-local");
  await mkdir(output, { recursive: true });
  const files = {
    background: path.join(output, "background-tileset.json"),
    overlays: path.join(output, "overlay-catalogue.json"),
    priorBackground: path.join(output, "prior-background-tileset.json"),
    priorOverlays: path.join(output, "prior-overlay-tileset.json"),
    report: path.join(output, "final", "report.json"),
    rollback: path.join(output, "recovery-building-assets.json"),
  };
  const contents = {
    background: JSON.stringify({ asset: { version: "1.0" }, root: {} }),
    overlays: JSON.stringify({ schemaVersion: "local-highlight-overlays-v1" }),
    priorBackground: JSON.stringify({
      asset: { version: "1.0" },
      root: { prior: true },
    }),
    priorOverlays: JSON.stringify({
      schemaVersion: "prior-local-highlight-overlays-v1",
    }),
    report: JSON.stringify({
      schemaVersion: "local-background-lite-validation-v2",
      state: "ready-to-switch",
      complete: true,
      migration: {},
      artifacts: {},
    }),
  };
  await Promise.all(
    Object.entries(files).map(([key, filename]) =>
      key === "rollback"
        ? Promise.resolve()
        : mkdir(path.dirname(filename), { recursive: true }).then(() =>
            writeFile(filename, contents[key]),
          ),
    ),
  );
  const recovery = asRecoveryManifest({
    background: {
      complete: true,
      opacity: 0.3,
      path: files.priorBackground,
      sha256: digest(contents.priorBackground),
      url: files.priorBackground,
    },
    overlays: {
      complete: true,
      empty: false,
      opacity: 1,
      path: files.priorOverlays,
      sha256: digest(contents.priorOverlays),
      url: files.priorOverlays,
    },
  });
  contents.rollback = JSON.stringify(recovery);
  await writeFile(files.rollback, contents.rollback);
  const manifest = {
    schemaVersion: "local-building-assets-v1",
    state: "ready",
    policyId: "fixture-policy",
    snapshotId: "fixture-snapshot",
    catalogueId: "fixture-catalogue",
    background: {
      complete: true,
      opacity: 0.3,
      path: files.background,
      sha256: digest(contents.background),
    },
    overlays: {
      complete: true,
      opacity: 1,
      path: files.overlays,
      sha256: digest(contents.overlays),
    },
    validation: {
      complete: true,
      browser: true,
      identityParity: true,
      path: files.report,
      rollbackReady: true,
      sha256: digest(contents.report),
      sourceProvenance: true,
    },
    rollbackReference: {
      complete: true,
      path: files.rollback,
      sha256: digest(contents.rollback),
    },
  };
  const candidateManifestPath = path.join(output, "candidate.json");
  await writeFile(candidateManifestPath, JSON.stringify(manifest));
  return { candidateManifestPath, manifest };
};

test("preflight inventories only the exact local migration paths without writing", async () => {
  await withRepository(async ({ repositoryRoot, sourcePath, targetPath }) => {
    const before = await readFile(
      path.join(sourcePath, "tileset.json"),
      "utf8",
    );
    const result = await createMigrationPreflight({
      now: FIXED_NOW,
      repositoryRoot,
    });

    assert.equal(result.schemaVersion, "local-building-asset-migration-v1");
    assert.equal(result.operation, "preflight");
    assert.equal(result.state, "awaiting-confirmation");
    assert.equal(result.localOnly, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.sourceValidation.valid, true);
    assert.equal(result.source.path, sourcePath);
    assert.equal(result.deletionCandidate.path, targetPath);
    assert.equal(result.deletionCandidate.regularFileCount, 2);
    assert.ok(result.deletionCandidate.logicalBytes > 0);
    assert.match(
      result.confirmation.token,
      /^v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/,
    );
    assert.deepEqual(result.scope.batching, {
      batchSize: 20,
      batchCount: 1,
      sourceTileCount: 1,
      processableTileCount: 1,
      excludedTileCount: 0,
    });
    assert.deepEqual(
      {
        activePoiCount: result.scope.activeHighlights.activePoiCount,
        claimCount: result.scope.activeHighlights.claimCount,
        complete: result.scope.activeHighlights.complete,
        referencedSourceTileCount:
          result.scope.activeHighlights.referencedSourceTileCount,
        resolvedBuildingCount:
          result.scope.activeHighlights.resolvedBuildingCount,
        snapshotId: result.scope.activeHighlights.snapshotId,
        uniqueIdentityCount: result.scope.activeHighlights.uniqueIdentityCount,
      },
      {
        activePoiCount: 2,
        claimCount: 3,
        complete: true,
        referencedSourceTileCount: 1,
        resolvedBuildingCount: 2,
        snapshotId: "fixture-snapshot",
        uniqueIdentityCount: 2,
      },
    );
    assert.deepEqual(
      result.scope.activeHighlights.outcomes.resolved.map(
        ({ gmlId, ownerPoiIds }) => ({ gmlId, ownerPoiIds }),
      ),
      [
        { gmlId: "building-a", ownerPoiIds: ["poi-a", "poi-b"] },
        { gmlId: "building-b", ownerPoiIds: ["poi-b"] },
      ],
    );
    assert.deepEqual(result.scope.activeHighlights.outcomes.review, []);
    const confirmationClaims = JSON.parse(
      Buffer.from(
        result.confirmation.token.split(".")[1],
        "base64url",
      ).toString("utf8"),
    );
    assert.equal(
      confirmationClaims.highlightIdentitySetIdentity,
      result.scope.activeHighlights.identitySetIdentity,
    );
    assert.match(
      result.scope.proposedRuns.backgroundRunId,
      /^sha256:[a-f0-9]{64}$/u,
    );
    assert.match(
      result.scope.proposedRuns.overlayRunId,
      /^sha256:[a-f0-9]{64}$/u,
    );
    assert.equal(
      await readFile(path.join(sourcePath, "tileset.json"), "utf8"),
      before,
    );
  });
});

test("preflight treats an already reclaimed exact target as intentionally unavailable", async () => {
  await withRepository(async ({ repositoryRoot, targetPath }) => {
    await rm(targetPath, { recursive: true });
    const result = await createMigrationPreflight({
      now: FIXED_NOW,
      repositoryRoot,
    });
    assert.deepEqual(result.blockers, []);
    assert.equal(result.state, "intentionally-unavailable");
    assert.equal(result.confirmation, null);
    assert.equal(result.deletionCandidate, null);
    assert.equal(result.sourceValidation.valid, true);
    assert.equal(result.scope.activeHighlights.activePoiCount, 2);
  });
});

test("preflight identities are deterministic and only overlay identity follows highlights", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const first = await createMigrationPreflight({
      batchSize: 1,
      now: FIXED_NOW,
      repositoryRoot,
    });
    const second = await createMigrationPreflight({
      batchSize: 1,
      now: FIXED_NOW + 1,
      repositoryRoot,
    });
    assert.equal(
      first.scope.proposedRuns.backgroundRunId,
      second.scope.proposedRuns.backgroundRunId,
    );
    assert.equal(
      first.scope.proposedRuns.overlayRunId,
      second.scope.proposedRuns.overlayRunId,
    );

    const poisPath = path.join(
      repositoryRoot,
      "data",
      "snapshots",
      "fixture-snapshot",
      "pois.json",
    );
    const pois = JSON.parse(await readFile(poisPath, "utf8"));
    pois[0].tiles["tiles/3/4/source.b3dm"].push(2);
    await writeFile(poisPath, JSON.stringify(pois));
    const changed = await createMigrationPreflight({
      batchSize: 1,
      now: FIXED_NOW + 2,
      repositoryRoot,
    });
    assert.equal(
      changed.scope.proposedRuns.backgroundRunId,
      first.scope.proposedRuns.backgroundRunId,
    );
    assert.notEqual(
      changed.scope.proposedRuns.overlayRunId,
      first.scope.proposedRuns.overlayRunId,
    );
    assert.equal(changed.scope.activeHighlights.uniqueIdentityCount, 3);
  });
});

test("preflight blocks confirmation when approved highlight scope is invalid", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const poisPath = path.join(
      repositoryRoot,
      "data",
      "snapshots",
      "fixture-snapshot",
      "pois.json",
    );
    await writeFile(
      poisPath,
      JSON.stringify([{ id: "bad", tiles: { "tiles/9/9/missing.b3dm": [0] } }]),
    );
    const result = await createMigrationPreflight({
      now: FIXED_NOW,
      repositoryRoot,
    });
    assert.equal(result.confirmation, null);
    assert.ok(result.scope);
    assert.equal(result.scope.activeHighlights.complete, false);
    assert.equal(result.scope.activeHighlights.outcomes.resolved.length, 0);
    assert.deepEqual(
      result.scope.activeHighlights.outcomes.review.map(({ reason }) => reason),
      ["source_tile_missing"],
    );
    assert.match(result.blockers.join(" "), /highlight-scope-unresolved/u);
  });
});

test("preflight refuses broad, protected, non-absolute, and symlink targets", async () => {
  await withRepository(
    async ({ legacyPoiPath, repositoryRoot, sourcePath, targetPath }) => {
      for (const unsafeTarget of [
        repositoryRoot,
        sourcePath,
        legacyPoiPath,
        path.dirname(repositoryRoot),
        "optimized-tiles",
        path.join(repositoryRoot, "optimized-*"),
      ]) {
        const result = await createMigrationPreflight({
          now: FIXED_NOW,
          repositoryRoot,
          targetPath: unsafeTarget,
        });
        assert.notEqual(result.state, "awaiting-confirmation", unsafeTarget);
        assert.equal(result.confirmation, null, unsafeTarget);
        assert.ok(result.blockers.length > 0, unsafeTarget);
      }

      await rm(targetPath, { force: true, recursive: true });
      await symlink(sourcePath, targetPath, "dir");
      const symlinkResult = await createMigrationPreflight({
        now: FIXED_NOW,
        repositoryRoot,
      });
      assert.equal(symlinkResult.confirmation, null);
      assert.match(symlinkResult.blockers.join(" "), /symlink/i);
    },
  );
});

test("guarded reclaim removes only the confirmed synthetic target", async () => {
  await withRepository(
    async ({ legacyPoiPath, repositoryRoot, sourcePath, targetPath }) => {
      const preflight = await createMigrationPreflight({
        now: FIXED_NOW,
        repositoryRoot,
      });
      const result = await reclaimOptimizedTiles({
        confirmationToken: preflight.confirmation.token,
        now: FIXED_NOW + 1_000,
        repositoryRoot,
        targetPath,
      });

      assert.equal(result.outcome, "intentionally-unavailable");
      assert.equal(result.state, "intentionally-unavailable");
      assert.equal(result.deletedPath, targetPath);
      assert.ok(result.actualReclaimedBytes >= 0);
      assert.ok(result.deletedTreeAllocatedBytes > 0);
      await assert.rejects(readFile(path.join(targetPath, "tileset.json")));
      assert.equal(
        JSON.parse(
          await readFile(path.join(sourcePath, "tileset.json"), "utf8"),
        ).asset.version,
        "1.0",
      );
      assert.equal(
        await readFile(path.join(legacyPoiPath, "highlight.b3dm"), "utf8"),
        "highlight",
      );

      const repeated = await reclaimOptimizedTiles({
        confirmationToken: preflight.confirmation.token,
        now: FIXED_NOW + 2_000,
        repositoryRoot,
        targetPath,
      });
      assert.equal(repeated.outcome, "no-op");
    },
  );
});

test("guarded reclaim rejects invalid or expired confirmation without mutation", async () => {
  await withRepository(async ({ repositoryRoot, targetPath }) => {
    const preflight = await createMigrationPreflight({
      now: FIXED_NOW,
      repositoryRoot,
      tokenTtlMs: 5_000,
    });

    for (const [confirmationToken, now] of [
      [`${preflight.confirmation.token}tampered`, FIXED_NOW + 1_000],
      [preflight.confirmation.token, FIXED_NOW + 5_000],
      [preflight.confirmation.token, FIXED_NOW + 6_000],
    ]) {
      const result = await reclaimOptimizedTiles({
        confirmationToken,
        now,
        repositoryRoot,
        targetPath,
      });
      assert.equal(result.outcome, "confirmation-invalid");
      assert.equal(
        await readFile(
          path.join(targetPath, "3", "4", "background.b3dm"),
          "utf8",
        ),
        "background",
      );
    }
  });
});

test("guarded reclaim detects changed target and source inventories", async () => {
  await withRepository(async ({ repositoryRoot, sourcePath, targetPath }) => {
    const targetPreflight = await createMigrationPreflight({
      now: FIXED_NOW,
      repositoryRoot,
    });
    await writeFile(path.join(targetPath, "late-file.b3dm"), "changed");
    const targetChanged = await reclaimOptimizedTiles({
      confirmationToken: targetPreflight.confirmation.token,
      now: FIXED_NOW + 1_000,
      repositoryRoot,
      targetPath,
    });
    assert.equal(targetChanged.outcome, "target-changed");
    assert.equal(
      await readFile(path.join(targetPath, "late-file.b3dm"), "utf8"),
      "changed",
    );

    await rm(path.join(targetPath, "late-file.b3dm"));
    const sourcePreflight = await createMigrationPreflight({
      now: FIXED_NOW + 2_000,
      repositoryRoot,
    });
    await writeFile(path.join(sourcePath, "late-source.b3dm"), "changed");
    const sourceChanged = await reclaimOptimizedTiles({
      confirmationToken: sourcePreflight.confirmation.token,
      now: FIXED_NOW + 3_000,
      repositoryRoot,
      targetPath,
    });
    assert.equal(sourceChanged.outcome, "source-invalid");
    assert.equal(
      await readFile(
        path.join(targetPath, "3", "4", "background.b3dm"),
        "utf8",
      ),
      "background",
    );
  });
});

test("guarded reclaim rejects a changed approved highlight identity set", async () => {
  await withRepository(async ({ repositoryRoot, targetPath }) => {
    const preflight = await createMigrationPreflight({
      now: FIXED_NOW,
      repositoryRoot,
    });
    const poisPath = path.join(
      repositoryRoot,
      "data",
      "snapshots",
      "fixture-snapshot",
      "pois.json",
    );
    const pois = JSON.parse(await readFile(poisPath, "utf8"));
    pois[0].tiles["tiles/3/4/source.b3dm"] = [2];
    await writeFile(poisPath, JSON.stringify(pois));

    const result = await reclaimOptimizedTiles({
      confirmationToken: preflight.confirmation.token,
      now: FIXED_NOW + 1_000,
      repositoryRoot,
      targetPath,
    });

    assert.equal(result.outcome, "source-invalid");
    assert.equal(
      await readFile(
        path.join(targetPath, "3", "4", "background.b3dm"),
        "utf8",
      ),
      "background",
    );
  });
});

test("local switch validates immutable assets, activates atomically, and rolls back", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const { candidateManifestPath, manifest } =
      await makeSwitchCandidate(repositoryRoot);
    assert.equal(
      (await validateLocalSwitchManifest({ manifest, repositoryRoot })).valid,
      true,
    );
    const activeManifestPath = path.join(
      repositoryRoot,
      "outputs",
      "active-local-assets.json",
    );
    const prior = JSON.parse(
      await readFile(manifest.rollbackReference.path, "utf8"),
    );
    await writeFile(
      activeManifestPath,
      JSON.stringify({ ...prior, state: "active-local" }),
    );
    const switched = await activateLocalSwitchManifest({
      activeManifestPath,
      candidateManifestPath,
      now: FIXED_NOW,
      repositoryRoot,
    });
    assert.equal(switched.state, "active-local");
    const active = JSON.parse(await readFile(activeManifestPath, "utf8"));
    assert.equal(active.state, "active-local");
    assert.equal(active.background.opacity, 0.3);
    assert.equal(active.overlays.opacity, 1);
    assert.ok(active.rollbackReference.path.endsWith(".rollback.json"));
    const terminalReport = JSON.parse(
      await readFile(manifest.validation.path, "utf8"),
    );
    assert.equal(terminalReport.state, "active-local");
    assert.equal(terminalReport.migration.switch.operation, "switch-local");
    assert.equal(terminalReport.migration.switch.outcome, "active-local");
    assert.equal(
      terminalReport.migration.switch.activeManifestPath,
      activeManifestPath,
    );
    assert.equal(terminalReport.migration.switch.verified, true);
    assert.equal(terminalReport.migration.switch.localOnly, true);
    assert.deepEqual(terminalReport.migration.switch.publicationActions, []);
    assert.equal(
      active.validation.sha256,
      digest(await readFile(manifest.validation.path)),
    );
    assert.equal(
      "activeManifestSha256" in terminalReport.migration.switch,
      false,
    );
    assert.equal("candidateManifest" in terminalReport.migration.switch, false);

    const rolledBack = await rollbackLocalSwitchManifest({
      activeManifestPath,
      repositoryRoot,
    });
    assert.equal(rolledBack.state, "rolled-back");
    assert.equal(
      JSON.parse(await readFile(activeManifestPath, "utf8")).schemaVersion,
      "local-building-assets-v1",
    );
  });
});

test("first local activation creates a hash-bound rollback from recovery evidence", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const { candidateManifestPath } = await makeSwitchCandidate(repositoryRoot);
    const activeManifestPath = path.join(
      repositoryRoot,
      "outputs",
      "first-active-assets.json",
    );
    const switched = await activateLocalSwitchManifest({
      activeManifestPath,
      candidateManifestPath,
      now: FIXED_NOW,
      repositoryRoot,
    });
    assert.equal(switched.rollbackReference.complete, true);
    const active = JSON.parse(await readFile(activeManifestPath, "utf8"));
    assert.match(active.rollbackReference.sha256, /^sha256:[a-f0-9]{64}$/u);
    await rollbackLocalSwitchManifest({ activeManifestPath, repositoryRoot });
    assert.equal(
      JSON.parse(await readFile(activeManifestPath, "utf8")).state,
      "rolled-back",
    );
  });
});

test("local switch rejects incomplete validation and changed asset hashes", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const { manifest } = await makeSwitchCandidate(repositoryRoot);
    await assert.rejects(
      validateLocalSwitchManifest({
        manifest: {
          ...manifest,
          validation: { ...manifest.validation, browser: false },
        },
        repositoryRoot,
      }),
      /incomplete/u,
    );
    await writeFile(manifest.background.path, "changed");
    await assert.rejects(
      validateLocalSwitchManifest({ manifest, repositoryRoot }),
      /hash does not match/u,
    );
  });
});

test("switch rejects a hash-valid recovery JSON after an inner asset changes", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const { manifest } = await makeSwitchCandidate(repositoryRoot);
    const recovery = JSON.parse(
      await readFile(manifest.rollbackReference.path, "utf8"),
    );
    await writeFile(recovery.overlays.path, "changed-inner-overlay");
    await assert.rejects(
      validateLocalSwitchManifest({ manifest, repositoryRoot }),
      /overlay recovery hash does not match/u,
    );
  });
});

test("rollback re-verifies both assets in the exact prior selection", async () => {
  await withRepository(async ({ repositoryRoot }) => {
    const { candidateManifestPath, manifest } =
      await makeSwitchCandidate(repositoryRoot);
    const activeManifestPath = path.join(
      repositoryRoot,
      "outputs",
      "first-active-assets.json",
    );
    await activateLocalSwitchManifest({
      activeManifestPath,
      candidateManifestPath,
      now: FIXED_NOW,
      repositoryRoot,
    });
    const recovery = JSON.parse(
      await readFile(manifest.rollbackReference.path, "utf8"),
    );
    await writeFile(recovery.background.path, "changed-inner-background");
    await assert.rejects(
      rollbackLocalSwitchManifest({ activeManifestPath, repositoryRoot }),
      /background recovery hash does not match/u,
    );
    assert.equal(
      JSON.parse(await readFile(activeManifestPath, "utf8")).state,
      "active-local",
    );
  });
});

test("legacy POI cleanup requires a separate exact confirmation after parity and rollback", async () => {
  await withRepository(
    async ({ legacyPoiPath, repositoryRoot, sourcePath }) => {
      const sourceBefore = await readFile(
        path.join(sourcePath, "3", "4", "source.b3dm"),
      );
      const { candidateManifestPath, manifest } =
        await makeSwitchCandidate(repositoryRoot);
      const activeManifestPath = path.join(
        repositoryRoot,
        "outputs",
        "active-local-assets.json",
      );
      const prior = JSON.parse(
        await readFile(manifest.rollbackReference.path, "utf8"),
      );
      await writeFile(
        activeManifestPath,
        JSON.stringify({ ...prior, state: "active-local" }),
      );
      await activateLocalSwitchManifest({
        activeManifestPath,
        candidateManifestPath,
        now: FIXED_NOW,
        repositoryRoot,
      });

      const broad = await createLegacyPoiCleanupPreflight({
        activeManifestPath,
        now: FIXED_NOW,
        repositoryRoot,
        targetPath: path.join(repositoryRoot, "public"),
      });
      assert.equal(broad.confirmation, null);

      const preflight = await createLegacyPoiCleanupPreflight({
        activeManifestPath,
        now: FIXED_NOW,
        repositoryRoot,
      });
      assert.deepEqual(preflight.blockers, []);
      assert.equal(preflight.deletionCandidate.path, legacyPoiPath);
      assert.equal(preflight.confirmation.action, "reclaim-legacy-poi-tiles");

      const rejected = await cleanupLegacyPoiTiles({
        activeManifestPath,
        confirmationToken: `${preflight.confirmation.token}changed`,
        now: FIXED_NOW + 1,
        repositoryRoot,
        targetPath: legacyPoiPath,
      });
      assert.equal(rejected.outcome, "confirmation-invalid");
      assert.equal(
        await readFile(path.join(legacyPoiPath, "highlight.b3dm"), "utf8"),
        "highlight",
      );

      const cleaned = await cleanupLegacyPoiTiles({
        activeManifestPath,
        confirmationToken: preflight.confirmation.token,
        now: FIXED_NOW + 1,
        repositoryRoot,
        targetPath: legacyPoiPath,
      });
      assert.equal(cleaned.outcome, "complete");
      await assert.rejects(lstat(legacyPoiPath), { code: "ENOENT" });
      assert.deepEqual(
        await readFile(path.join(sourcePath, "3", "4", "source.b3dm")),
        sourceBefore,
      );
    },
  );
});
