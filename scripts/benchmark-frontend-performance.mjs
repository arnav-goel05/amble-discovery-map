import { spawn } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const integerOption = (name, fallback) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
};

const runs = integerOption("runs", 3);
const settleMs = integerOption("settle-ms", 8_000);
const motionMs = integerOption("motion-ms", 2_000);
const port = integerOption("port", 4175);
const suppliedUrl = option("url", "");
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}`;
const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
const outputDirectory = path.resolve(root, option("output", `outputs/performance-baseline/${timestamp}`));
const profiles = [
  { id: "desktop-cold", cache: "cold", viewport: { width: 1440, height: 900 } },
  { id: "desktop-warm", cache: "warm", viewport: { width: 1440, height: 900 } },
  { id: "mobile-cold", cache: "cold", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { id: "mobile-warm", cache: "warm", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

const round = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, quantile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
};
const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return "n/a";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
};

async function directoryStats(directory) {
  let bytes = 0;
  let files = 0;
  const visit = async (current) => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const details = await stat(target);
        bytes += details.size;
        files += 1;
      }
    }
  };
  await visit(directory);
  return { bytes, files };
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`Frontend server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startServer() {
  if (suppliedUrl) return null;
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  child.serverOutput = () => output;
  return child;
}

function resourceGroup(url, type = "") {
  const pathname = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  if (/\.b3dm(?:$|\?)/i.test(pathname)) return "3d-tiles";
  if (/tileset[^/]*\.json(?:$|\?)/i.test(pathname)) return "tileset-json";
  if (/basemaps\.cartocdn\.com/i.test(url)) return "base-map";
  if (/\.(?:woff2?|ttf|otf)(?:$|\?)/i.test(pathname)) return "fonts";
  if (/\.css(?:$|\?)/i.test(pathname)) return "styles";
  if (/\.(?:m?js)(?:$|\?)/i.test(pathname) || type === "Script") return "scripts";
  if (/\.(?:png|jpe?g|webp|svg)(?:$|\?)/i.test(pathname)) return "images";
  if (/\/api\//.test(pathname)) return "api";
  if (type === "Document") return "document";
  return "other";
}

async function benchmarkRun(browser, runNumber, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile === true,
    hasTouch: profile.hasTouch === true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: profile.cache === "cold" });
  const requests = new Map();
  const resources = [];
  cdp.on("Network.requestWillBeSent", ({ requestId, request, type }) => {
    requests.set(requestId, { type, url: request.url });
  });
  cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
    const request = requests.get(requestId);
    if (request) resources.push({ ...request, encodedBytes: encodedDataLength });
  });

  await page.addInitScript(() => {
    const state = window.__frontendBaseline = { longTasks: [], milestones: {}, paints: {} };
    const mark = (name) => { if (state.milestones[name] == null) state.milestones[name] = performance.now(); };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.paints[entry.name] = entry.startTime;
    }).observe({ type: "paint", buffered: true });
    document.addEventListener("DOMContentLoaded", () => mark("domContentLoaded"), { once: true });
    window.addEventListener("load", () => mark("windowLoad"), { once: true });
    const milestones = {
      mapInitialized: ["mapInitialized", "true"],
      buildingsLayerStarted: ["buildingsLayerStarted", "true"],
      eventUiMounted: ["landmarkEventPills", "mounted"],
      overlayLayersLoaded: ["overlayLayersLoaded", "true"],
      tilesetLoaded: ["tilesetLoaded", "true"],
    };
    state.poll = window.setInterval(() => {
      if (!document.body) return;
      for (const [name, [key, value]] of Object.entries(milestones)) {
        if (document.body.dataset[key] === value) mark(name);
      }
      if (Number(document.body.dataset.tileLoadCount) > 0) mark("firstBackgroundTile");
      if (Number(document.body.dataset.poiTileLoadCount) > 0) mark("firstPoiTile");
    }, 10);
  });

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const targetUrl = `${baseUrl}/?autoStart#15.3/1.285844/103.857897/-30/60`;
  if (profile.cache === "warm") {
    await page.goto(targetUrl, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => document.body?.dataset.landmarkEventPills === "mounted", null, { timeout: 30_000 });
    await page.waitForTimeout(500);
    requests.clear();
    resources.length = 0;
    errors.length = 0;
  }
  const wallStart = performance.now();
  await page.goto(targetUrl, { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(() => document.body?.dataset.landmarkEventPills === "mounted", null, { timeout: 30_000 });
  const uiReadyWallMs = performance.now() - wallStart;
  const readUiWork = () => page.evaluate(() => ({
    directionUpdates: Number(document.body.dataset.landmarkDirectionUpdateCount || 0),
    pillPositionPasses: Number(document.body.dataset.landmarkEventPillPositionPassCount || 0),
    pillPositionUpdates: Number(document.body.dataset.landmarkEventPillPositionUpdateCount || 0),
  }));
  const uiWorkBeforeIdle = await readUiWork();
  await page.waitForTimeout(settleMs);
  const uiWorkAfterIdle = await readUiWork();

  const motion = await page.evaluate(async ({ duration }) => {
    const frames = [];
    let active = true;
    const frame = (time) => {
      frames.push(time);
      if (active) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const map = window._map;
    map.easeTo({ bearing: map.getBearing() + 25, center: [103.864, 1.292], duration });
    await new Promise((resolve) => setTimeout(resolve, duration + 300));
    active = false;
    const intervals = frames.slice(1).map((time, index) => time - frames[index]);
    const elapsed = frames.at(-1) - frames[0];
    const sorted = [...intervals].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] || null;
    return {
      elapsedMs: elapsed,
      frameCount: frames.length,
      averageFps: elapsed > 0 ? (frames.length - 1) * 1000 / elapsed : null,
      p95FrameMs: at(0.95),
      worstFrameMs: sorted.at(-1) || null,
      framesOver25Ms: intervals.filter((value) => value > 25).length,
      framesOver50Ms: intervals.filter((value) => value > 50).length,
    };
  }, { duration: motionMs });

  const browserMetrics = await page.evaluate(() => {
    clearInterval(window.__frontendBaseline.poll);
    const navigation = performance.getEntriesByType("navigation")[0];
    const state = window.__frontendBaseline;
    const memory = performance.memory;
    return {
      datasets: { ...document.body.dataset },
      longTasks: state.longTasks,
      milestones: { ...state.milestones, ...state.paints },
      memory: memory ? {
        jsHeapLimitBytes: memory.jsHeapSizeLimit,
        totalJsHeapBytes: memory.totalJSHeapSize,
        usedJsHeapBytes: memory.usedJSHeapSize,
      } : null,
      navigation: navigation ? {
        domInteractiveMs: navigation.domInteractive,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadEventMs: navigation.loadEventEnd,
        responseStartMs: navigation.responseStart,
      } : null,
    };
  });
  const finalQuality = {
    restored: browserMetrics.datasets.tileRefinementState === "full-detail",
    backgroundScreenSpaceError: Number(browserMetrics.datasets.backgroundCurrentMaximumScreenSpaceError),
    backgroundExpectedScreenSpaceError: Number(browserMetrics.datasets.backgroundMaximumScreenSpaceError),
    poiScreenSpaceError: Number(browserMetrics.datasets.poiCurrentMaximumScreenSpaceError),
    poiExpectedScreenSpaceError: Number(browserMetrics.datasets.poiDefaultMaximumScreenSpaceError),
  };
  finalQuality.restored = finalQuality.restored
    && finalQuality.backgroundScreenSpaceError === finalQuality.backgroundExpectedScreenSpaceError
    && finalQuality.poiScreenSpaceError === finalQuality.poiExpectedScreenSpaceError;
  if (!finalQuality.restored) throw new Error(`${profile.id} did not restore full tile quality after movement`);
  await page.waitForTimeout(100);
  const groupedResources = {};
  for (const resource of resources) {
    const group = resourceGroup(resource.url, resource.type);
    groupedResources[group] ||= { bytes: 0, requests: 0 };
    groupedResources[group].bytes += resource.encodedBytes || 0;
    groupedResources[group].requests += 1;
  }
  const longTaskDurations = browserMetrics.longTasks.map(({ duration }) => duration);
  const result = {
    profile: profile.id,
    run: runNumber,
    uiReadyWallMs: round(uiReadyWallMs),
    milestones: Object.fromEntries(Object.entries(browserMetrics.milestones).map(([key, value]) => [key, round(value)])),
    navigation: Object.fromEntries(Object.entries(browserMetrics.navigation || {}).map(([key, value]) => [key, round(value)])),
    network: {
      totalBytes: resources.reduce((sum, resource) => sum + (resource.encodedBytes || 0), 0),
      totalRequests: resources.length,
      groups: groupedResources,
      largestResources: [...resources]
        .sort((left, right) => (right.encodedBytes || 0) - (left.encodedBytes || 0))
        .slice(0, 20)
        .map(({ encodedBytes, type, url }) => ({
          encodedBytes,
          group: resourceGroup(url, type),
          path: (() => { try { return new URL(url).pathname; } catch { return url; } })(),
        })),
    },
    longTasks: {
      count: longTaskDurations.length,
      totalDurationMs: round(longTaskDurations.reduce((sum, value) => sum + value, 0)),
      p95DurationMs: round(percentile(longTaskDurations, 0.95)),
      worstDurationMs: round(Math.max(0, ...longTaskDurations)),
    },
    memory: browserMetrics.memory,
    motion: Object.fromEntries(Object.entries(motion).map(([key, value]) => [key, round(value)])),
    idleUiWork: Object.fromEntries(Object.keys(uiWorkAfterIdle).map((key) => [
      key,
      uiWorkAfterIdle[key] - uiWorkBeforeIdle[key],
    ])),
    tileCounts: {
      activePoiLayers: Number(browserMetrics.datasets.poiActiveLayerCount || 0),
      configuredPoiLayers: Number(browserMetrics.datasets.poiConfiguredLayerCount || 0),
      background: Number(browserMetrics.datasets.tileLoadCount || 0),
      poi: Number(browserMetrics.datasets.poiTileLoadCount || 0),
      preloadedPoi: Number(browserMetrics.datasets.poiPreloadCount || 0),
      preloadStatus: browserMetrics.datasets.poiPreload || "not-started",
    },
    finalQuality,
    errors,
  };
  await context.close();
  return result;
}

function summarize(results) {
  const value = (getter) => round(median(results.map(getter)));
  const milestoneNames = [...new Set(results.flatMap((run) => Object.keys(run.milestones)))];
  const groups = [...new Set(results.flatMap((run) => Object.keys(run.network.groups)))];
  return {
    uiReadyWallMs: value((run) => run.uiReadyWallMs),
    milestones: Object.fromEntries(milestoneNames.map((name) => [name, value((run) => run.milestones[name])])),
    network: {
      totalBytes: value((run) => run.network.totalBytes),
      totalRequests: value((run) => run.network.totalRequests),
      groups: Object.fromEntries(groups.map((group) => [group, {
        bytes: value((run) => run.network.groups[group]?.bytes),
        requests: value((run) => run.network.groups[group]?.requests),
      }])),
    },
    longTasks: {
      count: value((run) => run.longTasks.count),
      totalDurationMs: value((run) => run.longTasks.totalDurationMs),
      worstDurationMs: value((run) => run.longTasks.worstDurationMs),
    },
    memory: {
      usedJsHeapBytes: value((run) => run.memory?.usedJsHeapBytes),
      totalJsHeapBytes: value((run) => run.memory?.totalJsHeapBytes),
    },
    motion: {
      averageFps: value((run) => run.motion.averageFps),
      p95FrameMs: value((run) => run.motion.p95FrameMs),
      worstFrameMs: value((run) => run.motion.worstFrameMs),
      framesOver25Ms: value((run) => run.motion.framesOver25Ms),
      framesOver50Ms: value((run) => run.motion.framesOver50Ms),
    },
    idleUiWork: {
      directionUpdates: value((run) => run.idleUiWork.directionUpdates),
      pillPositionPasses: value((run) => run.idleUiWork.pillPositionPasses),
      pillPositionUpdates: value((run) => run.idleUiWork.pillPositionUpdates),
    },
    tileCounts: {
      activePoiLayers: value((run) => run.tileCounts.activePoiLayers),
      configuredPoiLayers: value((run) => run.tileCounts.configuredPoiLayers),
      background: value((run) => run.tileCounts.background),
      poi: value((run) => run.tileCounts.poi),
      preloadedPoi: value((run) => run.tileCounts.preloadedPoi),
    },
    finalQualityRestored: results.every((run) => run.finalQuality.restored),
  };
}

function profileMarkdown(profile, s) {
  const milestones = Object.entries(s.milestones)
    .filter(([, value]) => value != null)
    .map(([name, value]) => `| ${name} | ${value} ms |`).join("\n");
  const resourceGroups = Object.entries(s.network.groups)
    .sort((a, b) => (b[1].bytes || 0) - (a[1].bytes || 0))
    .map(([name, value]) => `| ${name} | ${value.requests ?? 0} | ${formatBytes(value.bytes)} |`).join("\n");
  return `## ${profile.id}

- Viewport: ${profile.viewport.width} × ${profile.viewport.height}
- Browser cache: ${profile.cache}
- Full quality restored after movement: ${s.finalQualityRestored ? "yes" : "no"}

### Startup

| Metric | Median |
| --- | ---: |
| UI mounted, wall clock | ${s.uiReadyWallMs} ms |
| Network requests observed | ${s.network.totalRequests} |
| Encoded bytes transferred | ${formatBytes(s.network.totalBytes)} |
| Long tasks | ${s.longTasks.count} |
| Total long-task time | ${s.longTasks.totalDurationMs} ms |
| Worst long task | ${s.longTasks.worstDurationMs} ms |
| Used JavaScript heap | ${formatBytes(s.memory.usedJsHeapBytes)} |
| Active/configured POI layers | ${s.tileCounts.activePoiLayers} / ${s.tileCounts.configuredPoiLayers} |
| Background tiles loaded | ${s.tileCounts.background} |
| POI tiles loaded | ${s.tileCounts.poi} |
| POI tiles proactively preloaded | ${s.tileCounts.preloadedPoi} |
| Idle pill-position passes | ${s.idleUiWork.pillPositionPasses} |
| Idle pill-position updates | ${s.idleUiWork.pillPositionUpdates} |
| Idle direction-indicator updates | ${s.idleUiWork.directionUpdates} |

### Startup milestones

| Milestone | Time from navigation |
| --- | ---: |
${milestones}

### Network by resource type

| Resource | Requests | Encoded bytes |
| --- | ---: | ---: |
${resourceGroups}

### Controlled map motion

| Metric | Median |
| --- | ---: |
| Average FPS | ${s.motion.averageFps} |
| P95 frame time | ${s.motion.p95FrameMs} ms |
| Worst frame | ${s.motion.worstFrameMs} ms |
| Frames over 25 ms | ${s.motion.framesOver25Ms} |
| Frames over 50 ms | ${s.motion.framesOver50Ms} |
`;
}

function markdown(report) {
  return `# Frontend performance baseline

- Captured: ${report.generatedAt}
- URL: ${report.config.url}
- Runs per profile: ${report.config.runs} (summary values are medians)
- Startup observation after UI mount: ${report.config.settleMs} ms
- Controlled map motion: ${report.config.motionMs} ms
- Git revision: ${report.environment.gitRevision || "unknown"}

${report.profiles.map((profile) => profileMarkdown(profile, report.summary[profile.id])).join("\n")}

## Dataset context

| Dataset | Files | Disk size |
| --- | ---: | ---: |
| Background 3D tiles | ${report.dataset.background.files} | ${formatBytes(report.dataset.background.bytes)} |
| Dedicated POI tiles | ${report.dataset.poi.files} | ${formatBytes(report.dataset.poi.bytes)} |

Raw per-run measurements are stored in \`baseline.json\` beside this report. Re-run with \`npm run benchmark:frontend\` under the same machine and viewport before and after an optimization.
`;
}

let server;
let browser;
try {
  server = startServer();
  await waitForServer(baseUrl, server);
  browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"] });
  const results = [];
  for (const profile of profiles) {
    for (let run = 1; run <= runs; run += 1) {
      process.stdout.write(`${profile.id} run ${run}/${runs}... `);
      const result = await benchmarkRun(browser, run, profile);
      results.push(result);
      process.stdout.write(`${result.uiReadyWallMs} ms UI, ${round(result.motion.averageFps)} FPS, ${formatBytes(result.network.totalBytes)}\n`);
    }
  }
  const [background, allPoi, poiSource] = await Promise.all([
    directoryStats(path.join(root, "optimized-tiles")),
    directoryStats(path.join(root, "public/poi-tiles")),
    directoryStats(path.join(root, "public/poi-tiles/source")),
  ]);
  const gitRevision = await new Promise((resolve) => {
    const child = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    let value = "";
    child.stdout.on("data", (chunk) => { value += chunk; });
    child.on("close", () => resolve(value.trim()));
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    config: { motionMs, runs, settleMs, url: baseUrl },
    environment: {
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model,
      gitRevision,
      memoryBytes: os.totalmem(),
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    },
    dataset: {
      background,
      poi: { bytes: Math.max(0, allPoi.bytes - poiSource.bytes), files: Math.max(0, allPoi.files - poiSource.files) },
    },
    profiles,
    summary: Object.fromEntries(profiles.map((profile) => [profile.id, summarize(results.filter((run) => run.profile === profile.id))])),
    runs: results,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "baseline.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, "baseline.md"), markdown(report));
  await mkdir(path.join(root, "outputs/performance-baseline"), { recursive: true });
  await writeFile(path.join(root, "outputs/performance-baseline/latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(root, "outputs/performance-baseline/latest.md"), markdown(report));
  console.log(`Baseline written to ${path.relative(root, outputDirectory)}`);
} catch (error) {
  if (server?.serverOutput()) process.stderr.write(server.serverOutput());
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode == null) server.kill("SIGTERM");
}
