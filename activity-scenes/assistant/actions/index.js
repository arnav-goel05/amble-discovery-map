import {
  APPLICATION_ACTION_PARITY_CASES,
  createApplicationActionContracts,
} from "./application-actions.js";
import {
  createEventActionContracts,
  EVENT_ACTION_PARITY_CASES,
} from "./event-actions.js";
import {
  createMapActionContracts,
  MAP_ACTION_PARITY_CASES,
} from "./map-actions.js";
import {
  createPlanActionContracts,
  PLAN_ACTION_PARITY_CASES,
} from "./plan-actions.js";
import {
  createRestaurantActionContracts,
  RESTAURANT_ACTION_PARITY_CASES,
} from "./restaurant-actions.js";

export function createPublicActionContracts(options = {}) {
  return [
    ...createMapActionContracts(options),
    ...createEventActionContracts(options),
    ...createRestaurantActionContracts(options),
    ...createPlanActionContracts(options),
    ...createApplicationActionContracts(options),
  ].sort((left, right) => left.actionId.localeCompare(right.actionId));
}

export const PUBLIC_ACTION_PARITY_CASES = Object.freeze(
  [
    ...MAP_ACTION_PARITY_CASES,
    ...EVENT_ACTION_PARITY_CASES,
    ...RESTAURANT_ACTION_PARITY_CASES,
    ...PLAN_ACTION_PARITY_CASES,
    ...APPLICATION_ACTION_PARITY_CASES,
  ].sort((left, right) => left.actionId.localeCompare(right.actionId)),
);

export * from "./map-actions.js";
export * from "./event-actions.js";
export * from "./restaurant-actions.js";
export * from "./plan-actions.js";
export * from "./application-actions.js";
