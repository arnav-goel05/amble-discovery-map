import {
  capturePerformanceMilestones,
  PERFORMANCE_MILESTONE_METRICS,
  performanceMetricState,
  performancePercentile,
  roundPerformanceValue,
  sanitizePerformanceResourcePath,
  summarizePerformanceResources,
} from "./performance-diagnostics-model.js";
import { createPerformanceDiagnosticsView } from "./performance-diagnostics-view.js";

export { sanitizePerformanceResourcePath };

const SNAPSHOT_VERSION = "1.0";
const MAX_SNAPSHOT_BYTES = 100 * 1024;

export function createPerformanceDiagnostics(options = {}) {
  const windowRef = options.window ?? globalThis.window;
  const documentRef = options.document ?? globalThis.document;
  const performanceRef = options.performance ?? globalThis.performance;
  const Observer =
    options.PerformanceObserver ?? globalThis.PerformanceObserver;
  const interval = options.setInterval ?? globalThis.setInterval;
  const clear = options.clearInterval ?? globalThis.clearInterval;
  const raf = options.requestAnimationFrame ?? globalThis.requestAnimationFrame;
  const cancelRaf =
    options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame;
  const now = options.now ?? (() => new Date());
  const autoMount = options.autoMount !== false;
  const observers = [];
  const longTasks = [];
  const paints = {};
  const webVitals = { cls: 0, inpMs: null, lcpMs: null };
  const milestones = {};
  const motionIntervals = [];
  let map = null;
  let started = false;
  let destroyed = false;
  let intervalId = null;
  let motionFrame = null;
  let motionActive = false;
  let lastFrameTime = null;
  let longTaskSupported = false;

  const observe = (type, receive) => {
    if (typeof Observer !== "function") return false;
    try {
      const observer = new Observer((list) => receive(list.getEntries()));
      observer.observe({ type, buffered: true });
      observers.push(observer);
      return true;
    } catch {
      return false;
    }
  };

  const frame = (time) => {
    if (!motionActive) return;
    if (lastFrameTime != null) motionIntervals.push(time - lastFrameTime);
    lastFrameTime = time;
    motionFrame = raf(frame);
  };
  const startMotion = () => {
    if (motionActive || documentRef?.hidden) return;
    motionActive = true;
    lastFrameTime = null;
    motionIntervals.length = 0;
    motionFrame = raf(frame);
  };
  const stopMotion = () => {
    motionActive = false;
    if (motionFrame != null) cancelRaf(motionFrame);
    motionFrame = null;
    lastFrameTime = null;
    render();
  };
  const detachMap = () => {
    if (!map) return;
    map.off?.("movestart", startMotion);
    map.off?.("moveend", stopMotion);
    map = null;
    stopMotion();
  };
  const attachMap = (nextMap) => {
    if (map === nextMap) return;
    detachMap();
    map = nextMap;
    map?.on?.("movestart", startMotion);
    map?.on?.("moveend", stopMotion);
  };

  const sample = (metric, value, unit, state, capturedAt) => ({
    metric,
    value: roundPerformanceValue(value),
    unit,
    capturedAt,
    freshnessMs: 0,
    state,
  });

  const snapshot = () => {
    const capturedAt = now().toISOString();
    const resources = summarizePerformanceResources(performanceRef);
    const navigation = performanceRef?.getEntriesByType?.("navigation")?.[0];
    const usedHeap = performanceRef?.memory?.usedJSHeapSize;
    const frameElapsed = motionIntervals.reduce((sum, value) => sum + value, 0);
    const averageFps =
      frameElapsed > 0 ? (motionIntervals.length * 1000) / frameElapsed : null;
    const p95FrameMs = performancePercentile(motionIntervals, 0.95);
    const body = documentRef?.body?.dataset ?? {};
    capturePerformanceMilestones(
      body,
      milestones,
      () => performanceRef?.now?.() ?? null,
    );
    const longTaskTotal = longTasks.reduce((sum, value) => sum + value, 0);
    const samples = [
      sample(
        "startup.loadEventMs",
        navigation?.loadEventEnd,
        "ms",
        navigation
          ? performanceMetricState(navigation.loadEventEnd, {
              warnMax: 2000,
              max: 4000,
            })
          : "pending",
        capturedAt,
      ),
      ...Object.keys(PERFORMANCE_MILESTONE_METRICS).map((metric) =>
        sample(
          metric,
          milestones[metric] ?? null,
          "ms",
          milestones[metric] == null
            ? "pending"
            : performanceMetricState(milestones[metric], {
                warnMax: 3000,
                max: 6000,
              }),
          capturedAt,
        ),
      ),
      sample(
        "paint.firstContentfulPaintMs",
        paints["first-contentful-paint"] ?? null,
        "ms",
        paints["first-contentful-paint"] == null
          ? "pending"
          : performanceMetricState(paints["first-contentful-paint"], {
              warnMax: 1800,
              max: 3000,
            }),
        capturedAt,
      ),
      sample(
        "network.totalBytes",
        resources.totalBytes,
        "bytes",
        performanceMetricState(resources.totalBytes, {
          warnMax: 50 * 1024 * 1024,
          max: 150 * 1024 * 1024,
        }),
        capturedAt,
      ),
      sample(
        "network.requests",
        resources.requests,
        "count",
        performanceMetricState(resources.requests, {
          warnMax: 150,
          max: 300,
        }),
        capturedAt,
      ),
      sample(
        "responsiveness.longTaskCount",
        longTasks.length,
        "count",
        performanceMetricState(longTasks.length, { warnMax: 5, max: 15 }),
        capturedAt,
      ),
      sample(
        "responsiveness.longTaskTotalMs",
        longTaskTotal,
        "ms",
        performanceMetricState(longTaskTotal, {
          warnMax: 1000,
          max: 3000,
        }),
        capturedAt,
      ),
      sample(
        "webVitals.lcpMs",
        webVitals.lcpMs,
        "ms",
        webVitals.lcpMs == null
          ? "pending"
          : performanceMetricState(webVitals.lcpMs, {
              warnMax: 2500,
              max: 4000,
            }),
        capturedAt,
      ),
      sample(
        "webVitals.cls",
        webVitals.cls,
        "count",
        performanceMetricState(webVitals.cls, {
          warnMax: 0.1,
          max: 0.25,
        }),
        capturedAt,
      ),
      sample(
        "webVitals.inpMs",
        webVitals.inpMs,
        "ms",
        webVitals.inpMs == null
          ? "pending"
          : performanceMetricState(webVitals.inpMs, {
              warnMax: 200,
              max: 500,
            }),
        capturedAt,
      ),
      sample(
        "motion.averageFps",
        averageFps,
        "fps",
        averageFps == null
          ? "pending"
          : performanceMetricState(averageFps, {
              min: 15,
              warnMin: 30,
            }),
        capturedAt,
      ),
      sample(
        "motion.p95FrameMs",
        p95FrameMs,
        "ms",
        p95FrameMs == null
          ? "pending"
          : performanceMetricState(p95FrameMs, {
              warnMax: 33.4,
              max: 66.7,
            }),
        capturedAt,
      ),
      sample(
        "memory.usedJsHeapBytes",
        Number.isFinite(usedHeap) ? usedHeap : null,
        "bytes",
        Number.isFinite(usedHeap)
          ? performanceMetricState(usedHeap, {
              warnMax: 500 * 1024 * 1024,
              max: 800 * 1024 * 1024,
            })
          : "unsupported",
        capturedAt,
      ),
      sample(
        "map.activePoiLayers",
        Number(body.poiActiveLayerCount || 0),
        "count",
        performanceMetricState(Number(body.poiActiveLayerCount || 0), {
          warnMax: 20,
          max: 50,
        }),
        capturedAt,
      ),
      sample(
        "map.configuredPoiLayers",
        Number(body.poiConfiguredLayerCount || 0),
        "count",
        performanceMetricState(Number(body.poiConfiguredLayerCount || 0), {
          warnMax: 50,
          max: 100,
        }),
        capturedAt,
      ),
      sample(
        "map.loadedTiles",
        Number(body.poiTileLoadCount || 0) + Number(body.tileLoadCount || 0),
        "count",
        "healthy",
        capturedAt,
      ),
    ];
    const result = {
      schemaVersion: SNAPSHOT_VERSION,
      capturedAt,
      visibility: documentRef?.hidden ? "background" : "foreground",
      reducedMotion: Boolean(
        windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
      ),
      capabilities: {
        heap: Number.isFinite(usedHeap),
        longTasks: longTaskSupported,
        resourceTiming: typeof performanceRef?.getEntriesByType === "function",
      },
      samples,
      resources,
      budgets: samples.map(({ metric, state }) => ({ metric, state })),
    };
    if (
      new TextEncoder().encode(JSON.stringify(result)).length >=
      MAX_SNAPSHOT_BYTES
    )
      result.resources.largest = result.resources.largest.slice(0, 3);
    return result;
  };

  const downloadSnapshot = () => {
    const blob = new Blob([`${JSON.stringify(snapshot(), null, 2)}\n`], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = documentRef.createElement("a");
    anchor.href = href;
    anchor.download = `amble-performance-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const view = createPerformanceDiagnosticsView({
    document: documentRef,
    onClose: () => destroy(),
    onExport: downloadSnapshot,
  });
  const render = () => view.render(snapshot());

  const onVisibilityChange = () => {
    if (documentRef.hidden) stopMotion();
    render();
  };
  const onPageHide = () => destroy();

  const start = () => {
    if (started || destroyed) return;
    started = true;
    longTaskSupported = observe("longtask", (entries) => {
      longTasks.push(...entries.map(({ duration }) => duration));
    });
    observe("paint", (entries) => {
      for (const entry of entries) paints[entry.name] = entry.startTime;
    });
    observe("largest-contentful-paint", (entries) => {
      const entry = entries.at(-1);
      if (entry) webVitals.lcpMs = entry.startTime;
    });
    observe("layout-shift", (entries) => {
      for (const entry of entries)
        if (!entry.hadRecentInput) webVitals.cls += entry.value;
    });
    observe("event", (entries) => {
      for (const entry of entries)
        webVitals.inpMs = Math.max(webVitals.inpMs ?? 0, entry.duration);
    });
    documentRef?.addEventListener?.("visibilitychange", onVisibilityChange);
    windowRef?.addEventListener?.("pagehide", onPageHide);
    if (autoMount) view.mount();
    if (options.map) attachMap(options.map);
    intervalId = interval(render, 1000);
    render();
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    started = false;
    detachMap();
    for (const observer of observers) observer.disconnect();
    observers.length = 0;
    if (intervalId != null) clear(intervalId);
    intervalId = null;
    documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange);
    windowRef?.removeEventListener?.("pagehide", onPageHide);
    view.remove();
  };

  return {
    attachMap,
    destroy,
    downloadSnapshot,
    snapshot,
    start,
    debugState: () => ({
      active: started && !destroyed,
      observers: observers.length,
      timer: intervalId != null,
      motionFrame: motionFrame != null,
    }),
  };
}
