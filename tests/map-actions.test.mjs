import assert from "node:assert/strict";
import test from "node:test";

import { createActionGateway } from "../activity-scenes/assistant/action-gateway.js";
import { createActionRegistry } from "../activity-scenes/assistant/action-registry.js";
import {
  MAP_ACTION_DEFINITIONS,
  createMapActionContracts,
  registerMapActions,
} from "../activity-scenes/assistant/actions/map-actions.js";

const expectedIds = [
  "map.zoomin",
  "map.zoomout",
  "map.pan",
  "map.rotate",
  "map.focustarget",
  "map.resetview",
  "map.openarea",
  "map.selectarea",
  "map.compareareas",
  "map.dismissarea",
  "map.setlayervisibility",
].sort();

test("map action contracts match the reviewed inventory and remain closed and reversible", () => {
  const commands = Object.fromEntries(
    expectedIds.map((actionId) => [actionId, () => ({ changed: true })]),
  );
  const contracts = createMapActionContracts({ commands });
  assert.deepEqual(
    contracts.map(({ actionId }) => actionId).sort(),
    expectedIds,
  );
  assert.equal(MAP_ACTION_DEFINITIONS.length, 11);
  for (const contract of contracts) {
    assert.equal(contract.version, "1.0");
    assert.equal(contract.argumentSchema.additionalProperties, false);
    assert.equal(contract.confirmationClass, "reversible");
    assert.match(contract.contextProvider, /Context$/);
  }
});

test("map adapters execute map, area, comparison, dismissal, focus, reset, and layer operations", async () => {
  const calls = [];
  const map = {
    zoomIn: (options) => calls.push(["zoomIn", options]),
    zoomOut: (options) => calls.push(["zoomOut", options]),
    panBy: (...args) => calls.push(["panBy", ...args]),
    getBearing: () => 170,
    easeTo: (options) => calls.push(["easeTo", options]),
  };
  const areaController = {
    openArea: (areaId) => ({ areaId }),
    selectArea: (areaId) => areaId === "ura-subzone:city-hall",
    compareAreas: (areaIds) => areaIds.map((areaId) => ({ areaId })),
    dismissArea: (areaId) => areaId === "ura-subzone:city-hall",
  };
  const layerController = {
    setVisibility: (...args) => {
      calls.push(["layer", ...args]);
      return true;
    },
  };
  const registry = createActionRegistry();
  registerMapActions(registry, {
    map,
    areaController,
    layerController,
    focusTarget: (targetId) => {
      calls.push(["focus", targetId]);
      return true;
    },
  });
  const gateway = createActionGateway({ registry });

  await gateway.execute(
    "map.pan",
    { direction: "right", amount: 2 },
    { states: ["map_ready"] },
  );
  await gateway.execute("map.rotate", {}, { states: ["map_ready"] });
  await gateway.execute(
    "map.focustarget",
    { targetId: "candidate:one" },
    { states: ["map_ready"] },
  );
  await gateway.execute(
    "map.openarea",
    { areaId: "ura-subzone:city-hall" },
    { states: ["area_recommendations_visible"] },
  );
  await gateway.execute(
    "map.compareareas",
    { areaIds: ["ura-subzone:city-hall", "ura-subzone:marina-south"] },
    { states: ["area_recommendations_visible"] },
  );
  await gateway.execute(
    "map.dismissarea",
    { areaId: "ura-subzone:city-hall" },
    { states: ["area_recommendations_visible"] },
  );
  await gateway.execute(
    "map.setlayervisibility",
    { layer: "mrtStations", visible: true },
    { states: ["map_ready"] },
  );
  await gateway.execute("map.resetview", {}, { states: ["map_ready"] });

  assert.deepEqual(calls[0], ["panBy", [192, 0], { duration: 300 }]);
  assert.deepEqual(calls[1], ["easeTo", { bearing: -145, duration: 300 }]);
  assert.deepEqual(calls[2], ["focus", "candidate:one"]);
  assert.deepEqual(calls.at(-2), ["layer", "mrtStations", true]);
  assert.deepEqual(calls.at(-1), [
    "easeTo",
    {
      center: [103.857897, 1.285844],
      zoom: 15.3,
      pitch: 45,
      bearing: -30,
      duration: 300,
    },
  ]);
});

test("map schemas reject extra properties, invalid layers, and duplicate comparison targets", async () => {
  const commands = Object.fromEntries(
    expectedIds.map((actionId) => [actionId, () => ({ changed: true })]),
  );
  const gateway = createActionGateway({
    registry: createActionRegistry(createMapActionContracts({ commands })),
  });

  await assert.rejects(
    gateway.execute(
      "map.zoomin",
      { selector: "#map" },
      { states: ["map_ready"] },
    ),
    (error) => error.code === "invalid_action_arguments",
  );
  await assert.rejects(
    gateway.execute(
      "map.setlayervisibility",
      { layer: "private", visible: true },
      { states: ["map_ready"] },
    ),
    (error) => error.code === "invalid_action_arguments",
  );
  await assert.rejects(
    gateway.execute(
      "map.compareareas",
      { areaIds: ["ura-subzone:city-hall", "ura-subzone:city-hall"] },
      { states: ["area_recommendations_visible"] },
    ),
    (error) => error.code === "invalid_action_arguments",
  );
});
