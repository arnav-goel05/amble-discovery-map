const CONDITIONAL_IDS = Object.freeze([
  "saved.open",
  "saved.openitem",
  "saved.deleteitem",
  "game.open",
  "game.start",
  "game.pause",
  "game.resume",
  "game.status",
  "game.skip",
  "game.quit",
  "game.openroute",
]);
export function createConditionalContentConnector({
  savedOwner = null,
  gameOwner = null,
} = {}) {
  const savedReady =
    typeof savedOwner?.snapshot === "function" &&
    typeof savedOwner?.dispatch === "function" &&
    (savedOwner.snapshot()?.items?.length || 0) > 0;
  const gameReady =
    typeof gameOwner?.snapshot === "function" &&
    typeof gameOwner?.dispatch === "function" &&
    (gameOwner.snapshot()?.games?.length || 0) > 0;
  if (!savedReady && !gameReady) {
    const emptySnapshot = Object.freeze({
      revision: 0,
      savedItemIds: Object.freeze([]),
      gameIds: Object.freeze([]),
      availableCapabilityIds: Object.freeze([]),
    });
    return Object.freeze({
      connectorId: "conditional-content",
      registered: false,
      capabilityIds: Object.freeze([]),
      availability: () => "empty",
      snapshot: () => emptySnapshot,
      subscribe(listener, { emitCurrent = false } = {}) {
        if (typeof listener !== "function")
          throw new TypeError("Conditional subscriber is invalid");
        if (emitCurrent) listener(emptySnapshot);
        return () => {};
      },
      isEligible: () => false,
      async execute() {
        throw new Error("Conditional capability is unavailable");
      },
      destroy() {},
    });
  }
  const owners = { saved: savedOwner, game: gameOwner };
  const capabilityIds = CONDITIONAL_IDS.filter(
    (id) => owners[id.split(".")[0]],
  );
  const listeners = new Set();
  const sourceUnsubscribers = [];
  let revision = 0;
  let destroyed = false;
  const snapshot = () => {
    if (destroyed) throw new Error("Conditional connector is destroyed");
    const savedItemIds = (savedOwner?.snapshot()?.items || [])
      .map((item) => item.id)
      .filter(Boolean)
      .slice(0, 50);
    const gameIds = (gameOwner?.snapshot()?.games || [])
      .map((item) => item.id)
      .filter(Boolean)
      .slice(0, 20);
    return Object.freeze({
      revision,
      savedItemIds: Object.freeze(savedItemIds),
      gameIds: Object.freeze(gameIds),
      availableCapabilityIds: Object.freeze(capabilityIds),
    });
  };
  const publish = () => {
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  for (const owner of [savedOwner, gameOwner]) {
    if (typeof owner?.subscribe !== "function") continue;
    const unsubscribe = owner.subscribe(publish, { emitCurrent: false });
    if (typeof unsubscribe === "function")
      sourceUnsubscribers.push(unsubscribe);
  }
  const isEligible = (id, args = {}) => {
    const state = snapshot();
    if (!capabilityIds.includes(id)) return false;
    if (id === "saved.open") return state.savedItemIds.length > 0;
    if (id.startsWith("saved."))
      return state.savedItemIds.includes(args.itemId);
    if (id === "game.start")
      return typeof args.planId === "string" && args.planId.length > 0;
    if (id === "game.open" && !args.gameId) return state.gameIds.length > 0;
    return state.gameIds.includes(args.gameId);
  };
  const execute = async (id, args = {}) => {
    if (!isEligible(id, args))
      throw new Error("Conditional capability is unavailable");
    const changed =
      (await owners[id.split(".")[0]].dispatch(id, structuredClone(args))) !==
      false;
    const current = snapshot();
    const affectedTargetIds = id.startsWith("saved.")
      ? [args.itemId].filter(Boolean)
      : [args.gameId].filter(Boolean);
    const contextPatch = Object.freeze({
      activeOverlayId: id === "saved.open" ? "saved" : undefined,
    });
    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(affectedTargetIds),
      contextPatch,
      data: Object.freeze({ state: current, contextPatch }),
    });
  };
  return Object.freeze({
    connectorId: "conditional-content",
    registered: true,
    capabilityIds: Object.freeze(capabilityIds),
    availability: () => (destroyed ? "disabled" : "available"),
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        throw new TypeError("Conditional subscriber is invalid");
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => listeners.delete(listener);
    },
    isEligible,
    execute,
    destroy() {
      if (destroyed) return;
      for (const unsubscribe of sourceUnsubscribers) unsubscribe();
      listeners.clear();
      destroyed = true;
    },
  });
}
