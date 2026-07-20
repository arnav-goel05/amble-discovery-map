export const LOCATION_CONTEXT_SOURCE_ID = "user-location-context";
export const LOCATION_CONTEXT_LAYER_IDS = Object.freeze([
  "user-location-accuracy",
  "user-location-point",
]);

const emptyCollection = () => ({ type: "FeatureCollection", features: [] });

function accuracyPolygon([longitude, latitude], radiusMeters, vertices = 48) {
  const latitudeRadius = radiusMeters / 111_320;
  const longitudeRadius = latitudeRadius / Math.cos((latitude * Math.PI) / 180);
  const ring = [];
  for (let index = 0; index <= vertices; index += 1) {
    const angle = (index / vertices) * Math.PI * 2;
    ring.push([
      longitude + Math.cos(angle) * longitudeRadius,
      latitude + Math.sin(angle) * latitudeRadius,
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

function rendered(snapshot) {
  if (!snapshot?.coordinates || !["fresh", "stale"].includes(snapshot.status)) {
    return emptyCollection();
  }
  const properties = {
    featureClass: "user_location",
    locationState: snapshot.status,
    stale: snapshot.status === "stale",
    accuracyMeters: snapshot.accuracyMeters,
  };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { ...properties, presentation: "accuracy" },
        geometry: accuracyPolygon(
          snapshot.coordinates,
          Math.max(1, snapshot.accuracyMeters || 1),
        ),
      },
      {
        type: "Feature",
        properties: { ...properties, presentation: "point" },
        geometry: { type: "Point", coordinates: [...snapshot.coordinates] },
      },
    ],
  };
}

export function createLocationContextLayerManager({
  map,
  beforeLayerId,
  reducedMotion = false,
} = {}) {
  if (!map)
    throw new TypeError("A map is required for location context layers");
  let snapshot = null;
  let visible = true;
  let started = false;

  const write = () =>
    map
      .getSource(LOCATION_CONTEXT_SOURCE_ID)
      ?.setData(visible ? rendered(snapshot) : emptyCollection());
  const reflectState = () => {
    if (!globalThis.document?.body) return;
    document.body.dataset.locationState = snapshot?.status || "idle";
    document.body.dataset.locationPermission = snapshot?.permission || "prompt";
    document.body.dataset.locationVisible = String(visible);
  };

  return Object.freeze({
    start() {
      if (started) return false;
      if (!map.getSource(LOCATION_CONTEXT_SOURCE_ID)) {
        map.addSource(LOCATION_CONTEXT_SOURCE_ID, {
          type: "geojson",
          data: emptyCollection(),
        });
      }
      const layers = [
        {
          id: LOCATION_CONTEXT_LAYER_IDS[0],
          type: "fill",
          source: LOCATION_CONTEXT_SOURCE_ID,
          filter: ["==", ["get", "presentation"], "accuracy"],
          paint: {
            "fill-color": "#2878b8",
            "fill-opacity": ["case", ["get", "stale"], 0.08, 0.16],
            "fill-outline-color": [
              "case",
              ["get", "stale"],
              "#758795",
              "#1d659d",
            ],
          },
        },
        {
          id: LOCATION_CONTEXT_LAYER_IDS[1],
          type: "circle",
          source: LOCATION_CONTEXT_SOURCE_ID,
          filter: ["==", ["get", "presentation"], "point"],
          paint: {
            "circle-radius": ["case", ["get", "stale"], 6, 8],
            "circle-color": ["case", ["get", "stale"], "#758795", "#1677bd"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
          },
        },
      ];
      for (const layer of layers) {
        if (!map.getLayer(layer.id)) map.addLayer(layer, beforeLayerId);
        map.setLayerZoomRange?.(layer.id, 7, 24);
      }
      started = true;
      reflectState();
      return true;
    },
    reconcile(nextSnapshot) {
      snapshot = nextSnapshot ? structuredClone(nextSnapshot) : null;
      write();
      reflectState();
      return {
        rendered: Boolean(snapshot?.coordinates && visible),
        status: snapshot?.status || "idle",
      };
    },
    setVisible(nextVisible) {
      visible = nextVisible === true;
      write();
      reflectState();
      return visible;
    },
    focusLocation() {
      if (
        !visible ||
        !snapshot?.coordinates ||
        !["fresh", "stale"].includes(snapshot.status)
      ) {
        return false;
      }
      map.easeTo({
        center: [...snapshot.coordinates],
        zoom: Math.max(map.getZoom?.() || 0, 15),
        duration: reducedMotion ? 0 : 650,
      });
      return true;
    },
    destroy() {
      try {
        for (const id of [...LOCATION_CONTEXT_LAYER_IDS].reverse()) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(LOCATION_CONTEXT_SOURCE_ID))
          map.removeSource(LOCATION_CONTEXT_SOURCE_ID);
      } catch {
        // Map removal may have already discarded its style-owned resources.
      }
      snapshot = null;
      started = false;
      reflectState();
    },
  });
}
