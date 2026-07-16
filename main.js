import "./style.css";

import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import maplibregl from "maplibre-gl";
import { addEsplanadePerformanceScene } from "./activity-scenes/esplanade-performance";
import { addRestaurantExplorer } from "./activity-scenes/restaurant-explorer";
import { addPlanBuilder } from "./activity-scenes/plan-builder";
import { addMapGuidanceControls } from "./activity-scenes/map-guidance-controls";
import { resetSavedMapView } from "./activity-scenes/map-initial-state";
import { dismissOpenOverlaysFromMapClick } from "./activity-scenes/overlay-coordinator";
import { createBuildingHighlightLayerManager } from "./map-layers/building-highlight-layers";
import { loadPublicSnapshot } from "./activity-scenes/shared/api-client.js";
import { createSnapshotStatus } from "./activity-scenes/snapshot-status.js";
import { createExperienceIntro } from "./activity-scenes/experience-intro.js";
import { createFeatureTour } from "./activity-scenes/feature-tour.js";

const INITIAL_CAMERA = { center: [103.857897, 1.285844], zoom: 15.3, pitch: 45, bearing: -30 };
const EXPLORE_CAMERA = { center: [103.8559, 1.2892], zoom: 16.7, pitch: 45, bearing: -30 };

async function bootstrapApplication() {
const queryParams = new URLSearchParams(window.location.search);
resetSavedMapView({ preserve: queryParams.has("autoStart") });
const hasInitialCameraHash = Boolean(window.location.hash);
let buildingHighlights = null;
let map = null;
const featureTour = createFeatureTour();
const experienceIntro = createExperienceIntro({
  skip: queryParams.has("autoStart"),
  sceneReady: () => document.body.dataset.mapLoaded === "true" && Boolean(buildingHighlights?.isBackgroundViewLoaded()),
  onEnter: () => {
    if (!map || hasInitialCameraHash) {
      window.setTimeout(() => featureTour.start(), 850);
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let tourStarted = false;
    const startTour = () => {
      if (tourStarted) return;
      tourStarted = true;
      featureTour.start();
    };
    map.once("moveend", startTour);
    map.easeTo({ ...EXPLORE_CAMERA, duration: reduceMotion ? 0 : 5_000 });
    window.setTimeout(startTour, reduceMotion ? 850 : 5_300);
  },
});
const injectedSnapshot = globalThis.__EVENT_PIPELINE_SNAPSHOT__;
let activeSnapshot = null;
let approvedPois = [];
let approvedLandmarks = [];
const snapshotStatus = createSnapshotStatus();
if (queryParams.has("emptyApprovedSnapshot")) {
  document.body.dataset.snapshotState = "empty-test-fixture";
} else if (injectedSnapshot) {
  approvedPois = injectedSnapshot.pois ?? [];
  approvedLandmarks = injectedSnapshot.landmarks ?? [];
  document.body.dataset.snapshotState = injectedSnapshot.stale ? "potentially-outdated" : "injected-test-fixture";
  if (injectedSnapshot.snapshotId) document.body.dataset.snapshotId = injectedSnapshot.snapshotId;
  snapshotStatus.update({ state: injectedSnapshot.stale ? "stale" : "fresh", fetchedAt: injectedSnapshot.publishedAt });
} else {
  try {
    activeSnapshot = await loadPublicSnapshot();
    approvedPois = activeSnapshot.pois;
    approvedLandmarks = activeSnapshot.landmarks;
    document.body.dataset.snapshotState = activeSnapshot.stale ? "potentially-outdated" : "fresh";
    document.body.dataset.snapshotId = activeSnapshot.metadata.snapshotId;
    snapshotStatus.update({ state: activeSnapshot.stale ? "stale" : "fresh", fetchedAt: activeSnapshot.metadata.publishedAt });
  } catch (error) {
    document.body.dataset.snapshotState = "unavailable";
    document.body.dataset.snapshotError = error.code ?? "snapshot_unavailable";
    snapshotStatus.update({ state: "unavailable" });
  }
}
const tilesetUrl = injectedSnapshot?.backgroundTilesetUrl ?? "optimized-tiles/tileset.json?assetMount=site-root-v1";
const poiTilesetUrl = injectedSnapshot?.poiTilesetUrl ?? activeSnapshot?.metadata.tilesetRef ?? "poi-tiles/event-venues/tileset.json";
const builtInPoiTilesets = [
  { id: "esplanade", label: "esplanade-complex", data: "poi-tiles/esplanade/tileset.json" },
  { id: "artscience", label: "artscience-museum", data: "poi-tiles/artscience/tileset.json" },
  { id: "the-star", label: "the-star", data: "poi-tiles/the-star/tileset.json" },
];
const composePoiTilesets = (landmarks, pois) => {
  const ids = new Set(landmarks.map(({ id }) => id));
  const anchors = new Map(landmarks.map(({ id, anchor }) => [id, anchor]));
  return [...new Map([
    ...builtInPoiTilesets.filter(({ id }) => ids.has(id)),
    ...pois.map(({ id, label, data }) => ({ id, label, data })),
  ].map((poi) => [poi.id, { ...poi, anchor: anchors.get(poi.id) }])).values()];
};
let poiTilesets = composePoiTilesets(approvedLandmarks, approvedPois);
const optimizedTilesMemoryMb = 192;

map = (window._map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "carto-voyager-nolabels": {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / <a href="https://carto.com/attributions">CARTO</a> / <a href="https://www.sla.gov.sg/">SLA</a> / <a href="https://www.onemap.gov.sg/legal/termsofuse.html">OneMap</a>',
      },
    },
    layers: [
      {
        id: "carto-voyager-nolabels",
        type: "raster",
        source: "carto-voyager-nolabels",
        paint: {
          // Keep the raster ground locked to continuously rendered 3D geometry
          // instead of crossfading between integer tile zoom levels.
          "raster-fade-duration": 0,
        },
      },
    ],
  },
  minZoom: 8,
  minPitch: 45,
  maxPitch: 45,
  antialias: true,
  renderWorldCopies: false,
  hash: true,
  ...INITIAL_CAMERA,
}));
document.body.dataset.mapInitialized = "true";

const mapCanvas = map.getCanvas();
const dismissPanelsFromMap = (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  dismissOpenOverlaysFromMapClick(event);
};
mapCanvas.addEventListener("click", dismissPanelsFromMap);

map.dragRotate.enable();
map.touchZoomRotate.enableRotation();
document.body.dataset.mouseRotation = "enabled";

const ambientLight = new AmbientLight({
  intensity: 5.5,
});

const directionalLight1 = new DirectionalLight({
  color: [235, 238, 238],
  intensity: 3.2,
  direction: [0, -1, 0.1],
});

const directionalLight2 = new DirectionalLight({
  color: [235, 238, 238],
  intensity: 1.4,
  direction: [0, 1, 0.1],
});

const lightingEffect = new LightingEffect({
  ambientLight,
  directionalLight1,
  directionalLight2,
});

buildingHighlights = createBuildingHighlightLayerManager({
  background: {
    data: tilesetUrl,
    maximumMemoryUsage: optimizedTilesMemoryMb,
  },
  lightingEffect,
  map,
  pois: poiTilesets,
  poiTilesetUrl,
});
let activityScenes = [];
let eventSceneController = null;

const reconcileActiveSnapshot = async () => {
  try {
    const next = await loadPublicSnapshot();
    snapshotStatus.update({ state: next.stale ? "stale" : "fresh", fetchedAt: next.metadata.publishedAt });
    document.body.dataset.snapshotState = next.stale ? "potentially-outdated" : "fresh";
    document.body.dataset.snapshotId = next.metadata.snapshotId;
    if (activeSnapshot?.metadata?.contentHash === next.metadata.contentHash) {
      activeSnapshot = next;
      document.body.dataset.snapshotReconciled = "noop";
      return { changed: false };
    }
    const nextPois = composePoiTilesets(next.landmarks, next.pois);
    const geometry = buildingHighlights.reconcile({ pois: nextPois, poiTilesetUrl: next.metadata.tilesetRef, snapshotId: next.metadata.snapshotId });
    const events = eventSceneController?.reconcile?.({ landmarks: next.landmarks }) || { changed: false };
    approvedLandmarks = next.landmarks;
    approvedPois = next.pois;
    poiTilesets = nextPois;
    activeSnapshot = next;
    document.body.dataset.snapshotReconciled = geometry.changed || events.changed ? "updated" : "noop";
    return { changed: geometry.changed || events.changed };
  } catch (error) {
    const hasApprovedData = approvedLandmarks.length > 0 || approvedPois.length > 0;
    snapshotStatus.update({ state: hasApprovedData ? "stale" : "unavailable", fetchedAt: activeSnapshot?.metadata?.publishedAt });
    document.body.dataset.snapshotState = hasApprovedData ? "potentially-outdated" : "unavailable";
    document.body.dataset.snapshotError = error.code || "snapshot_unavailable";
    return { changed: false, error: error.code || "snapshot_unavailable" };
  }
};
const requestSnapshotRefresh = () => { reconcileActiveSnapshot(); };
window.addEventListener("whats-here:snapshot-refresh", requestSnapshotRefresh);

const cleanupAppLayers = () => {
  experienceIntro.destroy();
  featureTour.destroy();
  mapCanvas.removeEventListener("click", dismissPanelsFromMap);
  for (const scene of activityScenes.splice(0)) scene.finalize?.();
  window.removeEventListener("whats-here:snapshot-refresh", requestSnapshotRefresh);
  snapshotStatus.destroy();
  buildingHighlights.destroy();
};

const dockActivityActions = () => {
  const controls = document.querySelector(".landmark-event-search__controls");
  const restaurantButton = document.getElementById("restaurant-search-button");
  const planButton = document.getElementById("plan-builder-button");
  if (!controls || !restaurantButton || !planButton) return;

  const actions = document.createElement("div");
  actions.className = "landmark-event-search__actions";
  actions.setAttribute("aria-label", "Map actions");
  actions.append(restaurantButton, planButton);
  controls.appendChild(actions);
};

const addOverlayLayers = () => {
  if (!map.getSource("water-overlay")) {
    map.addSource("water-overlay", {
      type: "geojson",
      data: "data/water.geojson",
    });
  }

  if (!map.getSource("parks-overlay")) {
    map.addSource("parks-overlay", {
      type: "geojson",
      data: "data/parks.geojson",
    });
  }

  if (!map.getLayer("water-overlay-fill")) {
    map.addLayer({
      id: "water-overlay-fill",
      type: "fill",
      source: "water-overlay",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-antialias": true,
        "fill-color": "#66c5d5",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.38, 14, 0.5, 18, 0.62],
      },
    });
  }

  if (!map.getLayer("parks-overlay-fill")) {
    map.addLayer({
      id: "parks-overlay-fill",
      type: "fill",
      source: "parks-overlay",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-antialias": true,
        "fill-color": "#65b96f",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.32, 14, 0.48, 18, 0.58],
      },
    });
  }

  if (!map.getLayer("water-overlay-line")) {
    map.addLayer({
      id: "water-overlay-line",
      type: "line",
      source: "water-overlay",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#3eb3c9",
        "line-opacity": 0.72,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 1.8, 18, 4],
      },
    });
  }

  if (!map.getLayer("parks-overlay-line")) {
    map.addLayer({
      id: "parks-overlay-line",
      type: "line",
      source: "parks-overlay",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#3e9650",
        "line-opacity": 0.52,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.4, 18, 3],
      },
    });
  }

  document.body.dataset.overlayLayersLoaded = "true";
};

map.once("load", () => {
  document.body.dataset.mapLoaded = "true";
  addOverlayLayers();

  const start = () => {
    if (!map.getLayer("buildings-3d")) {
      buildingHighlights.start();
      activityScenes = addEsplanadePerformanceScene(map, {
        landmarks: approvedLandmarks,
        onLandmarkSelected: (landmarkId) => buildingHighlights.setSelectedPoi(landmarkId),
      });
      eventSceneController = activityScenes.find(({ id }) => id === "landmark-event-pills") || null;
      activityScenes.push(addRestaurantExplorer(map));
      activityScenes.push(addPlanBuilder({ map }));
      activityScenes.push(addMapGuidanceControls(map, { onShowTour: () => featureTour.start({ force: true }) }));
      dockActivityActions();
    }
  };

  start();

});

map.once("remove", cleanupAppLayers);

if (import.meta.hot) import.meta.hot.dispose(cleanupAppLayers);
}

bootstrapApplication().catch((error) => {
  document.body.dataset.applicationState = "failed";
  document.body.dataset.applicationError = error?.code ?? "application_start_failed";
  console.error("Amble could not start.", error);
});
