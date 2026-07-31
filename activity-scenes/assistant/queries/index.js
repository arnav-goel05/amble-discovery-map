import appInspectResultSchema from "../../../specs/004-conversational-voice-map/contracts/app-inspect-result.schema.json" with { type: "json" };
import catalogGetResultSchema from "../../../specs/004-conversational-voice-map/contracts/catalog-get-result.schema.json" with { type: "json" };
import catalogSearchResultSchema from "../../../specs/004-conversational-voice-map/contracts/catalog-search-result.schema.json" with { type: "json" };
import { createAppInspectQuery } from "./app-inspect.js";

export { createAppInspectQuery } from "./app-inspect.js";
export { getCatalogItems } from "./catalog-get.js";
export {
  projectCatalogItem,
  searchCatalog,
  validateCatalogSnapshot,
} from "./catalog-search.js";

const CATALOG_TYPE_SCHEMA = Object.freeze({
  enum: ["area", "event", "restaurant", "plan_stop", "saved_item", "game"],
});
const closedObject = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

function boundedResultSchemas() {
  const inspect = structuredClone(appInspectResultSchema);
  inspect.properties.availableCapabilityIds.items.maxLength = 128;
  const search = structuredClone(catalogSearchResultSchema);
  search.properties.types.maxItems = CATALOG_TYPE_SCHEMA.enum.length;
  return {
    inspect,
    search,
    get: structuredClone(catalogGetResultSchema),
  };
}

export function createFoundationalQueryDefinitions({
  applicationStateConnector,
  approvedCatalogConnector,
  ready = Promise.resolve(),
} = {}) {
  const resultSchemas = boundedResultSchemas();
  const inspect = createAppInspectQuery({ applicationStateConnector });
  return [
    {
      contract: {
        capabilityId: "app.inspect",
        version: "2.0",
        kind: "query",
        description: "Inspect the current bounded application state.",
        connectorId: "application-state",
        argumentSchema: closedObject({}),
        eligibleStates: ["application_initialized"],
        confirmationClass: "none",
        contextProvider: "application-state",
        resultSchema: resultSchemas.inspect,
      },
      runtime: {
        async query(argumentsValue) {
          await ready;
          return inspect(argumentsValue);
        },
      },
    },
    {
      contract: {
        capabilityId: "catalog.search",
        version: "2.0",
        kind: "query",
        description: "Search the approved application catalogue.",
        connectorId: "approved-catalog",
        argumentSchema: closedObject(
          {
            query: { type: "string", maxLength: 500 },
            types: {
              type: "array",
              maxItems: 6,
              uniqueItems: true,
              items: CATALOG_TYPE_SCHEMA,
            },
            limit: { type: "integer", minimum: 1, maximum: 20 },
            cursor: { type: "string", minLength: 1, maxLength: 512 },
          },
          ["query", "types", "limit"],
        ),
        eligibleStates: ["approved_catalog_available"],
        confirmationClass: "none",
        contextProvider: "approved-catalog",
        resultSchema: resultSchemas.search,
      },
      runtime: {
        query: (argumentsValue) =>
          approvedCatalogConnector.query("catalog.search", argumentsValue),
      },
    },
    {
      contract: {
        capabilityId: "catalog.get",
        version: "2.0",
        kind: "query",
        description: "Get approved catalogue items by stable target ID.",
        connectorId: "approved-catalog",
        argumentSchema: closedObject({
          targetIds: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 256,
              pattern: "^[a-z][a-z0-9_-]*:.+",
            },
          },
        }),
        eligibleStates: ["approved_catalog_available"],
        confirmationClass: "none",
        contextProvider: "approved-catalog",
        resultSchema: resultSchemas.get,
      },
      runtime: {
        query: (argumentsValue) =>
          approvedCatalogConnector.query("catalog.get", argumentsValue),
      },
    },
  ];
}
