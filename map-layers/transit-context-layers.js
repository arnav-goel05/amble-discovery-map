export const TRANSIT_CONTEXT_SOURCE_ID = "singapore-transit-context";
export const TRANSIT_CONTEXT_LAYER_IDS = Object.freeze([
  "mrt-lines-context",
  "mrt-stations-context",
  "mrt-station-labels-context",
]);

const clone = (value) => structuredClone(value);

export const MRT_LINE_COLOURS = Object.freeze({
  NS: "#d42e12",
  EW: "#009645",
  NE: "#9900aa",
  CC: "#fa9e0d",
  DT: "#005ec4",
  TE: "#9d5b25",
  JR: "#0099aa",
  CR: "#97c616",
  LRT: "#748477",
  OTHER: "#7b6a92",
});

const railLineColourExpression = [
  "match",
  ["get", "railLineCode"],
  ...Object.entries(MRT_LINE_COLOURS).flatMap(([code, colour]) => [
    code,
    colour,
  ]),
  MRT_LINE_COLOURS.OTHER,
];

export function createTransitContextLayerManager({
  map,
  featureCollection,
  beforeLayerId,
  reducedMotion = false,
} = {}) {
  if (!map || featureCollection?.type !== "FeatureCollection") {
    throw new TypeError("A map and transit FeatureCollection are required");
  }
  const baseAsset = clone(featureCollection);
  const stations = new Map(
    baseAsset.features
      .filter(({ properties }) => properties?.featureClass === "station")
      .map((feature) => [feature.properties.stationId, feature]),
  );
  let selectedStationId = null;
  let visibility = { mrtStations: true, mrtLines: true };
  let started = false;
  const subscribers = new Set();

  const rendered = () => ({
    type: "FeatureCollection",
    features: baseAsset.features.map((feature) => ({
      ...clone(feature),
      properties: {
        ...clone(feature.properties),
        selected:
          feature.properties?.featureClass === "station" &&
          feature.properties.stationId === selectedStationId,
      },
    })),
  });
  const write = () =>
    map.getSource(TRANSIT_CONTEXT_SOURCE_ID)?.setData(rendered());
  const snapshot = () => ({
    assetStatus: "approved",
    stationCount: stations.size,
    lineCount: baseAsset.features.filter(
      ({ properties }) => properties?.featureClass === "rail_line",
    ).length,
    visibility: { ...visibility },
  });
  const emit = () => {
    const current = snapshot();
    for (const subscriber of subscribers) subscriber(structuredClone(current));
  };
  const reflectLayerVisibility = () => {
    map.setLayoutProperty?.(
      TRANSIT_CONTEXT_LAYER_IDS[0],
      "visibility",
      visibility.mrtLines ? "visible" : "none",
    );
    for (const id of TRANSIT_CONTEXT_LAYER_IDS.slice(1))
      map.setLayoutProperty?.(
        id,
        "visibility",
        visibility.mrtStations ? "visible" : "none",
      );
    if (globalThis.document?.body)
      document.body.dataset.transitVisible = String(
        visibility.mrtStations || visibility.mrtLines,
      );
  };

  return Object.freeze({
    start() {
      if (started) return false;
      if (!map.getSource(TRANSIT_CONTEXT_SOURCE_ID)) {
        map.addSource(TRANSIT_CONTEXT_SOURCE_ID, {
          type: "geojson",
          data: rendered(),
        });
      }
      const layers = [
        {
          id: TRANSIT_CONTEXT_LAYER_IDS[0],
          type: "line",
          source: TRANSIT_CONTEXT_SOURCE_ID,
          filter: ["==", ["get", "featureClass"], "rail_line"],
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": railLineColourExpression,
            "line-opacity": 0.82,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              0.8,
              14,
              2.4,
            ],
          },
        },
        {
          id: TRANSIT_CONTEXT_LAYER_IDS[1],
          type: "circle",
          source: TRANSIT_CONTEXT_SOURCE_ID,
          filter: ["==", ["get", "featureClass"], "station"],
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              ["case", ["get", "selected"], 2.5, 1],
              10,
              ["case", ["get", "selected"], 4, 2.5],
              14,
              ["case", ["get", "selected"], 7, 4.5],
              18,
              ["case", ["get", "selected"], 9, 6],
            ],
            "circle-color": ["case", ["get", "selected"], "#f3aa35", "#f7f4ff"],
            "circle-stroke-color": "#59466f",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              ["case", ["get", "selected"], 1, 0.5],
              10,
              ["case", ["get", "selected"], 1.5, 1],
              14,
              ["case", ["get", "selected"], 3, 1.5],
            ],
          },
        },
        {
          id: TRANSIT_CONTEXT_LAYER_IDS[2],
          type: "symbol",
          source: TRANSIT_CONTEXT_SOURCE_ID,
          filter: ["==", ["get", "featureClass"], "station"],
          layout: {
            "text-field": ["get", "stationName"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#473758",
            "text-halo-color": "#fffdf7",
            "text-halo-width": 1.2,
          },
        },
      ];
      for (const layer of layers)
        if (!map.getLayer(layer.id)) map.addLayer(layer, beforeLayerId);
      map.setLayerZoomRange?.(TRANSIT_CONTEXT_LAYER_IDS[0], 7, 24);
      map.setLayerZoomRange?.(TRANSIT_CONTEXT_LAYER_IDS[1], 7, 24);
      map.setLayerZoomRange?.(TRANSIT_CONTEXT_LAYER_IDS[2], 12, 24);
      started = true;
      reflectLayerVisibility();
      return true;
    },
    setVisible(nextVisible) {
      const requested = nextVisible === true;
      const changed =
        visibility.mrtStations !== requested ||
        visibility.mrtLines !== requested;
      visibility = { mrtStations: requested, mrtLines: requested };
      reflectLayerVisibility();
      if (changed) emit();
      return changed;
    },
    setLayerVisibility(layer, nextVisible) {
      if (!["mrtStations", "mrtLines"].includes(layer)) return false;
      const requested = nextVisible === true;
      const changed = visibility[layer] !== requested;
      visibility = { ...visibility, [layer]: requested };
      reflectLayerVisibility();
      if (changed) emit();
      return changed;
    },
    snapshot,
    subscribe(subscriber, { emitCurrent = false } = {}) {
      if (typeof subscriber !== "function")
        throw new TypeError("Transit subscriber must be a function");
      subscribers.add(subscriber);
      if (emitCurrent) subscriber(snapshot());
      return () => subscribers.delete(subscriber);
    },
    selectStation(stationId) {
      if (!stations.has(stationId)) return false;
      selectedStationId = stationId;
      write();
      return true;
    },
    clearSelection() {
      const changed = selectedStationId !== null;
      selectedStationId = null;
      if (changed) write();
      return changed;
    },
    focusStation(stationId) {
      const station = stations.get(stationId);
      if (!station || !visibility.mrtStations) return false;
      selectedStationId = stationId;
      write();
      map.easeTo({
        center: clone(station.geometry.coordinates),
        zoom: Math.max(map.getZoom?.() || 0, 14),
        duration: reducedMotion ? 0 : 650,
      });
      return true;
    },
    getStations() {
      return [...stations.values()].map((feature) => clone(feature));
    },
    destroy() {
      try {
        for (const id of [...TRANSIT_CONTEXT_LAYER_IDS].reverse()) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(TRANSIT_CONTEXT_SOURCE_ID))
          map.removeSource(TRANSIT_CONTEXT_SOURCE_ID);
      } catch {
        // Map removal may have already discarded its style-owned resources.
      }
      selectedStationId = null;
      subscribers.clear();
      started = false;
    },
  });
}
