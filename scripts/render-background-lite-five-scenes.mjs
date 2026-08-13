#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { atomicWrite } from "./lib/background-lite-run.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(
  root,
  "outputs",
  "background-lite-local",
  "visuals",
);
const renderer = path.join(
  import.meta.dirname,
  "render-background-lite-mixed.mjs",
);
const humanReviewPath = path.join(outputRoot, "human-review.json");

export function validateHumanReviews(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([category, outcome]) => {
      if (!["pass", "fail", "pending"].includes(outcome))
        throw new Error(`Invalid human review for ${category}: ${outcome}`);
      return [category, outcome];
    }),
  );
}

export const validationScenes = Object.freeze([
  {
    category: "landmark",
    fixtureId: "marina-bay-sands-artscience-museum",
    camera: "#17/1.285844/103.857897/0/60",
    poiIds:
      "tower-3-marina-bay-sands-singapore,marina-bay-sands-artscience-museum,marina-bay-sands-mice",
    fullSnapshot: true,
  },
  {
    category: "civic",
    fixtureId: "national-library-building",
    camera: "#17/1.297750037014743/103.85440629802106/0/60",
  },
  {
    category: "residential",
    fixtureId: "punggol-neighbourhood-police-centre",
    camera: "#17/1.3941864165028381/103.91687927680823/0/60",
  },
  {
    category: "heritage",
    fixtureId: "chinatown-heritage-centre",
    camera: "#17/1.2835648869624805/103.84437146082173/0/60",
  },
  {
    category: "industrial",
    fixtureId: "63-ubi",
    camera: "#17/1.3245980419563743/103.89398163920904/0/60",
  },
]);

function runScene(scene) {
  const slug = `local-five-scenes/${scene.category}`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [renderer], {
      cwd: root,
      env: {
        ...process.env,
        PILOT_CAMERA: scene.camera,
        PILOT_CAMERA_CATEGORY: scene.category,
        PILOT_FIXTURE_ID: scene.fixtureId,
        PILOT_OUTPUT_SLUG: slug,
        PILOT_POI_IDS: scene.poiIds ?? scene.fixtureId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0)
        reject(
          new Error(`${scene.category} render failed (${code}): ${stderr}`),
        );
      else
        resolve(
          JSON.parse(
            fs.readFileSync(
              path.join(
                root,
                "outputs",
                "background-lite-pilot",
                slug,
                "report.json",
              ),
              "utf8",
            ),
          ),
        );
    });
  });
}

function completedScene(report, humanReviews) {
  return {
    category: report.cameraCategory,
    requestedCamera: report.camera,
    observedCamera: report.after.observedCamera,
    passed: report.passed,
    matchedCounts: report.matchedCounts,
    beforeCounts: report.beforeCounts,
    afterCounts: report.afterCounts,
    backgroundRenderable: report.afterCounts.backgroundRenderable,
    highlightedRenderable: report.afterCounts.overlayRenderable,
    browserErrors: [...report.before.errors, ...report.after.errors],
    missingAssets: [
      ...report.before.missingAssets,
      ...report.after.missingAssets,
    ],
    renderState: {
      before: report.before.renderState,
      after: report.after.renderState,
    },
    humanReview: humanReviews[report.cameraCategory] ?? "pending",
    reportPath: path.join(
      root,
      "outputs",
      "background-lite-pilot",
      "local-five-scenes",
      report.cameraCategory,
      "report.json",
    ),
    beforeScreenshot: path.join(
      root,
      "outputs",
      "background-lite-pilot",
      "local-five-scenes",
      report.cameraCategory,
      "discovery-original-background.png",
    ),
    afterScreenshot: path.join(
      root,
      "outputs",
      "background-lite-pilot",
      "local-five-scenes",
      report.cameraCategory,
      "after-texture-lite-128-opacity-30.png",
    ),
  };
}

function unexecutedScene(scene, blocker) {
  return {
    category: scene.category,
    requestedCamera: scene.camera,
    observedCamera: null,
    passed: false,
    matchedCounts: false,
    beforeCounts: null,
    afterCounts: null,
    backgroundRenderable: 0,
    highlightedRenderable: 0,
    browserErrors: blocker ? [blocker.message] : [],
    missingAssets: [],
    renderState: null,
    humanReview: "pending",
    executionState: blocker ? "blocked" : "not-run-after-blocker",
    blocker: blocker ?? null,
    reportPath: null,
    beforeScreenshot: null,
    afterScreenshot: null,
  };
}

export function buildFiveSceneValidationReport({
  reports = [],
  humanReviews = {},
  blocker = null,
} = {}) {
  const completed = new Map(
    reports.map((report) => [report.cameraCategory, report]),
  );
  const scenes = validationScenes.map((scene) => {
    const report = completed.get(scene.category);
    if (report) return completedScene(report, humanReviews);
    const sceneBlocker =
      blocker?.sceneCategory === scene.category ? blocker : null;
    return unexecutedScene(scene, sceneBlocker);
  });
  const complete =
    blocker == null &&
    new Set(scenes.map(({ observedCamera }) => observedCamera)).size === 5 &&
    scenes.every(
      (scene) =>
        scene.passed &&
        scene.matchedCounts &&
        scene.backgroundRenderable > 0 &&
        scene.highlightedRenderable > 0 &&
        scene.browserErrors.length === 0 &&
        scene.missingAssets.length === 0 &&
        scene.humanReview === "pass",
    );
  return {
    schemaVersion: "background-lite-five-scene-validation-v1",
    state: complete ? "complete" : blocker ? "blocked" : "incomplete",
    localOnly: true,
    productionChanged: false,
    publicationActions: [],
    complete,
    automatedValidationComplete:
      blocker == null &&
      scenes.every(
        (scene) =>
          scene.passed &&
          scene.matchedCounts &&
          scene.backgroundRenderable > 0 &&
          scene.highlightedRenderable > 0 &&
          scene.browserErrors.length === 0 &&
          scene.missingAssets.length === 0,
      ),
    humanReviewComplete: scenes.every(
      (scene) => scene.humanReview !== "pending",
    ),
    blocker,
    scenes,
  };
}

async function main() {
  const humanReviews = validateHumanReviews(
    fs.existsSync(humanReviewPath)
      ? JSON.parse(fs.readFileSync(humanReviewPath, "utf8"))
      : {},
  );
  const reports = [];
  let blocker = null;
  for (const scene of validationScenes) {
    try {
      reports.push(await runScene(scene));
    } catch (error) {
      blocker = {
        code: "scene-render-blocked",
        sceneCategory: scene.category,
        message: String(error?.message ?? error).slice(0, 4_000),
        retryAttempted: false,
      };
      break;
    }
  }
  const result = buildFiveSceneValidationReport({
    reports,
    humanReviews,
    blocker,
  });
  atomicWrite(
    path.join(outputRoot, "report.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.complete) process.exitCode = 2;
}

if (process.argv[1] === import.meta.filename)
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
