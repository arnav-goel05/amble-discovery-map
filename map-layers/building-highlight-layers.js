import { Tile3DLayer } from "@deck.gl/geo-layers";
import { MapboxLayer } from "@deck.gl/mapbox";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";

const BACKGROUND_LAYER_ID = "buildings-3d";
const POI_LAYER_ID = "event-venues-3d";
const BACKGROUND_COLOR = [196, 204, 205, 145];
const BACKGROUND_OPACITY = 0.3;
const BACKGROUND_ZOOM_RANGE = [13, 22.1];
const POI_ZOOM_RANGE = [15, 22.1];
const BACKGROUND_SCREEN_SPACE_ERROR = 4;
const POI_SCREEN_SPACE_ERROR = 4;
const MOVING_SCREEN_SPACE_ERROR = 12;
const MAX_TILE_REQUESTS = 12;
const POI_MEMORY_USAGE_MB = 256;
const INITIAL_VIEW_SETTLE_MS = 600;
const MOVEMENT_SETTLE_MS = 350;
const MAX_REFINEMENT_WAIT_MS = 8_000;
const BACKGROUND_FADE_MS = 400;
const PRELOAD_OPACITY = 0.001;
const BACKGROUND_MOVING_OPACITY = 0.2;
const POI_MOVING_OPACITY = 0.8;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

const poiIdentity = (poi) => typeof poi?.contentHash === "string" && poi.contentHash
  ? `hash:${poi.contentHash}` : `value:${JSON.stringify(canonical(poi))}`;

export function geometryIdentityKeys(pois = []) {
  const keys = new Set();
  for (const poi of pois) for (const [tile, batchIds] of Object.entries(poi?.tiles ?? {})) {
    for (const batchId of batchIds ?? []) keys.add(`${tile}#${batchId}`);
  }
  return keys;
}

export function validatePoiGeometrySet(pois = [], { backgroundIdentityKeys = null } = {}) {
  if (!Array.isArray(pois)) throw new TypeError("POIs must be an array");
  const poiIds = new Set();
  const geometryOwners = new Map();
  for (const poi of pois) {
    if (!poi?.id) throw new Error("POI identity is missing");
    if (poiIds.has(poi.id)) throw new Error(`Duplicate POI identity: ${poi.id}`);
    poiIds.add(poi.id);
    for (const key of geometryIdentityKeys([poi])) {
      const owner = geometryOwners.get(key);
      if (owner && owner !== poi.id) throw new Error(`Highlight geometry identity ${key} belongs to more than one POI (${owner}, ${poi.id})`);
      geometryOwners.set(key, poi.id);
      if (backgroundIdentityKeys?.has(key)) throw new Error(`Highlighted geometry identity ${key} remains in the background`);
    }
  }
  return pois;
}

export function backgroundViewReadiness(tileset, started = true) {
  const selectedTiles = Array.isArray(tileset?.selectedTiles) ? tileset.selectedTiles : [];
  const readyTiles = selectedTiles.filter((tile) => tile?.contentAvailable === false || Boolean(tile?.content));
  return {
    loaded: Boolean(started && selectedTiles.length > 0 && tileset?.isLoaded?.() && readyTiles.length === selectedTiles.length),
    readyCount: readyTiles.length,
    selectedCount: selectedTiles.length,
  };
}

export function reconcilePoiGeometry(previousPois = [], nextPois = []) {
  validatePoiGeometrySet(previousPois);
  validatePoiGeometrySet(nextPois);
  const previous = new Map(previousPois.map((poi) => [poi.id, poi]));
  const next = new Map(nextPois.map((poi) => [poi.id, poi]));
  const actions = [];
  const pois = [];
  for (const [id, incoming] of next) {
    const current = previous.get(id);
    if (!current) { actions.push({ id, action: "create" }); pois.push(incoming); }
    else if (poiIdentity(current) === poiIdentity(incoming)) { actions.push({ id, action: "noop" }); pois.push(current); }
    else { actions.push({ id, action: "update" }); pois.push(incoming); }
  }
  const restorePoiIds = [];
  for (const id of previous.keys()) if (!next.has(id)) { actions.push({ id, action: "remove" }); restorePoiIds.push(id); }
  return { actions, pois, restorePoiIds };
}

function incrementBodyCounter(name) {
  document.body.dataset[name] = String(Number(document.body.dataset[name] || 0) + 1);
}

function createBackgroundLayer({ data, maximumMemoryUsage, onTilesetReady, onContentReady, onTileActivity, onTilesetError }) {
  let contentReady = false;
  return new MapboxLayer({
    id: BACKGROUND_LAYER_ID,
    type: Tile3DLayer,
    data,
    loader: Tiles3DLoader,
    // Deck.gl skips viewport activation for a fully transparent composite layer.
    // Keep an imperceptible opacity so initial tiles continue preloading.
    opacity: PRELOAD_OPACITY,
    _subLayerProps: { scenegraph: { getColor: BACKGROUND_COLOR } },
    loadOptions: {
      draco: { workerUrl: "/draco-worker.js" },
      tileset: {
        throttleRequests: true,
        maxRequests: MAX_TILE_REQUESTS,
        maximumMemoryUsage,
        viewDistanceScale: 1,
        updateTransforms: true,
        maximumScreenSpaceError: BACKGROUND_SCREEN_SPACE_ERROR,
      },
    },
    onTilesetLoad: (tileset) => {
      document.body.dataset.tilesetLoaded = "true";
      onTilesetReady(tileset);
    },
    onTileLoad: () => {
      incrementBodyCounter("tileLoadCount");
      onTileActivity?.();
      if (!contentReady) {
        contentReady = true;
        onContentReady?.();
      }
    },
    onTileError: (error) => {
      incrementBodyCounter("tileErrorCount");
      onTilesetError?.(error);
      console.warn("Tile load error", error);
    },
  });
}

function createPoiLayer({ data, opacity = PRELOAD_OPACITY, onTilesetReady, onContentReady, onTileActivity, onTilesetError }) {
  let contentReady = false;
  return new MapboxLayer({
    id: POI_LAYER_ID,
    type: Tile3DLayer,
    data,
    loader: Tiles3DLoader,
    opacity,
    _subLayerProps: {
      scenegraph: { getColor: [255, 255, 255, 255] },
      mesh: { getColor: [255, 255, 255, 255] },
    },
    loadOptions: {
      draco: { workerUrl: "/draco-worker.js" },
      tileset: {
        throttleRequests: true,
        maxRequests: MAX_TILE_REQUESTS,
        maximumMemoryUsage: POI_MEMORY_USAGE_MB,
        viewDistanceScale: 1,
        updateTransforms: true,
        maximumScreenSpaceError: POI_SCREEN_SPACE_ERROR,
      },
    },
    onTilesetLoad: (tileset) => {
      document.body.dataset.poiCombinedTilesetLoaded = "true";
      onTilesetReady(tileset);
    },
    onTileLoad: () => {
      incrementBodyCounter("poiTileLoadCount");
      onTileActivity?.();
      if (!contentReady) {
        contentReady = true;
        onContentReady?.();
      }
    },
    onTileError: (error) => {
      incrementBodyCounter("poiTileErrorCount");
      onTilesetError?.(error);
      console.warn("Combined POI tile load error", error);
    },
  });
}

export function createBuildingHighlightLayerManager({
  background,
  lightingEffect,
  map,
  pois,
  poiTilesetUrl,
  onBackgroundReady,
  onBackgroundError,
  onPoiReady,
  onPoiError,
}) {
  validatePoiGeometrySet(pois);
  let configuredPois = [...pois];
  let combinedPoiTilesetUrl = poiTilesetUrl;
  let backgroundTileset = null;
  let poiTileset = null;
  let selectedPoiId = null;
  let started = false;
  let backgroundRevealed = false;
  let backgroundOpacity = PRELOAD_OPACITY;
  let poiOpacity = PRELOAD_OPACITY;
  let opacityAnimationFrame = null;
  let refinementTimer = null;
  let refinementSettleTimer = null;
  let refinementMaximumTimer = null;
  let initialReadinessTimer = null;
  let waitingForSettledDetail = false;
  let refinementStartedAt = 0;
  let lastBackgroundTileActivity = Date.now();
  let lastTileActivity = Date.now();
  let lastReadinessSignature = "";
  let lastReadinessChange = Date.now();
  let initialReadinessStartedAt = Date.now();

  const applyRefinementState = (tileset, screenSpaceError) => {
    tileset?.setProps({ maximumScreenSpaceError: screenSpaceError });
  };

  const updateRefinementMetadata = (state, backgroundScreenSpaceError, poiScreenSpaceError) => {
    document.body.dataset.tileRefinementState = state;
    document.body.dataset.backgroundCurrentMaximumScreenSpaceError = String(backgroundScreenSpaceError);
    document.body.dataset.poiCurrentMaximumScreenSpaceError = String(poiScreenSpaceError);
  };

  const setRefinementState = (state, screenSpaceError) => {
    applyRefinementState(backgroundTileset, screenSpaceError);
    applyRefinementState(poiTileset, screenSpaceError);
    updateRefinementMetadata(state, screenSpaceError, screenSpaceError);
    map.triggerRepaint?.();
  };

  const animateBuildingOpacity = (backgroundTarget, poiTarget, duration = BACKGROUND_FADE_MS) => {
    if (!backgroundRevealed && backgroundTarget > 0) backgroundRevealed = true;
    if (opacityAnimationFrame !== null) cancelAnimationFrame(opacityAnimationFrame);
    const initialBackgroundOpacity = backgroundOpacity;
    const initialPoiOpacity = poiOpacity;
    const startedAt = performance.now();
    const update = (now) => {
      const progress = duration > 0 ? Math.min(1, (now - startedAt) / duration) : 1;
      const eased = 1 - (1 - progress) ** 3;
      backgroundOpacity = initialBackgroundOpacity + ((backgroundTarget - initialBackgroundOpacity) * eased);
      poiOpacity = initialPoiOpacity + ((poiTarget - initialPoiOpacity) * eased);
      backgroundLayer.setProps({ opacity: backgroundOpacity });
      poiLayer?.setProps({ opacity: poiOpacity });
      map.triggerRepaint?.();
      if (progress < 1) opacityAnimationFrame = requestAnimationFrame(update);
      else opacityAnimationFrame = null;
    };
    opacityAnimationFrame = requestAnimationFrame(update);
  };

  const selectedTilesRenderable = (tileset) => {
    if (!tileset) return true;
    const selectedTiles = Array.isArray(tileset.selectedTiles) ? tileset.selectedTiles : [];
    return selectedTiles.every((tile) => tile?.contentAvailable === false || Boolean(tile?.content));
  };

  const finishSettledDetail = () => {
    if (!waitingForSettledDetail) return;
    waitingForSettledDetail = false;
    if (refinementSettleTimer !== null) clearTimeout(refinementSettleTimer);
    if (refinementMaximumTimer !== null) clearTimeout(refinementMaximumTimer);
    refinementSettleTimer = null;
    refinementMaximumTimer = null;
    updateRefinementMetadata("full-detail", BACKGROUND_SCREEN_SPACE_ERROR, POI_SCREEN_SPACE_ERROR);
    if (backgroundRevealed) animateBuildingOpacity(BACKGROUND_OPACITY, 1);
  };

  const scheduleSettledDetail = () => {
    if (refinementSettleTimer !== null) clearTimeout(refinementSettleTimer);
    if (!waitingForSettledDetail || map.isMoving?.()) return;
    const quietFor = Date.now() - lastTileActivity;
    const delay = Math.max(100, INITIAL_VIEW_SETTLE_MS - quietFor);
    refinementSettleTimer = window.setTimeout(() => {
      refinementSettleTimer = null;
      if (!waitingForSettledDetail || map.isMoving?.()) return;
      const exceededMaximumWait = Date.now() - refinementStartedAt >= MAX_REFINEMENT_WAIT_MS;
      const viewIsSettled = Date.now() - lastTileActivity >= INITIAL_VIEW_SETTLE_MS
        && selectedTilesRenderable(backgroundTileset)
        && selectedTilesRenderable(poiTileset);
      if (!viewIsSettled && !exceededMaximumWait) {
        scheduleSettledDetail();
        return;
      }
      finishSettledDetail();
    }, delay);
  };

  const noteTileActivity = ({ background: isBackground = false } = {}) => {
    const now = Date.now();
    lastTileActivity = now;
    if (isBackground) lastBackgroundTileActivity = now;
    if (waitingForSettledDetail) scheduleSettledDetail();
  };

  const backgroundLayer = createBackgroundLayer({
    ...background,
    onTilesetReady: (tileset) => {
      backgroundTileset = tileset;
      applyRefinementState(backgroundTileset, BACKGROUND_SCREEN_SPACE_ERROR);
    },
    onContentReady: onBackgroundReady,
    onTileActivity: () => noteTileActivity({ background: true }),
    onTilesetError: onBackgroundError,
  });
  const makePoiLayer = () => configuredPois.length ? createPoiLayer({
    data: combinedPoiTilesetUrl,
    opacity: backgroundRevealed ? 1 : PRELOAD_OPACITY,
    onTilesetReady: (tileset) => {
      poiTileset = tileset;
      applyRefinementState(poiTileset, POI_SCREEN_SPACE_ERROR);
    },
    onContentReady: onPoiReady,
    onTileActivity: () => noteTileActivity(),
    onTilesetError: onPoiError,
  }) : null;
  let poiLayer = makePoiLayer();

  const updateMetadata = () => {
    document.body.dataset.poiActiveLayerCount = String(started && poiLayer ? 1 : 0);
    document.body.dataset.poiActiveLayerIds = started && poiLayer ? POI_LAYER_ID : "";
    document.body.dataset.poiActiveLayerScreenSpaceErrors = started && poiLayer ? `${POI_LAYER_ID}:${POI_SCREEN_SPACE_ERROR}` : "";
    document.body.dataset.poiSelectedLayerId = selectedPoiId || "";
  };

  const isBackgroundViewLoaded = () => {
    // The intro can fully cover the canvas, which lets the browser deprioritize
    // WebGL frames. Keep driving tile selection until the visible view is ready.
    map.triggerRepaint?.();
    const readiness = backgroundViewReadiness(backgroundTileset, started);
    const poiReadiness = poiLayer ? backgroundViewReadiness(poiTileset, started) : { loaded: true, readyCount: 0, selectedCount: 0 };
    const signature = [
      readiness.selectedCount,
      readiness.readyCount,
      ...(backgroundTileset?.selectedTiles ?? []).map((tile) => tile.id).sort(),
      poiReadiness.selectedCount,
      poiReadiness.readyCount,
      ...(poiTileset?.selectedTiles ?? []).map((tile) => tile.id).sort(),
    ].join("|");
    if (signature !== lastReadinessSignature) {
      lastReadinessSignature = signature;
      lastReadinessChange = Date.now();
    }
    const stableSince = Math.max(lastBackgroundTileActivity, lastReadinessChange);
    const readinessTimedOut = Date.now() - initialReadinessStartedAt >= MAX_REFINEMENT_WAIT_MS;
    const selectedViewsRenderable = readiness.selectedCount > 0
      && readiness.readyCount === readiness.selectedCount
      && (!poiLayer || (poiReadiness.selectedCount > 0 && poiReadiness.readyCount === poiReadiness.selectedCount));
    const normallyLoaded = readiness.loaded && poiReadiness.loaded && Date.now() - stableSince >= INITIAL_VIEW_SETTLE_MS;
    const loaded = !map.isMoving?.() && (normallyLoaded || (readinessTimedOut && selectedViewsRenderable));
    if (loaded && !backgroundRevealed) animateBuildingOpacity(BACKGROUND_OPACITY, 1);
    document.body.dataset.backgroundViewLoaded = String(loaded);
    document.body.dataset.backgroundViewReadyTileCount = String(readiness.readyCount);
    document.body.dataset.backgroundViewSelectedTileCount = String(readiness.selectedCount);
    document.body.dataset.poiViewReadyTileCount = String(poiReadiness.readyCount);
    document.body.dataset.poiViewSelectedTileCount = String(poiReadiness.selectedCount);
    return loaded;
  };

  const pollInitialReadiness = () => {
    if (!started || backgroundRevealed) {
      initialReadinessTimer = null;
      return;
    }
    isBackgroundViewLoaded();
    initialReadinessTimer = window.setTimeout(pollInitialReadiness, 100);
  };

  const handleMoveStart = () => {
    if (!started) return;
    if (refinementTimer !== null) clearTimeout(refinementTimer);
    if (refinementSettleTimer !== null) clearTimeout(refinementSettleTimer);
    if (refinementMaximumTimer !== null) clearTimeout(refinementMaximumTimer);
    waitingForSettledDetail = false;
    setRefinementState("moving-coarse", MOVING_SCREEN_SPACE_ERROR);
    if (backgroundRevealed) animateBuildingOpacity(BACKGROUND_MOVING_OPACITY, POI_MOVING_OPACITY, 160);
  };

  const handleMoveEnd = () => {
    if (!started) return;
    updateRefinementMetadata("settling", MOVING_SCREEN_SPACE_ERROR, MOVING_SCREEN_SPACE_ERROR);
    if (refinementTimer !== null) clearTimeout(refinementTimer);
    refinementTimer = window.setTimeout(() => {
      refinementTimer = null;
      lastTileActivity = Date.now();
      refinementStartedAt = lastTileActivity;
      waitingForSettledDetail = true;
      setRefinementState("refining", BACKGROUND_SCREEN_SPACE_ERROR);
      refinementMaximumTimer = window.setTimeout(finishSettledDetail, MAX_REFINEMENT_WAIT_MS);
      scheduleSettledDetail();
    }, MOVEMENT_SETTLE_MS);
  };

  const setSelectedPoi = (id = null) => {
    selectedPoiId = configuredPois.some((poi) => poi.id === id) ? id : null;
    document.body.dataset.poiSelectedMaximumScreenSpaceError = selectedPoiId ? String(POI_SCREEN_SPACE_ERROR) : "";
    updateMetadata();
    return Boolean(selectedPoiId);
  };

  const start = () => {
    if (started || map.getLayer(BACKGROUND_LAYER_ID)) return false;
    map.addLayer(backgroundLayer);
    map.setLayerZoomRange(BACKGROUND_LAYER_ID, ...BACKGROUND_ZOOM_RANGE);
    backgroundLayer.deck.setProps({ effects: [lightingEffect] });
    if (poiLayer) {
      map.addLayer(poiLayer);
      map.setLayerZoomRange(POI_LAYER_ID, ...POI_ZOOM_RANGE);
      poiLayer.deck.setProps({ effects: [lightingEffect] });
    }
    started = true;
    initialReadinessStartedAt = Date.now();
    document.body.dataset.buildingsLayerStarted = "true";
    document.body.dataset.backgroundBuildings = "muted-grey";
    document.body.dataset.backgroundTilesetUrl = background.data;
    document.body.dataset.backgroundPoiExcluded = configuredPois.map((poi) => poi.label).join(",");
    document.body.dataset.poiFullOpacity = configuredPois.map((poi) => poi.label).join(",");
    document.body.dataset.poiHighlightManager = "combined";
    document.body.dataset.backgroundMaximumScreenSpaceError = String(BACKGROUND_SCREEN_SPACE_ERROR);
    document.body.dataset.poiDefaultMaximumScreenSpaceError = String(POI_SCREEN_SPACE_ERROR);
    document.body.dataset.poiConfiguredLayerCount = String(configuredPois.length);
    document.body.dataset.poiCombinedVenueCount = String(configuredPois.length);
    document.body.dataset.poiCombinedTilesetUrl = combinedPoiTilesetUrl;
    document.body.dataset.poiPreload = "disabled";
    document.body.dataset.poiPreloadCount = "0";
    document.body.dataset.tileRefinementMovingMaximumScreenSpaceError = String(MOVING_SCREEN_SPACE_ERROR);
    document.body.dataset.tileRefinementSettleMs = String(MOVEMENT_SETTLE_MS);
    document.body.dataset.initialViewSettleMs = String(INITIAL_VIEW_SETTLE_MS);
    document.body.dataset.tileRefinementMaximumWaitMs = String(MAX_REFINEMENT_WAIT_MS);
    updateRefinementMetadata("full-detail", BACKGROUND_SCREEN_SPACE_ERROR, POI_SCREEN_SPACE_ERROR);
    map.on?.("movestart", handleMoveStart);
    map.on?.("moveend", handleMoveEnd);
    initialReadinessTimer = window.setTimeout(pollInitialReadiness, 0);
    updateMetadata();
    return true;
  };

  const destroy = () => {
    map.off?.("movestart", handleMoveStart);
    map.off?.("moveend", handleMoveEnd);
    if (refinementTimer !== null) clearTimeout(refinementTimer);
    if (refinementSettleTimer !== null) clearTimeout(refinementSettleTimer);
    if (refinementMaximumTimer !== null) clearTimeout(refinementMaximumTimer);
    if (initialReadinessTimer !== null) clearTimeout(initialReadinessTimer);
    if (opacityAnimationFrame !== null) cancelAnimationFrame(opacityAnimationFrame);
    try {
      if (map.getLayer(POI_LAYER_ID)) map.removeLayer(POI_LAYER_ID);
      if (map.getLayer(BACKGROUND_LAYER_ID)) map.removeLayer(BACKGROUND_LAYER_ID);
    } catch {
      // Map removal already finalized its style and custom layers.
    }
    started = false;
    backgroundTileset = null;
    poiTileset = null;
    opacityAnimationFrame = null;
    refinementTimer = null;
    refinementSettleTimer = null;
    refinementMaximumTimer = null;
    initialReadinessTimer = null;
    updateMetadata();
  };

  const reconcile = ({ pois: nextPois, poiTilesetUrl: nextTilesetUrl = combinedPoiTilesetUrl, snapshotId = "" }) => {
    const result = reconcilePoiGeometry(configuredPois, nextPois);
    const geometryChanged = result.actions.some(({ action }) => action !== "noop") || nextTilesetUrl !== combinedPoiTilesetUrl;
    if (!geometryChanged) return { ...result, changed: false };
    if (started && map.getLayer(POI_LAYER_ID)) map.removeLayer(POI_LAYER_ID);
    configuredPois = result.pois;
    combinedPoiTilesetUrl = nextTilesetUrl;
    poiTileset = null;
    poiLayer = makePoiLayer();
    if (started && poiLayer) {
      map.addLayer(poiLayer);
      map.setLayerZoomRange(POI_LAYER_ID, ...POI_ZOOM_RANGE);
      poiLayer.deck.setProps({ effects: [lightingEffect] });
    }
    if (selectedPoiId && !configuredPois.some(({ id }) => id === selectedPoiId)) selectedPoiId = null;
    document.body.dataset.backgroundPoiExcluded = configuredPois.map((poi) => poi.label).join(",");
    document.body.dataset.poiFullOpacity = configuredPois.map((poi) => poi.label).join(",");
    document.body.dataset.poiConfiguredLayerCount = String(configuredPois.length);
    document.body.dataset.poiCombinedVenueCount = String(configuredPois.length);
    document.body.dataset.poiCombinedTilesetUrl = combinedPoiTilesetUrl;
    document.body.dataset.poiSnapshotId = snapshotId;
    document.body.dataset.poiRestoreIds = result.restorePoiIds.join(",");
    updateMetadata();
    return { ...result, changed: true };
  };

  return { destroy, isBackgroundViewLoaded, reconcile, setSelectedPoi, start };
}
