import { readFileSync } from "node:fs";

import { expect, test } from "playwright/test";

import { installBrowserRenderGuard } from "./helpers/browser-render-guard.mjs";

const CAMERA = "#17/1.2858/103.8579/0/60";
// GPU rasterization varies across hosted and local Chromium implementations.
// Require a real multi-pixel layer-removal signal without coupling the gate to
// one renderer's antialiasing footprint.
const MINIMUM_CHANGED_PIXEL_RATIO = 0.00005;
const fixtureId = "marina-bay-sands-artscience-museum";
const pois = JSON.parse(
  readFileSync(new URL("../data/snapshots/initial/pois.json", import.meta.url)),
);
const landmarks = JSON.parse(
  readFileSync(
    new URL("../data/snapshots/initial/landmarks.json", import.meta.url),
  ),
);
const highlightedPoi = pois.find(({ id }) => id === fixtureId);
const highlightedLandmark = landmarks.find(({ id }) => id === fixtureId);

async function waitForSettledBuildings(
  page,
  { background = true, highlighted = true } = {},
) {
  await expect
    .poll(() => page.evaluate(() => Boolean(window._map?.__deck)), {
      timeout: 20_000,
    })
    .toBe(true);
  if (background) {
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Number(document.body.dataset.backgroundViewSelectedTileCount ?? 0),
          ),
        { timeout: 25_000 },
      )
      .toBeGreaterThan(0);
  }
  if (highlighted)
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Number(document.body.dataset.poiTileLoadCount ?? 0),
          ),
        { timeout: 25_000 },
      )
      .toBeGreaterThan(0);
  await page.waitForTimeout(750);
}

async function changedPixelRatio(page, before, after) {
  return page.evaluate(
    async ({ beforeBase64, afterBase64 }) => {
      const decode = async (base64) => {
        const response = await fetch(`data:image/png;base64,${base64}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [left, right] = await Promise.all([
        decode(beforeBase64),
        decode(afterBase64),
      ]);
      if (left.length !== right.length) throw new Error("Canvas sizes differ");
      let changed = 0;
      for (let offset = 0; offset < left.length; offset += 4) {
        const difference = Math.max(
          Math.abs(left[offset] - right[offset]),
          Math.abs(left[offset + 1] - right[offset + 1]),
          Math.abs(left[offset + 2] - right[offset + 2]),
        );
        if (difference >= 12) changed += 1;
      }
      return changed / (left.length / 4);
    },
    {
      beforeBase64: before.toString("base64"),
      afterBase64: after.toString("base64"),
    },
  );
}

async function layerRemovalSignal(page, layerId) {
  await page.goto(
    `/?performanceDiagnostics=1&performanceVariant=full${CAMERA}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await waitForSettledBuildings(page);
  const canvas = page.locator("#map .maplibregl-canvas").first();
  const before = await canvas.screenshot({ animations: "disabled" });
  await page.evaluate((id) => {
    if (!window._map.getLayer(id)) throw new Error(`Missing map layer: ${id}`);
    window._map.removeLayer(id);
    window._map.triggerRepaint();
  }, layerId);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const after = await canvas.screenshot({ animations: "disabled" });
  return changedPixelRatio(page, before, after);
}

test("background and highlighted buildings both reach visible pixels", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const context = page.context();
  await context.addInitScript(
    (snapshot) => {
      globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot;
    },
    {
      pois: [highlightedPoi],
      landmarks: [highlightedLandmark],
      poiTilesetUrl: highlightedPoi.data,
    },
  );
  const fullGuard = installBrowserRenderGuard(page);
  const highlightedRatio = await layerRemovalSignal(page, "event-venues-3d");
  expect
    .soft(
      highlightedRatio,
      "Removing highlighted 3D venues must materially change the rendered map",
    )
    .toBeGreaterThanOrEqual(MINIMUM_CHANGED_PIXEL_RATIO);

  const backgroundPage = await context.newPage();
  const backgroundGuard = installBrowserRenderGuard(backgroundPage);
  const backgroundRatio = await layerRemovalSignal(
    backgroundPage,
    "buildings-3d",
  );
  console.info(
    `Building visibility pixel ratios: highlighted=${highlightedRatio.toFixed(6)}, background=${backgroundRatio.toFixed(6)}`,
  );
  expect
    .soft(
      backgroundRatio,
      "Removing background 3D buildings must materially change the rendered map",
    )
    .toBeGreaterThanOrEqual(MINIMUM_CHANGED_PIXEL_RATIO);
  await backgroundPage.close();
  expect(
    [
      ...fullGuard.failures.map((failure) => ({ scope: "full", ...failure })),
      ...backgroundGuard.failures.map((failure) => ({
        scope: "background-removal",
        ...failure,
      })),
    ],
    "The building visibility views must not emit browser rendering failures",
  ).toEqual([]);
});

test("background and highlighted buildings hide together during movement", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.context().addInitScript(
    (snapshot) => {
      globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot;
    },
    {
      pois: [highlightedPoi],
      landmarks: [highlightedLandmark],
      poiTilesetUrl: highlightedPoi.data,
    },
  );
  await page.goto(`/?performanceDiagnostics=1${CAMERA}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForSettledBuildings(page);

  const visibility = () =>
    page.evaluate(() => {
      const layers = window._map.__deck.layerManager?.getLayers() ?? [];
      const layer = (id) => layers.find((candidate) => candidate.id === id);
      return {
        background: layer("buildings-3d")?.props?.visible,
        backgroundMap: window._map.getLayoutProperty(
          "buildings-3d",
          "visibility",
        ),
        highlighted: layer("event-venues-3d")?.props?.visible,
        highlightedMap: window._map.getLayoutProperty(
          "event-venues-3d",
          "visibility",
        ),
        traversal: document.body.dataset.tileTraversalState,
      };
    });

  await page.evaluate(() => window._map.fire("movestart"));
  await expect.poll(visibility).toEqual({
    background: false,
    backgroundMap: "none",
    highlighted: false,
    highlightedMap: "none",
    traversal: "paused",
  });

  await page.evaluate(() => window._map.fire("moveend"));
  await expect.poll(visibility, { timeout: 5_000 }).toMatchObject({
    background: true,
    backgroundMap: "visible",
    highlighted: true,
    highlightedMap: "visible",
    traversal: "active",
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => document.body.dataset.movementBuildingReadiness),
      { timeout: 20_000 },
    )
    .toBe("ready");
  await expect.poll(visibility).toEqual({
    background: true,
    backgroundMap: "visible",
    highlighted: true,
    highlightedMap: "visible",
    traversal: "paused",
  });
});
