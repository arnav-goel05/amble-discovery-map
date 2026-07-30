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
import { createAssistantController } from "./activity-scenes/assistant/assistant-controller.js";
import { createApplicationActionControls } from "./activity-scenes/assistant/actions/application-actions.js";
import { createRuntimeActionDispatcher } from "./activity-scenes/assistant/runtime-action-dispatcher.js";
import { createDiscoveryAreaLayerManager } from "./map-layers/discovery-area-layers.js";
import discoveryAreasUrl from "./data/discovery-areas.geojson?url";
import transitContextUrl from "./data/transit-context.geojson?url";
import backgroundGeometryRelease from "./data/background-geometry-release.json";
import { createLocationController } from "./activity-scenes/location/location-controller.js";
import {
  createLocationModel,
  resolveCoarseAreaFromFeatures,
} from "./activity-scenes/location/location-model.js";
import { createLocationContextLayerManager } from "./map-layers/location-context-layers.js";
import { createTransitContextLayerManager } from "./map-layers/transit-context-layers.js";
import { resolveCandidateEnvelopeAreas } from "./activity-scenes/assistant/candidate-area-resolution.js";

const INITIAL_CAMERA = {
  center: [103.857897, 1.285844],
  zoom: 15.3,
  pitch: 45,
  bearing: -30,
};
const EXPLORE_CAMERA = {
  center: [103.8559, 1.2892],
  zoom: 16.7,
  pitch: 45,
  bearing: -30,
};

function normalizeInjectedActivityFixture(snapshot) {
  const canonical = snapshot.activities?.records ?? snapshot.activities;
  if (Array.isArray(canonical))
    return { landmarks: snapshot.landmarks ?? [], activities: canonical };
  const activities = new Map();
  const landmarks = (snapshot.landmarks ?? []).map((landmark) => {
    const activityRefs = [];
    for (const event of landmark.events ?? []) {
      const activityId =
        event.activityId ??
        event.parentActivityId ??
        event.parentListingId ??
        `activity:${event.id}`;
      const sessionId = `session:${activityId}`;
      const venueGroupId = `venue-group:${activityId}:${landmark.id}`;
      const activity = activities.get(activityId) ?? {
        schemaVersion: "1.0",
        activityId,
        title: event.title,
        description: event.description ?? null,
        category: event.category ?? null,
        organizer: event.organizer ?? null,
        price: event.price ?? null,
        lifecycleState: event.lifecycleState ?? "active",
        freshness: event.freshness ?? "current",
        sources: [],
        sessions: [
          {
            sessionId,
            schedule: event.schedule ?? {
              kind: "exact",
              start: event.startsAt ?? null,
              end: event.endsAt ?? null,
              displayText: event.dateText ?? null,
            },
            availability: event.availability ?? "unknown",
            venueGroupIds: [],
          },
        ],
        venueGroups: [],
        sourceOffers: [],
        scheduleSummary: {
          kind: event.schedule?.kind ?? "exact",
          label:
            event.schedule?.displayText ??
            event.dateText ??
            "Schedule unavailable",
          sessionCount: 1,
        },
      };
      const session = activity.sessions[0];
      if (!session.venueGroupIds.includes(venueGroupId))
        session.venueGroupIds.push(venueGroupId);
      if (
        !activity.venueGroups.some(
          (group) => group.venueGroupId === venueGroupId,
        )
      )
        activity.venueGroups.push({
          venueGroupId,
          activityId,
          label: event.venue ?? landmark.label,
          address: event.address ?? null,
          publicPlacement: "mapped",
          mappingStatus: "approved",
          approvedLocationId: landmark.id,
          coordinates: landmark.anchor,
          sessionIds: [sessionId],
        });
      activities.set(activityId, activity);
      activityRefs.push({ activityId, venueGroupIds: [venueGroupId] });
    }
    const { events: _events, ...publicLandmark } = landmark;
    return { ...publicLandmark, activityRefs };
  });
  for (const event of snapshot.offMapEvents ?? snapshot.events?.offMap ?? []) {
    const activityId =
      event.activityId ??
      event.parentActivityId ??
      event.parentListingId ??
      `activity:${event.id}`;
    const sessionId = `session:${activityId}`;
    const venueGroupId = `venue-group:${activityId}:off-map`;
    activities.set(activityId, {
      schemaVersion: "1.0",
      activityId,
      title: event.title,
      description: event.description ?? null,
      category: event.category ?? null,
      organizer: event.organizer ?? null,
      price: event.price ?? null,
      lifecycleState: event.lifecycleState ?? "active",
      freshness: event.freshness ?? "current",
      sources: [],
      sessions: [
        {
          sessionId,
          schedule: event.schedule ?? {
            kind: "unverified",
            start: null,
            end: null,
            displayText: event.dateText ?? null,
          },
          availability: event.availability ?? "unknown",
          venueGroupIds: [venueGroupId],
        },
      ],
      venueGroups: [
        {
          venueGroupId,
          activityId,
          label: event.venue ?? "Location TBA",
          address: event.address ?? null,
          publicPlacement: "off_map",
          mappingStatus: event.mappingStatus ?? "not_required",
          approvedLocationId: null,
          coordinates: null,
          sessionIds: [sessionId],
          offMapSubtype: event.offMapSubtype ?? "geometry_unavailable",
        },
      ],
      sourceOffers: [],
      scheduleSummary: {
        kind: event.schedule?.kind ?? "unverified",
        label:
          event.schedule?.displayText ??
          event.dateText ??
          "Schedule unavailable",
        sessionCount: 1,
      },
    });
  }
  return { landmarks, activities: [...activities.values()] };
}

async function bootstrapApplication() {
  const queryParams = new URLSearchParams(window.location.search);
  let performanceVariant = null;
  if (
    queryParams.get("performanceDiagnostics") === "1" &&
    queryParams.has("performanceVariant")
  ) {
    const { requestedPerformanceVariant } =
      await import("./activity-scenes/performance-diagnostic-variants.js");
    performanceVariant = requestedPerformanceVariant(window.location.search);
  }
  resetSavedMapView({ preserve: queryParams.has("autoStart") });
  const hasInitialCameraHash = Boolean(window.location.hash);
  let buildingHighlights = null;
  let map = null;
  let sharedActionDispatch = null;
  const featureTour = createFeatureTour({
    executeCapability: (actionId, argumentsValue) =>
      sharedActionDispatch?.(actionId, argumentsValue),
  });
  const experienceIntro = createExperienceIntro({
    skip: queryParams.has("autoStart"),
    sceneReady: () =>
      document.body.dataset.mapLoaded === "true" &&
      Boolean(buildingHighlights?.isBackgroundViewLoaded()),
    onEnter: () => {
      if (!map || hasInitialCameraHash) {
        window.setTimeout(() => featureTour.start(), 850);
        return;
      }
      const reduceMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      let tourStarted = false;
      const startTour = () => {
        if (tourStarted) return;
        tourStarted = true;
        featureTour.start();
      };
      map.once("moveend", startTour);
      if (!reduceMotion) buildingHighlights?.preserveNextMovementRendering?.();
      map.easeTo({ ...EXPLORE_CAMERA, duration: reduceMotion ? 0 : 5_000 });
      window.setTimeout(startTour, reduceMotion ? 850 : 5_300);
    },
  });
  const injectedSnapshot = globalThis.__EVENT_PIPELINE_SNAPSHOT__;
  let activeSnapshot = null;
  let approvedPois = [];
  let approvedLandmarks = [];
  let approvedActivities = [];
  let discoveryAreaAsset = { type: "FeatureCollection", features: [] };
  let transitContextAsset = { type: "FeatureCollection", features: [] };
  const loadContextAsset = async (url) => {
    try {
      const response = await fetch(url);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const contextAssetsPromise = Promise.all([
    loadContextAsset(discoveryAreasUrl),
    loadContextAsset(transitContextUrl),
  ]).then(([discoveryAreas, transitContext]) => {
    if (discoveryAreas) discoveryAreaAsset = discoveryAreas;
    if (transitContext) transitContextAsset = transitContext;
  });
  const snapshotStatus = createSnapshotStatus();
  if (queryParams.has("emptyApprovedSnapshot")) {
    document.body.dataset.snapshotState = "empty-test-fixture";
  } else if (injectedSnapshot) {
    const injectedActivities =
      normalizeInjectedActivityFixture(injectedSnapshot);
    approvedPois = injectedSnapshot.pois ?? [];
    approvedLandmarks = injectedActivities.landmarks;
    approvedActivities = injectedActivities.activities;
    document.body.dataset.snapshotState = injectedSnapshot.stale
      ? "potentially-outdated"
      : "injected-test-fixture";
    if (injectedSnapshot.snapshotId)
      document.body.dataset.snapshotId = injectedSnapshot.snapshotId;
    snapshotStatus.update({
      state: injectedSnapshot.stale ? "stale" : "fresh",
      fetchedAt: injectedSnapshot.publishedAt,
    });
  } else {
    try {
      activeSnapshot = await loadPublicSnapshot();
      approvedPois = activeSnapshot.pois;
      approvedLandmarks = activeSnapshot.landmarks;
      approvedActivities = activeSnapshot.activities?.records ?? [];
      document.body.dataset.snapshotState = activeSnapshot.stale
        ? "potentially-outdated"
        : "fresh";
      document.body.dataset.snapshotId = activeSnapshot.metadata.snapshotId;
      snapshotStatus.update({
        state: activeSnapshot.stale ? "stale" : "fresh",
        fetchedAt: activeSnapshot.metadata.publishedAt,
      });
    } catch (error) {
      document.body.dataset.snapshotState = "unavailable";
      document.body.dataset.snapshotError =
        error.code ?? "snapshot_unavailable";
      snapshotStatus.update({ state: "unavailable" });
    }
  }
  const tilesetUrl =
    injectedSnapshot?.backgroundTilesetUrl ??
    backgroundGeometryRelease.tilesetUrl;
  const poiTilesetUrl =
    injectedSnapshot?.poiTilesetUrl ??
    activeSnapshot?.metadata.tilesetRef ??
    "poi-tiles/event-venues/tileset.json";
  const builtInPoiTilesets = [
    {
      id: "esplanade",
      label: "esplanade-complex",
      data: "poi-tiles/esplanade/tileset.json",
    },
    {
      id: "artscience",
      label: "artscience-museum",
      data: "poi-tiles/artscience/tileset.json",
    },
    {
      id: "the-star",
      label: "the-star",
      data: "poi-tiles/the-star/tileset.json",
    },
  ];
  const composePoiTilesets = (landmarks, pois) => {
    const ids = new Set(landmarks.map(({ id }) => id));
    const anchors = new Map(landmarks.map(({ id, anchor }) => [id, anchor]));
    return [
      ...new Map(
        [
          ...builtInPoiTilesets.filter(({ id }) => ids.has(id)),
          ...pois.map(({ id, label, data }) => ({ id, label, data })),
        ].map((poi) => [poi.id, { ...poi, anchor: anchors.get(poi.id) }]),
      ).values(),
    ];
  };
  let poiTilesets = composePoiTilesets(approvedLandmarks, approvedPois);
  const optimizedTilesMemoryMb = 192;

  map = window._map = new maplibregl.Map({
    container: "map",
    attributionControl: false,
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
  });
  globalThis.__performanceDiagnostics?.attachMap?.(map);
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
    diagnosticWorkloads: performanceVariant?.workloads ?? null,
  });
  let activityScenes = [];
  let eventSceneController = null;
  let performanceVariantController = null;

  const reconcileActiveSnapshot = async () => {
    try {
      const next = await loadPublicSnapshot();
      snapshotStatus.update({
        state: next.stale ? "stale" : "fresh",
        fetchedAt: next.metadata.publishedAt,
      });
      document.body.dataset.snapshotState = next.stale
        ? "potentially-outdated"
        : "fresh";
      document.body.dataset.snapshotId = next.metadata.snapshotId;
      if (activeSnapshot?.metadata?.contentHash === next.metadata.contentHash) {
        activeSnapshot = next;
        document.body.dataset.snapshotReconciled = "noop";
        return { changed: false };
      }
      const nextPois = composePoiTilesets(next.landmarks, next.pois);
      const geometry = buildingHighlights.reconcile({
        pois: nextPois,
        poiTilesetUrl: next.metadata.tilesetRef,
        snapshotId: next.metadata.snapshotId,
      });
      const events = eventSceneController?.reconcile?.({
        landmarks: next.landmarks,
        activities: next.activities?.records ?? [],
        sourceSnapshotId: next.metadata.snapshotId,
      }) || { changed: false };
      approvedLandmarks = next.landmarks;
      approvedPois = next.pois;
      approvedActivities = next.activities?.records ?? [];
      poiTilesets = nextPois;
      activeSnapshot = next;
      document.body.dataset.snapshotReconciled =
        geometry.changed || events.changed ? "updated" : "noop";
      return { changed: geometry.changed || events.changed };
    } catch (error) {
      const hasApprovedData =
        approvedLandmarks.length > 0 || approvedPois.length > 0;
      snapshotStatus.update({
        state: hasApprovedData ? "stale" : "unavailable",
        fetchedAt: activeSnapshot?.metadata?.publishedAt,
      });
      document.body.dataset.snapshotState = hasApprovedData
        ? "potentially-outdated"
        : "unavailable";
      document.body.dataset.snapshotError =
        error.code || "snapshot_unavailable";
      return { changed: false, error: error.code || "snapshot_unavailable" };
    }
  };
  const requestSnapshotRefresh = () => {
    reconcileActiveSnapshot();
  };
  window.addEventListener(
    "whats-here:snapshot-refresh",
    requestSnapshotRefresh,
  );

  const cleanupAppLayers = () => {
    globalThis.__performanceDiagnostics?.destroy?.();
    delete globalThis.__performanceDiagnostics;
    experienceIntro.destroy();
    featureTour.destroy();
    mapCanvas.removeEventListener("click", dismissPanelsFromMap);
    for (const scene of activityScenes.splice(0)) scene.finalize?.();
    window.removeEventListener(
      "whats-here:snapshot-refresh",
      requestSnapshotRefresh,
    );
    snapshotStatus.destroy();
    performanceVariantController?.destroy();
    buildingHighlights.destroy();
  };

  const dockActivityActions = () => {
    const controls = document.querySelector(".landmark-event-search__controls");
    const restaurantButton = document.getElementById(
      "restaurant-search-button",
    );
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
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.38,
            14,
            0.5,
            18,
            0.62,
          ],
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
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.32,
            14,
            0.48,
            18,
            0.58,
          ],
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
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.8,
            14,
            1.8,
            18,
            4,
          ],
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
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.6,
            14,
            1.4,
            18,
            3,
          ],
        },
      });
    }

    document.body.dataset.overlayLayersLoaded = "true";
  };

  map.once("load", async () => {
    document.body.dataset.mapLoaded = "true";
    addOverlayLayers();
    await contextAssetsPromise;

    const start = async () => {
      if (!map.getLayer("buildings-3d")) {
        buildingHighlights.start();
        const discoveryAreaLayers = createDiscoveryAreaLayerManager({
          map,
          featureCollection: discoveryAreaAsset,
          beforeLayerId: "buildings-3d",
          reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")
            .matches,
        });
        discoveryAreaLayers.start();
        window._discoveryAreaLayers = discoveryAreaLayers;
        const locationController = createLocationController({
          model: createLocationModel({
            resolveCoarseArea: (coordinates) =>
              resolveCoarseAreaFromFeatures(coordinates, discoveryAreaAsset),
          }),
        });
        activityScenes =
          performanceVariant?.workloads.interface === false
            ? []
            : addEsplanadePerformanceScene(map, {
                landmarks: approvedLandmarks,
                activities: approvedActivities,
                locationController,
                discoveryAreaAsset,
                areaIdOf: ({ event, landmark }) => {
                  const explicit =
                    event?.areaId ||
                    landmark?.areaId ||
                    landmark?.subzoneId ||
                    null;
                  if (explicit) return explicit;
                  const source = event?.coordinates || landmark?.anchor;
                  const coordinates = Array.isArray(source)
                    ? source
                    : [Number(source?.lng), Number(source?.lat)];
                  return resolveCoarseAreaFromFeatures(
                    coordinates,
                    discoveryAreaAsset,
                  );
                },
                onLandmarkSelected: (landmarkId) =>
                  buildingHighlights.setSelectedPoi(landmarkId),
                diagnosticWorkloads: performanceVariant?.workloads ?? null,
              });
        activityScenes.push({
          id: "discovery-area-layers",
          finalize: () => {
            discoveryAreaLayers.destroy();
            delete window._discoveryAreaLayers;
          },
        });
        eventSceneController =
          activityScenes.find(({ id }) => id === "landmark-event-pills") ||
          null;
        const locationLayers = createLocationContextLayerManager({
          map,
          beforeLayerId: "buildings-3d",
          reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")
            .matches,
        });
        const transitLayers = createTransitContextLayerManager({
          map,
          featureCollection: transitContextAsset,
          beforeLayerId: "buildings-3d",
          reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")
            .matches,
        });
        locationLayers.start();
        transitLayers.start();
        const unsubscribeLocationLayers = locationController.subscribe(
          (snapshot) => locationLayers.reconcile(snapshot),
        );
        if (!locationController.startWatch())
          void locationController.requestLocation();
        activityScenes.push({
          id: "location-context-layers",
          finalize: () => {
            unsubscribeLocationLayers();
            locationController.destroy();
            locationLayers.destroy();
            transitLayers.destroy();
          },
        });
        const restaurantController = addRestaurantExplorer(map);
        const planningController = addPlanBuilder({ map, locationController });
        activityScenes.push(restaurantController);
        activityScenes.push(planningController);
        let applicationControls = null;
        let assistantController = null;
        let mapGuidanceController = null;
        sharedActionDispatch = createRuntimeActionDispatcher({
          map,
          initialCamera: INITIAL_CAMERA,
          featureTour,
          experienceIntro,
          eventController: eventSceneController,
          restaurantController,
          planningController,
          locationController,
          locationLayers,
          transitLayers,
          discoveryAreaLayers,
          applicationControls: () => applicationControls,
          invokeConnector: (actionId, argumentsValue) => {
            if (
              !assistantController ||
              (!actionId.startsWith("map.") &&
                !actionId.startsWith("event.") &&
                !actionId.startsWith("navigation.") &&
                !actionId.startsWith("plan.") &&
                !actionId.startsWith("restaurant.") &&
                !actionId.startsWith("tour."))
            )
              return null;
            return assistantController.executeCapability(
              actionId,
              argumentsValue,
            );
          },
        });
        const dispatchRegisteredCapability = (actionId, argumentsValue) =>
          sharedActionDispatch(actionId, argumentsValue);
        restaurantController.setDirectActionDispatcher?.(
          dispatchRegisteredCapability,
        );
        planningController.setDirectActionDispatcher?.(
          dispatchRegisteredCapability,
        );
        applicationControls = createApplicationActionControls({
          dispatch: dispatchRegisteredCapability,
        });
        activityScenes.push(applicationControls);
        mapGuidanceController = addMapGuidanceControls(map, {
          onShowTour: () => featureTour.start({ force: true }),
          executeCapability: dispatchRegisteredCapability,
        });
        activityScenes.push(mapGuidanceController);
        assistantController = createAssistantController({
          getCandidateEnvelope: () =>
            globalThis.__ASSISTANT_APPROVED_CANDIDATES__ || {
              schemaVersion: "1.0",
              sourceSnapshotId:
                document.body.dataset.snapshotId || "in-memory-current",
              generatedAt: new Date().toISOString(),
              ...resolveCandidateEnvelopeAreas(
                {
                  candidates: [
                    ...(eventSceneController?.getApprovedCandidates?.() || []),
                    ...(restaurantController.getCandidates?.() || []),
                    ...(planningController.getApprovedCandidates?.() || []),
                  ],
                },
                discoveryAreaAsset,
              ),
              sources: [],
            },
          onSelectCandidate: (candidateId) => {
            if (candidateId.startsWith("event:"))
              eventSceneController?.selectCandidate?.(candidateId);
            else if (candidateId.startsWith("restaurant:"))
              restaurantController.selectCandidate?.(candidateId);
            else planningController.selectCandidate?.(candidateId);
          },
          map,
          areaLayerManager: discoveryAreaLayers,
          locationLayers,
          transitLayers,
          eventController: eventSceneController,
          restaurantController,
          planningController,
          featureTour,
          mapGuidanceController,
          experienceIntro,
          getTransitStations: () => transitLayers.getStations?.() || [],
          locationController,
          dispatchAction: sharedActionDispatch,
        });
        activityScenes.push(assistantController);
        if (
          queryParams.get("performanceDiagnostics") === "1" &&
          queryParams.has("performanceVariant")
        ) {
          const { installPerformanceVariantController } =
            await import("./activity-scenes/performance-diagnostic-variants.js");
          performanceVariantController = installPerformanceVariantController({
            map,
            buildingHighlights,
            eventScene: eventSceneController,
            search: window.location.search,
          });
        }
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
  document.body.dataset.applicationError =
    error?.code ?? "application_start_failed";
  console.error("Amble could not start.", error);
});
