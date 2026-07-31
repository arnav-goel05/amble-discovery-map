const CAPABILITY_IDS = Object.freeze([
  "tour.start",
  "tour.previous",
  "tour.next",
  "tour.finish",
]);
export class TourConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TourConnectorError";
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new TourConnectorError(code, message);
};
export function createTourConnector({ tourController, stepCount = 7 } = {}) {
  if (
    !tourController ||
    typeof tourController.start !== "function" ||
    typeof tourController.next !== "function" ||
    typeof tourController.previous !== "function" ||
    typeof tourController.finish !== "function" ||
    typeof tourController.isActive !== "function"
  )
    fail(
      "tour_owner_invalid",
      "Tour connector requires the shared feature-tour owner",
    );
  const listeners = new Set();
  let revision = 0;
  let destroyed = false;
  let stepIndex = 0;
  const totalSteps = Number.isInteger(stepCount)
    ? Math.min(20, Math.max(1, stepCount))
    : 7;
  const snapshot = () => {
    if (destroyed)
      fail("tour_connector_destroyed", "Tour connector is destroyed");
    const owner = tourController.snapshot?.() || {};
    const active = owner.active ?? tourController.isActive();
    if (Number.isInteger(owner.stepIndex))
      stepIndex = Math.min(totalSteps - 1, Math.max(0, owner.stepIndex));
    return Object.freeze({
      revision,
      available: owner.available !== false,
      active: active === true,
      stepIndex,
      stepCount: totalSteps,
      ...(active === true ? { activeOverlayId: "feature-tour" } : {}),
    });
  };
  const publish = () => {
    revision += 1;
    const state = snapshot();
    for (const listener of listeners) listener(state);
  };
  const unsubscribeOwner =
    typeof tourController.subscribe === "function"
      ? tourController.subscribe(publish, { emitCurrent: false })
      : null;
  const isEligible = (id) => {
    const state = snapshot();
    if (!CAPABILITY_IDS.includes(id) || !state.available) return false;
    if (id === "tour.start") return !state.active;
    if (id === "tour.finish") return state.active;
    if (id === "tour.previous") return state.active && state.stepIndex > 0;
    return state.active && state.stepIndex < state.stepCount - 1;
  };
  const execute = async (id) => {
    if (!isEligible(id))
      fail("tour_capability_unavailable", "Tour capability is unavailable");
    const methods = {
      "tour.start": "start",
      "tour.previous": "previous",
      "tour.next": "next",
      "tour.finish": "finish",
    };
    const result = await tourController[methods[id]](
      id === "tour.start" ? { force: true } : undefined,
    );
    if (!unsubscribeOwner && result !== false) {
      if (id === "tour.start") stepIndex = 0;
      if (id === "tour.previous") stepIndex -= 1;
      if (id === "tour.next") stepIndex += 1;
      publish();
    }
    const current = snapshot();
    const patch = Object.freeze({
      activeOverlayId: current.active ? "feature-tour" : null,
    });
    return Object.freeze({
      changed: result !== false,
      affectedTargetIds: Object.freeze([]),
      contextPatch: patch,
      data: Object.freeze({ state: current, contextPatch: patch }),
    });
  };
  return Object.freeze({
    connectorId: "tour",
    capabilityIds: CAPABILITY_IDS,
    availability: () =>
      destroyed
        ? "disabled"
        : snapshot().available
          ? "available"
          : "unavailable",
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        fail("tour_subscriber_invalid", "Subscriber is invalid");
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => listeners.delete(listener);
    },
    isEligible,
    execute,
    destroy() {
      if (destroyed) return;
      unsubscribeOwner?.();
      listeners.clear();
      destroyed = true;
    },
  });
}
