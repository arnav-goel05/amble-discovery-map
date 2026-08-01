const CAPABILITY_IDS = Object.freeze([
  "restaurant.search",
  "restaurant.searchviewport",
  "restaurant.setcategory",
  "restaurant.setcuisine",
  "restaurant.clearfilters",
  "restaurant.selectcluster",
  "restaurant.selectresult",
  "restaurant.closeresults",
  "restaurant.closedetail",
  "restaurant.addtoplan",
  "restaurant.openreference",
  "restaurant.opendealreference",
  "restaurant.opendirections",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;

export class RestaurantConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RestaurantConnectorError";
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new RestaurantConnectorError(code, message);
};
const ids = (values, maximum = 50) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : []).filter((id) => ID.test(id)),
    ),
  ].slice(0, maximum);
const recordIds = (values, field, prefix) =>
  ids(
    (Array.isArray(values) ? values : []).map((value) => {
      const id = value?.[field] ?? value?.id ?? value;
      return typeof id === "string" && !id.includes(":")
        ? `${prefix}:${id}`
        : id;
    }),
  );

function project(value, revision) {
  const resultIds = recordIds(
    value?.results ?? value?.restaurants,
    "restaurantId",
    "restaurant",
  );
  const sourceResults = Array.isArray(value?.results ?? value?.restaurants)
    ? (value?.results ?? value?.restaurants)
    : [];
  const sourceById = new Map(
    sourceResults.map((item) => {
      const rawId = item?.restaurantId ?? item?.id ?? item;
      const restaurantId =
        typeof rawId === "string" && !rawId.includes(":")
          ? `restaurant:${rawId}`
          : rawId;
      return [restaurantId, item];
    }),
  );
  const results = Object.freeze(
    resultIds.map((restaurantId) => {
      const item = sourceById.get(restaurantId);
      const label = String(
        item?.label ?? item?.name ?? item?.title ?? restaurantId,
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      return Object.freeze({ restaurantId, label: label || restaurantId });
    }),
  );
  const clusters = recordIds(value?.clusters, "clusterId", "cluster");
  const deals = {};
  for (const [restaurantId, values] of Object.entries(value?.deals || {})) {
    if (!ID.test(restaurantId) || !resultIds.includes(restaurantId)) continue;
    deals[restaurantId] = ids(values, 20);
  }
  const query = String(value?.query || "").slice(0, 500);
  const categoryId =
    typeof value?.categoryId === "string"
      ? value.categoryId.slice(0, 256)
      : null;
  const cuisineId =
    typeof value?.cuisineId === "string" ? value.cuisineId.slice(0, 256) : null;
  const selectedRestaurantId = resultIds.includes(value?.selectedRestaurantId)
    ? value.selectedRestaurantId
    : null;
  return Object.freeze({
    revision,
    resultsOpen: value?.resultsOpen === true,
    detailOpen: value?.detailOpen === true,
    query,
    categoryId,
    cuisineId,
    categories: Object.freeze(ids(value?.categories, 50)),
    cuisines: Object.freeze(ids(value?.cuisines, 50)),
    results,
    resultIds: Object.freeze(resultIds),
    clusterIds: Object.freeze(clusters),
    deals: Object.freeze(deals),
    selectedRestaurantId,
    visibleTargets: Object.freeze(
      results.map(({ restaurantId: targetId, label }) =>
        Object.freeze({
          targetId,
          type: "restaurant",
          label,
        }),
      ),
    ),
    selectedTargetIds: Object.freeze(
      selectedRestaurantId ? [selectedRestaurantId] : [],
    ),
    focusedTargetId: selectedRestaurantId,
    activeFilters: Object.freeze({
      restaurantQuery: query,
      restaurantCategory: categoryId,
      restaurantCuisine: cuisineId,
    }),
    ...(value?.detailOpen === true && selectedRestaurantId
      ? { activeOverlayId: "restaurant-detail" }
      : value?.resultsOpen === true
        ? { activeOverlayId: "restaurants" }
        : {}),
  });
}

export function createRestaurantConnector({ restaurantController } = {}) {
  if (
    typeof restaurantController?.snapshot !== "function" ||
    typeof restaurantController?.subscribe !== "function" ||
    typeof restaurantController?.dispatch !== "function"
  )
    fail(
      "restaurant_owner_invalid",
      "Restaurant connector requires the shared explorer owner",
    );
  const listeners = new Set();
  let destroyed = false;
  let revision = 0;
  const snapshot = () => {
    if (destroyed)
      fail(
        "restaurant_connector_destroyed",
        "Restaurant connector is destroyed",
      );
    return project(restaurantController.snapshot(), revision);
  };
  const publish = () => {
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  const unsubscribeOwner = restaurantController.subscribe(publish, {
    emitCurrent: false,
  });
  if (typeof unsubscribeOwner !== "function")
    fail(
      "restaurant_owner_subscription_invalid",
      "Restaurant owner cleanup is invalid",
    );
  const isEligible = (capabilityId, args = {}) => {
    if (!CAPABILITY_IDS.includes(capabilityId)) return false;
    const state = snapshot();
    if (
      ["restaurant.search", "restaurant.searchviewport"].includes(capabilityId)
    )
      return true;
    if (capabilityId === "restaurant.setcategory") return state.resultsOpen;
    if (capabilityId === "restaurant.setcuisine")
      return (
        state.resultsOpen &&
        (!args.cuisineId || state.cuisines.includes(args.cuisineId))
      );
    if (capabilityId === "restaurant.clearfilters")
      return Boolean(state.query || state.categoryId || state.cuisineId);
    if (capabilityId === "restaurant.selectcluster")
      return state.clusterIds.includes(args.clusterId);
    if (capabilityId === "restaurant.closeresults") return state.resultsOpen;
    if (capabilityId === "restaurant.closedetail") return state.detailOpen;
    if (!state.resultIds.includes(args.restaurantId)) return false;
    if (capabilityId === "restaurant.opendealreference")
      return state.deals[args.restaurantId]?.includes(args.dealId) === true;
    return true;
  };
  const execute = async (capabilityId, args = {}) => {
    if (!isEligible(capabilityId, args))
      fail(
        "restaurant_capability_unavailable",
        "Restaurant capability is unavailable",
      );
    const changed =
      (await restaurantController.dispatch(
        capabilityId,
        structuredClone(args),
      )) !== false;
    const current = snapshot();
    const affected = changed && args.restaurantId ? [args.restaurantId] : [];
    const patch = Object.freeze({
      activeFilters: Object.freeze({
        restaurantQuery: current.query,
        restaurantCategory: current.categoryId,
        restaurantCuisine: current.cuisineId,
      }),
      focusedTargetId: current.selectedRestaurantId,
      selectedTargetIds: Object.freeze(
        current.selectedRestaurantId ? [current.selectedRestaurantId] : [],
      ),
      activeOverlayId: current.detailOpen
        ? "restaurant-detail"
        : current.resultsOpen
          ? "restaurants"
          : null,
    });
    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(affected),
      contextPatch: patch,
      data: Object.freeze({ state: current, contextPatch: patch }),
    });
  };
  return Object.freeze({
    connectorId: "restaurants",
    capabilityIds: CAPABILITY_IDS,
    availability: () => (destroyed ? "disabled" : "available"),
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        fail("restaurant_subscriber_invalid", "Subscriber is invalid");
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => listeners.delete(listener);
    },
    isEligible,
    execute,
    destroy() {
      if (destroyed) return;
      unsubscribeOwner();
      listeners.clear();
      destroyed = true;
    },
  });
}
