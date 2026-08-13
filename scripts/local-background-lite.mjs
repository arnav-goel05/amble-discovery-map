#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  atomicWrite,
  BACKGROUND_LITE_POLICY,
  runBackgroundLite,
  sha256,
} from "./lib/background-lite-run.mjs";
import {
  createMigrationPreflight,
  reclaimOptimizedTiles,
  activateLocalSwitchManifest,
  rebindActiveValidationReport,
  rollbackLocalSwitchManifest,
  asRecoveryManifest,
} from "./lib/local-asset-migration.mjs";
import {
  buildOverlayCatalogue,
  loadActiveHighlightInputs,
} from "./lib/highlight-overlay-build.mjs";
import {
  buildFinalValidationReport,
  readValidationInputs,
  writeFinalValidationReport,
} from "./lib/local-background-validation.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for --${name}`);
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function absoluteOption(options, name, fallback) {
  const value = options[name] ?? fallback;
  if (!value) throw new Error(`--${name} is required`);
  if (!path.isAbsolute(value))
    throw new Error(`--${name} must be an absolute path`);
  return path.normalize(value);
}

function positiveInteger(options, name, fallback, { allowZero = false } = {}) {
  const value = Number(options[name] ?? fallback);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`--${name} must be an integer >= ${minimum}`);
  return value;
}

function writeReport(outputRoot, name, result) {
  const destination = path.join(outputRoot, "reports", name);
  atomicWrite(destination, `${JSON.stringify(result, null, 2)}\n`);
  return destination;
}

function print(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printBuildProgress(progress) {
  const outcomes = {};
  for (const record of progress.records ?? [])
    outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: "local-background-lite-progress-v1",
      runId: progress.runId,
      complete: progress.complete,
      recorded: progress.records?.length ?? 0,
      outcomes,
      capacityBlock: progress.capacityBlock ?? null,
    })}\n`,
  );
}

function fileReference(filename, complete = true) {
  const bytes = fs.readFileSync(filename);
  return { path: filename, sha256: `sha256:${sha256(bytes)}`, complete };
}

function ensureRecoveryManifest(outputRoot) {
  const destination = path.join(outputRoot, "recovery-building-assets.json");
  const backgroundPath = path.join(repositoryRoot, "tiles", "tileset.json");
  const overlaysPath = path.join(
    repositoryRoot,
    "public",
    "poi-tiles",
    "event-venues",
    "tileset.json",
  );
  const recovery = asRecoveryManifest({
    schemaVersion: "local-building-assets-v1",
    localOnly: true,
    publicationActions: [],
    background: {
      ...fileReference(backgroundPath),
      url: backgroundPath,
      opacity: 0.3,
    },
    overlays: {
      ...fileReference(overlaysPath),
      url: overlaysPath,
      opacity: 1,
      empty: false,
    },
  });
  atomicWrite(destination, `${JSON.stringify(recovery, null, 2)}\n`);
  return { destination, recovery };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const defaultOutput = path.join(
    repositoryRoot,
    "outputs",
    "background-lite-local",
  );

  if (command === "preflight") {
    const outputRoot = absoluteOption(options, "output", defaultOutput);
    const result = await createMigrationPreflight({ repositoryRoot });
    const reportPath = writeReport(outputRoot, "preflight.json", result);
    print({ ...result, reportPath });
    return;
  }

  if (command === "reclaim") {
    const targetPath = absoluteOption(options, "target");
    if (!options.confirm) throw new Error("--confirm is required");
    const result = await reclaimOptimizedTiles({
      confirmationToken: options.confirm,
      repositoryRoot,
      targetPath,
    });
    print(result);
    if (!["intentionally-unavailable", "no-op"].includes(result.outcome))
      process.exitCode = 2;
    return;
  }

  if (command === "build") {
    const outputRoot = absoluteOption(options, "output", defaultOutput);
    const report = await runBackgroundLite({
      sourceRoot: path.join(repositoryRoot, "tiles"),
      outputRoot,
      limit: positiveInteger(options, "limit", 0, { allowZero: true }),
      batchSize: positiveInteger(options, "batch-size", 20),
      concurrency: positiveInteger(options, "concurrency", 2),
      reserveBytes: positiveInteger(options, "reserve-bytes", 1_073_741_824),
      policy: BACKGROUND_LITE_POLICY,
      onCheckpoint: printBuildProgress,
    });
    print(report);
    if (!report.complete) process.exitCode = 2;
    return;
  }

  if (command === "overlays") {
    const outputRoot = absoluteOption(options, "output", defaultOutput);
    const inputs = loadActiveHighlightInputs({
      root: repositoryRoot,
      sourceRoot: path.join(repositoryRoot, "tiles"),
    });
    const result = await buildOverlayCatalogue({
      ...inputs,
      outputRoot: path.join(outputRoot, "overlays"),
    });
    print({
      ...result,
      localOnly: true,
      productionChanged: false,
      publicationActions: [],
    });
    if (!result.complete) process.exitCode = 2;
    return;
  }

  if (command === "switch-local") {
    const outputRoot = absoluteOption(options, "output", defaultOutput);
    const candidateManifestPath = absoluteOption(options, "manifest");
    const activeManifestPath = absoluteOption(
      options,
      "active-manifest",
      path.join(outputRoot, "active-building-assets.json"),
    );
    print(
      await activateLocalSwitchManifest({
        activeManifestPath,
        candidateManifestPath,
        repositoryRoot,
      }),
    );
    return;
  }

  if (command === "rollback-local") {
    const outputRoot = absoluteOption(options, "output", defaultOutput);
    const activeManifestPath = absoluteOption(
      options,
      "active-manifest",
      path.join(outputRoot, "active-building-assets.json"),
    );
    print(
      await rollbackLocalSwitchManifest({ activeManifestPath, repositoryRoot }),
    );
    return;
  }

  if (command === "validate") {
    const outputRoot = absoluteOption(options, "output", defaultOutput);
    const overlayTilesetPath = path.join(
      outputRoot,
      "overlays",
      "tileset.json",
    );
    const { destination: recoveryPath } = ensureRecoveryManifest(outputRoot);
    const inputs = readValidationInputs(outputRoot);
    const report = buildFinalValidationReport(inputs);
    const reportPath = writeFinalValidationReport(outputRoot, report);
    if (report.state === "active-local")
      await rebindActiveValidationReport({
        activeManifestPath: path.join(
          outputRoot,
          "active-building-assets.json",
        ),
        reportPath,
        repositoryRoot,
      });
    let switchManifestPath = null;
    if (report.state === "ready-to-switch") {
      if (!fs.existsSync(overlayTilesetPath))
        throw new Error("Complete overlay catalogue has no tileset.json");
      const backgroundTilesetPath = path.join(
        outputRoot,
        "background-lite",
        "tileset.json",
      );
      const manifest = {
        schemaVersion: "local-building-assets-v1",
        state: "ready",
        manifestId: sha256(fs.readFileSync(reportPath)),
        policyId: inputs.background.policyId,
        snapshotId: inputs.overlays.snapshotId,
        catalogueId: inputs.overlays.catalogueId,
        localOnly: true,
        publicationActions: [],
        background: {
          ...fileReference(backgroundTilesetPath),
          url: backgroundTilesetPath,
          opacity: 0.3,
        },
        overlays: {
          ...fileReference(overlayTilesetPath),
          url: overlayTilesetPath,
          opacity: 1,
          empty: inputs.overlays.uniqueBuildingCount === 0,
          identityCount: inputs.overlays.uniqueBuildingCount,
          ownerCount: inputs.overlays.uniqueOwnerCount,
        },
        validation: {
          ...fileReference(reportPath),
          ...report.validation,
          complete: true,
        },
        rollbackReference: {
          ...fileReference(recoveryPath),
        },
      };
      switchManifestPath = path.join(outputRoot, "switch-manifest.json");
      atomicWrite(switchManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    print({ ...report, reportPath, switchManifestPath });
    if (!report.complete) process.exitCode = 2;
    return;
  }

  if (command === "status") {
    const outputRoot = absoluteOption(options, "output", defaultOutput);
    const candidates = [
      path.join(outputRoot, "reports", "background.json"),
      path.join(outputRoot, "checkpoints", "latest.json"),
      path.join(outputRoot, "reports", "preflight.json"),
    ];
    const reportPath = candidates.find((candidate) => fs.existsSync(candidate));
    print(
      reportPath
        ? {
            reportPath,
            report: JSON.parse(fs.readFileSync(reportPath, "utf8")),
          }
        : {
            schemaVersion: "local-background-lite-status-v1",
            state: "not-started",
            outputRoot,
            localOnly: true,
          },
    );
    return;
  }

  throw new Error(
    "Usage: background-lite:local <preflight|reclaim|build|overlays|validate|switch-local|rollback-local|status> [options]",
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
