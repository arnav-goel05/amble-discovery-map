import { spawn } from "node:child_process";
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

export function startPerformanceServer({ root, port, suppliedUrl }) {
  if (suppliedUrl) return null;
  const child = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        VITE_AMBLE_E2E_BYPASS_INTRO: "1",
        VITE_AMBLE_E2E_OFFLINE_MAP: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => (output += chunk));
  child.serverOutput = () => output;
  return child;
}

export async function waitForPerformanceServer({ baseUrl, server }) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode != null)
      throw new Error(
        `Frontend server exited (${server.exitCode}): ${server.serverOutput()}`,
      );
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

export async function stopPerformanceServer(server) {
  if (!server || server.exitCode != null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (server.exitCode == null) server.kill("SIGKILL");
  }, 5_000);
  await exited;
  clearTimeout(timer);
}

async function waitForSettledScene(page, settings) {
  return page.evaluate(async ({ stableDurationMs, timeoutMs }) => {
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
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
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
        performance.now() - stableSince >= stableDurationMs
      ) {
        return {
          loadToSettleMs: performance.now(),
          counts: {
            backgroundSelected,
            backgroundRenderable: backgroundReady,
            overlaySelected,
            overlayRenderable: overlayReady,
          },
        };
      }
    }
    throw new Error(`Scene did not settle: ${signature()}`);
  }, settings);
}

async function measureMovement(page, durationMs) {
  return page.evaluate(async (duration) => {
    const map = globalThis._map;
    if (!map) throw new Error("Map is unavailable for movement measurement");
    const frames = [];
    let active = true;
    const frame = (time) => {
      frames.push(time);
      if (active) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const ended = new Promise((resolve) => map.once("moveend", resolve));
    map.easeTo({ bearing: map.getBearing() + 20, duration });
    await ended;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    active = false;
    const intervals = frames
      .slice(1)
      .map((time, index) => time - frames[index]);
    const elapsedMs = frames.at(-1) - frames[0];
    const sorted = [...intervals].sort((left, right) => left - right);
    const p95Index = Math.min(
      sorted.length - 1,
      Math.ceil(sorted.length * 0.95) - 1,
    );
    return {
      elapsedMs,
      frameCount: frames.length,
      averageFps:
        elapsedMs > 0 ? ((frames.length - 1) * 1000) / elapsedMs : null,
      p95FrameMs: sorted[p95Index] ?? null,
      worstFrameMs: sorted.at(-1) ?? null,
      framesOver25Ms: intervals.filter((value) => value > 25).length,
      framesOver50Ms: intervals.filter((value) => value > 50).length,
    };
  }, durationMs);
}

export async function measurePerformanceRun(browser, item, snapshot, settings) {
  const {
    assetPrefix,
    baseUrl,
    candidateRoot,
    currentRoot,
    movementDurationMs,
    overlayRoot,
    timeoutMs,
    viewport,
  } = settings;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const errors = [];
  const missingAssets = [];
  const requestedAssets = new Set();
  const backgroundRoot =
    item.variant === "current" ? currentRoot : candidateRoot;
  const roots = { background: backgroundRoot, overlays: overlayRoot };
  await context.route(`${baseUrl}${assetPrefix}**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const match =
      /^\/__background-lite-performance__\/(background|overlays)\/(.+)$/u.exec(
        pathname,
      );
    if (!match) return route.abort("blockedbyclient");
    const filename = resolveAsset(roots[match[1]], match[2]);
    requestedAssets.add(pathname);
    if (
      !filename ||
      !fs.existsSync(filename) ||
      !fs.statSync(filename).isFile()
    ) {
      missingAssets.push(pathname);
      return route.fulfill({ status: 404, body: "missing performance asset" });
    }
    return route.fulfill({
      path: filename,
      contentType: filename.endsWith(".json")
        ? "application/json"
        : "application/octet-stream",
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().includes(assetPrefix))
      errors.push(`request: ${request.failure()?.errorText}: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes(assetPrefix))
      errors.push(`${response.status()}: ${response.url()}`);
  });
  await page.addInitScript(
    ({
      snapshotId,
      pois,
      landmarks,
      activities,
      backgroundUrl,
      overlayUrl,
    }) => {
      globalThis.__EVENT_PIPELINE_SNAPSHOT__ = {
        snapshotId,
        pois,
        landmarks,
        activities,
        buildingAssetManifest: {
          schemaVersion: "local-building-assets-v1",
          state: "ready",
          manifestId: `performance-${snapshotId}`,
          localOnly: true,
          background: { complete: true, opacity: 0.3, url: backgroundUrl },
          overlays: {
            complete: true,
            empty: false,
            opacity: 1,
            url: overlayUrl,
          },
        },
      };
    },
    {
      snapshotId: snapshot.approved.snapshotId,
      pois: snapshot.pois,
      landmarks: snapshot.landmarks,
      activities: snapshot.activities,
      backgroundUrl: `${assetPrefix}background/tileset.json`,
      overlayUrl: `${assetPrefix}overlays/tileset.json`,
    },
  );
  try {
    await page.goto(
      `${baseUrl}/?performanceDiagnostics=1&performanceVariant=full${item.requestedCamera}`,
      { waitUntil: "domcontentloaded", timeout: timeoutMs },
    );
    await page.waitForFunction(
      () =>
        document.body.dataset.backgroundViewLoaded === "true" &&
        typeof globalThis.__buildingLayerDiagnosticSnapshot === "function",
      null,
      { timeout: timeoutMs },
    );
    const settled = await waitForSettledScene(page, settings);
    const observedCamera = await page.evaluate(() => location.hash);
    const motion = await measureMovement(page, movementDurationMs);
    const memory = await page.evaluate(() => {
      const value = performance.memory;
      return value
        ? {
            available: true,
            usedJsHeapBytes: value.usedJSHeapSize,
            totalJsHeapBytes: value.totalJSHeapSize,
            jsHeapLimitBytes: value.jsHeapSizeLimit,
          }
        : { available: false, reason: "performance.memory unsupported" };
    });
    return {
      ...item,
      settled: true,
      loadToSettleMs: Number(settled.loadToSettleMs.toFixed(3)),
      movementFps: Number(motion.averageFps.toFixed(3)),
      movement: motion,
      memory,
      counts: settled.counts,
      observedCamera,
      requestedAssetCount: requestedAssets.size,
      missingAssets: [...new Set(missingAssets)].sort(),
      errors: [...new Set(errors)].sort(),
    };
  } finally {
    await context.close();
  }
}
