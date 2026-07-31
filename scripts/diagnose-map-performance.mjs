import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  compareVariants,
  renderDiagnosticMarkdown,
  summarizeCpuProfile,
  validateTrial,
  validateVariantConfig,
} from "./lib/map-performance-diagnostics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const runs = Number(option("runs", "3"));
const port = Number(option("port", "4176"));
const headed = args.includes("--headed");
const cpuProfile = args.includes("--cpu-profile");
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs is invalid");
const config = validateVariantConfig(
  JSON.parse(
    await readFile(
      path.join(root, "config/map-performance-diagnostic-variants.json"),
      "utf8",
    ),
  ),
);
const requestedIds = option("variants", "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const variants = requestedIds.length
  ? requestedIds.map((id) =>
      config.variants.find((variant) => variant.id === id),
    )
  : config.variants;
if (requestedIds.some((id) => !variants.some((variant) => variant?.id === id)))
  throw new Error("Unknown diagnostic variant requested");
const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
const output = path.resolve(
  root,
  option("output", `outputs/map-performance-diagnostics/${stamp}`),
);
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn(
  "npm",
  [
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk));
server.stderr.on("data", (chunk) => (serverOutput += chunk));

const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null)
      throw new Error(`Frontend server exited (${server.exitCode})`);
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Frontend server did not start");
};

const round = (value, digits = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const percentile = (values, quantile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
    ] ?? null
  );
};
const median = (values) => percentile(values, 0.5);

async function runTrial(browser, variant, runNumber) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  const requests = new Map();
  const resources = [];
  const failures = [];
  cdp.on("Network.requestWillBeSent", ({ requestId, request, type }) => {
    requests.set(requestId, {
      type,
      url: request.url,
      startedAt: Date.now(),
    });
  });
  cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
    const request = requests.get(requestId);
    if (request)
      resources.push({ ...request, encodedBytes: encodedDataLength });
    requests.delete(requestId);
  });
  cdp.on("Network.loadingFailed", ({ requestId, errorText, canceled }) => {
    const request = requests.get(requestId);
    if (request && !canceled) failures.push({ ...request, errorText });
    requests.delete(requestId);
  });
  await page.addInitScript(() => {
    window.__mapDiagnostic = { longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__mapDiagnostic.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
    }).observe({ type: "longtask", buffered: true });
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const target = `${baseUrl}/?autoStart&performanceDiagnostics=1&performanceVariant=${encodeURIComponent(variant.id)}#15.3/1.285844/103.857897/-30/45`;
  const startedAt = Date.now();
  await page.goto(target, { waitUntil: "load", timeout: 45_000 });
  await page.waitForFunction(
    (expectInterface) =>
      (!expectInterface ||
        document.body?.dataset.landmarkEventPills === "mounted") &&
      document.body?.dataset.backgroundViewLoaded === "true" &&
      typeof globalThis.__applyPerformanceDiagnosticVariant === "function",
    variant.workloads.interface !== false,
    { timeout: 45_000 },
  );
  const readinessMs = Date.now() - startedAt;
  const readinessCompletedAt = Date.now();
  const readinessComplete = await page.evaluate(
    () => document.body.dataset.backgroundViewLoaded === "true",
  );
  const sceneChange = await page.evaluate(() =>
    globalThis.__applyPerformanceDiagnosticVariant(),
  );
  if (variant.workloads.primeEventSearch) {
    const filterCount = await page.evaluate(() =>
      Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
    );
    await page.locator("#landmark-event-search-input").focus();
    await page.waitForFunction(
      (before) =>
        Number(document.body.dataset.eventDiscoveryFilterCount ?? 0) > before,
      filterCount,
    );
    await page.keyboard.press("Escape");
    await page
      .locator("#landmark-event-search-input")
      .evaluate((input) => input.blur());
  }
  const relevantActiveRequests = () =>
    [...requests.values()].filter(
      ({ url }) =>
        !url.startsWith("blob:") && !/\/draco-worker\.js(?:$|\?)/.test(url),
    );
  let idleSince = null;
  const idleDeadline = Date.now() + 30_000;
  while (Date.now() < idleDeadline) {
    if (relevantActiveRequests().length === 0) idleSince ??= Date.now();
    else idleSince = null;
    if (idleSince && Date.now() - idleSince >= 1_000) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const networkIdleCompletedAt = Date.now();
  const activeAtMotionStart = relevantActiveRequests().length;
  const activeUrlsAtMotionStart = relevantActiveRequests()
    .map(({ url }) => url)
    .slice(0, 20);
  await page.waitForTimeout(500);
  const datasetsBeforeMotion = await page.evaluate(() => ({
    ...document.body.dataset,
  }));
  if (cpuProfile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await cdp.send("Profiler.start");
  }
  const motionStartedAt = Date.now();
  const motion = await page.evaluate(async (route) => {
    const start = performance.now();
    const frames = [];
    let active = true;
    const sample = (time) => {
      frames.push(time);
      if (active) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window._map.easeTo({
      center: route.end,
      bearing: route.bearingStart + route.bearingDelta,
      zoom: route.zoom,
      pitch: route.pitch,
      duration: route.durationMs,
    });
    await new Promise((resolve) =>
      window.setTimeout(resolve, route.durationMs + 250),
    );
    active = false;
    const end = performance.now();
    const intervals = frames
      .slice(1)
      .map((time, index) => time - frames[index]);
    const elapsed = frames.at(-1) - frames[0];
    const longTasks = window.__mapDiagnostic.longTasks.filter(
      (entry) => entry.startTime >= start && entry.startTime <= end,
    );
    return {
      averageFps: elapsed > 0 ? ((frames.length - 1) * 1000) / elapsed : null,
      elapsedMs: elapsed,
      frameCount: frames.length,
      intervals,
      longTaskMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
      longTasks,
    };
  }, config.route);
  const motionCompletedAt = Date.now();
  const profile = cpuProfile ? await cdp.send("Profiler.stop") : null;
  motion.medianFrameMs = median(motion.intervals);
  motion.p95FrameMs = percentile(motion.intervals, 0.95);
  motion.worstFrameMs = Math.max(...motion.intervals, 0);
  for (const key of [
    "averageFps",
    "elapsedMs",
    "longTaskMs",
    "medianFrameMs",
    "p95FrameMs",
    "worstFrameMs",
  ])
    motion[key] = round(motion[key]);
  const state = await page.evaluate(() => ({
    visibility: document.visibilityState,
    datasets: { ...document.body.dataset },
    layers: window._map.getStyle().layers.map(({ id, type }) => ({ id, type })),
    memory: performance.memory
      ? {
          usedJsHeapBytes: performance.memory.usedJSHeapSize,
          totalJsHeapBytes: performance.memory.totalJSHeapSize,
        }
      : null,
  }));
  const trial = validateTrial({
    schemaVersion: 1,
    trialId: `${variant.id}:${runNumber}`,
    variantId: variant.id,
    runNumber,
    visibility: state.visibility,
    controls: {
      cache: "warm-capable-new-context",
      route: config.route,
      viewport: { width: 1440, height: 900 },
    },
    readiness: {
      complete: readinessComplete,
      durationMs: readinessMs,
    },
    phases: {
      navigationAndReadinessMs: readinessCompletedAt - startedAt,
      networkIdleWaitMs: networkIdleCompletedAt - readinessCompletedAt,
      motionMs: motionCompletedAt - motionStartedAt,
    },
    motion,
    network: {
      activeAtMotionStart,
      activeUrlsAtMotionStart,
      failed: failures.length,
      failures,
      requests: resources.length,
      bytes: resources.reduce(
        (sum, resource) => sum + (resource.encodedBytes || 0),
        0,
      ),
      resources: resources
        .filter(({ url }) => /\.b3dm(?:$|\?)/i.test(url))
        .map(({ url, encodedBytes }) => ({ url, encodedBytes })),
    },
    renderer: {
      before: sceneChange?.before ?? null,
      after: sceneChange?.after ?? null,
      layers: state.layers,
      datasets: state.datasets,
      datasetsBeforeMotion,
      cpuProfileTop: profile ? summarizeCpuProfile(profile.profile) : [],
    },
    memory: state.memory,
    errors: pageErrors,
    validity: { reasons: pageErrors.length ? ["page_errors"] : [] },
  });
  await context.close();
  return trial;
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    headless: !headed,
    args: ["--enable-precise-memory-info"],
  });
  const browserSession = await browser.newBrowserCDPSession();
  const systemInfo = await browserSession.send("SystemInfo.getInfo");
  const trials = [];
  for (const variant of variants) {
    for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
      process.stdout.write(`${variant.id} ${runNumber}/${runs}... `);
      const trial = await runTrial(browser, variant, runNumber);
      trials.push(trial);
      console.log(
        `${trial.validity.state}, ${trial.motion.averageFps} FPS, ${trial.motion.medianFrameMs} ms median frame`,
      );
    }
  }
  const selectedConfig = { ...config, variants };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      browser: browser.version(),
      headed,
      graphicsDevice: systemInfo.gpu.devices[0] ?? null,
      graphicsFeatures: systemInfo.gpu.featureStatus ?? null,
      cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    },
    variants,
    trials,
    comparisons: compareVariants(selectedConfig, trials),
    findings: [],
  };
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    path.join(output, "report.md"),
    renderDiagnosticMarkdown(report),
  );
  const latest = path.join(root, "outputs/map-performance-diagnostics/latest");
  await mkdir(latest, { recursive: true });
  await writeFile(
    path.join(latest, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    path.join(latest, "report.md"),
    renderDiagnosticMarkdown(report),
  );
  console.log(path.relative(root, output));
} catch (error) {
  if (serverOutput) process.stderr.write(serverOutput);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode == null) server.kill("SIGTERM");
}
