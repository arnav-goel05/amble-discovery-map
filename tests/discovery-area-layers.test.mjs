import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_AREA_LAYER_IDS,
  DISCOVERY_AREA_SOURCE_ID,
  createDiscoveryAreaLayerManager,
} from "../map-layers/discovery-area-layers.js";

const asset = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        areaId: "ura-subzone:city-hall",
        areaName: "City Hall",
        planningAreaName: "Downtown Core",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [103.849, 1.288],
            [103.857, 1.288],
            [103.857, 1.294],
            [103.849, 1.294],
            [103.849, 1.288],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        areaId: "ura-subzone:marina-south",
        areaName: "Marina South",
        planningAreaName: "Marina South",
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [
                [103.858, 1.276],
                [103.872, 1.276],
                [103.872, 1.286],
                [103.858, 1.286],
                [103.858, 1.276],
              ],
            ],
          ],
        ],
      },
    },
  ],
};

const suggestions = [
  {
    areaId: "ura-subzone:marina-south",
    rank: 1,
    confidence: 0.92,
    candidateIds: ["candidate:walk"],
  },
  {
    areaId: "ura-subzone:city-hall",
    rank: 2,
    confidence: 0.42,
    candidateIds: ["candidate:gallery"],
  },
];

class FakeGeoJsonSource {
  constructor(data) {
    this.data = structuredClone(data);
    this.writes = 0;
  }

  setData(data) {
    this.data = structuredClone(data);
    this.writes += 1;
  }
}

class FakeMap {
  constructor() {
    this.sources = new Map();
    this.layers = new Map([
      ["buildings-3d", { id: "buildings-3d", type: "custom" }],
      ["event-venues-3d", { id: "event-venues-3d", type: "custom" }],
    ]);
    this.layerOrder = ["buildings-3d", "event-venues-3d"];
    this.zoomRanges = new Map();
    this.operations = [];
    this.focusCalls = [];
  }

  getStyle() {
    return { layers: this.layerOrder.map((id) => this.layers.get(id)) };
  }

  getSource(id) {
    return this.sources.get(id);
  }

  addSource(id, definition) {
    assert.equal(this.sources.has(id), false);
    this.sources.set(id, new FakeGeoJsonSource(definition.data));
    this.operations.push(["addSource", id]);
  }

  removeSource(id) {
    this.sources.delete(id);
    this.operations.push(["removeSource", id]);
  }

  getLayer(id) {
    return this.layers.get(id);
  }

  addLayer(layer, beforeId) {
    assert.equal(this.layers.has(layer.id), false);
    this.layers.set(layer.id, structuredClone(layer));
    const index = beforeId ? this.layerOrder.indexOf(beforeId) : -1;
    if (index >= 0) this.layerOrder.splice(index, 0, layer.id);
    else this.layerOrder.push(layer.id);
    this.operations.push(["addLayer", layer.id, beforeId ?? null]);
  }

  removeLayer(id) {
    assert.equal(["buildings-3d", "event-venues-3d"].includes(id), false);
    this.layers.delete(id);
    this.layerOrder = this.layerOrder.filter((layerId) => layerId !== id);
    this.operations.push(["removeLayer", id]);
  }

  setLayerZoomRange(id, minZoom, maxZoom) {
    assert.equal(["buildings-3d", "event-venues-3d"].includes(id), false);
    this.zoomRanges.set(id, [minZoom, maxZoom]);
    this.operations.push(["setLayerZoomRange", id, minZoom, maxZoom]);
  }

  setFilter(id, filter) {
    assert.equal(["buildings-3d", "event-venues-3d"].includes(id), false);
    this.layers.get(id).filter = structuredClone(filter);
    this.operations.push(["setFilter", id]);
  }

  setPaintProperty(id, property, value) {
    assert.equal(["buildings-3d", "event-venues-3d"].includes(id), false);
    this.layers.get(id).paint[property] = structuredClone(value);
    this.operations.push(["setPaintProperty", id, property]);
  }

  fitBounds(bounds, options) {
    this.focusCalls.push({
      bounds: structuredClone(bounds),
      options: { ...options },
    });
  }
}

function createManager({ reducedMotion = false } = {}) {
  const map = new FakeMap();
  const manager = createDiscoveryAreaLayerManager({
    map,
    featureCollection: asset,
    beforeLayerId: "buildings-3d",
    reducedMotion,
  });
  return { map, manager };
}

test("area layers start in stable visual order before the 3D building layers", () => {
  const { map, manager } = createManager();
  assert.equal(manager.start(), true);

  assert.equal(DISCOVERY_AREA_SOURCE_ID, "discovery-areas");
  assert.deepEqual(DISCOVERY_AREA_LAYER_IDS, [
    "discovery-areas-fill",
    "discovery-areas-outline",
    "discovery-areas-label",
  ]);
  assert.deepEqual(map.layerOrder, [
    ...DISCOVERY_AREA_LAYER_IDS,
    "buildings-3d",
    "event-venues-3d",
  ]);
  for (const id of DISCOVERY_AREA_LAYER_IDS) {
    const [minZoom, maxZoom] = map.zoomRanges.get(id);
    assert.ok(minZoom <= 8, `${id} must be available at wide zoom`);
    assert.ok(
      maxZoom >= 12,
      `${id} must remain visible through area drill-down`,
    );
  }
});

test("recommended areas remain visible at wide zoom with confidence and selection styling", () => {
  const { map, manager } = createManager();
  manager.start();
  manager.reconcile({ areas: suggestions });

  const source = map.getSource(DISCOVERY_AREA_SOURCE_ID);
  assert.deepEqual(
    source.data.features.map(({ properties }) => ({
      areaId: properties.areaId,
      confidence: properties.confidence,
      confidenceState: properties.confidenceState,
      selected: properties.selected,
    })),
    [
      {
        areaId: "ura-subzone:marina-south",
        confidence: 0.92,
        confidenceState: "high",
        selected: false,
      },
      {
        areaId: "ura-subzone:city-hall",
        confidence: 0.42,
        confidenceState: "uncertain",
        selected: false,
      },
    ],
  );

  const fill = map.getLayer("discovery-areas-fill");
  const outline = map.getLayer("discovery-areas-outline");
  assert.match(JSON.stringify(fill.paint), /confidence|confidenceState/);
  assert.match(JSON.stringify(fill.paint), /selected/);
  assert.match(JSON.stringify(outline.paint), /confidence|confidenceState/);
  assert.equal(fill.layout?.visibility ?? "visible", "visible");
});

test("selection is exclusive and disappears when its area becomes stale", () => {
  const { map, manager } = createManager();
  manager.start();
  manager.reconcile({ areas: suggestions });

  assert.equal(manager.setSelectedArea("ura-subzone:city-hall"), true);
  assert.deepEqual(
    map
      .getSource(DISCOVERY_AREA_SOURCE_ID)
      .data.features.map(({ properties }) => [
        properties.areaId,
        properties.selected,
      ]),
    [
      ["ura-subzone:marina-south", false],
      ["ura-subzone:city-hall", true],
    ],
  );

  const result = manager.reconcile({ areas: [suggestions[0]] });
  assert.deepEqual(result.removedAreaIds, ["ura-subzone:city-hall"]);
  assert.equal(result.selectionCleared, true);
  assert.deepEqual(
    map
      .getSource(DISCOVERY_AREA_SOURCE_ID)
      .data.features.map(({ properties }) => properties.areaId),
    ["ura-subzone:marina-south"],
  );
  assert.equal(manager.setSelectedArea("ura-subzone:city-hall"), false);
});

test("area focus honors reduced motion", () => {
  const animated = createManager();
  animated.manager.start();
  animated.manager.reconcile({ areas: suggestions });
  assert.equal(animated.manager.focusArea("ura-subzone:marina-south"), true);
  assert.ok(animated.map.focusCalls[0].options.duration > 0);

  const reduced = createManager({ reducedMotion: true });
  reduced.manager.start();
  reduced.manager.reconcile({ areas: suggestions });
  assert.equal(reduced.manager.focusArea("ura-subzone:marina-south"), true);
  assert.equal(reduced.map.focusCalls[0].options.duration, 0);
  assert.equal(reduced.manager.focusArea("unknown-area"), false);
});

test("reconciliation and destruction never mutate the 3D building lifecycle", () => {
  const { map, manager } = createManager();
  const protectedBefore = structuredClone([
    map.getLayer("buildings-3d"),
    map.getLayer("event-venues-3d"),
  ]);

  manager.start();
  manager.reconcile({ areas: suggestions });
  manager.setSelectedArea("ura-subzone:marina-south");
  manager.destroy();

  assert.deepEqual(
    [map.getLayer("buildings-3d"), map.getLayer("event-venues-3d")],
    protectedBefore,
  );
  assert.deepEqual(map.layerOrder, ["buildings-3d", "event-venues-3d"]);
  assert.equal(map.getSource(DISCOVERY_AREA_SOURCE_ID), undefined);
  assert.equal(
    map.operations.some(
      ([operation, id]) =>
        [
          "removeLayer",
          "setFilter",
          "setPaintProperty",
          "setLayerZoomRange",
        ].includes(operation) &&
        ["buildings-3d", "event-venues-3d"].includes(id),
    ),
    false,
  );
});
