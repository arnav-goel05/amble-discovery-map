import assert from "node:assert/strict";
import test from "node:test";

import { createContextCoordinator } from "../activity-scenes/assistant/context-coordinator.js";
import {
  MapConnectorError,
  createMapConnector,
} from "../activity-scenes/assistant/connectors/map-connector.js";

function mapFixture() {
  const state = {
    center: [103.85, 1.29],
    zoom: 12,
    pitch: 20,
    bearing: -15,
  };
  const listeners = new Map();
  const calls = [];
  const emit = (name) => {
    for (const listener of listeners.get(name) || []) listener();
  };
  return {
    calls,
    getCenter: () => ({ lng: state.center[0], lat: state.center[1] }),
    getZoom: () => state.zoom,
    getPitch: () => state.pitch,
    getBearing: () => state.bearing,
    zoomIn(options) {
      calls.push(["zoomIn", options]);
      state.zoom += 1;
      emit("moveend");
    },
    zoomOut(options) {
      calls.push(["zoomOut", options]);
      state.zoom -= 1;
      emit("moveend");
    },
    panBy(offset, options) {
      calls.push(["panBy", offset, options]);
      state.center = [
        state.center[0] + offset[0] / 10_000,
        state.center[1] - offset[1] / 10_000,
      ];
      emit("moveend");
    },
    easeTo(options) {
      calls.push(["easeTo", options]);
      if (options.center) state.center = [...options.center];
      for (const field of ["zoom", "pitch", "bearing"])
        if (options[field] !== undefined) state[field] = options[field];
      emit("moveend");
    },
    on(name, listener) {
      const registered = listeners.get(name) || new Set();
      registered.add(listener);
      listeners.set(name, registered);
    },
    off(name, listener) {
      listeners.get(name)?.delete(listener);
    },
  };
}

function layerOwner(initial = false) {
  let visible = initial;
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    snapshot: () => ({ visible }),
    setVisible(next) {
      calls.push(next);
      const changed = visible !== next;
      visible = next;
      if (changed) for (const listener of listeners) listener({ visible });
      return changed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function transitOwner() {
  const visibility = { mrtStations: true, mrtLines: false };
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    snapshot: () => ({
      visibility: { ...visibility },
      constraintActive: true,
    }),
    setLayerVisibility(layer, visible) {
      calls.push([layer, visible]);
      const changed = visibility[layer] !== visible;
      visibility[layer] = visible;
      if (changed)
        for (const listener of listeners)
          listener({
            visibility: { ...visibility },
            constraintActive: true,
          });
      return changed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function connectorFixture() {
  const map = mapFixture();
  const recommendations = layerOwner(true);
  const location = layerOwner(false);
  const transit = transitOwner();
  let focusedTargetId = null;
  const visibleTargets = [
    { targetId: "event:night-walk", type: "event", label: "Night walk" },
  ];
  const connector = createMapConnector({
    map,
    recommendationLayers: recommendations,
    locationLayers: location,
    transitLayers: transit,
    getVisibleTargets: () => visibleTargets,
    getFocusedTargetId: () => focusedTargetId,
    focusTarget(targetId) {
      focusedTargetId = targetId;
      return true;
    },
  });
  return {
    connector,
    map,
    recommendations,
    location,
    transit,
  };
}

test("map snapshot is bounded and subscribable without exposing arbitrary targets", () => {
  const { connector } = connectorFixture();
  const changes = [];
  const unsubscribe = connector.subscribe((snapshot) => changes.push(snapshot));

  const snapshot = connector.snapshot();
  assert.equal(connector.connectorId, "map");
  assert.equal(connector.availability(), "available");
  assert.deepEqual(snapshot.viewport, {
    center: [103.85, 1.29],
    zoom: 12,
    pitch: 20,
    bearing: -15,
  });
  assert.deepEqual(snapshot.visibleLayers, {
    recommendations: true,
    location: false,
    mrtStations: true,
    mrtLines: false,
  });
  assert.equal(snapshot.transit.constraintActive, true);
  assert.equal(unsubscribe(), true);
  assert.deepEqual(changes, []);
});

test("camera commands delegate to the map and return observable viewport outcomes", async () => {
  const { connector, map } = connectorFixture();

  const zoomed = await connector.execute("map.zoomin", {});
  assert.equal(zoomed.changed, true);
  assert.equal(zoomed.data.viewport.zoom, 13);
  assert.deepEqual(map.calls[0], ["zoomIn", { duration: 300 }]);

  const panned = await connector.execute("map.pan", {
    direction: "right",
    amount: 2,
  });
  assert.deepEqual(map.calls[1], ["panBy", [192, 0], { duration: 300 }]);
  assert.notDeepEqual(panned.data.viewport.center, zoomed.data.viewport.center);

  const rotated = await connector.execute("map.rotate", { bearing: 25 });
  assert.equal(rotated.data.viewport.bearing, 25);
});

test("reset and stable target focus use shared owners and observable context patches", async () => {
  const { connector, map } = connectorFixture();

  const focused = await connector.execute("map.focustarget", {
    targetId: "event:night-walk",
  });
  assert.deepEqual(focused.affectedTargetIds, ["event:night-walk"]);
  assert.equal(focused.contextPatch.focusedTargetId, "event:night-walk");
  assert.deepEqual(focused.contextPatch.selectedTargetIds, [
    "event:night-walk",
  ]);

  await assert.rejects(
    connector.execute("map.focustarget", {
      targetId: "event:not-visible",
    }),
    (error) =>
      error instanceof MapConnectorError &&
      error.code === "map_target_unavailable",
  );

  const reset = await connector.execute("map.resetview", {});
  assert.deepEqual(reset.data.viewport, {
    center: [103.857897, 1.285844],
    zoom: 15.3,
    pitch: 45,
    bearing: -30,
  });
  assert.equal(map.calls.at(-1)[0], "easeTo");
});

test("named layers delegate both show and hide to their authoritative owners", async () => {
  const { connector, recommendations, location, transit } = connectorFixture();

  const shown = await connector.execute("map.setlayervisibility", {
    layer: "location",
    visible: true,
  });
  const hidden = await connector.execute("map.setlayervisibility", {
    layer: "location",
    visible: false,
  });
  await connector.execute("map.setlayervisibility", {
    layer: "mrtStations",
    visible: false,
  });
  await connector.execute("map.setlayervisibility", {
    layer: "mrtLines",
    visible: true,
  });
  await connector.execute("map.setlayervisibility", {
    layer: "recommendations",
    visible: false,
  });

  assert.deepEqual(location.calls, [true, false]);
  assert.deepEqual(transit.calls, [
    ["mrtStations", false],
    ["mrtLines", true],
  ]);
  assert.deepEqual(recommendations.calls, [false]);
  assert.equal(shown.data.visibleLayers.location, true);
  assert.equal(hidden.data.visibleLayers.location, false);
  assert.equal(hidden.data.transit.constraintActive, true);
});

test("observable map changes publish a newer canonical context revision", async () => {
  const { connector } = connectorFixture();
  const coordinator = createContextCoordinator({ connectors: [connector] });
  const initial = await coordinator.start();

  await connector.execute("map.zoomout", {});
  const published = await coordinator.waitForPublication(initial.revision + 1);

  assert.equal(published.revision, initial.revision + 1);
  assert.equal(published.viewport.zoom, initial.viewport.zoom - 1);
  coordinator.destroy();
});

test("unknown layers and unavailable map owners fail closed", async () => {
  const { connector } = connectorFixture();
  await assert.rejects(
    connector.execute("map.setlayervisibility", {
      layer: "private",
      visible: true,
    }),
    (error) =>
      error instanceof MapConnectorError &&
      error.code === "map_layer_unavailable",
  );
  assert.throws(
    () => createMapConnector(),
    (error) =>
      error instanceof MapConnectorError && error.code === "map_owner_invalid",
  );
});
