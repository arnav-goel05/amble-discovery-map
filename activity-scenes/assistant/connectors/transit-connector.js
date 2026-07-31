const CONNECTOR_ID = "transit";
const LAYERS = new Set(["mrtStations", "mrtLines"]);

export class TransitConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TransitConnectorError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new TransitConnectorError(code, message);
};

function ownerSnapshot(owner) {
  if (typeof owner?.snapshot !== "function") return {};
  const value = owner.snapshot();
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(
      "transit_owner_snapshot_invalid",
      "Transit owner returned invalid state",
    );
  return value;
}

function featureCounts(owner, snapshot) {
  const stations =
    snapshot.stationCount ??
    snapshot.stations?.length ??
    owner.getStations?.().length ??
    0;
  const lines =
    snapshot.lineCount ??
    snapshot.lines?.length ??
    snapshot.railLines?.length ??
    0;
  return {
    stationCount: Number.isInteger(stations)
      ? Math.min(500, Math.max(0, stations))
      : 0,
    lineCount: Number.isInteger(lines) ? Math.min(100, Math.max(0, lines)) : 0,
  };
}

export function createTransitConnector({
  transitController = null,
  transitLayerManager = transitController,
  assetStatus = "approved",
  initialVisibility = { mrtStations: true, mrtLines: true },
  initialConstraintActive = false,
} = {}) {
  const owner = transitLayerManager;
  if (
    !owner ||
    (typeof owner.setLayerVisibility !== "function" &&
      typeof owner.setVisible !== "function")
  )
    fail(
      "transit_owner_invalid",
      "Transit connector requires the shared transit layer owner",
    );
  const listeners = new Set();
  let destroyed = false;
  let revision = 0;
  let visibility = {
    mrtStations: initialVisibility.mrtStations === true,
    mrtLines: initialVisibility.mrtLines === true,
  };
  let constraintActive = initialConstraintActive === true;

  const ensureActive = () => {
    if (destroyed)
      fail(
        "transit_connector_destroyed",
        "Transit connector has been destroyed",
      );
  };
  const read = () => {
    const state = ownerSnapshot(owner);
    const ownerVisibility = state.visibility || {};
    visibility = {
      mrtStations:
        typeof ownerVisibility.mrtStations === "boolean"
          ? ownerVisibility.mrtStations
          : visibility.mrtStations,
      mrtLines:
        typeof ownerVisibility.mrtLines === "boolean"
          ? ownerVisibility.mrtLines
          : visibility.mrtLines,
    };
    if (typeof state.constraintActive === "boolean")
      constraintActive = state.constraintActive;
    return state;
  };
  const snapshot = () => {
    ensureActive();
    const ownerState = read();
    const counts = featureCounts(owner, ownerState);
    const approved =
      (ownerState.assetStatus ?? assetStatus) === "approved" &&
      counts.stationCount > 0;
    const transit = Object.freeze({
      visible: visibility.mrtStations || visibility.mrtLines,
      constraintActive,
    });
    return Object.freeze({
      revision,
      assetStatus: approved ? "approved" : "unavailable",
      stationCount: counts.stationCount,
      lineCount: counts.lineCount,
      visibility: Object.freeze({ ...visibility }),
      constraintActive,
      transit,
      availableCapabilityIds: Object.freeze([]),
    });
  };
  const publish = () => {
    if (destroyed) return;
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  const ownerSubscription =
    typeof owner.subscribe === "function"
      ? owner.subscribe(publish, { emitCurrent: false })
      : null;
  if (ownerSubscription !== null && typeof ownerSubscription !== "function")
    fail(
      "transit_owner_subscription_invalid",
      "Transit owner returned invalid subscription cleanup",
    );

  const setLayerVisibility = async (layer, nextVisible) => {
    ensureActive();
    if (!LAYERS.has(layer) || typeof nextVisible !== "boolean")
      fail(
        "transit_layer_invalid",
        "Transit visibility requires a named MRT layer and boolean",
      );
    const before = snapshot();
    let result;
    if (typeof owner.setLayerVisibility === "function") {
      result = await owner.setLayerVisibility(layer, nextVisible);
      visibility[layer] = nextVisible;
    } else {
      result = await owner.setVisible(nextVisible);
      visibility = {
        mrtStations: nextVisible,
        mrtLines: nextVisible,
      };
    }
    if (!ownerSubscription) publish();
    const current = snapshot();
    return result === false
      ? false
      : before.visibility[layer] !== current.visibility[layer];
  };

  return Object.freeze({
    connectorId: CONNECTOR_ID,
    capabilityIds: Object.freeze([]),
    availability() {
      if (destroyed) return "disabled";
      return snapshot().assetStatus === "approved"
        ? "available"
        : "unavailable";
    },
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      ensureActive();
      if (typeof listener !== "function")
        fail(
          "transit_subscriber_invalid",
          "Transit subscriber must be a function",
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
    setLayerVisibility,
    async setVisible(nextVisible, layer = null) {
      if (layer) return setLayerVisibility(layer, nextVisible);
      const stationChanged = await setLayerVisibility(
        "mrtStations",
        nextVisible,
      );
      const lineChanged = await setLayerVisibility("mrtLines", nextVisible);
      return stationChanged || lineChanged;
    },
    async setConstraintActive(
      nextActive,
      { explicitlyRequested = false } = {},
    ) {
      ensureActive();
      if (typeof nextActive !== "boolean")
        fail(
          "transit_constraint_invalid",
          "Transit constraint state must be boolean",
        );
      if (nextActive && explicitlyRequested !== true)
        fail(
          "transit_constraint_not_explicit",
          "Transit ranking constraint requires an explicit user request",
        );
      const before = snapshot();
      let result = true;
      if (typeof owner.setConstraintActive === "function")
        result = await owner.setConstraintActive(nextActive, {
          explicitlyRequested,
        });
      constraintActive = nextActive;
      if (!ownerSubscription) publish();
      return (
        result !== false &&
        before.constraintActive !== snapshot().constraintActive
      );
    },
    destroy() {
      if (destroyed) return;
      ownerSubscription?.();
      listeners.clear();
      destroyed = true;
    },
  });
}
