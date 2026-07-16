import { expect, test } from "playwright/test";

test("the fixed 45 degree camera stays aligned while the map zooms", async ({ page }) => {
  await page.goto("/?autoStart&emptyApprovedSnapshot#15.3/1.285844/103.857897/-30/45", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean(window._map?.__deck))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.body.dataset.backgroundViewLoaded), { timeout: 20_000 }).toBe("true");
  await expect.poll(() => page.evaluate(() => {
    const layer = (window._map.__deck?.props?.layers || []).flat(Infinity).filter(Boolean).find(({ id }) => id === "buildings-3d");
    return layer?.props?.opacity;
  }), { timeout: 5_000 }).toBeCloseTo(0.3, 3);

  await page.evaluate(() => {
    window.__mapRenderSyncSamples = [];
    const sample = () => {
      const map = window._map;
      const deckView = map.__deck?.props?.viewState;
      if (!deckView) return;
      const center = map.getCenter();
      const anchor = [103.85927402663303, 1.2862040338634544];
      const mapPoint = map.project(anchor);
      const deckPoint = map.__deck.viewManager.getViewports()[0].project([...anchor, 0]);
      window.__mapRenderSyncSamples.push({
        map: [center.lng, center.lat, map.getZoom(), map.getPitch(), map.getBearing()],
        deck: [deckView.longitude, deckView.latitude, deckView.zoom, deckView.pitch, deckView.bearing],
        projectionDelta: Math.hypot(mapPoint.x - deckPoint[0], mapPoint.y - deckPoint[1]),
        refinement: document.body.dataset.tileRefinementState,
        backgroundScreenSpaceError: document.body.dataset.backgroundCurrentMaximumScreenSpaceError,
        poiScreenSpaceError: document.body.dataset.poiCurrentMaximumScreenSpaceError,
      });
    };
    window._map.on("render", sample);
    sample();
  });

  await page.evaluate(() => {
    window._map.easeTo({ zoom: 16.7, pitch: 45, bearing: -30, duration: 800 });
  });
  await expect.poll(() => page.evaluate(() => {
    const map = window._map;
    return Math.max(
      Math.abs(map.getZoom() - 16.7),
      Math.abs(map.getPitch() - 45),
      Math.abs(map.getBearing() - -30),
    );
  })).toBeLessThan(0.01);

  await page.evaluate(() => {
    window._map.easeTo({ zoom: 15.3, pitch: 0, duration: 500 });
  });
  await expect.poll(() => page.evaluate(() => Math.abs(window._map.getZoom() - 15.3))).toBeLessThan(0.01);
  await expect.poll(() => page.evaluate(() => window._map.getPitch())).toBe(45);
  await expect.poll(() => page.evaluate(() => document.body.dataset.tileRefinementState), { timeout: 20_000 }).toBe("full-detail");
  await expect.poll(() => page.evaluate(() => window.__mapRenderSyncSamples.length)).toBeGreaterThan(5);

  const result = await page.evaluate(() => {
    const samples = window.__mapRenderSyncSamples;
    return {
      samples: samples.length,
      maximumDelta: Math.max(...samples.flatMap(({ map, deck }) => map.map((value, index) => Math.abs(value - deck[index])))),
      maximumProjectionDelta: Math.max(...samples.map(({ projectionDelta }) => projectionDelta)),
      minimumPitch: Math.min(...samples.map(({ map }) => map[3])),
      maximumPitch: Math.max(...samples.map(({ map }) => map[3])),
      refinementStates: [...new Set(samples.map(({ refinement }) => refinement))],
      backgroundScreenSpaceErrors: [...new Set(samples.map(({ backgroundScreenSpaceError }) => backgroundScreenSpaceError))],
      poiScreenSpaceErrors: [...new Set(samples.map(({ poiScreenSpaceError }) => poiScreenSpaceError))],
    };
  });

  expect(result.samples).toBeGreaterThan(5);
  expect(result.maximumDelta).toBeLessThan(1e-9);
  expect(result.maximumProjectionDelta).toBeLessThan(1e-5);
  expect(result.minimumPitch).toBe(45);
  expect(result.maximumPitch).toBeCloseTo(45, 5);
  expect(result.refinementStates).toContain("moving-coarse");
  expect(result.refinementStates).toContain("full-detail");
  expect(result.backgroundScreenSpaceErrors).toContain("12");
  expect(result.backgroundScreenSpaceErrors).toContain("4");
  expect(result.poiScreenSpaceErrors).toContain("12");
  expect(result.poiScreenSpaceErrors).toContain("4");
});
