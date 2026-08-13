import fs from "node:fs";
import path from "node:path";

import { expect, test } from "playwright/test";

const enabled = process.env.BACKGROUND_LITE_PILOT === "1";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "outputs/background-lite-pilot/round1-20");
const manifestPath = path.join(output, "manifest.json");
const manifest = enabled
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : { records: [] };
const screenshots = path.join(output, "screenshots");

const cameraHash = ({ latitude, longitude }) =>
  `#17/${latitude.toFixed(7)}/${longitude.toFixed(7)}/0/60`;

async function installPilot(page, { mode, sse = 4, tileset = null }) {
  const selectedTileset =
    tileset ??
    JSON.parse(
      fs.readFileSync(path.join(output, `${mode}-tileset.json`), "utf8"),
    );
  await page.route("**/__background-lite-pilot__/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/__background-lite-pilot__/tileset.json")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(selectedTileset),
      });
    const relative = decodeURIComponent(
      pathname.replace(
        /^\/__background-lite-pilot__\/(?:original|lite)\//u,
        "",
      ),
    );
    const local = pathname.includes("/__background-lite-pilot__/original/")
      ? path.join(root, "optimized-tiles", relative)
      : path.join(output, "lite", relative);
    return route.fulfill({
      contentType: "application/octet-stream",
      body: fs.readFileSync(local),
    });
  });
  await page.addInitScript(
    ({ backgroundScreenSpaceError }) => {
      globalThis.__EVENT_PIPELINE_SNAPSHOT__ = {
        snapshotId: "background-lite-pilot",
        backgroundTilesetUrl: "/__background-lite-pilot__/tileset.json",
        backgroundScreenSpaceError,
        pois: [],
        landmarks: [],
        activities: [],
      };
    },
    { backgroundScreenSpaceError: sse },
  );
}

async function runMode(browser, mode) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const results = [];
  const representative = new Set([
    manifest.records.find(({ category }) => category === "heavy")?.source,
    manifest.records.find(({ category }) => category === "medium")?.source,
    manifest.records.find(({ category }) => category === "complex")?.source,
  ]);
  for (const [index, record] of manifest.records.entries()) {
    const page = await context.newPage();
    const tileRequests = [];
    page.on("response", (response) => {
      if (/\.b3dm(?:\?|$)/u.test(response.url()))
        tileRequests.push({ url: response.url(), status: response.status() });
    });
    await installPilot(page, { mode });
    const expectedPath = `/__background-lite-pilot__/${mode}/${record.source.replace(/^optimized-tiles\//u, "")}`;
    const startedAt = performance.now();
    const responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === expectedPath,
      { timeout: 30_000 },
    );
    await page.goto(`/?performanceDiagnostics=1${cameraHash(record.camera)}`, {
      waitUntil: "domcontentloaded",
    });
    let response;
    try {
      response = await responsePromise;
    } catch (error) {
      const state = await page.evaluate(() => ({ ...document.body.dataset }));
      throw new Error(
        `${error.message}; expected=${expectedPath}; requests=${JSON.stringify(tileRequests)}; state=${JSON.stringify(state)}`,
      );
    }
    await response.finished();
    await expect
      .poll(
        () => page.locator("body").getAttribute("data-background-view-loaded"),
        {
          timeout: 30_000,
        },
      )
      .toBe("true");
    const visibleMs = performance.now() - startedAt;
    await page.waitForTimeout(250);
    const diagnostic = await page.evaluate(() => ({
      selected: Number(
        document.body.dataset.backgroundViewSelectedTileCount ?? 0,
      ),
      ready: Number(document.body.dataset.backgroundViewReadyTileCount ?? 0),
      errors: Number(document.body.dataset.tileErrorCount ?? 0),
      sse: Number(document.body.dataset.backgroundMaximumScreenSpaceError),
      usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    }));
    const frameMetrics = representative.has(record.source)
      ? await page.evaluate(async () => {
          const sample = async ({ move }) => {
            const frames = [];
            let previous = performance.now();
            const end = previous + 1_000;
            if (move) {
              const center = window._map.getCenter();
              window._map.easeTo({
                center: [center.lng + 0.0008, center.lat + 0.0004],
                duration: 850,
              });
            }
            await new Promise((resolve) => {
              const tick = (now) => {
                frames.push(now - previous);
                previous = now;
                if (now >= end) resolve();
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            frames.sort((a, b) => a - b);
            const average =
              frames.reduce((sum, value) => sum + value, 0) / frames.length;
            return {
              averageFps: 1000 / average,
              p95FrameMs: frames[Math.floor(frames.length * 0.95)],
            };
          };
          return {
            movement: await sample({ move: true }),
            settled: await sample({ move: false }),
          };
        })
      : null;
    let screenshot = null;
    if (representative.has(record.source)) {
      screenshot = path.join(
        screenshots,
        `${String(index + 1).padStart(2, "0")}-${record.category}-${mode}.png`,
      );
      await page
        .locator("#map .maplibregl-canvas")
        .first()
        .screenshot({ path: screenshot });
    }
    results.push({
      source: record.source,
      category: record.category,
      expectedBytes:
        mode === "original" ? record.sourceBytes : record.liteBytes,
      responseStatus: response.status(),
      visibleMs: Number(visibleMs.toFixed(1)),
      screenshot: screenshot ? path.relative(root, screenshot) : null,
      frameMetrics,
      ...diagnostic,
    });
    await page.close();
  }
  await context.close();
  return results;
}

async function compareScreenshots(page, originalPath, litePath) {
  return page.evaluate(
    async ({ original, lite }) => {
      const pixels = async (base64) => {
        const response = await fetch(`data:image/png;base64,${base64}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [left, right] = await Promise.all([pixels(original), pixels(lite)]);
      let changed = 0;
      let absoluteDifference = 0;
      for (let offset = 0; offset < left.length; offset += 4) {
        const difference = Math.max(
          Math.abs(left[offset] - right[offset]),
          Math.abs(left[offset + 1] - right[offset + 1]),
          Math.abs(left[offset + 2] - right[offset + 2]),
        );
        absoluteDifference += difference;
        if (difference >= 12) changed += 1;
      }
      return {
        changedPixelRatio: changed / (left.length / 4),
        meanMaximumChannelDifference: absoluteDifference / (left.length / 4),
      };
    },
    {
      original: fs.readFileSync(originalPath).toString("base64"),
      lite: fs.readFileSync(litePath).toString("base64"),
    },
  );
}

test.skip(
  !enabled,
  "Run with BACKGROUND_LITE_PILOT=1 after generating the pilot",
);
test("20-tile background-lite pilot loads, renders, and produces reviewable comparisons", async ({
  browser,
  page,
}) => {
  test.setTimeout(12 * 60_000);
  fs.mkdirSync(screenshots, { recursive: true });
  const original = await runMode(browser, "original");
  const lite = await runMode(browser, "lite");
  const comparisons = [];
  for (const originalRecord of original.filter(
    ({ screenshot }) => screenshot,
  )) {
    const liteRecord = lite.find(
      ({ source }) => source === originalRecord.source,
    );
    comparisons.push({
      source: originalRecord.source,
      category: originalRecord.category,
      originalScreenshot: originalRecord.screenshot,
      liteScreenshot: liteRecord.screenshot,
      ...(await compareScreenshots(
        page,
        path.join(root, originalRecord.screenshot),
        path.join(root, liteRecord.screenshot),
      )),
    });
  }
  const summarize = (records) => ({
    tileCount: records.length,
    successfulResponses: records.filter(
      ({ responseStatus }) => responseStatus === 200,
    ).length,
    tileErrors: records.reduce((sum, record) => sum + record.errors, 0),
    medianVisibleMs: records
      .map(({ visibleMs }) => visibleMs)
      .sort((a, b) => a - b)[Math.floor(records.length / 2)],
    p95VisibleMs: records
      .map(({ visibleMs }) => visibleMs)
      .sort((a, b) => a - b)[Math.floor(records.length * 0.95) - 1],
  });
  const report = {
    schemaVersion: "background-lite-browser-comparison-v1",
    generatedAt: new Date().toISOString(),
    original: summarize(original),
    lite: summarize(lite),
    comparisons,
    records: { original, lite },
  };
  fs.writeFileSync(
    path.join(output, "browser-comparison.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  expect(report.original.successfulResponses).toBe(20);
  expect(report.lite.successfulResponses).toBe(20);
  expect(report.original.tileErrors).toBe(0);
  expect(report.lite.tileErrors).toBe(0);
  expect(comparisons).toHaveLength(3);
});

test("background screen-space error 4, 6, 8, and 10 is measured independently", async ({
  browser,
}) => {
  test.setTimeout(6 * 60_000);
  const results = [];
  for (const sse of [4, 6, 8, 10]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    const resources = [];
    page.on("response", (response) => {
      if (/\/optimized-tiles\/.+\.b3dm(?:\?|$)/u.test(response.url()))
        resources.push({
          url: response.url(),
          status: response.status(),
          contentLength: Number(response.headers()["content-length"] ?? 0),
        });
    });
    await page.addInitScript(
      ({ backgroundScreenSpaceError }) => {
        globalThis.__EVENT_PIPELINE_SNAPSHOT__ = {
          snapshotId: `background-sse-${backgroundScreenSpaceError}`,
          backgroundTilesetUrl: "/optimized-tiles/tileset.json",
          backgroundScreenSpaceError,
          pois: [],
          landmarks: [],
          activities: [],
        };
      },
      { backgroundScreenSpaceError: sse },
    );
    const startedAt = performance.now();
    await page.goto("/?performanceDiagnostics=1#17/1.285844/103.857897/0/60", {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(
        () => page.locator("body").getAttribute("data-background-view-loaded"),
        {
          timeout: 45_000,
        },
      )
      .toBe("true");
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => ({
      selectedTileCount: Number(
        document.body.dataset.backgroundViewSelectedTileCount ?? 0,
      ),
      readyTileCount: Number(
        document.body.dataset.backgroundViewReadyTileCount ?? 0,
      ),
      configuredSse: Number(
        document.body.dataset.backgroundMaximumScreenSpaceError,
      ),
      currentSse: Number(
        document.body.dataset.backgroundCurrentMaximumScreenSpaceError,
      ),
      tileErrors: Number(document.body.dataset.tileErrorCount ?? 0),
      usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    }));
    results.push({
      sse,
      visibleMs: Number((performance.now() - startedAt).toFixed(1)),
      b3dmRequests: resources.length,
      b3dmResponseBytes: resources.reduce(
        (sum, item) => sum + item.contentLength,
        0,
      ),
      ...state,
    });
    await context.close();
  }
  fs.writeFileSync(
    path.join(output, "sse-comparison.json"),
    `${JSON.stringify(
      {
        schemaVersion: "background-sse-comparison-v1",
        generatedAt: new Date().toISOString(),
        camera: {
          zoom: 17,
          latitude: 1.285844,
          longitude: 103.857897,
          pitch: 60,
        },
        results,
      },
      null,
      2,
    )}\n`,
  );
  expect(results.map(({ configuredSse }) => configuredSse)).toEqual([
    4, 6, 8, 10,
  ]);
  expect(results.every(({ tileErrors }) => tileErrors === 0)).toBe(true);
});
