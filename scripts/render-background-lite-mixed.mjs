#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import { createMixedSceneRenderer } from "./lib/background-lite-scene-capture.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outputSlug = process.env.PILOT_OUTPUT_SLUG ?? "mixed-national-gallery";
const outputRoot = path.join(root, "outputs/background-lite-pilot", outputSlug);
const baseUrl = process.env.PILOT_BASE_URL ?? "http://127.0.0.1:4174";
const fixtureId = process.env.PILOT_FIXTURE_ID ?? "national-gallery-singapore";
const requestedPoiIds = new Set(
  (process.env.PILOT_POI_IDS ?? fixtureId)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const camera = process.env.PILOT_CAMERA ?? "#17.2/1.2902844/103.8515235/0/60";
const cameraCategory = process.env.PILOT_CAMERA_CATEGORY ?? "civic";
const backgroundScreenSpaceError = Number(
  process.env.PILOT_BACKGROUND_SSE ?? "4",
);
const beforeRoot = path.resolve(
  process.env.PILOT_BEFORE_ROOT ?? path.join(root, "tiles"),
);
const afterRoot = path.resolve(
  process.env.PILOT_AFTER_ROOT ??
    path.join(root, "outputs/background-lite-local/background-lite"),
);
const overlayRoot = path.resolve(
  process.env.PILOT_OVERLAY_ROOT ??
    path.join(root, "outputs/background-lite-local/overlays"),
);
const assetPrefix = "/__background-lite-validation__/";

if (
  !Number.isFinite(backgroundScreenSpaceError) ||
  backgroundScreenSpaceError <= 0
)
  throw new Error("PILOT_BACKGROUND_SSE must be positive");

for (const [label, directory] of Object.entries({
  beforeRoot,
  afterRoot,
  overlayRoot,
})) {
  if (!fs.existsSync(path.join(directory, "tileset.json")))
    throw new Error(`${label} has no tileset.json: ${directory}`);
}

const approved = JSON.parse(
  fs.readFileSync(path.join(root, "data/approved-snapshot.json"), "utf8"),
);
const snapshotRoot = path.join(root, "data/snapshots", approved.snapshotId);
const pois = JSON.parse(
  fs.readFileSync(path.join(snapshotRoot, "pois.json"), "utf8"),
);
const landmarks = JSON.parse(
  fs.readFileSync(path.join(snapshotRoot, "landmarks.json"), "utf8"),
);
const activities = JSON.parse(
  fs.readFileSync(path.join(snapshotRoot, "activities.json"), "utf8"),
);
const selectedPois = pois.filter(({ id }) => requestedPoiIds.has(id));
const selectedLandmarks = landmarks.filter(({ id }) => requestedPoiIds.has(id));
if (
  selectedPois.length !== requestedPoiIds.size ||
  selectedLandmarks.length !== requestedPoiIds.size
)
  throw new Error(`Missing active-snapshot fixture: ${fixtureId}`);

const fullOverlayTileset = JSON.parse(
  fs.readFileSync(path.join(overlayRoot, "tileset.json"), "utf8"),
);
const overlayChildren = fullOverlayTileset.root.children.filter((child) =>
  child.extras?.ownerPoiIds?.some((id) => requestedPoiIds.has(id)),
);
if (!overlayChildren.length)
  throw new Error(
    `No generated overlays found for: ${[...requestedPoiIds].join(", ")}`,
  );
const overlayRegions = overlayChildren.map(
  (child) => child.boundingVolume?.region,
);
if (
  overlayRegions.some((region) => !Array.isArray(region) || region.length !== 6)
)
  throw new Error("Validation overlays require region bounding volumes");
const validationOverlayTileset = {
  asset: fullOverlayTileset.asset,
  geometricError: fullOverlayTileset.geometricError,
  root: {
    boundingVolume: {
      region: [
        Math.min(...overlayRegions.map((region) => region[0])),
        Math.min(...overlayRegions.map((region) => region[1])),
        Math.max(...overlayRegions.map((region) => region[2])),
        Math.max(...overlayRegions.map((region) => region[3])),
        Math.min(...overlayRegions.map((region) => region[4])),
        Math.max(...overlayRegions.map((region) => region[5])),
      ],
    },
    geometricError: 512,
    refine: "REPLACE",
    children: overlayChildren,
  },
};

const cameraParts = /^#([^/]+)\/([^/]+)\/([^/]+)/u.exec(camera);
if (!cameraParts) throw new Error(`Invalid validation camera: ${camera}`);
const cameraLatitude = Number(cameraParts[2]);
const cameraLongitude = Number(cameraParts[3]);
const validationRadiusDegrees = Number(
  process.env.PILOT_VALIDATION_RADIUS_DEGREES ?? "0.003",
);
const sourceTileset = JSON.parse(
  fs.readFileSync(path.join(beforeRoot, "tileset.json"), "utf8"),
);
const backgroundChildren = [];
const collectNearbyDetail = (tile) => {
  const uri = tile.content?.uri ?? tile.content?.url;
  const region = tile.boundingVolume?.region;
  if (
    typeof uri === "string" &&
    /_0\.b3dm$/u.test(uri) &&
    Array.isArray(region) &&
    region.length === 6
  ) {
    const degrees = region.slice(0, 4).map((value) => (value * 180) / Math.PI);
    const intersects =
      degrees[0] < cameraLongitude + validationRadiusDegrees &&
      degrees[2] > cameraLongitude - validationRadiusDegrees &&
      degrees[1] < cameraLatitude + validationRadiusDegrees &&
      degrees[3] > cameraLatitude - validationRadiusDegrees;
    if (
      intersects &&
      fs.existsSync(path.join(beforeRoot, uri)) &&
      fs.existsSync(path.join(afterRoot, uri))
    )
      backgroundChildren.push({
        boundingVolume: tile.boundingVolume,
        geometricError: 0,
        refine: "REPLACE",
        ...(tile.transform ? { transform: tile.transform } : {}),
        content: { uri },
      });
  }
  for (const child of tile.children ?? []) collectNearbyDetail(child);
};
collectNearbyDetail(sourceTileset.root);
if (!backgroundChildren.length)
  throw new Error(`No matched detail tiles found around camera: ${camera}`);
const backgroundRegions = backgroundChildren.map(
  (child) => child.boundingVolume.region,
);
const validationBackgroundTileset = {
  asset: sourceTileset.asset,
  geometricError: sourceTileset.geometricError,
  root: {
    boundingVolume: {
      region: [
        Math.min(...backgroundRegions.map((region) => region[0])),
        Math.min(...backgroundRegions.map((region) => region[1])),
        Math.max(...backgroundRegions.map((region) => region[2])),
        Math.max(...backgroundRegions.map((region) => region[3])),
        Math.min(...backgroundRegions.map((region) => region[4])),
        Math.max(...backgroundRegions.map((region) => region[5])),
      ],
    },
    geometricError: 512,
    refine: "REPLACE",
    children: backgroundChildren,
  },
};

fs.mkdirSync(outputRoot, { recursive: true });

const render = createMixedSceneRenderer({
  root,
  outputRoot,
  baseUrl,
  assetPrefix,
  overlayRoot,
  validationBackgroundTileset,
  validationOverlayTileset,
  snapshotId: approved.snapshotId,
  selectedPois,
  selectedLandmarks,
  activities,
  backgroundScreenSpaceError,
  camera,
});

function counts(result) {
  return {
    backgroundSelected: result.diagnostic.background.selectedCount,
    backgroundRenderable: result.diagnostic.background.renderableCount,
    overlaySelected: result.diagnostic.highlighted.selectedCount,
    overlayRenderable: result.diagnostic.highlighted.renderableCount,
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const before = await render(browser, {
    variant: "original-source-background",
    backgroundRoot: beforeRoot,
    filename: "before-original-background.png",
  });
  const after = await render(browser, {
    variant: "completed-background-lite",
    backgroundRoot: afterRoot,
    filename: "after-texture-lite-128-opacity-30.png",
  });
  const beforeCounts = counts(before);
  const afterCounts = counts(after);
  const matchedCounts =
    beforeCounts.backgroundSelected === afterCounts.backgroundSelected &&
    beforeCounts.backgroundRenderable === afterCounts.backgroundRenderable &&
    beforeCounts.overlaySelected === afterCounts.overlaySelected &&
    beforeCounts.overlayRenderable === afterCounts.overlayRenderable;
  const report = {
    schemaVersion: "background-lite-mixed-scene-v2",
    generatedAt: new Date().toISOString(),
    localOnly: true,
    productionChanged: false,
    publicationActions: [],
    fixtureId,
    selectedPoiIds: [...requestedPoiIds].sort(),
    overlayValidationChildCount: overlayChildren.length,
    backgroundValidationChildCount: backgroundChildren.length,
    snapshotId: approved.snapshotId,
    camera,
    cameraCategory,
    settings: {
      backgroundOpacity: 0.3,
      overlayOpacity: 1,
      backgroundScreenSpaceError,
      maximumTextureDimension: 128,
      jpegQuality: 55,
      blurSigma: 0,
      preserveSourceColour: true,
      highlightedBuildingProcessed: false,
    },
    roots: { beforeRoot, afterRoot, overlayRoot },
    before,
    after,
    beforeCounts,
    afterCounts,
    matchedCounts,
    missingProcessedSelections: after.missingAssets,
    passed:
      matchedCounts &&
      beforeCounts.backgroundRenderable > 0 &&
      beforeCounts.overlayRenderable > 0 &&
      before.errors.length === 0 &&
      after.errors.length === 0 &&
      before.missingAssets.length === 0 &&
      after.missingAssets.length === 0 &&
      before.observedCamera === camera &&
      after.observedCamera === camera &&
      before.renderState.backgroundOpacity === "0.3" &&
      after.renderState.backgroundOpacity === "0.3" &&
      before.renderState.overlayOpacity === "1" &&
      after.renderState.overlayOpacity === "1",
  };
  fs.writeFileSync(
    path.join(outputRoot, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
} finally {
  await browser.close();
}
