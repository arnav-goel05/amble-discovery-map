export class InterfaceContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InterfaceContextError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new InterfaceContextError(code, message);
};
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function normalize(input, revision) {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray(input.visibleTargets)
  )
    fail("context_invalid", "Interface context is invalid");
  const identities = new Set();
  const visibleTargets = input.visibleTargets.map((target, index) => {
    if (
      !target ||
      typeof target.targetId !== "string" ||
      !target.targetId ||
      identities.has(target.targetId) ||
      typeof target.type !== "string" ||
      typeof target.label !== "string"
    )
      fail("context_target_invalid", "Visible target is invalid or duplicated");
    identities.add(target.targetId);
    return {
      targetId: target.targetId,
      type: target.type,
      label: target.label,
      ordinal: index + 1,
    };
  });
  if (
    input.focusedTargetId !== null &&
    input.focusedTargetId !== undefined &&
    !identities.has(input.focusedTargetId)
  )
    fail("context_target_unknown", "Focused target is not visible");
  const selectedTargetIds = [...new Set(input.selectedTargetIds || [])];
  if (selectedTargetIds.some((id) => !identities.has(id)))
    fail("context_target_unknown", "Selected target is not visible");
  return freeze({
    revision,
    viewport: structuredClone(input.viewport || {}),
    visibleTargets,
    focusedTargetId: input.focusedTargetId ?? null,
    selectedTargetIds,
    activeOverlayId: input.activeOverlayId ?? null,
    activeFilters: structuredClone(input.activeFilters || {}),
    locationState: structuredClone(
      input.locationState || {
        permission: "prompt",
        status: "idle",
        coarseAreaId: null,
      },
    ),
    transitVisible: input.transitVisible === true,
    transitConstraintActive: input.transitConstraintActive === true,
    availableActionIds: [...new Set(input.availableActionIds || [])].sort(),
  });
}

const clarification = (snapshot, reason, candidateTargetIds = []) => ({
  status: "clarification_required",
  reason,
  candidateTargetIds,
  contextRevision: snapshot.revision,
});

export function resolveInterfaceReference(
  snapshot,
  reference,
  { expectedRevision = snapshot?.revision } = {},
) {
  if (!snapshot || expectedRevision !== snapshot.revision)
    return clarification(snapshot, "context_revision_stale");
  if (reference?.kind === "ordinal") {
    const target = snapshot.visibleTargets.find(
      ({ ordinal }) => ordinal === reference.ordinal,
    );
    return target
      ? {
          status: "resolved",
          targetId: target.targetId,
          contextRevision: snapshot.revision,
        }
      : clarification(snapshot, "reference_target_missing");
  }
  if (reference?.kind === "deictic") {
    if (snapshot.focusedTargetId)
      return {
        status: "resolved",
        targetId: snapshot.focusedTargetId,
        contextRevision: snapshot.revision,
      };
    if (snapshot.selectedTargetIds.length === 1)
      return {
        status: "resolved",
        targetId: snapshot.selectedTargetIds[0],
        contextRevision: snapshot.revision,
      };
    if (snapshot.selectedTargetIds.length > 1)
      return clarification(
        snapshot,
        "ambiguous_reference",
        [...snapshot.selectedTargetIds].sort(),
      );
    return clarification(snapshot, "reference_target_missing");
  }
  if (reference?.kind === "active_overlay") {
    return snapshot.activeOverlayId
      ? {
          status: "resolved",
          overlayId: snapshot.activeOverlayId,
          contextRevision: snapshot.revision,
        }
      : clarification(snapshot, "reference_target_missing");
  }
  if (
    reference?.kind === "target" &&
    snapshot.visibleTargets.some(
      ({ targetId }) => targetId === reference.targetId,
    )
  )
    return {
      status: "resolved",
      targetId: reference.targetId,
      contextRevision: snapshot.revision,
    };
  return clarification(snapshot, "reference_target_missing");
}

export function createInterfaceContext(initial) {
  let current = normalize(initial, 0);
  return Object.freeze({
    snapshot: () => current,
    update(patch = {}) {
      current = normalize({ ...current, ...patch }, current.revision + 1);
      return current;
    },
    resolve(reference, options) {
      return resolveInterfaceReference(current, reference, options);
    },
  });
}
