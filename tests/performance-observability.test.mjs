import assert from "node:assert/strict";
import test from "node:test";

import {
  createPerformanceDiagnostics,
  sanitizePerformanceResourcePath,
} from "../activity-scenes/performance-diagnostics.js";

function diagnosticsFixture({ heap = true, hidden = false } = {}) {
  const observers = [];
  const listeners = new Map();
  const mapListeners = new Map();
  const timers = new Set();
  const frames = new Set();
  let now = 100;
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const body = {
    dataset: {
      mapInitialized: "true",
      poiActiveLayerCount: "2",
      poiConfiguredLayerCount: "123",
      poiTileLoadCount: "31",
      tileLoadCount: "4",
      snapshotId: "private-snapshot-id",
      selectedDiscoveryArea: "secret-area",
    },
    append() {},
  };
  const document = {
    body,
    hidden,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    createElement() {
      return {
        className: "",
        dataset: {},
        hidden: false,
        innerHTML: "",
        remove() {
          this.removed = true;
        },
        addEventListener() {},
        querySelector() {
          return null;
        },
        setAttribute() {},
      };
    },
  };
  const performance = {
    memory: heap
      ? { usedJSHeapSize: 200, totalJSHeapSize: 300, jsHeapSizeLimit: 1000 }
      : undefined,
    now: () => now,
    getEntriesByType(type) {
      if (type === "resource")
        return [
          {
            name: "https://example.com/private.js?token=secret#fragment",
            initiatorType: "script",
            transferSize: 50,
            encodedBodySize: 40,
          },
        ];
      if (type === "navigation")
        return [
          {
            domInteractive: 20,
            domContentLoadedEventEnd: 25,
            loadEventEnd: 30,
          },
        ];
      return [];
    },
  };
  const window = {
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    matchMedia: () => ({ matches: false }),
  };
  const map = {
    on(type, callback) {
      mapListeners.set(type, callback);
    },
    off(type) {
      mapListeners.delete(type);
    },
  };
  const diagnostics = createPerformanceDiagnostics({
    PerformanceObserver: FakeObserver,
    autoMount: false,
    clearInterval(id) {
      timers.delete(id);
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    document,
    map,
    now: () => new Date("2026-07-23T00:00:00.000Z"),
    performance,
    requestAnimationFrame(callback) {
      const id = frames.size + 1;
      frames.add(id);
      return id;
    },
    setInterval(callback) {
      timers.add(callback);
      return callback;
    },
    window,
  });
  return {
    body,
    diagnostics,
    frames,
    listeners,
    mapListeners,
    observers,
    setNow(value) {
      now = value;
    },
    timers,
  };
}

test("constructing diagnostics is inert until explicitly started", () => {
  const fixture = diagnosticsFixture();
  assert.equal(fixture.observers.length, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.frames.size, 0);
});

test("start is idempotent and destroy releases every owned resource", () => {
  const fixture = diagnosticsFixture();
  fixture.diagnostics.start();
  fixture.diagnostics.start();
  assert.ok(fixture.observers.length > 0);
  assert.equal(fixture.timers.size, 1);
  assert.ok(fixture.mapListeners.has("movestart"));
  fixture.mapListeners.get("movestart")();
  assert.equal(fixture.frames.size, 1);
  fixture.diagnostics.destroy();
  assert.equal(
    fixture.observers.every((observer) => observer.disconnected),
    true,
  );
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.mapListeners.size, 0);
  assert.equal(fixture.listeners.size, 0);
});

test("unsupported heap is explicit rather than zero", () => {
  const fixture = diagnosticsFixture({ heap: false });
  fixture.diagnostics.start();
  const heap = fixture.diagnostics
    .snapshot()
    .samples.find((sample) => sample.metric === "memory.usedJsHeapBytes");
  assert.equal(heap.value, null);
  assert.equal(heap.state, "unsupported");
});

test("background visibility is labelled and suppresses motion sampling", () => {
  const fixture = diagnosticsFixture({ hidden: true });
  fixture.diagnostics.start();
  fixture.mapListeners.get("movestart")();
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.diagnostics.snapshot().visibility, "background");
});

test("snapshot is bounded and excludes application state and URL secrets", () => {
  const fixture = diagnosticsFixture();
  fixture.diagnostics.start();
  const snapshot = fixture.diagnostics.snapshot();
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.schemaVersion, "1.0");
  assert.ok(Buffer.byteLength(serialized) < 100 * 1024);
  for (const forbidden of [
    "private-snapshot-id",
    "secret-area",
    "token=secret",
    "example.com",
    "#fragment",
  ])
    assert.equal(serialized.includes(forbidden), false);
  assert.match(serialized, /private\.js/);
  assert.deepEqual(snapshot.resources.first, {
    bytes: 50,
    group: "scripts",
    path: "/private.js",
    startTime: null,
  });
  assert.equal(
    snapshot.samples.every(
      (sample) =>
        typeof sample.unit === "string" &&
        typeof sample.freshnessMs === "number" &&
        typeof sample.state === "string",
    ),
    true,
  );
});

test("startup milestones retain their first observed navigation-relative time", () => {
  const fixture = diagnosticsFixture();
  fixture.diagnostics.start();
  let snapshot = fixture.diagnostics.snapshot();
  assert.equal(
    snapshot.samples.find(({ metric }) => metric === "startup.mapInitializedMs")
      .value,
    100,
  );
  assert.equal(
    snapshot.samples.find(
      ({ metric }) => metric === "startup.overlayLayersLoadedMs",
    ).state,
    "pending",
  );
  fixture.setNow(250);
  fixture.body.dataset.overlayLayersLoaded = "true";
  snapshot = fixture.diagnostics.snapshot();
  assert.equal(
    snapshot.samples.find(
      ({ metric }) => metric === "startup.overlayLayersLoadedMs",
    ).value,
    250,
  );
  fixture.setNow(400);
  assert.equal(
    fixture.diagnostics
      .snapshot()
      .samples.find(({ metric }) => metric === "startup.overlayLayersLoadedMs")
      .value,
    250,
  );
});

test("first-contentful paint is exposed after the paint observer reports it", () => {
  const fixture = diagnosticsFixture();
  fixture.diagnostics.start();
  fixture.observers[1].callback({
    getEntries: () => [{ name: "first-contentful-paint", startTime: 42 }],
  });
  const metric = fixture.diagnostics
    .snapshot()
    .samples.find(
      ({ metric: name }) => name === "paint.firstContentfulPaintMs",
    );
  assert.equal(metric.value, 42);
  assert.equal(metric.state, "healthy");
});

test("resource paths remove origin, query, fragment, and credentials", () => {
  assert.equal(
    sanitizePerformanceResourcePath(
      "https://user:pass@example.com/assets/app.js?token=secret#hash",
    ),
    "/assets/app.js",
  );
  assert.equal(
    sanitizePerformanceResourcePath(
      "https://example.com/api/snapshot/assets/20260722T174727255Z-source-retirement/events.json",
    ),
    "/api/snapshot/assets/:snapshot/events.json",
  );
  assert.equal(
    sanitizePerformanceResourcePath(
      "https://example.com/poi-tiles/private-venue-name/6_1-secret123.b3dm",
    ),
    "/poi-tiles/:poi/6_1-:hash.b3dm",
  );
});
