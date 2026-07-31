const CONNECTOR_ID = "map";
const CAPABILITY_IDS = Object.freeze([
  "map.zoomin",
  "map.zoomout",
  "map.pan",
  "map.rotate",
  "map.focustarget",
  "map.resetview",
  "map.setlayervisibility",
]);
const CAMERA_CAPABILITIES = new Set([
  "map.zoomin",
  "map.zoomout",
  "map.pan",
  "map.rotate",
  "map.resetview",
]);
const LAYERS = new Set([
  "recommendations",
  "location",
  "mrtStations",
  "mrtLines",
]);
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
const INITIAL_CAMERA = Object.freeze({
  center: [103.857897, 1.285844],
  zoom: 15.3,
  pitch: 45,
  bearing: -30,
});

export class MapConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MapConnectorError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new MapConnectorError(code, message);
};
const method = (owner, name) =>
  typeof owner?.[name] === "function" ? owner[name].bind(owner) : null;
const finite = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
};
const normalizeBearing = (value) => {
  const normalized = ((((Number(value) + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
};

function centerValue(value) {
  const longitude = Array.isArray(value) ? value[0] : value?.lng;
  const latitude = Array.isArray(value) ? value[1] : value?.lat;
  return [
    finite(longitude, 103.857897, -180, 180),
    finite(latitude, 1.285844, -90, 90),
  ];
}

function ownerSnapshot(owner) {
  try {
    return owner?.snapshot?.() || {};
  } catch {
    return {};
  }
}

function layerVisible(owner, layer) {
  const state = ownerSnapshot(owner);
  const value =
    state.visibility?.[layer] ??
    state.layers?.[layer]?.visible ??
    state.layers?.[layer] ??
    state.visible;
  return value === true;
}

function projectTargets(values) {
  const seen = new Set();
  const targets = [];
  for (const value of Array.isArray(values) ? values : []) {
    const targetId =
      typeof value?.targetId === "string" ? value.targetId.slice(0, 256) : "";
    const type = typeof value?.type === "string" ? value.type.slice(0, 64) : "";
    const label =
      typeof value?.label === "string" ? value.label.slice(0, 200) : "";
    if (!TARGET_ID.test(targetId) || !type || !label || seen.has(targetId))
      continue;
    seen.add(targetId);
    targets.push(Object.freeze({ targetId, type, label }));
    if (targets.length === 50) break;
  }
  return targets;
}

function cameraState(map, mapController) {
  const controllerState = ownerSnapshot(mapController);
  const viewport = controllerState.viewport || controllerState.camera || {};
  const center =
    viewport.center ?? controllerState.center ?? map?.getCenter?.();
  const zoom = viewport.zoom ?? controllerState.zoom ?? map?.getZoom?.();
  const pitch = viewport.pitch ?? controllerState.pitch ?? map?.getPitch?.();
  const bearing =
    viewport.bearing ?? controllerState.bearing ?? map?.getBearing?.();
  return Object.freeze({
    center: Object.freeze(centerValue(center)),
    zoom: finite(zoom, 0, 0, 24),
    pitch: finite(pitch, 0, 0, 85),
    bearing: normalizeBearing(finite(bearing, 0, -360, 360)),
  });
}

function contextPatch(snapshot) {
  return Object.freeze({
    viewport: snapshot.viewport,
    visibleTargets: snapshot.visibleTargets,
    focusedTargetId: snapshot.focusedTargetId,
    selectedTargetIds: snapshot.selectedTargetIds,
    transit: snapshot.transit,
    availableCapabilityIds: snapshot.availableCapabilityIds,
  });
}

function semanticSnapshot(snapshot) {
  const { revision: _revision, ...semantic } = snapshot;
  return semantic;
}

export function createMapConnector({
  map = null,
  mapController = null,
  recommendationLayers = null,
  discoveryAreaLayers = recommendationLayers,
  locationLayers = null,
  transitLayers = null,
  layerIds = null,
  getVisibleTargets = () => [],
  getFocusedTargetId = () => null,
  focusTarget = null,
  resetView = null,
  setRecommendationLayerVisibility = null,
  setLocationLayerVisibility = null,
  setTransitLayerVisibility = null,
  getLayerVisibility = null,
  initialCamera = INITIAL_CAMERA,
  motionDuration = 300,
  panStepPixels = 96,
} = {}) {
  if (
    (!map || typeof map.getZoom !== "function") &&
    typeof mapController?.snapshot !== "function"
  )
    fail("map_owner_invalid", "Map connector requires an authoritative map");
  if (typeof getVisibleTargets !== "function")
    fail("map_target_provider_invalid", "Map target provider must be callable");

  const listeners = new Set();
  const sourceUnsubscribers = [];
  let destroyed = false;
  let revision = 0;
  const focus =
    focusTarget ||
    method(mapController, "focusTarget") ||
    method(mapController, "selectTarget");
  const reset = resetView || method(mapController, "resetView");

  const ensureActive = () => {
    if (destroyed)
      fail("map_connector_destroyed", "Map connector has been destroyed");
  };
  const visibleLayers = () => {
    const read = (layer, owner) => {
      if (typeof getLayerVisibility === "function")
        return getLayerVisibility(layer) === true;
      return layerVisible(owner, layer);
    };
    return Object.freeze({
      recommendations: read("recommendations", discoveryAreaLayers),
      location: read("location", locationLayers),
      mrtStations: read("mrtStations", transitLayers),
      mrtLines: read("mrtLines", transitLayers),
    });
  };
  const capabilityAvailability = () => {
    const ids = [];
    if (method(mapController, "zoomIn") || method(map, "zoomIn"))
      ids.push("map.zoomin");
    if (method(mapController, "zoomOut") || method(map, "zoomOut"))
      ids.push("map.zoomout");
    if (method(mapController, "pan") || method(map, "panBy"))
      ids.push("map.pan");
    if (
      method(mapController, "rotate") ||
      method(map, "easeTo") ||
      method(map, "rotateTo")
    )
      ids.push("map.rotate");
    if (focus) ids.push("map.focustarget");
    if (reset || method(map, "easeTo")) ids.push("map.resetview");
    if (
      discoveryAreaLayers ||
      locationLayers ||
      transitLayers ||
      setRecommendationLayerVisibility ||
      setLocationLayerVisibility ||
      setTransitLayerVisibility ||
      Object.values(layerIds || {}).some(
        (ids) => Array.isArray(ids) && ids.length,
      )
    )
      ids.push("map.setlayervisibility");
    return ids;
  };
  const snapshot = () => {
    ensureActive();
    const targets = projectTargets(getVisibleTargets());
    const targetIds = new Set(targets.map(({ targetId }) => targetId));
    const requestedFocus = getFocusedTargetId?.();
    const focusedTargetId = targetIds.has(requestedFocus)
      ? requestedFocus
      : null;
    const layers = visibleLayers();
    return Object.freeze({
      revision,
      viewport: cameraState(map, mapController),
      visibleLayers: layers,
      visibleTargets: Object.freeze(targets),
      focusedTargetId,
      selectedTargetIds: Object.freeze(
        focusedTargetId ? [focusedTargetId] : [],
      ),
      transit: Object.freeze({
        visible: layers.mrtStations || layers.mrtLines,
        constraintActive:
          ownerSnapshot(transitLayers).constraintActive === true,
      }),
      availableCapabilityIds: Object.freeze(capabilityAvailability()),
    });
  };
  const publish = () => {
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };

  for (const eventName of ["moveend", "zoomend", "rotateend"]) {
    if (typeof map?.on !== "function") break;
    map.on(eventName, publish);
    sourceUnsubscribers.push(() => map.off?.(eventName, publish));
  }
  for (const owner of [
    discoveryAreaLayers,
    locationLayers,
    transitLayers,
    mapController,
  ]) {
    if (typeof owner?.subscribe !== "function") continue;
    const unsubscribe = owner.subscribe(publish);
    if (typeof unsubscribe !== "function")
      fail(
        "map_owner_subscription_invalid",
        "Map owner returned invalid subscription cleanup",
      );
    sourceUnsubscribers.push(unsubscribe);
  }

  const isEligible = (capabilityId, argumentsValue = {}) => {
    if (!CAPABILITY_IDS.includes(capabilityId)) return false;
    const current = snapshot();
    if (!current.availableCapabilityIds.includes(capabilityId)) return false;
    if (capabilityId === "map.focustarget")
      return current.visibleTargets.some(
        ({ targetId }) => targetId === argumentsValue.targetId,
      );
    if (capabilityId === "map.setlayervisibility")
      return (
        LAYERS.has(argumentsValue.layer) &&
        typeof argumentsValue.visible === "boolean" &&
        ((argumentsValue.layer === "recommendations" &&
          (discoveryAreaLayers ||
            setRecommendationLayerVisibility ||
            layerIds?.recommendations?.length)) ||
          (argumentsValue.layer === "location" &&
            (locationLayers ||
              setLocationLayerVisibility ||
              layerIds?.location?.length)) ||
          (["mrtStations", "mrtLines"].includes(argumentsValue.layer) &&
            (transitLayers ||
              setTransitLayerVisibility ||
              layerIds?.[argumentsValue.layer]?.length)))
      );
    if (capabilityId === "map.pan")
      return (
        ["up", "down", "left", "right"].includes(argumentsValue.direction) &&
        Number.isInteger(argumentsValue.amount) &&
        argumentsValue.amount >= 1 &&
        argumentsValue.amount <= 3
      );
    if (capabilityId === "map.rotate")
      return (
        argumentsValue.bearing === undefined ||
        (Number.isFinite(argumentsValue.bearing) &&
          argumentsValue.bearing >= -180 &&
          argumentsValue.bearing <= 180)
      );
    return true;
  };

  const setLayer = async (layer, visible) => {
    let handler;
    let owner;
    if (layer === "recommendations") {
      handler = setRecommendationLayerVisibility;
      owner = discoveryAreaLayers;
    } else if (layer === "location") {
      handler = setLocationLayerVisibility;
      owner = locationLayers;
    } else {
      handler = setTransitLayerVisibility;
      owner = transitLayers;
    }
    if (handler)
      return layer === "mrtStations" || layer === "mrtLines"
        ? handler(layer, visible)
        : handler(visible);
    const setNamed = method(owner, "setLayerVisibility");
    if (setNamed) return setNamed(layer, visible);
    const setVisible = method(owner, "setVisible");
    if (setVisible)
      return layer === "mrtStations" || layer === "mrtLines"
        ? setVisible(visible, layer)
        : setVisible(visible);
    const ids = layerIds?.[layer];
    if (!map?.setLayoutProperty || !Array.isArray(ids) || !ids.length)
      fail("map_layer_unavailable", `Map layer ${layer} is unavailable`);
    let changed = false;
    for (const id of ids) {
      if (map.getLayer && !map.getLayer(id)) continue;
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      changed = true;
    }
    return changed;
  };

  const execute = async (
    capabilityId,
    argumentsValue = {},
    context = {},
    metadata = {},
  ) => {
    ensureActive();
    if (!CAPABILITY_IDS.includes(capabilityId))
      fail(
        "capability_unsupported",
        `Map connector does not support ${capabilityId}`,
      );
    if (!isEligible(capabilityId, argumentsValue)) {
      const errorCode =
        capabilityId === "map.focustarget"
          ? "map_target_unavailable"
          : capabilityId === "map.setlayervisibility"
            ? "map_layer_unavailable"
            : "map_capability_unavailable";
      fail(
        errorCode,
        "The requested map capability is unavailable in current context",
      );
    }
    const before = snapshot();
    const revisionBefore = revision;
    let result;
    if (capabilityId === "map.zoomin")
      result = (method(mapController, "zoomIn") || method(map, "zoomIn"))({
        duration: motionDuration,
      });
    else if (capabilityId === "map.zoomout")
      result = (method(mapController, "zoomOut") || method(map, "zoomOut"))({
        duration: motionDuration,
      });
    else if (capabilityId === "map.pan") {
      const amount = panStepPixels * argumentsValue.amount;
      const offsets = {
        up: [0, -amount],
        down: [0, amount],
        left: [-amount, 0],
        right: [amount, 0],
      };
      result = (method(mapController, "pan") || method(map, "panBy"))(
        offsets[argumentsValue.direction],
        { duration: motionDuration },
      );
    } else if (capabilityId === "map.rotate") {
      const bearing = normalizeBearing(
        argumentsValue.bearing ?? before.viewport.bearing + 45,
      );
      const rotate = method(mapController, "rotate");
      const rotateTo = method(map, "rotateTo");
      result = rotate
        ? rotate(bearing, { duration: motionDuration })
        : rotateTo
          ? rotateTo(bearing, { duration: motionDuration })
          : map.easeTo({ bearing, duration: motionDuration });
    } else if (capabilityId === "map.focustarget")
      result = await focus(argumentsValue.targetId, context, metadata);
    else if (capabilityId === "map.resetview")
      result = reset
        ? await reset(structuredClone(initialCamera), context, metadata)
        : map.easeTo({
            ...structuredClone(initialCamera),
            duration: motionDuration,
          });
    else result = await setLayer(argumentsValue.layer, argumentsValue.visible);

    let current = snapshot();
    const changed =
      result === false
        ? false
        : JSON.stringify(semanticSnapshot(before)) !==
          JSON.stringify(semanticSnapshot(current));
    if (changed && revision === revisionBefore) {
      publish();
      current = snapshot();
    }
    const patch = contextPatch(current);
    const affectedTargetIds =
      changed && capabilityId === "map.focustarget"
        ? [argumentsValue.targetId]
        : [];
    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(affectedTargetIds),
      contextPatch: patch,
      data: Object.freeze({
        viewport: current.viewport,
        focusedTargetId: current.focusedTargetId,
        visibleLayers: current.visibleLayers,
        transit: current.transit,
        contextPatch: patch,
      }),
    });
  };

  return Object.freeze({
    connectorId: CONNECTOR_ID,
    capabilityIds: CAPABILITY_IDS,
    availability() {
      if (destroyed) return "disabled";
      return capabilityAvailability().length ? "available" : "unavailable";
    },
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      ensureActive();
      if (typeof listener !== "function")
        fail("map_subscriber_invalid", "Map subscriber must be a function");
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    },
    isEligible,
    execute,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const unsubscribe of sourceUnsubscribers) unsubscribe();
      sourceUnsubscribers.length = 0;
      listeners.clear();
    },
  });
}
