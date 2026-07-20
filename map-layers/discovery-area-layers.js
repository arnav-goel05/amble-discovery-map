export const DISCOVERY_AREA_SOURCE_ID = "discovery-areas";
export const DISCOVERY_AREA_LAYER_IDS = Object.freeze([
  "discovery-areas-fill",
  "discovery-areas-outline",
  "discovery-areas-label",
]);

const emptyCollection = () => ({ type: "FeatureCollection", features: [] });
const clone = (value) => structuredClone(value);

function geometryBounds(geometry) {
  const points = [];
  const visit = (value) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      value.every((item) => typeof item === "number")
    )
      points.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  if (!points.length) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export function createDiscoveryAreaLayerManager({
  map,
  featureCollection,
  beforeLayerId,
  reducedMotion = false,
} = {}) {
  if (!map || featureCollection?.type !== "FeatureCollection")
    throw new TypeError(
      "A map and discovery area FeatureCollection are required",
    );
  const featureById = new Map(
    featureCollection.features.map((feature) => [
      feature.properties?.areaId,
      clone(feature),
    ]),
  );
  let currentAreas = [];
  let selectedAreaId = null;
  let started = false;

  const rendered = () => ({
    type: "FeatureCollection",
    features: currentAreas.flatMap((area) => {
      const feature = featureById.get(area.areaId);
      if (!feature) return [];
      return [
        {
          ...clone(feature),
          properties: {
            ...clone(feature.properties),
            rank: area.rank,
            confidence: area.confidence,
            confidenceState: area.confidence >= 0.7 ? "high" : "uncertain",
            selected: area.areaId === selectedAreaId,
            candidateCount: area.candidateIds?.length ?? 0,
          },
        },
      ];
    }),
  });
  const write = () =>
    map.getSource(DISCOVERY_AREA_SOURCE_ID)?.setData(rendered());

  const layers = [
    {
      id: DISCOVERY_AREA_LAYER_IDS[0],
      type: "fill",
      source: DISCOVERY_AREA_SOURCE_ID,
      paint: {
        "fill-color": [
          "case",
          ["get", "selected"],
          "#e36b3d",
          ["==", ["get", "confidenceState"], "high"],
          "#2c8f73",
          "#d8a83e",
        ],
        "fill-opacity": [
          "case",
          ["get", "selected"],
          0.48,
          ["interpolate", ["linear"], ["get", "confidence"], 0, 0.14, 1, 0.34],
        ],
      },
    },
    {
      id: DISCOVERY_AREA_LAYER_IDS[1],
      type: "line",
      source: DISCOVERY_AREA_SOURCE_ID,
      paint: {
        "line-color": [
          "case",
          ["get", "selected"],
          "#9d321b",
          ["==", ["get", "confidenceState"], "high"],
          "#17644f",
          "#8b6b1c",
        ],
        "line-width": [
          "case",
          ["get", "selected"],
          4,
          ["interpolate", ["linear"], ["get", "confidence"], 0, 1, 1, 2.5],
        ],
      },
    },
    {
      id: DISCOVERY_AREA_LAYER_IDS[2],
      type: "symbol",
      source: DISCOVERY_AREA_SOURCE_ID,
      layout: {
        "text-field": ["get", "areaName"],
        "text-size": 13,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#173c32",
        "text-halo-color": "#fffdf7",
        "text-halo-width": 1.5,
      },
    },
  ];

  return Object.freeze({
    start() {
      if (started) return false;
      if (!map.getSource(DISCOVERY_AREA_SOURCE_ID))
        map.addSource(DISCOVERY_AREA_SOURCE_ID, {
          type: "geojson",
          data: emptyCollection(),
        });
      for (const layer of layers) {
        if (!map.getLayer(layer.id)) map.addLayer(layer, beforeLayerId);
        map.setLayerZoomRange(layer.id, 7, 14.5);
      }
      started = true;
      if (globalThis.document?.body)
        document.body.dataset.discoveryAreaLayerCount = String(
          DISCOVERY_AREA_LAYER_IDS.length,
        );
      return true;
    },
    reconcile({ areas = [] } = {}) {
      const previousIds = new Set(currentAreas.map(({ areaId }) => areaId));
      const nextIds = new Set(areas.map(({ areaId }) => areaId));
      const removedAreaIds = [...previousIds]
        .filter((id) => !nextIds.has(id))
        .sort();
      const selectionCleared =
        selectedAreaId !== null && !nextIds.has(selectedAreaId);
      if (selectionCleared) selectedAreaId = null;
      currentAreas = areas
        .filter(({ areaId }) => featureById.has(areaId))
        .map(clone);
      write();
      if (globalThis.document?.body)
        document.body.dataset.discoveryAreaRenderedCount = String(
          currentAreas.length,
        );
      return { removedAreaIds, selectionCleared };
    },
    setSelectedArea(areaId) {
      if (!currentAreas.some((area) => area.areaId === areaId)) return false;
      selectedAreaId = areaId;
      write();
      return true;
    },
    focusArea(areaId) {
      if (!currentAreas.some((area) => area.areaId === areaId)) return false;
      const bounds = geometryBounds(featureById.get(areaId).geometry);
      if (!bounds) return false;
      map.fitBounds(bounds, {
        padding: 64,
        maxZoom: 13,
        duration: reducedMotion ? 0 : 700,
      });
      return true;
    },
    destroy() {
      // MapLibre emits `remove` after it has discarded its style. Cleanup is
      // therefore best-effort when this manager is finalized from that event.
      try {
        for (const id of [...DISCOVERY_AREA_LAYER_IDS].reverse())
          if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(DISCOVERY_AREA_SOURCE_ID))
          map.removeSource(DISCOVERY_AREA_SOURCE_ID);
      } catch {
        // The map has already removed the owned layers and source with its style.
      }
      currentAreas = [];
      selectedAreaId = null;
      started = false;
    },
  });
}
