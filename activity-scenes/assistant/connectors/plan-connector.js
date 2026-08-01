const CAPABILITY_IDS = Object.freeze([
  "plan.open",
  "plan.close",
  "plan.uselocation",
  "plan.focuslocation",
  "plan.settravelmode",
  "plan.addstop",
  "plan.removestop",
  "plan.reorderstop",
  "plan.focusstop",
  "plan.openroute",
]);
const MODES = new Set(["walking", "driving", "bicycling", "transit"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
export class PlanConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlanConnectorError";
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new PlanConnectorError(code, message);
};
const stableId = (value) => {
  const id =
    value?.stopId ??
    value?.stopKey ??
    value?.targetId ??
    value?.candidateId ??
    value?.id ??
    value;
  return typeof id === "string" && ID.test(id) ? id : null;
};
function project(value, revision) {
  const seen = new Set();
  const stops = [];
  for (const item of value?.stops ?? value?.planStops ?? []) {
    const stopId = stableId(item);
    if (!stopId || seen.has(stopId)) continue;
    seen.add(stopId);
    stops.push(
      Object.freeze({
        stopId,
        targetId: stableId(item?.targetId ?? item?.candidateId) || stopId,
        label: String(item?.label ?? item?.title ?? stopId).slice(0, 200),
      }),
    );
    if (stops.length === 20) break;
  }
  const travelMode = MODES.has(value?.travelMode)
    ? value.travelMode
    : "walking";
  const routeAvailable = value?.routeAvailable === true;
  return Object.freeze({
    revision,
    open: value?.open === true,
    planId: stableId(value?.planId) || null,
    stops: Object.freeze(stops),
    travelMode,
    routeAvailable,
    locationAvailable: value?.locationAvailable === true,
    addableTargetIds: Object.freeze(
      [
        ...new Set((value?.addableTargetIds || []).filter((id) => ID.test(id))),
      ].slice(0, 50),
    ),
    plan: Object.freeze({
      stopIds: Object.freeze(stops.map(({ stopId }) => stopId)),
      addableTargetIds: Object.freeze(
        [
          ...new Set(
            (value?.addableTargetIds || []).filter((id) => ID.test(id)),
          ),
        ].slice(0, 50),
      ),
      travelMode,
      routeAvailable,
    }),
    ...(value?.open === true ? { activeOverlayId: "plan-builder" } : {}),
  });
}
export function createPlanConnector({ planController } = {}) {
  if (
    typeof planController?.snapshot !== "function" ||
    typeof planController?.subscribe !== "function" ||
    typeof planController?.dispatch !== "function"
  )
    fail("plan_owner_invalid", "Plan connector requires the shared plan owner");
  const listeners = new Set();
  let destroyed = false;
  let revision = 0;
  const snapshot = () => {
    if (destroyed)
      fail("plan_connector_destroyed", "Plan connector is destroyed");
    return project(planController.snapshot(), revision);
  };
  const publish = () => {
    revision += 1;
    const state = snapshot();
    for (const listener of listeners) listener(state);
  };
  const unsubscribeOwner = planController.subscribe(publish, {
    emitCurrent: false,
  });
  if (typeof unsubscribeOwner !== "function")
    fail("plan_owner_subscription_invalid", "Plan owner cleanup is invalid");
  const isEligible = (id, args = {}) => {
    if (!CAPABILITY_IDS.includes(id)) return false;
    const state = snapshot();
    const stopIds = new Set(state.stops.map((stop) => stop.stopId));
    if (id === "plan.open") return !state.open;
    if (id === "plan.close") return state.open;
    if (id === "plan.uselocation") return true;
    if (id === "plan.focuslocation") return state.locationAvailable;
    if (id === "plan.settravelmode") return state.open && MODES.has(args.mode);
    if (id === "plan.addstop")
      return (
        state.stops.length < 20 &&
        state.addableTargetIds.includes(args.targetId)
      );
    if (["plan.removestop", "plan.focusstop"].includes(id))
      return stopIds.has(args.stopId);
    if (id === "plan.reorderstop")
      return (
        stopIds.has(args.stopId) &&
        Number.isInteger(args.toIndex) &&
        args.toIndex >= 0 &&
        args.toIndex < state.stops.length
      );
    return (
      state.routeAvailable &&
      (args.segmentIndex === undefined ||
        (Number.isInteger(args.segmentIndex) &&
          args.segmentIndex >= 0 &&
          args.segmentIndex < 100))
    );
  };
  const execute = async (id, args = {}) => {
    if (!isEligible(id, args))
      fail("plan_capability_unavailable", "Plan capability is unavailable");
    const changed =
      (await planController.dispatch(id, structuredClone(args))) !== false;
    const current = snapshot();
    const target = args.stopId ?? args.targetId ?? null;
    const patch = Object.freeze({
      plan: Object.freeze({
        stopIds: Object.freeze(current.stops.map((stop) => stop.stopId)),
        addableTargetIds: current.addableTargetIds,
        travelMode: current.travelMode,
        routeAvailable: current.routeAvailable,
      }),
      activeOverlayId: current.open ? "plan-builder" : null,
    });
    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(changed && target ? [target] : []),
      contextPatch: patch,
      data: Object.freeze({ state: current, contextPatch: patch }),
    });
  };
  return Object.freeze({
    connectorId: "plan",
    capabilityIds: CAPABILITY_IDS,
    availability: () => (destroyed ? "disabled" : "available"),
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        fail("plan_subscriber_invalid", "Subscriber is invalid");
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
