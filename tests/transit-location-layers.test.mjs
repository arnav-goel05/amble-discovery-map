import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocationContextLayerManager,
  LOCATION_CONTEXT_LAYER_IDS,
  LOCATION_CONTEXT_SOURCE_ID,
} from "../map-layers/location-context-layers.js";
import {
  createTransitContextLayerManager,
  MRT_LINE_COLOURS,
  TRANSIT_CONTEXT_LAYER_IDS,
  TRANSIT_CONTEXT_SOURCE_ID,
} from "../map-layers/transit-context-layers.js";

class Source {
  constructor(data) {
    this.data = structuredClone(data);
  }
  setData(data) {
    this.data = structuredClone(data);
  }
}

class MapFixture {
  constructor() {
    this.sources = new Map();
    this.layers = new Map([["buildings-3d", { id: "buildings-3d" }]]);
    this.order = ["buildings-3d"];
    this.zoomRanges = new Map();
    this.focus = [];
  }
  getSource(id) {
    return this.sources.get(id);
  }
  addSource(id, definition) {
    this.sources.set(id, new Source(definition.data));
  }
  removeSource(id) {
    this.sources.delete(id);
  }
  getLayer(id) {
    return this.layers.get(id);
  }
  addLayer(layer, beforeId) {
    this.layers.set(layer.id, structuredClone(layer));
    const index = this.order.indexOf(beforeId);
    this.order.splice(index < 0 ? this.order.length : index, 0, layer.id);
  }
  removeLayer(id) {
    this.layers.delete(id);
    this.order = this.order.filter((item) => item !== id);
  }
  setLayerZoomRange(id, minimum, maximum) {
    this.zoomRanges.set(id, [minimum, maximum]);
  }
  setLayoutProperty(id, property, value) {
    this.layers.get(id).layout ||= {};
    this.layers.get(id).layout[property] = value;
  }
  easeTo(options) {
    this.focus.push(structuredClone(options));
  }
  getZoom() {
    return 11;
  }
}

const transitAsset = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        featureClass: "rail_line",
        railLineId: "rail-line:cc",
        railLineCode: "CC",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [103.84, 1.29],
          [103.86, 1.3],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        featureClass: "station",
        stationId: "mrt-station:city-hall",
        stationName: "City Hall",
      },
      geometry: { type: "Point", coordinates: [103.851, 1.293] },
    },
  ],
};

test("location point and accuracy have stable identities and remain separate from transit and 3D layers", () => {
  const map = new MapFixture();
  const manager = createLocationContextLayerManager({
    map,
    beforeLayerId: "buildings-3d",
  });
  assert.equal(manager.start(), true);
  assert.deepEqual(map.order, [...LOCATION_CONTEXT_LAYER_IDS, "buildings-3d"]);
  manager.reconcile({
    permission: "granted",
    status: "fresh",
    coordinates: [103.851, 1.293],
    accuracyMeters: 30,
  });
  const source = map.getSource(LOCATION_CONTEXT_SOURCE_ID);
  assert.deepEqual(
    source.data.features.map(({ properties }) => properties.presentation),
    ["accuracy", "point"],
  );
  assert.equal(
    source.data.features[0].properties.featureClass,
    "user_location",
  );
  assert.notEqual(LOCATION_CONTEXT_SOURCE_ID, TRANSIT_CONTEXT_SOURCE_ID);
  assert.equal(map.getLayer("buildings-3d").id, "buildings-3d");
  assert.equal(manager.focusLocation(), true);
  assert.deepEqual(map.focus[0].center, [103.851, 1.293]);
});

test("stale location is explicit while denied and unavailable states remove precise geometry", () => {
  const map = new MapFixture();
  const manager = createLocationContextLayerManager({ map });
  manager.start();
  manager.reconcile({
    permission: "granted",
    status: "stale",
    coordinates: [103.851, 1.293],
    accuracyMeters: 200,
  });
  assert.ok(
    map
      .getSource(LOCATION_CONTEXT_SOURCE_ID)
      .data.features.every(({ properties }) => properties.stale),
  );
  manager.reconcile({
    permission: "denied",
    status: "error",
    coordinates: null,
  });
  assert.equal(
    map.getSource(LOCATION_CONTEXT_SOURCE_ID).data.features.length,
    0,
  );
  assert.equal(manager.focusLocation(), false);
  manager.reconcile({
    permission: "unavailable",
    status: "error",
    coordinates: null,
  });
  assert.equal(
    map.getSource(LOCATION_CONTEXT_SOURCE_ID).data.features.length,
    0,
  );
});

test("MRT lines, stations, and labels use a subordinate zoom hierarchy with isolated selection", () => {
  const map = new MapFixture();
  const manager = createTransitContextLayerManager({
    map,
    featureCollection: transitAsset,
    beforeLayerId: "buildings-3d",
  });
  manager.start();
  assert.deepEqual(map.order, [...TRANSIT_CONTEXT_LAYER_IDS, "buildings-3d"]);
  assert.deepEqual(map.zoomRanges.get("mrt-lines-context"), [7, 24]);
  assert.deepEqual(map.zoomRanges.get("mrt-stations-context"), [7, 24]);
  assert.deepEqual(map.zoomRanges.get("mrt-station-labels-context"), [12, 24]);
  const lineColour = map.getLayer("mrt-lines-context").paint["line-color"];
  assert.equal(lineColour[0], "match");
  assert.ok(lineColour.includes(MRT_LINE_COLOURS.CC));
  assert.equal(new Set(Object.values(MRT_LINE_COLOURS)).size, 10);
  const stationPaint = map.getLayer("mrt-stations-context").paint;
  assert.deepEqual(stationPaint["circle-radius"].slice(0, 3), [
    "interpolate",
    ["linear"],
    ["zoom"],
  ]);
  assert.deepEqual(stationPaint["circle-stroke-width"].slice(0, 3), [
    "interpolate",
    ["linear"],
    ["zoom"],
  ]);
  assert.equal(manager.selectStation("mrt-station:city-hall"), true);
  const station = map
    .getSource(TRANSIT_CONTEXT_SOURCE_ID)
    .data.features.find(
      ({ properties }) => properties.featureClass === "station",
    );
  assert.equal(station.properties.selected, true);
  assert.equal(manager.focusStation("mrt-station:city-hall"), true);
  assert.equal(manager.selectStation("unknown"), false);
});

test("transit visibility is presentation-only and cannot mutate recommendation ranking", () => {
  const ranked = Object.freeze([
    Object.freeze({ candidateId: "a", rank: 1 }),
    Object.freeze({ candidateId: "b", rank: 2 }),
  ]);
  const before = structuredClone(ranked);
  const map = new MapFixture();
  const manager = createTransitContextLayerManager({
    map,
    featureCollection: transitAsset,
  });
  manager.start();
  manager.setVisible(false);
  for (const id of TRANSIT_CONTEXT_LAYER_IDS)
    assert.equal(map.getLayer(id).layout.visibility, "none");
  manager.setVisible(true);
  assert.deepEqual(ranked, before);
  assert.equal(manager.focusStation("mrt-station:city-hall"), true);
  assert.deepEqual(ranked, before);
});

test("destroying context managers preserves the independent 3D lifecycle", () => {
  const map = new MapFixture();
  const transit = createTransitContextLayerManager({
    map,
    featureCollection: transitAsset,
    beforeLayerId: "buildings-3d",
  });
  const location = createLocationContextLayerManager({
    map,
    beforeLayerId: "buildings-3d",
  });
  transit.start();
  location.start();
  location.destroy();
  transit.destroy();
  assert.deepEqual(map.order, ["buildings-3d"]);
  assert.equal(map.getLayer("buildings-3d").id, "buildings-3d");
});
