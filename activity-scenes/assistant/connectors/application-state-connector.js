const CAPABILITY_ID = "app.inspect";

export class ApplicationStateConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApplicationStateConnectorError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ApplicationStateConnectorError(code, message);
};
const boundedString = (value, maximum, fallback = "") =>
  typeof value === "string" ? value.slice(0, maximum) : fallback;
const nullableString = (value, maximum) =>
  typeof value === "string" && value ? value.slice(0, maximum) : null;
const uniqueStrings = (values, maximum, itemMaximum = 256) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string" && value)
        .map((value) => value.slice(0, itemMaximum)),
    ),
  ].slice(0, maximum);

const filterProjection = (input = {}) => {
  const output = {};
  for (const field of ["eventQuery", "restaurantQuery"])
    if (input[field] !== undefined)
      output[field] = boundedString(input[field], 500);
  for (const field of ["eventWhat", "eventWhen", "eventWhere", "eventPrice"])
    if (input[field] !== undefined)
      output[field] = uniqueStrings(input[field], 12, 100);
  for (const field of ["restaurantCategory", "restaurantCuisine"])
    if (input[field] !== undefined)
      output[field] = nullableString(input[field], 100);
  return output;
};

export function projectApplicationStateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object")
    fail("application_state_unavailable", "Application state is unavailable");
  const visibleTargets = [];
  const visibleIds = new Set();
  for (const item of Array.isArray(snapshot.visibleTargets)
    ? snapshot.visibleTargets
    : []) {
    const targetId = boundedString(item?.targetId, 256);
    const type = boundedString(item?.type, 64);
    const label = boundedString(item?.label, 200);
    if (!targetId || !type || !label || visibleIds.has(targetId)) continue;
    visibleIds.add(targetId);
    visibleTargets.push({
      targetId,
      type,
      label,
      ordinal: visibleTargets.length + 1,
    });
    if (visibleTargets.length === 50) break;
  }
  const plan = snapshot.plan || {};
  const location = snapshot.location || snapshot.locationState || {};
  const transit = snapshot.transit || {};
  const viewport = snapshot.viewport || {};
  const visibleLayers = snapshot.visibleLayers || {};
  const focusedTargetId = nullableString(snapshot.focusedTargetId, 256);
  const selectedTargetIds = uniqueStrings(
    snapshot.selectedTargetIds,
    20,
  ).filter((targetId) => visibleIds.has(targetId));

  return Object.freeze({
    revision:
      Number.isInteger(snapshot.revision) && snapshot.revision >= 0
        ? snapshot.revision
        : 0,
    stateDigest: boundedString(snapshot.stateDigest, 128, "unavailable"),
    viewport: Object.freeze({
      zoom: Math.min(24, Math.max(0, Number(viewport.zoom) || 0)),
      bearing: Math.min(180, Math.max(-180, Number(viewport.bearing) || 0)),
    }),
    visibleLayers: Object.freeze({
      recommendations: visibleLayers.recommendations === true,
      location: visibleLayers.location === true,
      mrtStations: visibleLayers.mrtStations === true,
      mrtLines: visibleLayers.mrtLines === true,
    }),
    visibleTargets: Object.freeze(
      visibleTargets.map((target) => Object.freeze(target)),
    ),
    focusedTargetId: visibleIds.has(focusedTargetId) ? focusedTargetId : null,
    selectedTargetIds: Object.freeze(selectedTargetIds),
    activeOverlayId: nullableString(snapshot.activeOverlayId, 128),
    assistantPresentation: new Set([
      "recommendations",
      "clarification",
      "no_match",
    ]).has(snapshot.assistantPresentation)
      ? snapshot.assistantPresentation
      : null,
    activeFilters: Object.freeze(filterProjection(snapshot.activeFilters)),
    plan: Object.freeze({
      stopIds: Object.freeze(uniqueStrings(plan.stopIds, 20)),
      travelMode: new Set(["walking", "driving", "bicycling", "transit"]).has(
        plan.travelMode,
      )
        ? plan.travelMode
        : "walking",
      routeAvailable: plan.routeAvailable === true,
    }),
    location: Object.freeze({
      permission: new Set(["prompt", "granted", "denied", "unavailable"]).has(
        location.permission,
      )
        ? location.permission
        : "unavailable",
      status: new Set(["idle", "locating", "fresh", "stale", "error"]).has(
        location.status,
      )
        ? location.status
        : "error",
      coarseAreaId: nullableString(location.coarseAreaId, 256),
    }),
    transit: Object.freeze({
      visible:
        transit.visible === true ||
        (transit.visible === undefined && snapshot.transitVisible === true),
      constraintActive:
        transit.constraintActive === true ||
        (transit.constraintActive === undefined &&
          snapshot.transitConstraintActive === true),
    }),
    availableCapabilityIds: Object.freeze(
      uniqueStrings(
        snapshot.availableCapabilityIds || snapshot.availableActionIds,
        128,
      )
        .filter((capabilityId) =>
          /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(capabilityId),
        )
        .sort(),
    ),
  });
}

export function createApplicationStateConnector({ coordinator } = {}) {
  if (
    !coordinator ||
    typeof coordinator.snapshot !== "function" ||
    typeof coordinator.subscribe !== "function"
  )
    fail(
      "application_state_owner_invalid",
      "Application-state connector requires a context coordinator",
    );

  return Object.freeze({
    connectorId: "application-state",
    capabilityIds: Object.freeze([CAPABILITY_ID]),
    availability() {
      try {
        coordinator.snapshot();
        return "available";
      } catch {
        return "unavailable";
      }
    },
    snapshot() {
      return projectApplicationStateSnapshot(coordinator.snapshot());
    },
    subscribe(listener, options) {
      if (typeof listener !== "function")
        fail(
          "application_state_subscriber_invalid",
          "Application-state subscriber must be a function",
        );
      return coordinator.subscribe(
        (snapshot) => listener(projectApplicationStateSnapshot(snapshot)),
        options,
      );
    },
    async query(capabilityId, argumentsValue = {}) {
      if (capabilityId !== CAPABILITY_ID)
        fail(
          "capability_unsupported",
          `Application-state connector does not support ${capabilityId}`,
        );
      if (
        !argumentsValue ||
        typeof argumentsValue !== "object" ||
        Array.isArray(argumentsValue) ||
        Object.keys(argumentsValue).length
      )
        fail(
          "capability_arguments_invalid",
          "app.inspect accepts a closed empty argument object",
        );
      return projectApplicationStateSnapshot(coordinator.snapshot());
    },
  });
}
