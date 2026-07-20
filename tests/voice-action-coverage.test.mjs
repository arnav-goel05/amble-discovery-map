import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parsePublicActionInventory,
  verifyDirectVoiceParity,
  verifyRegistryInventoryCoverage,
} from "../activity-scenes/assistant/action-coverage.js";
import { createActionRegistry } from "../activity-scenes/assistant/action-registry.js";
import {
  createPublicActionContracts,
  PUBLIC_ACTION_PARITY_CASES,
} from "../activity-scenes/assistant/actions/index.js";

const INVENTORY_PATH = new URL(
  "../specs/004-conversational-voice-map/contracts/public-action-inventory.md",
  import.meta.url,
);

const EXPECTED_ACTION_IDS = [
  "event.addtoplan",
  "event.clearfilters",
  "event.closedetail",
  "event.nextevent",
  "event.opendetail",
  "event.opendirections",
  "event.openreference",
  "event.previousevent",
  "event.search",
  "event.selectresult",
  "event.setcategory",
  "event.setdaterange",
  "event.setpricerange",
  "game.open",
  "game.openroute",
  "game.pause",
  "game.quit",
  "game.resume",
  "game.skip",
  "game.start",
  "game.status",
  "map.compareareas",
  "map.dismissarea",
  "map.focustarget",
  "map.openarea",
  "map.pan",
  "map.resetview",
  "map.rotate",
  "map.selectarea",
  "map.setlayervisibility",
  "map.zoomin",
  "map.zoomout",
  "navigation.closeassistant",
  "navigation.closeoverlay",
  "navigation.enterexperience",
  "navigation.openassistant",
  "navigation.openexternal",
  "plan.addstop",
  "plan.close",
  "plan.focuslocation",
  "plan.focusstop",
  "plan.open",
  "plan.openroute",
  "plan.removestop",
  "plan.reorderstop",
  "plan.settravelmode",
  "plan.uselocation",
  "restaurant.addtoplan",
  "restaurant.clearfilters",
  "restaurant.closedetail",
  "restaurant.closeresults",
  "restaurant.opendealreference",
  "restaurant.opendirections",
  "restaurant.openreference",
  "restaurant.search",
  "restaurant.searchviewport",
  "restaurant.selectcluster",
  "restaurant.selectresult",
  "restaurant.setcategory",
  "restaurant.setcuisine",
  "saved.deleteitem",
  "saved.open",
  "saved.openitem",
  "tour.finish",
  "tour.next",
  "tour.previous",
  "tour.start",
];

const inventory = parsePublicActionInventory(
  readFileSync(INVENTORY_PATH, "utf8"),
);

const clone = (value) => structuredClone(value);

function registryFixture(cases = PUBLIC_ACTION_PARITY_CASES) {
  const results = new Map(
    cases.map(({ actionId, result }) => [actionId, result]),
  );
  return createActionRegistry(
    createPublicActionContracts({
      dispatch(actionId) {
        assert.ok(
          results.has(actionId),
          `Missing result fixture for ${actionId}`,
        );
        return clone(results.get(actionId));
      },
    }),
  );
}

test("reviewed public-action inventory parses all release actions with complete ownership metadata", () => {
  assert.deepEqual(
    inventory.map(({ actionId }) => actionId).sort(),
    EXPECTED_ACTION_IDS,
  );
  assert.equal(new Set(EXPECTED_ACTION_IDS).size, 67);

  for (const entry of inventory) {
    assert.match(entry.release, /^(?:existing|004)$/);
    assert.ok(entry.arguments.length > 0, `${entry.actionId} lacks arguments`);
    assert.ok(entry.eligibleState.length > 0, `${entry.actionId} lacks state`);
    assert.ok(
      entry.contextProvider.length > 0,
      `${entry.actionId} lacks context`,
    );
    assert.match(entry.confirmationClass, /^(?:reversible|consequential)$/);
    assert.ok(entry.result.length > 0, `${entry.actionId} lacks a result`);
    assert.ok(
      entry.directControlOwner.length > 0,
      `${entry.actionId} lacks a direct-control owner`,
    );
  }
});

test("the typed registry and parity fixtures exactly cover the reviewed inventory", () => {
  const report = verifyRegistryInventoryCoverage({
    inventory,
    registry: registryFixture(),
    parityCases: PUBLIC_ACTION_PARITY_CASES,
  });

  assert.equal(report.complete, true);
  assert.equal(report.inventoryCount, 67);
  assert.equal(report.registryCount, 67);
  assert.equal(report.parityCaseCount, 67);
  assert.deepEqual(report.missingRegistryIds, []);
  assert.deepEqual(report.unlistedRegistryIds, []);
  assert.deepEqual(report.missingParityIds, []);
  assert.deepEqual(report.unlistedParityIds, []);
  assert.deepEqual(report.duplicateInventoryIds, []);
  assert.deepEqual(report.duplicateParityIds, []);
});

test("coverage reports omissions, unreviewed actions, and duplicate parity cases", () => {
  const completeRegistry = registryFixture();
  const omittedId = EXPECTED_ACTION_IDS[0];
  const parityCases = PUBLIC_ACTION_PARITY_CASES.filter(
    ({ actionId }) => actionId !== omittedId,
  );
  parityCases.push(clone(parityCases[0]));
  const report = verifyRegistryInventoryCoverage({
    inventory: inventory.filter(({ actionId }) => actionId !== omittedId),
    registry: completeRegistry,
    parityCases,
  });

  assert.equal(report.complete, false);
  assert.deepEqual(report.unlistedRegistryIds, [omittedId]);
  assert.deepEqual(report.missingParityIds, [omittedId]);
  assert.deepEqual(report.duplicateParityIds, [parityCases[0].actionId]);
});

test("direct and voice dispatch produce the same observable state for every public action", async () => {
  const report = await verifyDirectVoiceParity({
    registry: registryFixture(),
    parityCases: PUBLIC_ACTION_PARITY_CASES,
  });

  assert.equal(report.complete, true);
  assert.equal(report.checkedCount, 67);
  assert.deepEqual(report.failedActionIds, []);
  assert.deepEqual(report.missingActionIds, []);
  assert.deepEqual(report.checkedActionIds, EXPECTED_ACTION_IDS);
});

test("observable-state parity fails closed when a source-specific executor diverges", async () => {
  const parityCase = {
    actionId: "test.toggle",
    argumentsValue: {},
    context: { states: ["ready"] },
    result: { visible: true },
  };
  const registry = createActionRegistry([
    {
      actionId: parityCase.actionId,
      version: "1.0",
      description: "Toggle a test control",
      argumentSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      eligibleStates: ["ready"],
      confirmationClass: "reversible",
      contextProvider: "testContext",
      resultSchema: {
        type: "object",
        additionalProperties: false,
        properties: { visible: { type: "boolean" } },
        required: ["visible"],
      },
      execute(_argumentsValue, _context, metadata) {
        return { visible: metadata.source === "direct" };
      },
    },
  ]);

  const report = await verifyDirectVoiceParity({
    registry,
    parityCases: [parityCase],
  });

  assert.equal(report.complete, false);
  assert.equal(report.checkedCount, 1);
  assert.deepEqual(report.failedActionIds, ["test.toggle"]);
  assert.equal(report.failures[0].actionId, "test.toggle");
  assert.notDeepEqual(report.failures[0].direct, report.failures[0].voice);
});
