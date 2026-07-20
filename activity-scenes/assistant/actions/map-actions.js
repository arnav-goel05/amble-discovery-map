import {
  actionContracts,
  objectSchema,
  optional,
  parityCases,
  registerContracts,
} from "./action-definition.js";

const stableId = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9:._-]*$",
};
const bearing = { type: "number", minimum: -180, maximum: 180 };
const layerName = {
  enum: ["recommendations", "location", "mrtStations", "mrtLines"],
};
const INITIAL_CAMERA = Object.freeze({
  center: [103.857897, 1.285844],
  zoom: 15.3,
  pitch: 45,
  bearing: -30,
});

const MAP_READY = ["map_ready"];
const AREAS_VISIBLE = ["area_recommendations_visible"];

export const MAP_ACTION_DEFINITIONS = Object.freeze(
  [
    {
      actionId: "map.zoomin",
      description: "Zoom the map in one step",
      contextProvider: "mapContext",
      eligibleStates: MAP_READY,
      argumentSchema: objectSchema(),
      sampleArguments: {},
    },
    {
      actionId: "map.zoomout",
      description: "Zoom the map out one step",
      contextProvider: "mapContext",
      eligibleStates: MAP_READY,
      argumentSchema: objectSchema(),
      sampleArguments: {},
    },
    {
      actionId: "map.pan",
      description: "Pan the map in a direction by a bounded amount",
      contextProvider: "mapContext",
      eligibleStates: MAP_READY,
      argumentSchema: objectSchema({
        direction: { enum: ["up", "down", "left", "right"] },
        amount: { type: "integer", minimum: 1, maximum: 3 },
      }),
      sampleArguments: { direction: "right", amount: 1 },
    },
    {
      actionId: "map.rotate",
      description: "Rotate the map to a bearing or by one clockwise step",
      contextProvider: "mapContext",
      eligibleStates: MAP_READY,
      argumentSchema: optional({ bearing }),
      sampleArguments: { bearing: 0 },
    },
    {
      actionId: "map.focustarget",
      description:
        "Focus and visibly select a target from the current interface context",
      contextProvider: "selectionContext",
      eligibleStates: MAP_READY,
      argumentSchema: objectSchema({ targetId: stableId }),
      sampleArguments: { targetId: "candidate:example" },
    },
    {
      actionId: "map.resetview",
      description: "Restore the initial Singapore map camera",
      contextProvider: "mapContext",
      eligibleStates: MAP_READY,
      argumentSchema: objectSchema(),
      sampleArguments: {},
    },
    {
      actionId: "map.openarea",
      description:
        "Focus a recommended area and open its reasons and candidates",
      contextProvider: "discoveryContext",
      eligibleStates: AREAS_VISIBLE,
      argumentSchema: objectSchema({ areaId: stableId }),
      sampleArguments: { areaId: "ura-subzone:city-hall" },
    },
    {
      actionId: "map.selectarea",
      description: "Select and emphasize a recommended area",
      contextProvider: "discoveryContext",
      eligibleStates: AREAS_VISIBLE,
      argumentSchema: objectSchema({ areaId: stableId }),
      sampleArguments: { areaId: "ura-subzone:city-hall" },
    },
    {
      actionId: "map.compareareas",
      description: "Compare two or three visible recommended areas",
      contextProvider: "discoveryContext",
      eligibleStates: AREAS_VISIBLE,
      argumentSchema: objectSchema({
        areaIds: {
          type: "array",
          items: stableId,
          minItems: 2,
          maxItems: 3,
          uniqueItems: true,
        },
      }),
      sampleArguments: {
        areaIds: ["ura-subzone:city-hall", "ura-subzone:marina-south"],
      },
    },
    {
      actionId: "map.dismissarea",
      description: "Dismiss a recommended area and refresh the active ranking",
      contextProvider: "discoveryContext",
      eligibleStates: AREAS_VISIBLE,
      argumentSchema: objectSchema({ areaId: stableId }),
      sampleArguments: { areaId: "ura-subzone:city-hall" },
    },
    {
      actionId: "map.setlayervisibility",
      description: "Show or hide an approved map context layer",
      contextProvider: "mapContext",
      eligibleStates: MAP_READY,
      argumentSchema: objectSchema({
        layer: layerName,
        visible: { type: "boolean" },
      }),
      sampleArguments: { layer: "mrtStations", visible: true },
    },
  ].map((definition) =>
    Object.freeze({
      confirmationClass: "reversible",
      ...definition,
      eligibleStates: Object.freeze([...definition.eligibleStates]),
      argumentSchema: Object.freeze(definition.argumentSchema),
    }),
  ),
);

const changed = (value = true) => ({
  changed: value !== false && value !== null,
});
const unavailable = (name) => {
  throw new Error(`Map action adapter ${name} is unavailable`);
};

function method(owner, name) {
  return typeof owner?.[name] === "function" ? owner[name].bind(owner) : null;
}

function normalizeBearing(value) {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function layerVisibilityAdapter(
  { map, layerController, layerIds },
  layer,
  visible,
) {
  const setVisibility =
    method(layerController, "setVisibility") ||
    method(layerController, "setLayerVisibility");
  if (setVisibility) return changed(setVisibility(layer, visible));

  const ids = layerIds?.[layer];
  if (!map?.setLayoutProperty || !Array.isArray(ids) || ids.length === 0)
    return unavailable("setlayervisibility");
  let updated = false;
  for (const id of ids) {
    if (map.getLayer && !map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    updated = true;
  }
  return changed(updated);
}

export function createMapActionCommands({
  map,
  mapController = null,
  areaController = null,
  areaLayerManager = null,
  layerController = null,
  layerIds = null,
  initialCamera = INITIAL_CAMERA,
  focusTarget = null,
  resetView = null,
  onCompareAreas = null,
  onDismissArea = null,
  motionDuration = 300,
  panStepPixels = 96,
} = {}) {
  const zoomIn = method(mapController, "zoomIn") || method(map, "zoomIn");
  const zoomOut = method(mapController, "zoomOut") || method(map, "zoomOut");
  const pan = method(mapController, "pan") || method(map, "panBy");
  const rotate = method(mapController, "rotate");
  const easeTo = method(map, "easeTo");
  const openArea = method(areaController, "openArea");
  const selectArea =
    method(areaController, "selectArea") ||
    method(areaLayerManager, "setSelectedArea");
  const compareAreas = method(areaController, "compareAreas");
  const dismissArea = method(areaController, "dismissArea") || onDismissArea;
  const focus = focusTarget || method(mapController, "focusTarget");
  const reset = resetView || method(mapController, "resetView");

  return Object.freeze({
    "map.zoomin": () => {
      if (!zoomIn) return unavailable("zoomin");
      zoomIn({ duration: motionDuration });
      return changed();
    },
    "map.zoomout": () => {
      if (!zoomOut) return unavailable("zoomout");
      zoomOut({ duration: motionDuration });
      return changed();
    },
    "map.pan": ({ direction, amount }) => {
      if (!pan) return unavailable("pan");
      const distance = panStepPixels * amount;
      const offsets = {
        up: [0, -distance],
        down: [0, distance],
        left: [-distance, 0],
        right: [distance, 0],
      };
      pan(offsets[direction], { duration: motionDuration });
      return changed();
    },
    "map.rotate": ({ bearing: requestedBearing }) => {
      const nextBearing = normalizeBearing(
        requestedBearing ?? (map?.getBearing?.() || 0) + 45,
      );
      if (rotate) rotate(nextBearing, { duration: motionDuration });
      else if (easeTo)
        easeTo({ bearing: nextBearing, duration: motionDuration });
      else return unavailable("rotate");
      return changed();
    },
    "map.focustarget": ({ targetId }, context, metadata) => {
      if (!focus) return unavailable("focustarget");
      return changed(focus(targetId, context, metadata));
    },
    "map.resetview": (_argumentsValue, context, metadata) => {
      if (reset)
        return changed(
          reset(structuredClone(initialCamera), context, metadata),
        );
      if (!easeTo) return unavailable("resetview");
      easeTo({ ...structuredClone(initialCamera), duration: motionDuration });
      return changed();
    },
    "map.openarea": ({ areaId }) => {
      if (!openArea) return unavailable("openarea");
      return changed(openArea(areaId));
    },
    "map.selectarea": ({ areaId }) => {
      if (!selectArea) return unavailable("selectarea");
      return changed(selectArea(areaId));
    },
    "map.compareareas": ({ areaIds }, context, metadata) => {
      if (!compareAreas) return unavailable("compareareas");
      const comparison = compareAreas(areaIds);
      if (!Array.isArray(comparison) || comparison.length !== areaIds.length)
        return changed(false);
      onCompareAreas?.(structuredClone(comparison), context, metadata);
      return changed();
    },
    "map.dismissarea": ({ areaId }, context, metadata) => {
      if (typeof dismissArea !== "function") return unavailable("dismissarea");
      return changed(dismissArea(areaId, context, metadata));
    },
    "map.setlayervisibility": ({ layer, visible }) =>
      layerVisibilityAdapter(
        { map, layerController, layerIds },
        layer,
        visible,
      ),
  });
}

export function createMapActionContracts(options = {}) {
  const commands = options.commands || createMapActionCommands(options);
  return actionContracts(MAP_ACTION_DEFINITIONS, {
    commands,
    dispatch: options.dispatch || null,
  });
}

export function registerMapActions(registry, options = {}) {
  return registerContracts(registry, createMapActionContracts(options));
}

export const MAP_ACTION_PARITY_CASES = parityCases(MAP_ACTION_DEFINITIONS);
