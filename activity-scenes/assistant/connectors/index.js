export {
  createApplicationStateConnector,
  projectApplicationStateSnapshot,
} from "./application-state-connector.js";
export { createApprovedCatalogConnector } from "./approved-catalog-connector.js";
export { createDiscoveryAreaConnector } from "./discovery-area-connector.js";
export {
  createEventApplyQueryCapabilityDefinition,
  createEventConnector,
  EVENT_APPLY_QUERY_CAPABILITY_CONTRACT,
} from "./event-connector.js";
export { createLocationConnector } from "./location-connector.js";
export { createMapConnector } from "./map-connector.js";
export { createOverlayNavigationConnector } from "./overlay-navigation-connector.js";
export { createPlanConnector } from "./plan-connector.js";
export { createRestaurantConnector } from "./restaurant-connector.js";
export { createTourConnector } from "./tour-connector.js";
export { createTransitConnector } from "./transit-connector.js";

const CONNECTOR_BY_ACTION_PREFIX = Object.freeze({
  discovery: "discovery-areas",
  event: "events",
  game: "conditional-content",
  map: "map",
  navigation: "overlay-navigation",
  plan: "plan",
  restaurant: "restaurants",
  saved: "conditional-content",
  tour: "tour",
});

function connectorIdFor(actionId) {
  if (["plan.focuslocation", "plan.uselocation"].includes(actionId))
    return "location";
  if (
    [
      "map.compareareas",
      "map.dismissarea",
      "map.openarea",
      "map.selectarea",
    ].includes(actionId)
  )
    return "discovery-areas";
  return CONNECTOR_BY_ACTION_PREFIX[actionId.split(".")[0]] || "map";
}

export function createLegacyCommandCapabilityDefinitions(actionContracts = []) {
  return actionContracts.map((action) => {
    const connectorId = connectorIdFor(action.actionId);
    return {
      contract: {
        capabilityId: action.actionId,
        version: "2.0",
        kind: "command",
        description: action.description,
        connectorId,
        argumentSchema: action.argumentSchema,
        eligibleStates: action.eligibleStates,
        confirmationClass: action.confirmationClass,
        contextProvider: action.contextProvider || connectorId,
        resultSchema: action.resultSchema,
      },
      runtime: { execute: action.execute },
    };
  });
}

export function createLegacyConnectorDescriptors(definitions = []) {
  return [
    ...new Set(
      definitions.map(({ contract }) => contract.connectorId).filter(Boolean),
    ),
  ]
    .sort()
    .map((connectorId) => Object.freeze({ connectorId }));
}
