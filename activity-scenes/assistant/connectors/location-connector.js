const CONNECTOR_ID = "location";
const LOCATION_TARGET_ID = "location:current";
const CAPABILITY_IDS = Object.freeze([
  "plan.uselocation",
  "plan.focuslocation",
]);
const PERMISSIONS = new Set(["prompt", "granted", "denied", "unavailable"]);
const STATUSES = new Set(["idle", "locating", "fresh", "stale", "error"]);

export class LocationConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocationConnectorError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new LocationConnectorError(code, message);
};
const boundedAreaId = (value) =>
  typeof value === "string" && value ? value.slice(0, 256) : null;

export function projectLocationConnectorSnapshot(
  ownerSnapshot,
  { visible = true, revision = 0 } = {},
) {
  if (
    !ownerSnapshot ||
    typeof ownerSnapshot !== "object" ||
    Array.isArray(ownerSnapshot)
  )
    fail(
      "location_owner_snapshot_invalid",
      "Location owner returned invalid state",
    );
  const permission = PERMISSIONS.has(ownerSnapshot.permission)
    ? ownerSnapshot.permission
    : "unavailable";
  const status = STATUSES.has(ownerSnapshot.status)
    ? ownerSnapshot.status
    : "error";
  const current = ["fresh", "stale"].includes(status);
  const location = Object.freeze({
    permission,
    status,
    coarseAreaId: current ? boundedAreaId(ownerSnapshot.coarseAreaId) : null,
  });
  const availableCapabilityIds = [];
  if (!["denied", "unavailable"].includes(permission))
    availableCapabilityIds.push("plan.uselocation");
  if (current) availableCapabilityIds.push("plan.focuslocation");
  return Object.freeze({
    revision: Number.isInteger(revision) && revision >= 0 ? revision : 0,
    location,
    visible: visible === true,
    availableCapabilityIds: Object.freeze(availableCapabilityIds),
  });
}

function validateOwner(locationController, layerManager) {
  if (
    !locationController ||
    typeof locationController.snapshot !== "function" ||
    typeof locationController.subscribe !== "function" ||
    typeof locationController.requestLocation !== "function"
  )
    fail(
      "location_owner_invalid",
      "Location connector requires the shared location controller",
    );
  if (
    !layerManager ||
    typeof layerManager.setVisible !== "function" ||
    typeof layerManager.focusLocation !== "function"
  )
    fail(
      "location_layer_owner_invalid",
      "Location connector requires the shared location layer manager",
    );
}

export function createLocationConnector({
  locationController,
  locationLayerManager = null,
  layerManager = locationLayerManager,
  initialVisible = true,
} = {}) {
  validateOwner(locationController, layerManager);
  const listeners = new Set();
  let destroyed = false;
  let revision = 0;
  let visible = initialVisible === true;

  const ensureActive = () => {
    if (destroyed)
      fail(
        "location_connector_destroyed",
        "Location connector has been destroyed",
      );
  };
  const snapshot = () => {
    ensureActive();
    return projectLocationConnectorSnapshot(
      locationController.assistantSnapshot?.() ?? locationController.snapshot(),
      {
        visible,
        revision,
      },
    );
  };
  const publish = () => {
    if (destroyed) return;
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  const ownerSubscription = (
    locationController.subscribeAssistantContext?.bind(locationController) ??
    locationController.subscribe.bind(locationController)
  )(publish, { emitCurrent: false });
  if (typeof ownerSubscription !== "function")
    fail(
      "location_owner_subscription_invalid",
      "Location controller returned invalid subscription cleanup",
    );
  const layerSubscription =
    typeof layerManager.subscribe === "function"
      ? layerManager.subscribe((state) => {
          const nextVisible = state?.visible === true;
          if (nextVisible === visible) return;
          visible = nextVisible;
          publish();
        })
      : null;
  if (layerSubscription !== null && typeof layerSubscription !== "function")
    fail(
      "location_layer_subscription_invalid",
      "Location layer manager returned invalid subscription cleanup",
    );

  const contextPatch = (current) =>
    Object.freeze({
      location: current.location,
      availableCapabilityIds: current.availableCapabilityIds,
    });

  const isEligible = (capabilityId) => {
    if (!CAPABILITY_IDS.includes(capabilityId)) return false;
    return snapshot().availableCapabilityIds.includes(capabilityId);
  };

  const execute = async (capabilityId, argumentsValue = {}) => {
    ensureActive();
    if (!CAPABILITY_IDS.includes(capabilityId))
      fail(
        "capability_unsupported",
        `Location connector does not support ${capabilityId}`,
      );
    if (
      !argumentsValue ||
      typeof argumentsValue !== "object" ||
      Array.isArray(argumentsValue) ||
      Object.keys(argumentsValue).length
    )
      fail(
        "location_arguments_invalid",
        "Location capabilities accept a closed empty argument object",
      );
    if (!isEligible(capabilityId))
      fail(
        "location_unavailable",
        "The requested location capability is unavailable",
      );

    const before = snapshot();
    let ownerResult;
    if (capabilityId === "plan.uselocation") {
      ownerResult = await locationController.requestLocation();
    } else {
      ownerResult = layerManager.focusLocation();
    }
    const current = snapshot();
    const changed =
      ownerResult !== false &&
      (capabilityId === "plan.focuslocation" ||
        JSON.stringify(before.location) !== JSON.stringify(current.location));
    const patch = contextPatch(current);
    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(changed ? [LOCATION_TARGET_ID] : []),
      contextPatch: patch,
      data: Object.freeze({
        location: current.location,
        visible: current.visible,
        contextPatch: patch,
      }),
    });
  };

  return Object.freeze({
    connectorId: CONNECTOR_ID,
    capabilityIds: CAPABILITY_IDS,
    availability() {
      if (destroyed) return "disabled";
      return locationController.snapshot().permission === "unavailable"
        ? "unavailable"
        : "available";
    },
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      ensureActive();
      if (typeof listener !== "function")
        fail(
          "location_subscriber_invalid",
          "Location subscriber must be a function",
        );
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    },
    isEligible,
    execute,
    setVisible(nextVisible) {
      ensureActive();
      const requested = nextVisible === true;
      const before = visible;
      const result = layerManager.setVisible(requested);
      visible = requested;
      if (!layerSubscription && before !== visible) publish();
      return result === false ? false : before !== visible;
    },
    destroy() {
      if (destroyed) return;
      ownerSubscription();
      layerSubscription?.();
      listeners.clear();
      destroyed = true;
    },
  });
}
