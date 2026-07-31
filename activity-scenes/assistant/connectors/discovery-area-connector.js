const CONNECTOR_ID = "discovery-areas";
const CAPABILITY_IDS = Object.freeze([
  "map.openarea",
  "map.selectarea",
  "map.compareareas",
  "map.dismissarea",
]);
const AREA_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
const MAX_AREAS = 5;

export class DiscoveryAreaConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DiscoveryAreaConnectorError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new DiscoveryAreaConnectorError(code, message);
};
const boundedString = (value, maximum) =>
  typeof value === "string" ? value.slice(0, maximum) : "";
const uniqueStrings = (values, maximum) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : []).filter(
        (value) => typeof value === "string" && AREA_ID.test(value),
      ),
    ),
  ].slice(0, maximum);

function projectReason(reason, knownCandidates) {
  const text = boundedString(reason?.text, 240);
  if (!text) return null;
  return Object.freeze({
    text,
    candidateIds: Object.freeze(
      uniqueStrings(reason?.candidateIds, 20).filter((candidateId) =>
        knownCandidates.has(candidateId),
      ),
    ),
    attributeKeys: Object.freeze(
      [
        ...new Set(
          (Array.isArray(reason?.attributeKeys) ? reason.attributeKeys : [])
            .filter(
              (value) =>
                typeof value === "string" &&
                /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value),
            )
            .map((value) => value.slice(0, 64)),
        ),
      ].slice(0, 12),
    ),
  });
}

function projectArea(area) {
  if (!AREA_ID.test(area?.areaId || "")) return null;
  const candidateIds = uniqueStrings(area.candidateIds, 20);
  const knownCandidates = new Set(candidateIds);
  const confidence = Number(area.confidence);
  return Object.freeze({
    areaId: area.areaId,
    rank:
      Number.isInteger(area.rank) && area.rank > 0
        ? Math.min(area.rank, MAX_AREAS)
        : 1,
    confidence: Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence))
      : 0,
    reasons: Object.freeze(
      (Array.isArray(area.reasons) ? area.reasons : [])
        .map((reason) => projectReason(reason, knownCandidates))
        .filter(Boolean)
        .slice(0, 5),
    ),
    tradeoffs: Object.freeze(
      [
        ...new Set(
          (Array.isArray(area.tradeoffs) ? area.tradeoffs : [])
            .filter((value) => typeof value === "string" && value.trim())
            .map((value) => value.slice(0, 140)),
        ),
      ].slice(0, 5),
    ),
    candidateIds: Object.freeze(candidateIds),
  });
}

function capabilityIdsFor(areaCount) {
  if (!areaCount) return [];
  return areaCount > 1
    ? [...CAPABILITY_IDS]
    : CAPABILITY_IDS.filter(
        (capabilityId) => capabilityId !== "map.compareareas",
      );
}

function areaLabel(areaId) {
  return areaId
    .replace(/^[^:]+:/, "")
    .replaceAll("-", " ")
    .slice(0, 200);
}

export function projectDiscoveryAreaSnapshot(snapshot, layerSnapshot = null) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    fail(
      "area_owner_snapshot_invalid",
      "Area controller returned invalid state",
    );
  const areas = (Array.isArray(snapshot.areas) ? snapshot.areas : [])
    .map(projectArea)
    .filter(Boolean)
    .slice(0, MAX_AREAS);
  const areaIds = new Set(areas.map(({ areaId }) => areaId));
  const layerState =
    layerSnapshot && typeof layerSnapshot === "object" ? layerSnapshot : {};
  const requestedSelection =
    snapshot.selectedAreaId ?? layerState.selectedAreaId ?? null;
  const selectedAreaId = areaIds.has(requestedSelection)
    ? requestedSelection
    : null;
  const comparedAreaIds = uniqueStrings(
    snapshot.comparedAreaIds ?? layerState.comparedAreaIds,
    3,
  ).filter((areaId) => areaIds.has(areaId));
  const availableCapabilityIds = capabilityIdsFor(areas.length);
  const visibleTargets = areas.map(({ areaId }) =>
    Object.freeze({
      targetId: areaId,
      type: "area",
      label: areaLabel(areaId),
    }),
  );

  return Object.freeze({
    revision:
      Number.isInteger(snapshot.revision) && snapshot.revision >= 0
        ? snapshot.revision
        : 0,
    areas: Object.freeze(areas),
    selectedAreaId,
    comparedAreaIds: Object.freeze(comparedAreaIds),
    visibleTargets: Object.freeze(visibleTargets),
    focusedTargetId: selectedAreaId,
    selectedTargetIds: Object.freeze(
      selectedAreaId ? [selectedAreaId] : comparedAreaIds,
    ),
    availableCapabilityIds: Object.freeze(availableCapabilityIds),
  });
}

function contextPatch(snapshot) {
  return Object.freeze({
    visibleTargets: snapshot.visibleTargets,
    focusedTargetId: snapshot.focusedTargetId,
    selectedTargetIds: snapshot.selectedTargetIds,
    availableCapabilityIds: snapshot.availableCapabilityIds,
  });
}

function validateOwner(areaController) {
  if (
    !areaController ||
    typeof areaController.snapshot !== "function" ||
    (typeof areaController.handleAction !== "function" &&
      !CAPABILITY_IDS.every((capabilityId) => {
        const methodName = {
          "map.openarea": "openArea",
          "map.selectarea": "selectArea",
          "map.compareareas": "compareAreas",
          "map.dismissarea": "dismissArea",
        }[capabilityId];
        return (
          typeof areaController[methodName] === "function" ||
          (capabilityId === "map.selectarea" &&
            typeof areaController.openArea === "function")
        );
      }))
  )
    fail(
      "area_owner_invalid",
      "Discovery-area connector requires the authoritative area controller",
    );
}

export function createDiscoveryAreaConnector({
  areaController,
  areaLayerManager = null,
  layerManager = areaLayerManager,
} = {}) {
  validateOwner(areaController);
  const listeners = new Set();
  let destroyed = false;
  let ownerSubscription = null;

  const ensureActive = () => {
    if (destroyed)
      fail(
        "area_connector_destroyed",
        "Discovery-area connector has been destroyed",
      );
  };
  const snapshot = () => {
    ensureActive();
    return projectDiscoveryAreaSnapshot(
      areaController.snapshot(),
      layerManager?.snapshot?.(),
    );
  };
  const publish = () => {
    const projected = snapshot();
    for (const listener of listeners) listener(projected);
  };

  if (typeof areaController.subscribe === "function") {
    ownerSubscription = areaController.subscribe(publish);
    if (typeof ownerSubscription !== "function")
      fail(
        "area_owner_subscription_invalid",
        "Area controller returned invalid subscription cleanup",
      );
  }

  const isEligible = (capabilityId, argumentsValue = {}) => {
    if (!CAPABILITY_IDS.includes(capabilityId)) return false;
    const current = snapshot();
    const areaIds = new Set(current.areas.map(({ areaId }) => areaId));
    if (!current.availableCapabilityIds.includes(capabilityId)) return false;
    if (capabilityId === "map.compareareas") {
      const targets = argumentsValue?.areaIds;
      return (
        Array.isArray(targets) &&
        targets.length >= 2 &&
        targets.length <= 3 &&
        new Set(targets).size === targets.length &&
        targets.every((areaId) => AREA_ID.test(areaId) && areaIds.has(areaId))
      );
    }
    return (
      AREA_ID.test(argumentsValue?.areaId || "") &&
      areaIds.has(argumentsValue.areaId)
    );
  };

  const invokeOwner = (capabilityId, argumentsValue) => {
    if (typeof areaController.handleAction === "function")
      return areaController.handleAction(capabilityId, argumentsValue);
    const methodName = {
      "map.openarea": "openArea",
      "map.selectarea":
        typeof areaController.selectArea === "function"
          ? "selectArea"
          : "openArea",
      "map.compareareas": "compareAreas",
      "map.dismissarea": "dismissArea",
    }[capabilityId];
    return areaController[methodName](
      capabilityId === "map.compareareas"
        ? argumentsValue.areaIds
        : argumentsValue.areaId,
    );
  };

  const execute = async (capabilityId, argumentsValue = {}) => {
    ensureActive();
    if (!CAPABILITY_IDS.includes(capabilityId))
      fail(
        "capability_unsupported",
        `Discovery-area connector does not support ${capabilityId}`,
      );
    if (!isEligible(capabilityId, argumentsValue))
      fail(
        "area_target_unavailable",
        "The requested area is no longer an approved visible recommendation",
      );

    const result = await invokeOwner(capabilityId, argumentsValue);
    const requestedIds =
      capabilityId === "map.compareareas"
        ? [...argumentsValue.areaIds]
        : [argumentsValue.areaId];
    const changed =
      capabilityId === "map.compareareas"
        ? Array.isArray(result) && result.length === requestedIds.length
        : Boolean(result);
    if (!ownerSubscription && changed) publish();
    const current = snapshot();
    const patch = contextPatch(current);
    const removedAreaIds =
      capabilityId === "map.dismissarea" && changed ? requestedIds : [];
    const comparedAreaIds =
      capabilityId === "map.compareareas" && changed
        ? requestedIds
        : current.comparedAreaIds;
    const data = Object.freeze({
      selectedAreaId: current.selectedAreaId,
      comparedAreaIds: Object.freeze([...comparedAreaIds]),
      removedAreaIds: Object.freeze(removedAreaIds),
      contextPatch: patch,
    });

    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(changed ? requestedIds : []),
      contextPatch: patch,
      data,
    });
  };

  return Object.freeze({
    connectorId: CONNECTOR_ID,
    capabilityIds: CAPABILITY_IDS,
    availability() {
      if (destroyed) return "disabled";
      try {
        return snapshot().areas.length ? "available" : "empty";
      } catch {
        return "unavailable";
      }
    },
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      ensureActive();
      if (typeof listener !== "function")
        fail(
          "area_subscriber_invalid",
          "Discovery-area subscriber must be a function",
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
    destroy() {
      if (destroyed) return;
      ownerSubscription?.();
      ownerSubscription = null;
      listeners.clear();
      destroyed = true;
    },
  });
}
