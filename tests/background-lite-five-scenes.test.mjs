import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFiveSceneValidationReport,
  validateHumanReviews,
  validationScenes,
} from "../scripts/render-background-lite-five-scenes.mjs";

test("five-scene runner defines genuinely distinct mixed validation areas", () => {
  assert.equal(validationScenes.length, 5);
  assert.equal(
    new Set(validationScenes.map(({ category }) => category)).size,
    5,
  );
  assert.equal(new Set(validationScenes.map(({ camera }) => camera)).size, 5);
  assert.equal(
    new Set(validationScenes.map(({ fixtureId }) => fixtureId)).size,
    5,
  );
  assert.ok(validationScenes.every(({ camera }) => camera.startsWith("#17/")));
});

test("human visual reviews use an explicit closed outcome set", () => {
  assert.deepEqual(validateHumanReviews({ civic: "pass", heritage: "fail" }), {
    civic: "pass",
    heritage: "fail",
  });
  assert.throws(
    () => validateHumanReviews({ civic: true }),
    /Invalid human review/,
  );
});

test("a scene failure produces a terminal blocked report without retrying", () => {
  const report = buildFiveSceneValidationReport({
    reports: [],
    blocker: {
      code: "scene-render-blocked",
      sceneCategory: "landmark",
      message: "overlay selected 0/0",
      retryAttempted: false,
    },
  });
  assert.equal(report.state, "blocked");
  assert.equal(report.complete, false);
  assert.equal(report.automatedValidationComplete, false);
  assert.equal(report.scenes.length, 5);
  assert.equal(report.scenes[0].executionState, "blocked");
  assert.deepEqual(report.scenes[0].browserErrors, ["overlay selected 0/0"]);
  assert.ok(
    report.scenes
      .slice(1)
      .every(
        ({ executionState }) => executionState === "not-run-after-blocker",
      ),
  );
});
