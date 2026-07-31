const CAPABILITY_IDS = Object.freeze([
  "navigation.enterexperience",
  "navigation.openassistant",
  "navigation.closeassistant",
  "navigation.closeoverlay",
  "navigation.openattribution",
  "navigation.closeattribution",
  "navigation.openattributionreference",
  "navigation.openexternal",
]);
const LINK_KINDS = new Set(["reference", "directions", "deal", "route"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
export class OverlayNavigationConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OverlayNavigationConnectorError";
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new OverlayNavigationConnectorError(code, message);
};
const ids = (values, max = 50) =>
  [
    ...new Set(
      (values || []).filter((id) => typeof id === "string" && ID.test(id)),
    ),
  ].slice(0, max);
function project(value, revision) {
  const links = {};
  for (const [targetId, kinds] of Object.entries(value?.approvedLinks || {}))
    if (ID.test(targetId))
      links[targetId] = Object.freeze(
        ids(kinds, 4).filter((kind) => LINK_KINDS.has(kind)),
      );
  return Object.freeze({
    revision,
    introVisible: value?.introVisible === true,
    assistantOpen: value?.assistantOpen === true,
    activeOverlayId:
      typeof value?.activeOverlayId === "string"
        ? value.activeOverlayId.slice(0, 128)
        : null,
    closableOverlayIds: Object.freeze(ids(value?.closableOverlayIds, 20)),
    attributionOpen: value?.attributionOpen === true,
    attributionReferenceIds: Object.freeze(
      ids(value?.attributionReferenceIds, 20),
    ),
    approvedLinks: Object.freeze(links),
  });
}
export function createOverlayNavigationConnector({
  navigationController,
} = {}) {
  if (
    typeof navigationController?.snapshot !== "function" ||
    typeof navigationController?.subscribe !== "function" ||
    typeof navigationController?.dispatch !== "function"
  )
    fail(
      "navigation_owner_invalid",
      "Overlay connector requires the shared navigation owner",
    );
  const listeners = new Set();
  let revision = 0;
  let destroyed = false;
  const snapshot = () => {
    if (destroyed)
      fail(
        "navigation_connector_destroyed",
        "Navigation connector is destroyed",
      );
    return project(navigationController.snapshot(), revision);
  };
  const publish = () => {
    revision += 1;
    const state = snapshot();
    for (const listener of listeners) listener(state);
  };
  const unsubscribeOwner = navigationController.subscribe(publish, {
    emitCurrent: false,
  });
  if (typeof unsubscribeOwner !== "function")
    fail(
      "navigation_owner_subscription_invalid",
      "Navigation owner cleanup is invalid",
    );
  const isEligible = (id, args = {}) => {
    if (!CAPABILITY_IDS.includes(id)) return false;
    const state = snapshot();
    if (id === "navigation.enterexperience") return state.introVisible;
    if (id === "navigation.openassistant") return !state.assistantOpen;
    if (id === "navigation.closeassistant") return state.assistantOpen;
    if (id === "navigation.closeoverlay")
      return (
        Boolean(state.activeOverlayId) &&
        (!args.overlayId || state.closableOverlayIds.includes(args.overlayId))
      );
    if (id === "navigation.openattribution") return !state.attributionOpen;
    if (id === "navigation.closeattribution") return state.attributionOpen;
    if (id === "navigation.openattributionreference")
      return (
        state.attributionOpen &&
        state.attributionReferenceIds.includes(args.referenceId)
      );
    return (
      LINK_KINDS.has(args.linkKind) &&
      state.approvedLinks[args.targetId]?.includes(args.linkKind) === true
    );
  };
  const execute = async (id, args = {}) => {
    if (!isEligible(id, args))
      fail(
        id.includes("external") || id.includes("reference")
          ? "external_target_unapproved"
          : "navigation_unavailable",
        "Navigation capability is unavailable",
      );
    const changed =
      (await navigationController.dispatch(id, structuredClone(args))) !==
      false;
    const current = snapshot();
    const target = args.targetId ?? args.referenceId ?? null;
    const patch = Object.freeze({
      activeOverlayId: current.activeOverlayId,
      focusedTargetId: null,
      selectedTargetIds: Object.freeze([]),
    });
    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(changed && target ? [target] : []),
      contextPatch: patch,
      data: Object.freeze({
        activeOverlayId: current.activeOverlayId,
        assistantOpen: current.assistantOpen,
        attributionOpen: current.attributionOpen,
        contextPatch: patch,
      }),
    });
  };
  return Object.freeze({
    connectorId: "overlay-navigation",
    capabilityIds: CAPABILITY_IDS,
    availability: () => (destroyed ? "disabled" : "available"),
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        fail("navigation_subscriber_invalid", "Subscriber is invalid");
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
