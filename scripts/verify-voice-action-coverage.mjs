import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import { ASSISTANT_OWNED_ACTION_IDS } from "../activity-scenes/assistant/assistant-controller.js";
import { createRuntimeActionDispatcher } from "../activity-scenes/assistant/runtime-action-dispatcher.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(
  root,
  "specs/004-conversational-voice-map/contracts/public-action-inventory.md",
);
const inventory = parsePublicActionInventory(
  fs.readFileSync(inventoryPath, "utf8"),
);
const calls = [];
const owner = {
  dispatch(actionId) {
    calls.push(actionId);
    return { changed: true };
  },
  selectCandidate() {
    return true;
  },
};
const map = new Proxy(
  {},
  {
    get: (_target, property) =>
      property === "getBearing" ? () => 0 : () => true,
  },
);
const runtimeDispatch = createRuntimeActionDispatcher({
  map,
  initialCamera: {},
  featureTour: new Proxy({}, { get: () => () => true }),
  experienceIntro: { enter: () => true },
  eventController: owner,
  restaurantController: owner,
  planningController: owner,
  locationController: { requestLocation: () => true },
  locationLayers: { setVisible: () => true, focusLocation: () => true },
  transitLayers: { setVisible: () => true },
  discoveryAreaLayers: { setVisible: () => true },
  applicationControls: () => owner,
});
const assistantOwned = new Set(ASSISTANT_OWNED_ACTION_IDS);
const productionDispatch = (actionId, args) =>
  assistantOwned.has(actionId)
    ? { changed: true }
    : runtimeDispatch(actionId, args);
const registry = createActionRegistry(
  createPublicActionContracts({ dispatch: productionDispatch }),
);
const coverage = verifyRegistryInventoryCoverage({
  inventory,
  registry,
  parityCases: PUBLIC_ACTION_PARITY_CASES,
});
const parity = await verifyDirectVoiceParity({
  registry,
  parityCases: PUBLIC_ACTION_PARITY_CASES,
});
const unroutedActionIds = PUBLIC_ACTION_PARITY_CASES.filter(
  ({ actionId, argumentsValue }) =>
    productionDispatch(actionId, argumentsValue)?.changed !== true,
).map(({ actionId }) => actionId);

if (!coverage.complete || !parity.complete || unroutedActionIds.length) {
  console.error(
    JSON.stringify({ coverage, parity, unroutedActionIds }, null, 2),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Voice action coverage verified against production routing: ${coverage.inventoryCount} inventory actions, ${parity.checkedCount} direct/voice parity cases.`,
  );
}
