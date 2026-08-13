import { canonicalJson, sha256 } from "./background-lite-run.mjs";

export const PERFORMANCE_REPORT_SCHEMA = "local-background-lite-performance-v1";
export const PERFORMANCE_VARIANTS = Object.freeze(["current", "candidate"]);

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function percentile(values, quantile) {
  const sorted = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  ];
}

export function summarizeVariability(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length)
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
      standardDeviation: null,
      coefficientOfVariationPercent: null,
    };
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  const standardDeviation = Math.sqrt(variance);
  const round = (value) => Number(value.toFixed(3));
  return {
    count: finite.length,
    min: Math.min(...finite),
    max: Math.max(...finite),
    mean: round(mean),
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    standardDeviation: round(standardDeviation),
    coefficientOfVariationPercent:
      mean === 0 ? null : round((standardDeviation / Math.abs(mean)) * 100),
  };
}

function validateScenes(scenes) {
  if (!Array.isArray(scenes) || scenes.length < 5)
    throw new Error("At least five performance scenes are required");
  const ids = new Set();
  const cameras = new Set();
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object")
      throw new Error("Every performance scene must be an object");
    if (typeof scene.category !== "string" || !scene.category)
      throw new Error("Every performance scene requires category");
    if (typeof scene.camera !== "string" || !scene.camera.startsWith("#"))
      throw new Error(`${scene.category} requires a hash camera`);
    if (ids.has(scene.category))
      throw new Error(`Duplicate performance scene: ${scene.category}`);
    if (cameras.has(scene.camera))
      throw new Error(`Duplicate performance camera: ${scene.camera}`);
    ids.add(scene.category);
    cameras.add(scene.camera);
  }
  return scenes;
}

export function createPerformanceTrialPlan(scenes, trialCount = 5) {
  validateScenes(scenes);
  if (!Number.isSafeInteger(trialCount) || trialCount < 5)
    throw new Error("Performance evidence requires at least five trials");
  const plan = [];
  for (let trial = 1; trial <= trialCount; trial += 1) {
    for (const scene of scenes) {
      for (const variant of PERFORMANCE_VARIANTS) {
        plan.push({
          sequence: plan.length + 1,
          trial,
          sceneId: scene.category,
          fixtureId: scene.fixtureId,
          requestedCamera: scene.camera,
          variant,
        });
      }
    }
  }
  return plan;
}

function summarizeRuns(scenes, runs) {
  const summaries = [];
  for (const scene of scenes) {
    for (const variant of PERFORMANCE_VARIANTS) {
      const group = runs.filter(
        (run) => run.sceneId === scene.category && run.variant === variant,
      );
      summaries.push({
        sceneId: scene.category,
        variant,
        runCount: group.length,
        loadToSettleMs: summarizeVariability(
          group.map((run) => run.loadToSettleMs),
        ),
        movementFps: summarizeVariability(group.map((run) => run.movementFps)),
        usedJsHeapBytes: summarizeVariability(
          group.map((run) => run.memory?.usedJsHeapBytes),
        ),
      });
    }
  }
  return summaries;
}

export function buildLocalBackgroundPerformanceReport({
  scenes,
  trialCount = 5,
  runs = [],
  controls,
  inputs,
  generatedAt = new Date().toISOString(),
  blocker = null,
} = {}) {
  const expectedPlan = createPerformanceTrialPlan(scenes, trialCount);
  if (!Array.isArray(runs)) throw new Error("runs must be an array");
  const exactOrder = runs.every((run, index) => {
    const expected = expectedPlan[index];
    return (
      expected &&
      run.sequence === expected.sequence &&
      run.trial === expected.trial &&
      run.sceneId === expected.sceneId &&
      run.variant === expected.variant
    );
  });
  const strictlyAlternating = runs.every(
    (run, index) => index === 0 || run.variant !== runs[index - 1].variant,
  );
  const validRuns = runs.filter(
    (run) =>
      run.settled === true &&
      run.observedCamera === run.requestedCamera &&
      finiteNumber(run.loadToSettleMs, "loadToSettleMs") >= 0 &&
      finiteNumber(run.movementFps, "movementFps") > 0 &&
      Number(run.counts?.backgroundRenderable ?? 0) > 0 &&
      Number(run.counts?.overlayRenderable ?? 0) > 0 &&
      (run.errors?.length ?? 0) === 0 &&
      (run.missingAssets?.length ?? 0) === 0,
  );
  const summaries = summarizeRuns(scenes, runs);
  const everyGroupRepeated = summaries.every(
    ({ runCount }) => runCount >= trialCount,
  );
  const complete =
    blocker == null &&
    runs.length === expectedPlan.length &&
    validRuns.length === runs.length &&
    exactOrder &&
    strictlyAlternating &&
    everyGroupRepeated;
  const content = {
    schemaVersion: PERFORMANCE_REPORT_SCHEMA,
    generatedAt,
    state: complete ? "complete" : blocker ? "blocked" : "incomplete",
    complete,
    localOnly: true,
    productionChanged: false,
    publicationActions: [],
    comparison: {
      current: {
        label: "authoritative full-quality-source proxy",
        evidenceMode: "authoritative-full-quality-source-proxy",
        directLegacyRuntimeMeasurement: false,
        reason:
          "optimized-tiles was deleted; tiles/ is the retained authoritative full-quality source proxy",
      },
      candidate: {
        label: "completed background-lite plus canonical active overlays",
        evidenceMode: "completed-local-candidate",
      },
    },
    controls,
    inputs,
    trialCount,
    expectedRunCount: expectedPlan.length,
    completedRunCount: runs.length,
    validation: {
      exactOrder,
      strictlyAlternating,
      everyGroupRepeated,
      validRunCount: validRuns.length,
      distinctSceneCount: new Set(runs.map((run) => run.sceneId)).size,
    },
    blocker,
    scenes: scenes.map(({ category, fixtureId, camera }) => ({
      sceneId: category,
      fixtureId,
      requestedCamera: camera,
    })),
    summaries,
    runs,
  };
  return { ...content, reportId: sha256(canonicalJson(content)) };
}
