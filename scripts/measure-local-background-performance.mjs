#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { atomicWrite } from "./lib/background-lite-run.mjs";
import {
  measurePerformanceRun,
  startPerformanceServer,
  stopPerformanceServer,
  waitForPerformanceServer,
} from "./lib/local-background-performance-browser.mjs";
import {
  buildLocalBackgroundPerformanceReport,
  createPerformanceTrialPlan,
} from "./lib/local-background-performance.mjs";
import { validationScenes } from "./render-background-lite-five-scenes.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const positiveInteger = (name, fallback, minimum = 1) => {
  const value = Number(option(name, fallback));
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`--${name} must be an integer >= ${minimum}`);
  return value;
};

const trialCount = positiveInteger("runs", 5, 5);
const port = positiveInteger("port", 4176);
const movementDurationMs = positiveInteger("movement-ms", 1_500);
const stableDurationMs = positiveInteger("stable-ms", 3_000);
const timeoutMs = positiveInteger("timeout-ms", 90_000);
const suppliedUrl = option("url", "");
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}`;
const outputRoot = path.resolve(
  root,
  option("output", "outputs/background-lite-local"),
);
const reportPath = path.join(outputRoot, "performance", "report.json");
const currentRoot = path.join(root, "tiles");
const candidateRoot = path.join(outputRoot, "background-lite");
const overlayRoot = path.join(outputRoot, "overlays");
const assetPrefix = "/__background-lite-performance__/";
const viewport = Object.freeze({ width: 1440, height: 900 });

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function requireCompleteInputs() {
  for (const directory of [currentRoot, candidateRoot, overlayRoot]) {
    if (!fs.existsSync(path.join(directory, "tileset.json")))
      throw new Error(`Missing tileset: ${directory}`);
  }
  const background = readJson(path.join(outputRoot, "reports/background.json"));
  const overlays = readJson(path.join(overlayRoot, "catalogue.json"));
  if (background.complete !== true)
    throw new Error("Background report is not complete");
  if (overlays.complete !== true)
    throw new Error("Overlay catalogue is not complete");
  return { background, overlays };
}

function snapshotInputs() {
  const approved = readJson(path.join(root, "data/approved-snapshot.json"));
  const snapshotRoot = path.join(root, "data/snapshots", approved.snapshotId);
  return {
    approved,
    pois: readJson(path.join(snapshotRoot, "pois.json")),
    landmarks: readJson(path.join(snapshotRoot, "landmarks.json")),
    activities: readJson(path.join(snapshotRoot, "activities.json")),
  };
}

async function main() {
  const { background, overlays } = requireCompleteInputs();
  const snapshot = snapshotInputs();
  const controls = {
    browserEngine: "chromium",
    headless: true,
    coldIsolatedContextPerRun: true,
    serviceWorkers: "blocked",
    viewport,
    deviceScaleFactor: 1,
    backgroundOpacity: 0.3,
    overlayOpacity: 1,
    movement: { bearingDelta: 20, durationMs: movementDurationMs },
    settlement: {
      stableDurationMs,
      timeoutMs,
      requiresSelectedEqualsReady: true,
      requiresBothLayersRenderable: true,
    },
    ordering: "trial -> scene -> current -> candidate",
  };
  const inputs = {
    snapshotId: snapshot.approved.snapshotId,
    currentBackgroundRoot: currentRoot,
    candidateBackgroundRoot: candidateRoot,
    canonicalOverlayRoot: overlayRoot,
    backgroundRunId: background.runId,
    overlayCatalogueId: overlays.catalogueId,
  };
  const runs = [];
  let blocker = null;
  const server = startPerformanceServer({ root, port, suppliedUrl });
  let browser = null;
  try {
    await waitForPerformanceServer({ baseUrl, server });
    browser = await chromium.launch({ headless: true });
    for (const item of createPerformanceTrialPlan(
      validationScenes,
      trialCount,
    )) {
      process.stderr.write(
        `[${item.sequence}/${trialCount * validationScenes.length * 2}] ${item.sceneId} ${item.variant}\n`,
      );
      try {
        runs.push(
          await measurePerformanceRun(browser, item, snapshot, {
            assetPrefix,
            baseUrl,
            candidateRoot,
            currentRoot,
            movementDurationMs,
            overlayRoot,
            stableDurationMs,
            timeoutMs,
            viewport,
          }),
        );
      } catch (error) {
        blocker = {
          code: "browser-run-blocked",
          sequence: item.sequence,
          sceneId: item.sceneId,
          variant: item.variant,
          message: error.message,
          retryAttempted: false,
        };
        break;
      }
    }
  } catch (error) {
    blocker = {
      code: "browser-or-server-blocked",
      message: error.message,
      retryAttempted: false,
    };
  } finally {
    await browser?.close();
    await stopPerformanceServer(server);
  }
  const report = buildLocalBackgroundPerformanceReport({
    scenes: validationScenes,
    trialCount,
    runs,
    controls,
    inputs,
    blocker,
  });
  atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ ...report, reportPath }, null, 2)}\n`,
  );
  if (!report.complete) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
