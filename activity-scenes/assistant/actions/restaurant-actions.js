import {
  actionContracts,
  objectSchema,
  optional,
  parityCases,
  registerContracts,
  types,
} from "./action-definition.js";

export const RESTAURANT_ACTION_DEFINITIONS = Object.freeze([
  {
    actionId: "restaurant.search",
    description: "Search current restaurant results",
    contextProvider: "restaurantContext",
    argumentSchema: objectSchema({ query: types.text }),
    sampleArguments: { query: "cafe" },
  },
  {
    actionId: "restaurant.searchviewport",
    description: "Search restaurants in the current viewport",
    contextProvider: "mapContext",
  },
  {
    actionId: "restaurant.setcategory",
    description: "Set or clear restaurant category",
    contextProvider: "restaurantContext",
    argumentSchema: optional({ categoryId: types.id }),
    sampleArguments: { categoryId: "cafe" },
  },
  {
    actionId: "restaurant.setcuisine",
    description: "Set or clear restaurant cuisine",
    contextProvider: "restaurantContext",
    argumentSchema: optional({ cuisineId: types.id }),
    sampleArguments: { cuisineId: "local" },
  },
  {
    actionId: "restaurant.clearfilters",
    description: "Clear restaurant filters",
    contextProvider: "restaurantContext",
  },
  {
    actionId: "restaurant.selectcluster",
    description: "Expand a restaurant cluster",
    contextProvider: "restaurantContext",
    argumentSchema: objectSchema({ clusterId: types.id }),
    sampleArguments: { clusterId: "cluster:1" },
  },
  {
    actionId: "restaurant.selectresult",
    description: "Select a restaurant result",
    contextProvider: "restaurantContext",
    argumentSchema: objectSchema({ restaurantId: types.id }),
    sampleArguments: { restaurantId: "restaurant:fixture" },
  },
  {
    actionId: "restaurant.closeresults",
    description: "Close restaurant results",
    contextProvider: "overlayContext",
  },
  {
    actionId: "restaurant.closedetail",
    description: "Close restaurant detail",
    contextProvider: "overlayContext",
  },
  {
    actionId: "restaurant.addtoplan",
    description: "Add a restaurant to the plan",
    contextProvider: "restaurantContext",
    argumentSchema: objectSchema({ restaurantId: types.id }),
    sampleArguments: { restaurantId: "restaurant:fixture" },
  },
  {
    actionId: "restaurant.openreference",
    description: "Open an approved restaurant reference",
    contextProvider: "restaurantContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ restaurantId: types.id }),
    sampleArguments: { restaurantId: "restaurant:fixture" },
  },
  {
    actionId: "restaurant.opendealreference",
    description: "Open an approved restaurant deal",
    contextProvider: "restaurantContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ restaurantId: types.id, dealId: types.id }),
    sampleArguments: {
      restaurantId: "restaurant:fixture",
      dealId: "deal:fixture",
    },
  },
  {
    actionId: "restaurant.opendirections",
    description: "Open directions to a restaurant",
    contextProvider: "restaurantContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ restaurantId: types.id }),
    sampleArguments: { restaurantId: "restaurant:fixture" },
  },
]);

export const createRestaurantActionContracts = (options = {}) =>
  actionContracts(RESTAURANT_ACTION_DEFINITIONS, options);
export const registerRestaurantActions = (registry, options = {}) =>
  registerContracts(registry, createRestaurantActionContracts(options));
export const RESTAURANT_ACTION_PARITY_CASES = parityCases(
  RESTAURANT_ACTION_DEFINITIONS,
);
