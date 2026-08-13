import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assessPlaywrightBrowserEvidence,
  readPlaywrightBrowserEvidence,
  REQUIRED_BROWSER_PROJECTS,
} from "../scripts/lib/local-background-browser-evidence.mjs";
import {
  assessPerformanceEvidence,
  buildFinalValidationReport,
  readValidationInputs,
} from "../scripts/lib/local-background-validation.mjs";
import { activeLocalSelectionId } from "../scripts/lib/local-asset-switch-report.mjs";

function playwrightReport({ failedProject = null, omitProject = null } = {}) {
  const projects = REQUIRED_BROWSER_PROJECTS.filter(
    (projectName) => projectName !== omitProject,
  ).map((name) => ({ id: name, name }));
  return {
    config: { projects },
    suites: [
      {
        file: "tests/background-lite-local.spec.mjs",
        specs: ["camera contract", "layer contract", "startup contract"].map(
          (title, index) => ({
            title,
            file: "tests/background-lite-local.spec.mjs",
            line: index + 1,
            column: 1,
            tests: projects.map(({ id, name }) => ({
              projectId: id,
              projectName: name,
              expectedStatus: "passed",
              results: [
                {
                  status:
                    name === failedProject && index === 0 ? "failed" : "passed",
                  duration: 10 + index,
                  ...(name === failedProject && index === 0
                    ? { error: { message: "fixture browser failure" } }
                    : {}),
                },
              ],
            })),
          }),
        ),
      },
    ],
    errors: [],
    stats: { expected: 18, skipped: 0, unexpected: 0, flaky: 0 },
  };
}

const completeInputs = () => {
  const runs = [];
  for (let scene = 0; scene < 5; scene += 1)
    for (let repeat = 0; repeat < 5; repeat += 1)
      for (const variant of ["current", "candidate"])
        runs.push({
          sceneId: `scene-${scene}`,
          variant,
          loadToSettleMs: 100 + scene + repeat,
          movementFps: 50 + scene,
          settled: true,
          memory: { usedJsHeapBytes: 1_000 + repeat },
          counts: { backgroundRenderable: 2, overlayRenderable: 1 },
          errors: [],
          missingAssets: [],
        });
  return {
    background: {
      complete: true,
      sourceTileCount: 2,
      records: [
        {
          canonicalPath: "1/a.b3dm",
          outcome: "processed",
          outputBytes: 20,
          identityPreserved: true,
          geometryPreserved: true,
        },
        {
          canonicalPath: "1/b.b3dm",
          outcome: "processed",
          outputBytes: 30,
          identityPreserved: true,
          geometryPreserved: true,
        },
      ],
    },
    overlays: {
      complete: true,
      unresolved: [],
      counts: { create: 1, update: 0, noop: 1, expire: 0, review: 0 },
      uniqueBuildingCount: 2,
      uniqueFragmentCount: 2,
      uniqueAssetCount: 2,
      buildings: [
        {
          buildingIdentity: "building:one",
          fragments: [{ fragmentId: "one", outputBytes: 10 }],
        },
        {
          buildingIdentity: "building:two",
          fragments: [{ fragmentId: "two", outputBytes: 10 }],
        },
      ],
    },
    visuals: {
      complete: true,
      scenes: Array.from({ length: 5 }, (_, index) => ({
        observedCamera: `camera-${index}`,
        passed: true,
        humanReview: "pass",
        highlightedRenderable: 1,
        backgroundRenderable: 2,
        beforeRenderable: 3,
        afterRenderable: 3,
        browserErrors: [],
      })),
    },
    performance: { complete: true, runs },
    browser: assessPlaywrightBrowserEvidence(playwrightReport()),
    migration: {
      reclaim: {
        schemaVersion: "local-building-asset-migration-v1",
        state: "intentionally-unavailable",
        deletedPath: "/fixture/optimized-tiles",
        deletedTreeAllocatedBytes: 1000,
        actualReclaimedBytes: 500,
        localOnly: true,
        publicationActions: [],
      },
    },
    rollback: {
      complete: true,
      innerAssetHashesVerified: true,
      path: "/fixture/recovery-building-assets.json",
      selectionId: `sha256:${"b".repeat(64)}`,
      sha256: `sha256:${"a".repeat(64)}`,
    },
    artifactLocations: {
      backgroundTileset: "/fixture/background-lite/tileset.json",
      overlayTileset: "/fixture/overlays/tileset.json",
      visualReport: "/fixture/visuals/report.json",
      performanceReport: "/fixture/performance/report.json",
    },
    currentRuntimeBytes: 140,
  };
};

test("combined payload counts each background and overlay fragment once", () => {
  const report = buildFinalValidationReport(completeInputs());
  assert.equal(report.complete, true);
  assert.equal(report.payload.candidateRuntimeBytes, 70);
  assert.equal(report.payload.reductionPercent, 50);
  assert.equal(report.payload.uniqueBackgroundTileCount, 2);
  assert.equal(report.payload.uniqueOverlayFragmentCount, 2);
  assert.equal(report.validation.rollbackReady, true);
  assert.equal(report.overlays.exactOnceReachability, true);
  assert.equal(report.overlays.reconciliationComplete, true);
  assert.deepEqual(report.overlays.counts, {
    create: 1,
    update: 0,
    noop: 1,
    expire: 0,
    review: 0,
  });
  assert.equal("actions" in report.overlays, false);
  assert.equal(report.browser.complete, true);
  assert.equal(report.browser.projectOutcomes.length, 6);
  assert.equal(report.migration.reclaim.actualReclaimedBytes, 500);
  assert.equal(
    report.artifacts.backgroundTileset,
    "/fixture/background-lite/tileset.json",
  );
  assert.equal("records" in report.background, false);
  assert.equal("buildings" in report.overlays, false);
});

test("identity parity accepts formally evidenced source exclusions", () => {
  const inputs = completeInputs();
  inputs.background.sourceTileCount = 3;
  inputs.background.records.push({
    canonicalPath: "1/missing.b3dm",
    evidenceIdentity: "evidence-hash",
    outcome: "excluded",
    reason: "authoritative-provider-403-and-immutable-release-omission",
    sourceBytes: 0,
    outputBytes: 0,
  });
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.validation.identityParity, true);
  assert.equal(report.complete, true);
});

test("visual and repeated performance evidence remain explicit advisory", () => {
  const inputs = completeInputs();
  inputs.visuals.scenes[0].humanReview = "pending";
  inputs.performance.runs = inputs.performance.runs.slice(0, 8);
  inputs.currentRuntimeBytes = null;
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.complete, false);
  assert.deepEqual(report.unresolved, [
    "current-runtime-payload-baseline-missing",
  ]);
  assert.deepEqual(report.advisory, [
    "five-scene-human-visual-parity-not-recorded",
    "repeated-performance-evidence-not-recorded",
  ]);
});

test("advisory visual and performance evidence do not block readiness", () => {
  const inputs = completeInputs();
  inputs.visuals = null;
  inputs.performance = null;
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.complete, true);
  assert.deepEqual(report.unresolved, []);
  assert.deepEqual(report.advisory, [
    "five-scene-human-visual-parity-not-recorded",
    "repeated-performance-evidence-not-recorded",
  ]);
});

test("verified switch evidence preserves active-local validation state", () => {
  const inputs = completeInputs();
  inputs.migration.switch = {
    complete: true,
    state: "active-local",
    outcome: "active-local",
    verified: true,
    localOnly: true,
    publicationActions: [],
  };
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.complete, true);
  assert.equal(report.state, "active-local");
  assert.equal(report.migration.switch.verified, true);
});

test("tampered switch evidence cannot claim active-local state", () => {
  const inputs = completeInputs();
  inputs.migration.switch = {
    complete: true,
    state: "active-local",
    outcome: "active-local",
    verified: false,
    localOnly: true,
    publicationActions: [],
  };
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.complete, true);
  assert.equal(report.state, "ready-to-switch");
  assert.ok(report.advisory.includes("active-switch-evidence-invalid"));
});

test("read inputs verifies persisted switch selection without circular hashes", () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "switch-evidence-"));
  try {
    fs.mkdirSync(path.join(outputRoot, "reports"), { recursive: true });
    const activeManifestPath = path.join(
      outputRoot,
      "active-building-assets.json",
    );
    const active = {
      schemaVersion: "local-building-assets-v1",
      state: "active-local",
      policyId: "policy",
      snapshotId: "snapshot",
      catalogueId: "catalogue",
      localOnly: true,
      publicationActions: [],
      background: {
        path: "/bg",
        sha256: `sha256:${"a".repeat(64)}`,
        opacity: 0.3,
      },
      overlays: {
        path: "/overlay",
        sha256: `sha256:${"b".repeat(64)}`,
        opacity: 1,
      },
      rollbackReference: {
        path: "/rollback",
        sha256: `sha256:${"c".repeat(64)}`,
      },
    };
    const switchEvidence = {
      schemaVersion: "local-building-asset-migration-v1",
      operation: "switch-local",
      state: "active-local",
      outcome: "active-local",
      complete: true,
      activeManifestPath,
      activeSelectionId: activeLocalSelectionId(active),
      policyId: active.policyId,
      snapshotId: active.snapshotId,
      catalogueId: active.catalogueId,
      background: active.background,
      overlays: active.overlays,
      rollbackReference: active.rollbackReference,
      localOnly: true,
      publicationActions: [],
    };
    fs.writeFileSync(activeManifestPath, JSON.stringify(active));
    fs.writeFileSync(
      path.join(outputRoot, "reports", "switch.json"),
      JSON.stringify(switchEvidence),
    );
    const inputs = readValidationInputs(outputRoot);
    assert.equal(inputs.migration.switch.verified, true);
    assert.equal(inputs.artifactLocations.activeManifest, activeManifestPath);
    assert.equal("activeManifestSha256" in inputs.migration.switch, false);

    switchEvidence.catalogueId = "tampered";
    fs.writeFileSync(
      path.join(outputRoot, "reports", "switch.json"),
      JSON.stringify(switchEvidence),
    );
    assert.equal(
      readValidationInputs(outputRoot).migration.switch.verified,
      false,
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("six-project browser evidence requires matching passing coverage", () => {
  const complete = assessPlaywrightBrowserEvidence(playwrightReport());
  assert.equal(complete.complete, true);
  assert.equal(complete.testCaseCount, 3);
  assert.equal(complete.totalProjectTestCount, 18);
  assert.deepEqual(complete.failedProjects, []);

  const failed = assessPlaywrightBrowserEvidence(
    playwrightReport({ failedProject: "webkit-mobile" }),
  );
  assert.equal(failed.complete, false);
  assert.deepEqual(failed.failedProjects, ["webkit-mobile"]);

  const missing = assessPlaywrightBrowserEvidence(
    playwrightReport({ omitProject: "firefox-mobile" }),
  );
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.missingProjects, ["firefox-mobile"]);
});

test("validation cannot pass without persisted six-project browser evidence", () => {
  const inputs = completeInputs();
  inputs.browser = null;
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.validation.browser, false);
  assert.equal(report.complete, false);
  assert.ok(
    report.unresolved.includes("six-project-browser-evidence-incomplete"),
  );
});

test("validation input reads and hashes the deterministic Playwright JSON path", () => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "background-browser-evidence-"),
  );
  const browserDirectory = path.join(outputRoot, "browser");
  fs.mkdirSync(browserDirectory, { recursive: true });
  const filename = path.join(browserDirectory, "playwright-report.json");
  fs.writeFileSync(filename, JSON.stringify(playwrightReport()));
  const inputs = readValidationInputs(outputRoot);
  assert.equal(inputs.browser.complete, true);
  assert.equal(inputs.browser.reportPath, filename);
  assert.match(inputs.browser.reportSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(inputs.artifactLocations.browserReport, filename);
});

test("malformed Playwright JSON remains explicit incomplete evidence", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "background-browser-invalid-"),
  );
  const filename = path.join(directory, "playwright-report.json");
  fs.writeFileSync(filename, "not-json");
  const evidence = readPlaywrightBrowserEvidence(filename);
  assert.equal(evidence.complete, false);
  assert.match(evidence.reportErrors[0], /^invalid-playwright-json:/u);
});

test("validation rejects an unproven rollback instead of claiming readiness", () => {
  const inputs = completeInputs();
  inputs.rollback = null;
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.validation.rollbackReady, false);
  assert.equal(report.complete, false);
  assert.ok(report.unresolved.includes("rollback-evidence-incomplete"));
});

test("performance requires five alternating runs per variant and scene", () => {
  const complete = assessPerformanceEvidence(completeInputs().performance);
  assert.equal(complete.complete, true);
  const nonAlternating = completeInputs().performance;
  [nonAlternating.runs[0], nonAlternating.runs[1]] = [
    nonAlternating.runs[1],
    nonAlternating.runs[0],
  ];
  assert.equal(assessPerformanceEvidence(nonAlternating).complete, false);
});

test("contradictory duplicate fragment evidence is rejected", () => {
  const inputs = completeInputs();
  inputs.overlays.buildings.push({
    buildingIdentity: "building:duplicate",
    fragments: [{ fragmentId: "one", outputBytes: 999 }],
  });
  assert.throws(
    () => buildFinalValidationReport(inputs),
    /Contradictory duplicate evidence/,
  );
});

test("validation rejects multiple reachable LOD fragments for one building", () => {
  const inputs = completeInputs();
  inputs.overlays.buildings[0].fragments.push({
    fragmentId: "extra-lod",
    outputBytes: 10,
  });
  inputs.overlays.uniqueFragmentCount = 3;
  inputs.overlays.uniqueAssetCount = 3;
  const report = buildFinalValidationReport(inputs);
  assert.equal(report.validation.identityParity, false);
  assert.equal(report.overlays.exactOnceReachability, false);
  assert.equal(report.complete, false);
});

test("validation rejects missing or inconsistent reconciliation counts", () => {
  const missing = completeInputs();
  delete missing.overlays.counts;
  let report = buildFinalValidationReport(missing);
  assert.equal(report.overlays.reconciliationComplete, false);
  assert.equal(report.validation.identityParity, false);

  const inconsistent = completeInputs();
  inconsistent.overlays.counts.noop = 0;
  report = buildFinalValidationReport(inconsistent);
  assert.equal(report.overlays.reconciliationComplete, false);
  assert.equal(report.validation.identityParity, false);
});
