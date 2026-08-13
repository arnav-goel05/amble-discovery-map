import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalBackgroundPerformanceReport,
  createPerformanceTrialPlan,
  PERFORMANCE_REPORT_SCHEMA,
  summarizeVariability,
} from "../scripts/lib/local-background-performance.mjs";

const scenes = Array.from({ length: 5 }, (_, index) => ({
  category: `scene-${index + 1}`,
  fixtureId: `fixture-${index + 1}`,
  camera: `#17/1.${index}/103.${index}/0/60`,
}));

function successfulRuns(trials = 5) {
  return createPerformanceTrialPlan(scenes, trials).map((item) => ({
    ...item,
    settled: true,
    observedCamera: item.requestedCamera,
    loadToSettleMs: 1_000 + item.trial,
    movementFps: 55 + item.trial,
    movement: { p95FrameMs: 18 },
    memory: { available: true, usedJsHeapBytes: 100 + item.trial },
    counts: { backgroundRenderable: 2, overlayRenderable: 1 },
    errors: [],
    missingAssets: [],
  }));
}

test("trial plan is deterministic and strictly alternates variants", () => {
  const plan = createPerformanceTrialPlan(scenes, 5);
  assert.equal(plan.length, 50);
  assert.deepEqual(
    plan.slice(0, 4).map(({ sceneId, variant }) => [sceneId, variant]),
    [
      ["scene-1", "current"],
      ["scene-1", "candidate"],
      ["scene-2", "current"],
      ["scene-2", "candidate"],
    ],
  );
  assert.equal(
    plan.every(
      (item, index) => index === 0 || item.variant !== plan[index - 1].variant,
    ),
    true,
  );
  assert.throws(() => createPerformanceTrialPlan(scenes, 4), /at least five/);
});

test("variability reports distribution and population standard deviation", () => {
  assert.deepEqual(summarizeVariability([1, 2, 3, 4, 5]), {
    count: 5,
    min: 1,
    max: 5,
    mean: 3,
    p50: 3,
    p95: 5,
    standardDeviation: 1.414,
    coefficientOfVariationPercent: 47.14,
  });
  assert.equal(summarizeVariability([]).count, 0);
});

test("complete report labels current evidence as a source proxy", () => {
  const report = buildLocalBackgroundPerformanceReport({
    scenes,
    runs: successfulRuns(),
    controls: { viewport: { width: 1440, height: 900 } },
    inputs: { currentBackgroundRoot: "/repo/tiles" },
    generatedAt: "2026-08-13T00:00:00.000Z",
  });
  assert.equal(report.schemaVersion, PERFORMANCE_REPORT_SCHEMA);
  assert.equal(report.complete, true);
  assert.equal(report.validation.strictlyAlternating, true);
  assert.equal(report.validation.everyGroupRepeated, true);
  assert.equal(report.summaries.length, 10);
  assert.equal(
    report.summaries.every(({ runCount }) => runCount === 5),
    true,
  );
  assert.equal(
    report.comparison.current.evidenceMode,
    "authoritative-full-quality-source-proxy",
  );
  assert.equal(report.comparison.current.directLegacyRuntimeMeasurement, false);
});

test("out-of-order, invalid, or blocked evidence remains incomplete", () => {
  const outOfOrder = successfulRuns();
  [outOfOrder[0], outOfOrder[1]] = [outOfOrder[1], outOfOrder[0]];
  const report = buildLocalBackgroundPerformanceReport({
    scenes,
    runs: outOfOrder,
    controls: {},
    inputs: {},
  });
  assert.equal(report.complete, false);
  assert.equal(report.validation.exactOrder, false);
  assert.equal(report.validation.strictlyAlternating, false);

  const blocked = buildLocalBackgroundPerformanceReport({
    scenes,
    runs: [],
    controls: {},
    inputs: {},
    blocker: { code: "browser-run-blocked", retryAttempted: false },
  });
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.complete, false);
});
