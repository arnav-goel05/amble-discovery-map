import fs from "node:fs";
import path from "node:path";

import { atomicWrite, canonicalJson, sha256 } from "./background-lite-run.mjs";
import {
  readPlaywrightBrowserEvidence,
  REQUIRED_BROWSER_PROJECTS,
} from "./local-background-browser-evidence.mjs";
import { validateRecoveryManifest } from "./local-asset-recovery.mjs";
import { activeLocalSelectionId } from "./local-asset-switch-report.mjs";

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

function uniqueBy(items, keyFor) {
  const unique = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const old = unique.get(key);
    if (old && canonicalJson(old) !== canonicalJson(item))
      throw new Error(`Contradictory duplicate evidence: ${key}`);
    unique.set(key, item);
  }
  return unique;
}

export function assessPerformanceEvidence(performance) {
  const runs = Array.isArray(performance?.runs) ? performance.runs : [];
  const variants = new Set(runs.map(({ variant }) => variant));
  const scenes = new Set(runs.map(({ sceneId }) => sceneId));
  const grouped = new Map();
  for (const run of runs) {
    if (
      !["current", "candidate"].includes(run.variant) ||
      typeof run.sceneId !== "string" ||
      !Number.isFinite(run.loadToSettleMs) ||
      !Number.isFinite(run.movementFps) ||
      !Number.isFinite(run.memory?.usedJsHeapBytes) ||
      run.settled !== true ||
      Number(run.counts?.backgroundRenderable ?? 0) <= 0 ||
      Number(run.counts?.overlayRenderable ?? 0) <= 0 ||
      (run.errors?.length ?? 0) !== 0 ||
      (run.missingAssets?.length ?? 0) !== 0
    )
      continue;
    const key = `${run.sceneId}:${run.variant}`;
    const group = grouped.get(key) ?? [];
    group.push(run);
    grouped.set(key, group);
  }
  const everyGroupRepeated =
    scenes.size >= 5 &&
    [...scenes].every(
      (scene) =>
        (grouped.get(`${scene}:current`)?.length ?? 0) >= 5 &&
        (grouped.get(`${scene}:candidate`)?.length ?? 0) >= 5,
    );
  const alternating =
    runs.length > 0 &&
    runs.every(
      (run, index) => index === 0 || run.variant !== runs[index - 1].variant,
    );
  const summaries = [...grouped].map(([key, group]) => ({
    key,
    runCount: group.length,
    p50LoadToSettleMs: median(
      group.map(({ loadToSettleMs }) => loadToSettleMs),
    ),
    p50MovementFps: median(group.map(({ movementFps }) => movementFps)),
    minLoadToSettleMs: Math.min(
      ...group.map(({ loadToSettleMs }) => loadToSettleMs),
    ),
    maxLoadToSettleMs: Math.max(
      ...group.map(({ loadToSettleMs }) => loadToSettleMs),
    ),
  }));
  return {
    complete:
      performance?.complete === true &&
      variants.has("current") &&
      variants.has("candidate") &&
      everyGroupRepeated &&
      alternating,
    alternating,
    distinctSceneCount: scenes.size,
    everyGroupRepeated,
    summaries,
  };
}

export function buildFinalValidationReport({
  background,
  overlays,
  visuals,
  performance,
  browser,
  migration,
  rollback,
  artifactLocations,
  currentRuntimeBytes,
} = {}) {
  const backgroundRecords = Array.isArray(background?.records)
    ? background.records
    : [];
  const uniqueBackground = uniqueBy(
    backgroundRecords,
    ({ canonicalPath }) => canonicalPath,
  );
  const overlayFragments = (overlays?.buildings ?? []).flatMap(
    ({ fragments = [] }) => fragments,
  );
  const overlayBuildings = Array.isArray(overlays?.buildings)
    ? overlays.buildings
    : [];
  const uniqueOverlays = uniqueBy(
    overlayFragments,
    ({ fragmentId }) => fragmentId,
  );
  const uniqueOverlayAssets = uniqueBy(
    overlayFragments.map((fragment) => ({
      assetId: fragment.assetId ?? fragment.fragmentId,
      outputPath: fragment.outputPath ?? null,
      outputSha256: fragment.outputSha256 ?? null,
      outputBytes: Number(fragment.outputBytes ?? 0),
    })),
    ({ assetId }) => assetId,
  );
  const backgroundBytes = [...uniqueBackground.values()].reduce(
    (sum, record) => sum + Number(record.outputBytes ?? 0),
    0,
  );
  const overlayBytes = [...uniqueOverlayAssets.values()].reduce(
    (sum, asset) => sum + asset.outputBytes,
    0,
  );
  const candidateRuntimeBytes = backgroundBytes + overlayBytes;
  const payloadReductionPercent =
    Number.isFinite(currentRuntimeBytes) && currentRuntimeBytes > 0
      ? Number(
          (
            ((currentRuntimeBytes - candidateRuntimeBytes) /
              currentRuntimeBytes) *
            100
          ).toFixed(2),
        )
      : null;
  const scenes = Array.isArray(visuals?.scenes) ? visuals.scenes : [];
  const distinctCameras = new Set(
    scenes.map(({ observedCamera }) => observedCamera).filter(Boolean),
  );
  const visualParity =
    visuals?.complete === true &&
    scenes.length >= 5 &&
    distinctCameras.size >= 5 &&
    scenes.every(
      (scene) =>
        scene.passed === true &&
        scene.humanReview === "pass" &&
        scene.highlightedRenderable > 0 &&
        scene.backgroundRenderable > 0 &&
        scene.beforeRenderable === scene.afterRenderable &&
        (scene.browserErrors?.length ?? 0) === 0,
    );
  const backgroundIntegrity = backgroundRecords.every((record) => {
    if (record.outcome === "excluded")
      return (
        typeof record.evidenceIdentity === "string" &&
        record.evidenceIdentity.length > 0 &&
        typeof record.reason === "string" &&
        record.reason.length > 0 &&
        Number(record.outputBytes ?? 0) === 0
      );
    return (
      record.outcome === "processed" &&
      record.identityPreserved === true &&
      record.geometryPreserved === true
    );
  });
  const overlayBuildingIdentities = overlayBuildings.map(
    ({ buildingIdentity }) => buildingIdentity,
  );
  const overlayReachability =
    overlayBuildings.length === Number(overlays?.uniqueBuildingCount) &&
    new Set(overlayBuildingIdentities).size === overlayBuildings.length &&
    overlayBuildings.every(
      (building) =>
        typeof building.buildingIdentity === "string" &&
        building.buildingIdentity.length > 0 &&
        building.fragments?.length === 1,
    ) &&
    uniqueOverlays.size === Number(overlays?.uniqueFragmentCount) &&
    uniqueOverlayAssets.size === Number(overlays?.uniqueAssetCount);
  const overlayCounts = overlays?.counts;
  const reconciliationOutcomes = [
    "create",
    "update",
    "noop",
    "expire",
    "review",
  ];
  const reconciliationComplete =
    overlayCounts != null &&
    reconciliationOutcomes.every(
      (outcome) =>
        Number.isSafeInteger(overlayCounts[outcome]) &&
        overlayCounts[outcome] >= 0,
    ) &&
    overlayCounts.create + overlayCounts.update + overlayCounts.noop ===
      Number(overlays?.uniqueBuildingCount) &&
    overlayCounts.review === 0;
  const identityParity =
    background?.complete === true &&
    backgroundRecords.length === Number(background?.sourceTileCount) &&
    backgroundIntegrity &&
    overlays?.complete === true &&
    overlayReachability &&
    reconciliationComplete &&
    (overlays?.unresolved?.length ?? 0) === 0;
  const performanceAssessment = assessPerformanceEvidence(performance);
  const browserComplete =
    browser?.complete === true &&
    browser?.schemaVersion === "local-background-browser-evidence-v1" &&
    REQUIRED_BROWSER_PROJECTS.every((projectName) =>
      browser.projectOutcomes?.some(
        (outcome) =>
          outcome.projectName === projectName && outcome.status === "passed",
      ),
    );
  const rollbackReady =
    rollback?.complete === true &&
    rollback?.innerAssetHashesVerified === true &&
    /^sha256:[a-f0-9]{64}$/u.test(rollback?.selectionId ?? "") &&
    typeof rollback?.path === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(rollback?.sha256 ?? "");
  const switchActive =
    migration?.switch?.verified === true &&
    migration.switch.complete === true &&
    migration.switch.state === "active-local" &&
    migration.switch.outcome === "active-local" &&
    migration.switch.localOnly === true &&
    migration.switch.publicationActions?.length === 0;
  const complete =
    identityParity &&
    browserComplete &&
    rollbackReady &&
    payloadReductionPercent !== null &&
    payloadReductionPercent >= 40;
  const unresolved = [
    ...(!background ? ["background-report-missing"] : []),
    ...(!overlays ? ["overlay-catalogue-missing"] : []),
    ...(!identityParity ? ["identity-or-source-provenance-incomplete"] : []),
    ...(!browserComplete ? ["six-project-browser-evidence-incomplete"] : []),
    ...(!rollbackReady ? ["rollback-evidence-incomplete"] : []),
    ...(payloadReductionPercent === null
      ? ["current-runtime-payload-baseline-missing"]
      : payloadReductionPercent < 40
        ? ["combined-payload-reduction-below-40-percent"]
        : []),
  ];
  const advisory = [
    ...(!visualParity ? ["five-scene-human-visual-parity-not-recorded"] : []),
    ...(!performanceAssessment.complete
      ? ["repeated-performance-evidence-not-recorded"]
      : []),
    ...(migration?.switch && !switchActive
      ? ["active-switch-evidence-invalid"]
      : []),
  ];
  const content = {
    schemaVersion: "local-background-lite-validation-v2",
    state: complete
      ? switchActive
        ? "active-local"
        : "ready-to-switch"
      : "failed-validation",
    complete,
    localOnly: true,
    productionChanged: false,
    publicationActions: [],
    payload: {
      currentRuntimeBytes: currentRuntimeBytes ?? null,
      candidateRuntimeBytes,
      backgroundBytes,
      overlayBytes,
      uniqueBackgroundTileCount: uniqueBackground.size,
      uniqueOverlayFragmentCount: uniqueOverlays.size,
      uniqueOverlayAssetCount: uniqueOverlayAssets.size,
      reductionPercent: payloadReductionPercent,
    },
    validation: {
      identityParity,
      sourceProvenance: overlays?.complete === true,
      visualParity,
      distinctSceneCount: distinctCameras.size,
      performance: performanceAssessment,
      browser: browserComplete,
      rollbackReady,
    },
    background: background
      ? {
          complete: background.complete,
          runId: background.runId,
          inventoryId: background.inventoryId,
          policyId: background.policyId,
          policy: background.policy,
          sourceTileCount: background.sourceTileCount,
          selectedTileCount: background.selectedTileCount,
          excludedCount: background.excludedCount,
          failedCount: background.failedCount,
          processedCount: background.processedCount,
          resumedCount: background.resumedCount,
          outcomes: background.outcomes,
          totals: background.totals,
          tilesetSha256: background.tilesetSha256,
          unresolved: background.unresolved,
          exclusions: backgroundRecords
            .filter(({ outcome }) => outcome === "excluded")
            .map(({ canonicalPath, evidenceIdentity, reason }) => ({
              canonicalPath,
              evidenceIdentity,
              reason,
            })),
          failures: backgroundRecords
            .filter(({ outcome }) => outcome === "failed")
            .map(({ canonicalPath, error }) => ({ canonicalPath, error })),
          integrityVerifiedCount: backgroundRecords.filter(
            (record) =>
              record.outcome === "processed" &&
              record.identityPreserved === true &&
              record.geometryPreserved === true,
          ).length,
          terminalProcessedCount: backgroundRecords.filter(
            ({ outcome }) => outcome === "processed",
          ).length,
        }
      : { state: "missing" },
    overlays: overlays
      ? {
          complete: overlays.complete,
          catalogueId: overlays.catalogueId,
          snapshotId: overlays.snapshotId,
          evidenceIdentity: overlays.evidenceIdentity,
          uniqueBuildingCount: overlays.uniqueBuildingCount,
          uniqueFragmentCount: overlays.uniqueFragmentCount,
          uniqueAssetCount: overlays.uniqueAssetCount,
          uniqueOwnerCount: overlays.uniqueOwnerCount,
          counts: overlays.counts,
          reconciliationComplete,
          unresolved: overlays.unresolved,
          exactOnceReachability: overlayReachability,
          buildingIdentities: overlayBuildingIdentities,
        }
      : { state: "missing" },
    visuals: visuals ?? { state: "missing", scenes: [] },
    performance: performance ?? { state: "missing", runs: [] },
    browser: browser ?? {
      state: "missing",
      requiredProjects: [...REQUIRED_BROWSER_PROJECTS],
      projectOutcomes: [],
      complete: false,
    },
    migration: migration ?? { state: "missing" },
    rollback: rollback ?? { state: "missing", complete: false },
    artifacts: artifactLocations ?? {},
    unresolved,
    advisory,
  };
  return { ...content, reportId: sha256(canonicalJson(content)) };
}

export function readValidationInputs(outputRoot) {
  const read = (relative) => {
    const filename = path.join(outputRoot, relative);
    return fs.existsSync(filename)
      ? JSON.parse(fs.readFileSync(filename, "utf8"))
      : null;
  };
  const baseline = read("reports/current-runtime-payload.json");
  const absolute = (relative) => path.join(outputRoot, relative);
  const recoveryPath = absolute("recovery-building-assets.json");
  const browserReportPath = absolute("browser/playwright-report.json");
  const recovery = read("recovery-building-assets.json");
  const switchEvidence = read("reports/switch.json");
  const activeManifestPath = absolute("active-building-assets.json");
  let verifiedSwitch = null;
  if (switchEvidence?.complete === true && fs.existsSync(activeManifestPath)) {
    try {
      const active = JSON.parse(fs.readFileSync(activeManifestPath, "utf8"));
      const verified =
        active.state === "active-local" &&
        active.localOnly === true &&
        active.publicationActions?.length === 0 &&
        switchEvidence.activeManifestPath === activeManifestPath &&
        switchEvidence.activeSelectionId === activeLocalSelectionId(active) &&
        switchEvidence.policyId === active.policyId &&
        switchEvidence.snapshotId === active.snapshotId &&
        switchEvidence.catalogueId === active.catalogueId &&
        switchEvidence.background?.sha256 === active.background?.sha256 &&
        switchEvidence.overlays?.sha256 === active.overlays?.sha256 &&
        switchEvidence.rollbackReference?.sha256 ===
          active.rollbackReference?.sha256;
      verifiedSwitch = { ...switchEvidence, verified };
    } catch (error) {
      verifiedSwitch = {
        ...switchEvidence,
        error: error.message,
        verified: false,
      };
    }
  }
  let rollback = null;
  if (recovery?.schemaVersion === "local-building-assets-v1") {
    try {
      const verified = validateRecoveryManifest({
        manifest: recovery,
        repositoryRoot: path.resolve(outputRoot, "..", ".."),
      });
      rollback = {
        complete: true,
        innerAssetHashesVerified: true,
        path: recoveryPath,
        selectionId: verified.selectionId,
        sha256: `sha256:${sha256(fs.readFileSync(recoveryPath))}`,
      };
    } catch (error) {
      rollback = {
        complete: false,
        error: error.message,
        innerAssetHashesVerified: false,
        path: recoveryPath,
      };
    }
  }
  return {
    background: read("reports/background.json"),
    overlays: read("overlays/catalogue.json"),
    visuals: read("visuals/report.json"),
    performance: read("performance/report.json"),
    browser: readPlaywrightBrowserEvidence(browserReportPath),
    migration: {
      preflight: read("reports/preflight.json"),
      reclaim: read("reports/reclaim.json"),
      switch: verifiedSwitch,
    },
    rollback,
    artifactLocations: {
      backgroundReport: absolute("reports/background.json"),
      backgroundTileset: absolute("background-lite/tileset.json"),
      overlayCatalogue: absolute("overlays/catalogue.json"),
      overlayTileset: absolute("overlays/tileset.json"),
      visualReport: absolute("visuals/report.json"),
      performanceReport: absolute("performance/report.json"),
      browserReport: browserReportPath,
      preflightReport: absolute("reports/preflight.json"),
      reclaimReport: absolute("reports/reclaim.json"),
      recoveryManifest: recoveryPath,
      activeManifest: activeManifestPath,
      switchReport: absolute("reports/switch.json"),
    },
    currentRuntimeBytes: Number.isFinite(baseline?.uniqueRuntimeBytes)
      ? baseline.uniqueRuntimeBytes
      : null,
  };
}

export function writeFinalValidationReport(outputRoot, report) {
  const destination = path.join(outputRoot, "final", "report.json");
  atomicWrite(destination, `${JSON.stringify(report, null, 2)}\n`);
  return destination;
}
