import fs from "node:fs";
import path from "node:path";

function resolveAsset(directory, relative) {
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const candidate = path.resolve(directory, decoded);
  return candidate === directory ||
    candidate.startsWith(`${directory}${path.sep}`)
    ? candidate
    : null;
}

async function waitForScene(page, errors) {
  try {
    await page.waitForFunction(
      () =>
        document.body.dataset.backgroundViewLoaded === "true" &&
        Number(document.body.dataset.poiTileLoadCount ?? 0) > 0 &&
        typeof globalThis.__buildingLayerDiagnosticSnapshot === "function",
      null,
      { timeout: 90_000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({ ...document.body.dataset }));
    throw new Error(
      `Scene readiness timed out: ${JSON.stringify({ state, errors })}`,
      { cause: error },
    );
  }
  await page.evaluate(async () => {
    const signature = () =>
      [
        document.body.dataset.tileRefinementState,
        document.body.dataset.backgroundViewSelectedTileCount,
        document.body.dataset.backgroundViewReadyTileCount,
        document.body.dataset.poiViewSelectedTileCount,
        document.body.dataset.poiViewReadyTileCount,
      ].join("|");
    let previous = signature();
    let stableSince = performance.now();
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const current = signature();
      const backgroundSelected = Number(
        document.body.dataset.backgroundViewSelectedTileCount ?? 0,
      );
      const backgroundReady = Number(
        document.body.dataset.backgroundViewReadyTileCount ?? -1,
      );
      const overlaySelected = Number(
        document.body.dataset.poiViewSelectedTileCount ?? 0,
      );
      const overlayReady = Number(
        document.body.dataset.poiViewReadyTileCount ?? -1,
      );
      if (current !== previous) {
        previous = current;
        stableSince = performance.now();
      } else if (
        backgroundSelected > 0 &&
        backgroundSelected === backgroundReady &&
        overlaySelected > 0 &&
        overlaySelected === overlayReady &&
        performance.now() - stableSince >= 5_000
      ) {
        return;
      }
    }
    throw new Error(`Scene counts did not stabilize: ${signature()}`);
  });
}

export function createMixedSceneRenderer({
  root,
  outputRoot,
  baseUrl,
  assetPrefix,
  overlayRoot,
  validationBackgroundTileset,
  validationOverlayTileset,
  snapshotId,
  selectedPois,
  selectedLandmarks,
  activities,
  backgroundScreenSpaceError,
  camera,
}) {
  return async function render(browser, { variant, backgroundRoot, filename }) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const errors = [];
    const missingAssets = [];
    const requestedAssets = new Set();
    const roots = { background: backgroundRoot, overlays: overlayRoot };
    await context.route(`${baseUrl}${assetPrefix}**`, async (route) => {
      const pathname = decodeURIComponent(
        new URL(route.request().url()).pathname,
      );
      const match =
        /^\/__background-lite-validation__\/(background|overlays)\/(.+)$/u.exec(
          pathname,
        );
      if (!match) return route.abort("blockedbyclient");
      const assetFilename = resolveAsset(roots[match[1]], match[2]);
      requestedAssets.add(pathname);
      if (match[1] === "background" && match[2] === "tileset.json")
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(validationBackgroundTileset),
        });
      if (match[1] === "overlays" && match[2] === "tileset.json")
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(validationOverlayTileset),
        });
      if (
        !assetFilename ||
        !fs.existsSync(assetFilename) ||
        !fs.statSync(assetFilename).isFile()
      ) {
        missingAssets.push(pathname);
        return route.fulfill({ status: 404, body: "missing validation asset" });
      }
      return route.fulfill({
        contentType: assetFilename.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
        body: fs.readFileSync(assetFilename),
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().includes(assetPrefix))
        errors.push(`${response.status()}: ${response.url()}`);
    });
    await page.addInitScript(
      (input) => {
        globalThis.__EVENT_PIPELINE_SNAPSHOT__ = {
          snapshotId: input.snapshotId,
          pois: input.pois,
          landmarks: input.landmarks,
          activities: input.activities,
          backgroundScreenSpaceError: input.backgroundScreenSpaceError,
          buildingAssetManifest: {
            schemaVersion: "local-building-assets-v1",
            state: "ready",
            manifestId: `five-scene-${input.snapshotId}`,
            localOnly: true,
            background: {
              complete: true,
              opacity: 0.3,
              url: input.backgroundUrl,
            },
            overlays: {
              complete: true,
              empty: false,
              opacity: 1,
              url: input.overlayUrl,
            },
          },
        };
      },
      {
        snapshotId,
        pois: selectedPois,
        landmarks: selectedLandmarks,
        activities,
        backgroundScreenSpaceError,
        backgroundUrl: `${assetPrefix}background/tileset.json`,
        overlayUrl: `${assetPrefix}overlays/tileset.json`,
      },
    );
    await page.goto(
      `${baseUrl}/?performanceDiagnostics=1&performanceVariant=full${camera}`,
      { waitUntil: "domcontentloaded" },
    );
    await waitForScene(page, errors);
    const diagnostic = await page.evaluate(() =>
      globalThis.__buildingLayerDiagnosticSnapshot(),
    );
    const observedCamera = await page.evaluate(() => location.hash);
    const renderState = await page.evaluate(() => ({
      backgroundOpacity: document.body.dataset.backgroundOpacity,
      overlayOpacity: document.body.dataset.poiOpacity,
      buildingAssetState: document.body.dataset.buildingAssetState,
      overlayDepthPreference: document.body.dataset.overlayDepthPreference,
    }));
    await page.addStyleTag({
      content: `
        body > *:not(#map),
        .performance-diagnostics,
        #map .maplibregl-control-container { display: none !important; }
      `,
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const screenshotPath = path.join(outputRoot, filename);
    const mapBox = await page.locator("#map").boundingBox();
    if (!mapBox) throw new Error("Map has no screenshot bounds");
    await page.screenshot({
      path: screenshotPath,
      animations: "disabled",
      clip: mapBox,
    });
    await context.close();
    return {
      variant,
      diagnostic,
      errors,
      missingAssets: [...new Set(missingAssets)].sort(),
      observedCamera,
      renderState,
      requestedAssetCount: requestedAssets.size,
      screenshot: path.relative(root, screenshotPath).split(path.sep).join("/"),
    };
  };
}
