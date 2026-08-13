import { Tile3DLayer } from "@deck.gl/geo-layers";
import { MapboxLayer } from "@deck.gl/mapbox";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";

const BACKGROUND_LAYER_ID = "buildings-3d";
const POI_LAYER_ID = "event-venues-3d";
// Preserve the source/material colour. Background prominence is controlled by
// layer opacity instead of multiplying a second grey tint into every surface.
const BACKGROUND_COLOR = [255, 255, 255, 255];
const BACKGROUND_OPACITY = 0.3;
const BACKGROUND_ZOOM_RANGE = [13, 22.1];
const POI_ZOOM_RANGE = [13, 22.1];
const BACKGROUND_SCREEN_SPACE_ERROR = 4;
const POI_SCREEN_SPACE_ERROR = 4;
const MAX_TILE_REQUESTS = 12;
const POI_MEMORY_USAGE_MB = 256;
const INITIAL_VIEW_SETTLE_MS = 600;
const MAX_REFINEMENT_WAIT_MS = 8_000;
const BACKGROUND_FADE_MS = 400;
const PRELOAD_OPACITY = 0.001;
export const LOCAL_BUILDING_ASSET_SCHEMA = "local-building-assets-v1";
export const LOCAL_BUILDING_RENDER_POLICY = Object.freeze({
  backgroundOpacity: BACKGROUND_OPACITY,
  buildingZoomRange: Object.freeze([...BACKGROUND_ZOOM_RANGE]),
  hideBuildingsDuringMovement: true,
  maintainFullDetailDuringMovement: true,
  overlayOpacity: 1,
  overlayDepthParameters: Object.freeze({
    depthFunc: 515,
    depthTest: true,
    polygonOffset: Object.freeze([-1, -1]),
    polygonOffsetFill: true,
  }),
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

const poiIdentity = (poi) =>
  typeof poi?.contentHash === "string" && poi.contentHash
    ? `hash:${poi.contentHash}`
    : `value:${JSON.stringify(canonical(poi))}`;

export function rendererAssetManifestState(manifest, pois = []) {
  if (!manifest)
    return { errors: [], overlayEmpty: pois.length === 0, state: "legacy" };
  const errors = [];
  if (manifest.schemaVersion !== LOCAL_BUILDING_ASSET_SCHEMA)
    errors.push("manifest-schema-invalid");
  if (!["ready", "active-local"].includes(manifest.state))
    errors.push("manifest-not-active");
  if (manifest.background?.complete !== true)
    errors.push("background-incomplete");
  if (typeof manifest.background?.url !== "string" || !manifest.background.url)
    errors.push("background-url-missing");
  if (manifest.background?.opacity !== BACKGROUND_OPACITY)
    errors.push("background-opacity-invalid");
  const overlayEmpty = manifest.overlays?.empty === true && pois.length === 0;
  if (manifest.overlays?.complete !== true) errors.push("overlays-incomplete");
  if (
    !overlayEmpty &&
    (typeof manifest.overlays?.url !== "string" || !manifest.overlays.url)
  )
    errors.push("overlay-url-missing");
  if (manifest.overlays?.opacity !== 1) errors.push("overlay-opacity-invalid");
  if (
    manifest.overlays?.identityCount !== undefined &&
    (!Number.isSafeInteger(manifest.overlays.identityCount) ||
      manifest.overlays.identityCount < 0)
  )
    errors.push("overlay-identity-count-invalid");
  const configuredOwnerCount = new Set(pois.map(({ id }) => id)).size;
  if (
    manifest.overlays?.ownerCount !== undefined &&
    manifest.overlays.ownerCount < configuredOwnerCount
  )
    errors.push("overlay-owner-count-mismatch");
  return {
    errors,
    overlayEmpty,
    state: errors.length
      ? "intentionally-unavailable"
      : overlayEmpty
        ? "empty-overlay"
        : "ready",
  };
}

export function overlayOnlyReloadPlan({
  backgroundUrl,
  previousPois = [],
  nextPois = [],
  previousOverlayUrl,
  nextOverlayUrl,
}) {
  const reconciliation = reconcilePoiGeometry(previousPois, nextPois);
  const overlayChanged =
    reconciliation.actions.some(({ action }) => action !== "noop") ||
    previousOverlayUrl !== nextOverlayUrl;
  return {
    ...reconciliation,
    backgroundChanged: false,
    backgroundUrl,
    overlayChanged,
    overlayUrl: nextOverlayUrl,
  };
}

export function geometryIdentityKeys(pois = []) {
  const keys = new Set();
  for (const poi of pois)
    for (const [tile, batchIds] of Object.entries(poi?.tiles ?? {})) {
      for (const batchId of batchIds ?? []) keys.add(`${tile}#${batchId}`);
    }
  return keys;
}

export function validatePoiGeometrySet(
  pois = [],
  { backgroundIdentityKeys = null } = {},
) {
  if (!Array.isArray(pois)) throw new TypeError("POIs must be an array");
  const poiIds = new Set();
  const geometryOwners = new Map();
  for (const poi of pois) {
    if (!poi?.id) throw new Error("POI identity is missing");
    if (poiIds.has(poi.id))
      throw new Error(`Duplicate POI identity: ${poi.id}`);
    poiIds.add(poi.id);
    for (const key of geometryIdentityKeys([poi])) {
      const owner = geometryOwners.get(key);
      if (owner && owner !== poi.id)
        throw new Error(
          `Highlight geometry identity ${key} belongs to more than one POI (${owner}, ${poi.id})`,
        );
      geometryOwners.set(key, poi.id);
      if (backgroundIdentityKeys?.has(key))
        throw new Error(
          `Highlighted geometry identity ${key} remains in the background`,
        );
    }
  }
  return pois;
}

export function backgroundViewReadiness(tileset, started = true) {
  const selectedTiles = Array.isArray(tileset?.selectedTiles)
    ? tileset.selectedTiles
    : [];
  const readyTiles = selectedTiles.filter(
    (tile) => tile?.contentAvailable === false || Boolean(tile?.content),
  );
  return {
    loaded: Boolean(
      started &&
      selectedTiles.length > 0 &&
      tileset?.isLoaded?.() &&
      readyTiles.length === selectedTiles.length,
    ),
    readyCount: readyTiles.length,
    selectedCount: selectedTiles.length,
  };
}

export function optionalTilesetViewReadiness(readiness, tileset) {
  const emptyViewLoaded = readiness.selectedCount === 0 && Boolean(tileset);
  return {
    loaded: readiness.loaded || emptyViewLoaded,
    renderable:
      emptyViewLoaded ||
      (readiness.selectedCount > 0 &&
        readiness.readyCount === readiness.selectedCount),
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
    if (!current) {
      actions.push({ id, action: "create" });
      pois.push(incoming);
    } else if (poiIdentity(current) === poiIdentity(incoming)) {
      actions.push({ id, action: "noop" });
      pois.push(current);
    } else {
      actions.push({ id, action: "update" });
      pois.push(incoming);
    }
  }
  const restorePoiIds = [];
  for (const id of previous.keys())
    if (!next.has(id)) {
      actions.push({ id, action: "remove" });
      restorePoiIds.push(id);
    }
  return { actions, pois, restorePoiIds };
}

export function createMovementRenderingGuard() {
  let preserveNext = false;
  let preserveCurrent = false;
  return {
    preserveNext() {
      preserveNext = true;
    },
    begin() {
      preserveCurrent = preserveNext;
      preserveNext = false;
      return {
        hideBackground: !preserveCurrent,
        pauseTraversal: !preserveCurrent,
      };
    },
    end() {
      preserveCurrent = false;
    },
  };
}

function incrementBodyCounter(name) {
  document.body.dataset[name] = String(
    Number(document.body.dataset[name] || 0) + 1,
  );
}

function createBackgroundLayer({
  data,
  maximumScreenSpaceError = BACKGROUND_SCREEN_SPACE_ERROR,
  maximumMemoryUsage,
  onTilesetReady,
  onContentReady,
  onTileActivity,
  onTilesetError,
}) {
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
        maximumScreenSpaceError,
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

function createPoiLayer({
  data,
  opacity = PRELOAD_OPACITY,
  onTilesetReady,
  onContentReady,
  onTileActivity,
  onTilesetError,
}) {
  let contentReady = false;
  return new MapboxLayer({
    id: POI_LAYER_ID,
    type: Tile3DLayer,
    data,
    loader: Tiles3DLoader,
    opacity,
    parameters: LOCAL_BUILDING_RENDER_POLICY.overlayDepthParameters,
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
  assetManifest = null,
  background,
  backgroundScreenSpaceError = BACKGROUND_SCREEN_SPACE_ERROR,
  lightingEffect,
  map,
  pois,
  poiTilesetUrl,
  diagnosticWorkloads = null,
  onBackgroundReady,
  onBackgroundError,
  onPoiReady,
  onPoiError,
}) {
  validatePoiGeometrySet(pois);
  const initialManifestState = rendererAssetManifestState(assetManifest, pois);
  if (assetManifest && initialManifestState.errors.length) {
    document.body.dataset.buildingAssetState = initialManifestState.state;
    document.body.dataset.buildingAssetErrors =
      initialManifestState.errors.join(",");
    throw new Error(
      `Local building assets are incomplete: ${initialManifestState.errors.join(", ")}`,
    );
  }
  if (
    !Number.isFinite(backgroundScreenSpaceError) ||
    backgroundScreenSpaceError <= 0
  )
    throw new TypeError("Background screen-space error must be positive");
  const background3dEnabled = diagnosticWorkloads?.background3d !== false;
  const highlighted3dEnabled = diagnosticWorkloads?.highlighted3d !== false;
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
  let initialReadinessTimer = null;
  const movementRendering = createMovementRenderingGuard();
  let lastBackgroundTileActivity = Date.now();
  let lastTileActivity = Date.now();
  let lastReadinessSignature = "";
  let lastReadinessChange = Date.now();
  let initialReadinessStartedAt = Date.now();
  let backgroundFailed = false;
  let overlayFailed = false;
  let overlayReloadCount = 0;

  const updateAssetState = () => {
    let state = initialManifestState.state;
    if (backgroundFailed) state = "background-failed";
    else if (overlayFailed) state = "overlay-failed";
    else if (assetManifest && backgroundRevealed)
      state =
        initialManifestState.overlayEmpty || poiTileset
          ? "complete"
          : "overlay-loading";
    document.body.dataset.buildingAssetState = state;
    document.body.dataset.buildingAssetErrors = [
      ...(initialManifestState.errors ?? []),
      ...(backgroundFailed ? ["background-load-failed"] : []),
      ...(overlayFailed ? ["overlay-load-failed"] : []),
    ].join(",");
  };

  const applyRefinementState = (tileset, screenSpaceError) => {
    tileset?.setProps({ maximumScreenSpaceError: screenSpaceError });
  };

  const setTileTraversal = (loadTiles) => {
    backgroundTileset?.setProps({ loadTiles });
    poiTileset?.setProps({ loadTiles });
    document.body.dataset.tileTraversalState = loadTiles ? "active" : "paused";
  };

  const setBuildingVisibility = (visible) => {
    backgroundLayer?.setProps({ visible });
    poiLayer?.setProps({ visible });
    if (map.getLayer?.(BACKGROUND_LAYER_ID))
      map.setLayoutProperty?.(
        BACKGROUND_LAYER_ID,
        "visibility",
        visible ? "visible" : "none",
      );
    if (map.getLayer?.(POI_LAYER_ID))
      map.setLayoutProperty?.(
        POI_LAYER_ID,
        "visibility",
        visible ? "visible" : "none",
      );
    document.body.dataset.backgroundInteractionVisibility = visible
      ? "visible"
      : "hidden";
    document.body.dataset.poiInteractionVisibility = visible
      ? "visible"
      : "hidden";
    map.triggerRepaint?.();
  };

  const updateRefinementMetadata = (
    state,
    backgroundScreenSpaceError,
    poiScreenSpaceError,
  ) => {
    document.body.dataset.tileRefinementState = state;
    document.body.dataset.backgroundCurrentMaximumScreenSpaceError = String(
      backgroundScreenSpaceError,
    );
    document.body.dataset.poiCurrentMaximumScreenSpaceError =
      String(poiScreenSpaceError);
  };

  const setFullDetailState = (state) => {
    applyRefinementState(backgroundTileset, backgroundScreenSpaceError);
    applyRefinementState(poiTileset, POI_SCREEN_SPACE_ERROR);
    updateRefinementMetadata(
      state,
      backgroundScreenSpaceError,
      POI_SCREEN_SPACE_ERROR,
    );
    map.triggerRepaint?.();
  };

  const animateBuildingOpacity = (
    backgroundTarget,
    poiTarget,
    duration = BACKGROUND_FADE_MS,
  ) => {
    if (!backgroundRevealed && backgroundTarget > 0) backgroundRevealed = true;
    if (opacityAnimationFrame !== null)
      cancelAnimationFrame(opacityAnimationFrame);
    const initialBackgroundOpacity = backgroundOpacity;
    const initialPoiOpacity = poiOpacity;
    const startedAt = performance.now();
    const update = (now) => {
      const progress =
        duration > 0 ? Math.min(1, (now - startedAt) / duration) : 1;
      const eased = 1 - (1 - progress) ** 3;
      backgroundOpacity =
        initialBackgroundOpacity +
        (backgroundTarget - initialBackgroundOpacity) * eased;
      poiOpacity = initialPoiOpacity + (poiTarget - initialPoiOpacity) * eased;
      backgroundLayer?.setProps({ opacity: backgroundOpacity });
      poiLayer?.setProps({ opacity: poiOpacity });
      map.triggerRepaint?.();
      if (progress < 1) opacityAnimationFrame = requestAnimationFrame(update);
      else opacityAnimationFrame = null;
    };
    opacityAnimationFrame = requestAnimationFrame(update);
  };

  const noteTileActivity = ({ background: isBackground = false } = {}) => {
    const now = Date.now();
    lastTileActivity = now;
    if (isBackground) lastBackgroundTileActivity = now;
  };

  const backgroundLayer = background3dEnabled
    ? createBackgroundLayer({
        ...background,
        maximumScreenSpaceError: backgroundScreenSpaceError,
        onTilesetReady: (tileset) => {
          backgroundTileset = tileset;
          applyRefinementState(backgroundTileset, backgroundScreenSpaceError);
        },
        onContentReady: onBackgroundReady,
        onTileActivity: () => noteTileActivity({ background: true }),
        onTilesetError: (error) => {
          backgroundFailed = true;
          updateAssetState();
          onBackgroundError?.(error);
        },
      })
    : null;
  const backgroundPlaceholderLayer = {
    id: BACKGROUND_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd() {},
    render() {},
  };
  const makePoiLayer = () =>
    highlighted3dEnabled && configuredPois.length
      ? createPoiLayer({
          data: combinedPoiTilesetUrl,
          opacity: backgroundRevealed ? 1 : PRELOAD_OPACITY,
          onTilesetReady: (tileset) => {
            poiTileset = tileset;
            applyRefinementState(poiTileset, POI_SCREEN_SPACE_ERROR);
          },
          onContentReady: onPoiReady,
          onTileActivity: () => noteTileActivity(),
          onTilesetError: (error) => {
            overlayFailed = true;
            updateAssetState();
            onPoiError?.(error);
          },
        })
      : null;
  let poiLayer = makePoiLayer();

  const updateMetadata = () => {
    document.body.dataset.poiActiveLayerCount = String(
      started && poiLayer ? 1 : 0,
    );
    document.body.dataset.poiActiveLayerIds =
      started && poiLayer ? POI_LAYER_ID : "";
    document.body.dataset.poiActiveLayerScreenSpaceErrors =
      started && poiLayer ? `${POI_LAYER_ID}:${POI_SCREEN_SPACE_ERROR}` : "";
    document.body.dataset.poiSelectedLayerId = selectedPoiId || "";
  };

  const isBackgroundViewLoaded = () => {
    // The intro can fully cover the canvas, which lets the browser deprioritize
    // WebGL frames. Keep driving tile selection until the visible view is ready.
    map.triggerRepaint?.();
    const readiness = background3dEnabled
      ? backgroundViewReadiness(backgroundTileset, started)
      : { loaded: true, readyCount: 0, selectedCount: 0 };
    const poiReadiness = poiLayer
      ? backgroundViewReadiness(poiTileset, started)
      : { loaded: true, readyCount: 0, selectedCount: 0 };
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
    const stableSince = Math.max(
      lastBackgroundTileActivity,
      lastReadinessChange,
    );
    const readinessTimedOut =
      Date.now() - initialReadinessStartedAt >= MAX_REFINEMENT_WAIT_MS;
    const poiViewReadiness = poiLayer
      ? optionalTilesetViewReadiness(poiReadiness, poiTileset)
      : { loaded: true, renderable: true };
    const selectedViewsRenderable =
      (!background3dEnabled || readiness.selectedCount > 0) &&
      readiness.readyCount === readiness.selectedCount &&
      poiViewReadiness.renderable;
    const normallyLoaded =
      readiness.loaded &&
      poiViewReadiness.loaded &&
      Date.now() - stableSince >= INITIAL_VIEW_SETTLE_MS;
    const loaded =
      !map.isMoving?.() &&
      (normallyLoaded || (readinessTimedOut && selectedViewsRenderable));
    if (loaded && !backgroundRevealed) {
      if (background3dEnabled) animateBuildingOpacity(BACKGROUND_OPACITY, 1);
      else backgroundRevealed = true;
    }
    document.body.dataset.backgroundViewLoaded = String(loaded);
    document.body.dataset.backgroundViewReadyTileCount = String(
      readiness.readyCount,
    );
    document.body.dataset.backgroundViewSelectedTileCount = String(
      readiness.selectedCount,
    );
    document.body.dataset.poiViewReadyTileCount = String(
      poiReadiness.readyCount,
    );
    document.body.dataset.poiViewSelectedTileCount = String(
      poiReadiness.selectedCount,
    );
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
    movementRendering.begin();
    setTileTraversal(true);
    setBuildingVisibility(false);
    setFullDetailState("moving-full-detail");
  };

  const handleMoveEnd = () => {
    if (!started) return;
    setTileTraversal(true);
    movementRendering.end();
    setBuildingVisibility(true);
    setFullDetailState("full-detail");
  };

  const setSelectedPoi = (id = null) => {
    selectedPoiId = configuredPois.some((poi) => poi.id === id) ? id : null;
    document.body.dataset.poiSelectedMaximumScreenSpaceError = selectedPoiId
      ? String(POI_SCREEN_SPACE_ERROR)
      : "";
    updateMetadata();
    return Boolean(selectedPoiId);
  };

  const preserveNextMovement = () => {
    movementRendering.preserveNext();
  };

  const start = () => {
    if (started || map.getLayer(BACKGROUND_LAYER_ID)) return false;
    map.addLayer(backgroundLayer ?? backgroundPlaceholderLayer);
    map.setLayerZoomRange(BACKGROUND_LAYER_ID, ...BACKGROUND_ZOOM_RANGE);
    backgroundLayer?.deck.setProps({ effects: [lightingEffect] });
    if (poiLayer) {
      map.addLayer(poiLayer);
      map.setLayerZoomRange(POI_LAYER_ID, ...POI_ZOOM_RANGE);
      poiLayer.deck.setProps({ effects: [lightingEffect] });
    }
    started = true;
    initialReadinessStartedAt = Date.now();
    document.body.dataset.buildingsLayerStarted = "true";
    document.body.dataset.backgroundBuildings = "colour-preserving-lite";
    document.body.dataset.backgroundOpacity = String(BACKGROUND_OPACITY);
    document.body.dataset.poiOpacity = "1";
    document.body.dataset.overlayDepthPreference = "polygon-offset--1";
    document.body.dataset.buildingAssetManifestId =
      assetManifest?.manifestId ?? "";
    document.body.dataset.backgroundAssetIdentity =
      assetManifest?.background?.manifestId ?? "";
    document.body.dataset.overlayAssetIdentity =
      assetManifest?.overlays?.catalogueId ?? "";
    document.body.dataset.background3dEnabled = String(background3dEnabled);
    document.body.dataset.highlighted3dEnabled = String(highlighted3dEnabled);
    document.body.dataset.backgroundTilesetUrl = background.data;
    document.body.dataset.backgroundPoiExcluded = configuredPois
      .map((poi) => poi.label)
      .join(",");
    document.body.dataset.poiFullOpacity = configuredPois
      .map((poi) => poi.label)
      .join(",");
    document.body.dataset.poiHighlightManager = "combined";
    document.body.dataset.backgroundMaximumScreenSpaceError = String(
      backgroundScreenSpaceError,
    );
    document.body.dataset.poiDefaultMaximumScreenSpaceError = String(
      POI_SCREEN_SPACE_ERROR,
    );
    document.body.dataset.poiConfiguredLayerCount = String(
      configuredPois.length,
    );
    document.body.dataset.poiCombinedVenueCount = String(configuredPois.length);
    document.body.dataset.poiCombinedTilesetUrl = combinedPoiTilesetUrl;
    document.body.dataset.poiPreload = "disabled";
    document.body.dataset.poiPreloadCount = "0";
    document.body.dataset.tileRefinementMovingMaximumScreenSpaceError = String(
      POI_SCREEN_SPACE_ERROR,
    );
    document.body.dataset.tileRefinementSettleMs = "0";
    document.body.dataset.initialViewSettleMs = String(INITIAL_VIEW_SETTLE_MS);
    document.body.dataset.tileRefinementMaximumWaitMs = String(
      MAX_REFINEMENT_WAIT_MS,
    );
    document.body.dataset.tileTraversalState = "active";
    document.body.dataset.backgroundInteractionVisibility = "visible";
    document.body.dataset.poiInteractionVisibility = "visible";
    updateRefinementMetadata(
      "full-detail",
      backgroundScreenSpaceError,
      POI_SCREEN_SPACE_ERROR,
    );
    map.on?.("movestart", handleMoveStart);
    map.on?.("moveend", handleMoveEnd);
    initialReadinessTimer = window.setTimeout(pollInitialReadiness, 0);
    updateMetadata();
    updateAssetState();
    return true;
  };

  const destroy = () => {
    map.off?.("movestart", handleMoveStart);
    map.off?.("moveend", handleMoveEnd);
    if (initialReadinessTimer !== null) clearTimeout(initialReadinessTimer);
    if (opacityAnimationFrame !== null)
      cancelAnimationFrame(opacityAnimationFrame);
    try {
      if (map.getLayer(POI_LAYER_ID)) map.removeLayer(POI_LAYER_ID);
      if (map.getLayer(BACKGROUND_LAYER_ID))
        map.removeLayer(BACKGROUND_LAYER_ID);
    } catch {
      // Map removal already finalized its style and custom layers.
    }
    started = false;
    backgroundTileset = null;
    poiTileset = null;
    opacityAnimationFrame = null;
    initialReadinessTimer = null;
    updateMetadata();
  };

  const reconcile = ({
    pois: nextPois,
    poiTilesetUrl: nextTilesetUrl = combinedPoiTilesetUrl,
    snapshotId = "",
  }) => {
    const result = reconcilePoiGeometry(configuredPois, nextPois);
    const geometryChanged =
      result.actions.some(({ action }) => action !== "noop") ||
      nextTilesetUrl !== combinedPoiTilesetUrl;
    if (!geometryChanged) return { ...result, changed: false };
    if (started && map.getLayer(POI_LAYER_ID)) map.removeLayer(POI_LAYER_ID);
    configuredPois = result.pois;
    combinedPoiTilesetUrl = nextTilesetUrl;
    poiTileset = null;
    overlayFailed = false;
    overlayReloadCount += 1;
    poiLayer = makePoiLayer();
    if (started && poiLayer) {
      map.addLayer(poiLayer);
      map.setLayerZoomRange(POI_LAYER_ID, ...POI_ZOOM_RANGE);
      poiLayer.deck.setProps({ effects: [lightingEffect] });
    }
    if (selectedPoiId && !configuredPois.some(({ id }) => id === selectedPoiId))
      selectedPoiId = null;
    document.body.dataset.backgroundPoiExcluded = configuredPois
      .map((poi) => poi.label)
      .join(",");
    document.body.dataset.poiFullOpacity = configuredPois
      .map((poi) => poi.label)
      .join(",");
    document.body.dataset.poiConfiguredLayerCount = String(
      configuredPois.length,
    );
    document.body.dataset.poiCombinedVenueCount = String(configuredPois.length);
    document.body.dataset.poiCombinedTilesetUrl = combinedPoiTilesetUrl;
    document.body.dataset.poiSnapshotId = snapshotId;
    document.body.dataset.poiRestoreIds = result.restorePoiIds.join(",");
    document.body.dataset.overlayReloadCount = String(overlayReloadCount);
    document.body.dataset.buildingAssetState = configuredPois.length
      ? "overlay-loading"
      : "empty-overlay";
    updateMetadata();
    return { ...result, changed: true };
  };

  const diagnosticTilesetSnapshot = (tileset) => {
    const selected = Array.isArray(tileset?.selectedTiles)
      ? tileset.selectedTiles
      : [];
    return {
      present: Boolean(tileset),
      loaded: Boolean(tileset?.isLoaded?.()),
      loadTiles: tileset?.options?.loadTiles ?? null,
      maximumScreenSpaceError:
        tileset?.options?.maximumScreenSpaceError ?? null,
      selectedCount: selected.length,
      renderableCount: selected.filter(
        (tile) => tile?.contentAvailable === false || Boolean(tile?.content),
      ).length,
      selected: selected.slice(0, 100).map((tile) => ({
        id: String(tile?.id ?? ""),
        contentUrl:
          tile?.contentUrl ??
          tile?.content?.url ??
          tile?.header?.content?.uri ??
          tile?.header?.content?.url ??
          null,
        geometricError: tile?.geometricError ?? null,
      })),
    };
  };

  const diagnosticSnapshot = () => ({
    started,
    background3dEnabled,
    highlighted3dEnabled,
    assetState: document.body.dataset.buildingAssetState ?? null,
    backgroundOpacity,
    poiOpacity,
    overlayReloadCount,
    backgroundUrl: background.data,
    overlayUrl: combinedPoiTilesetUrl,
    backgroundLayerPresent: Boolean(map.getLayer(BACKGROUND_LAYER_ID)),
    poiLayerPresent: Boolean(map.getLayer(POI_LAYER_ID)),
    refinementState: document.body.dataset.tileRefinementState ?? null,
    traversalState: document.body.dataset.tileTraversalState ?? null,
    background: diagnosticTilesetSnapshot(backgroundTileset),
    highlighted: diagnosticTilesetSnapshot(poiTileset),
  });

  const setDiagnosticTileTraversal = (loadTiles) => {
    setTileTraversal(loadTiles === true);
    return diagnosticSnapshot();
  };

  return {
    destroy,
    diagnosticSnapshot,
    isBackgroundViewLoaded,
    preserveNextMovementRendering: preserveNextMovement,
    reconcile,
    setDiagnosticTileTraversal,
    setSelectedPoi,
    start,
  };
}
