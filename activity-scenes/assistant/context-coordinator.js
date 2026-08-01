export class ContextCoordinatorError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ContextCoordinatorError";
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new ContextCoordinatorError(code, message, details);
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

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
const finite = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
};

const FILTER_FIELDS = Object.freeze({
  eventQuery: "string",
  eventWhat: "array",
  eventWhen: "array",
  eventWhere: "array",
  eventPrice: "array",
  eventComposerState: "event-composer",
  restaurantQuery: "string",
  restaurantCategory: "nullable",
  restaurantCuisine: "nullable",
});

function normalizeFilters(input = {}) {
  const output = {};
  for (const [field, kind] of Object.entries(FILTER_FIELDS)) {
    if (input[field] === undefined) continue;
    if (kind === "event-composer") {
      const composer = input[field];
      if (!composer || typeof composer !== "object" || Array.isArray(composer))
        continue;
      output[field] = {
        canonicalSentence: boundedString(composer.canonicalSentence, 500),
        residualQuery: boundedString(composer.residualQuery, 500),
        phrases: (Array.isArray(composer.phrases) ? composer.phrases : [])
          .slice(0, 24)
          .map((phrase) => ({
            phraseId: boundedString(phrase?.phraseId, 120),
            facet: ["what", "when", "where", "price"].includes(phrase?.facet)
              ? phrase.facet
              : "what",
            valueId: boundedString(phrase?.valueId, 120),
            label: boundedString(phrase?.label, 160),
          }))
          .filter(
            ({ phraseId, valueId, label }) => phraseId && valueId && label,
          ),
        catalogRevision: boundedString(composer.catalogRevision, 160),
        contextRevision: Math.max(
          0,
          Number.isInteger(composer.contextRevision)
            ? composer.contextRevision
            : 0,
        ),
      };
    } else if (kind === "array")
      output[field] = uniqueStrings(input[field], 12, 100);
    else if (kind === "nullable")
      output[field] = nullableString(input[field], 100);
    else output[field] = boundedString(input[field], 500);
  }
  return output;
}

function normalizeVisibleTargets(input = []) {
  const seen = new Set();
  const targets = [];
  for (const candidate of Array.isArray(input) ? input : []) {
    const targetId = boundedString(candidate?.targetId, 256);
    const type = boundedString(candidate?.type, 64);
    const label = boundedString(candidate?.label, 200);
    if (!targetId || !type || !label || seen.has(targetId)) continue;
    seen.add(targetId);
    targets.push({ targetId, type, label, ordinal: targets.length + 1 });
    if (targets.length === 50) break;
  }
  return targets;
}

function normalizeEventFacetCatalog(input = {}) {
  return {
    catalogRevision: boundedString(input.catalogRevision, 160),
    ...Object.fromEntries(
      ["what", "when", "where", "price"].map((facet) => [
        facet,
        uniqueStrings(input[facet], facet === "what" ? 60 : 20, 160),
      ]),
    ),
  };
}

function mergeParts(parts) {
  const merged = {
    visibleTargets: [],
    selectedTargetIds: [],
    activeFilters: {},
    availableCapabilityIds: [],
  };
  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part))
      fail(
        "context_connector_snapshot_invalid",
        "Connector snapshots must be objects",
      );
    for (const [key, value] of Object.entries(part)) {
      if (key === "visibleTargets")
        merged.visibleTargets.push(...(Array.isArray(value) ? value : []));
      else if (key === "selectedTargetIds")
        merged.selectedTargetIds.push(...(Array.isArray(value) ? value : []));
      else if (key === "availableCapabilityIds")
        merged.availableCapabilityIds.push(
          ...(Array.isArray(value) ? value : []),
        );
      else if (key === "activeFilters")
        Object.assign(merged.activeFilters, value || {});
      else if (key === "activeOverlayId" || key === "focusedTargetId") {
        if (value !== null && value !== undefined) merged[key] = value;
      } else merged[key] = value;
    }
  }
  return merged;
}

export function canonicalizeContextState(input = {}) {
  const visibleTargets = normalizeVisibleTargets(input.visibleTargets);
  const visibleIds = new Set(visibleTargets.map(({ targetId }) => targetId));
  const focused = nullableString(input.focusedTargetId, 256);
  const selectedTargetIds = uniqueStrings(input.selectedTargetIds, 20).filter(
    (targetId) => visibleIds.has(targetId),
  );
  const travelModes = new Set(["walking", "driving", "bicycling", "transit"]);
  const permissions = new Set(["prompt", "granted", "denied", "unavailable"]);
  const locationStatuses = new Set([
    "idle",
    "locating",
    "fresh",
    "stale",
    "error",
  ]);
  const viewport = input.viewport || {};
  const plan = input.plan || {};
  const location = input.location || input.locationState || {};
  const transit = input.transit || {};
  const visibleLayers = input.visibleLayers || {};

  return {
    viewport: {
      zoom: finite(viewport.zoom, 0, 0, 24),
      bearing: finite(viewport.bearing, 0, -180, 180),
    },
    visibleLayers: {
      recommendations: visibleLayers.recommendations === true,
      location: visibleLayers.location === true,
      mrtStations: visibleLayers.mrtStations === true,
      mrtLines: visibleLayers.mrtLines === true,
    },
    visibleTargets,
    focusedTargetId: visibleIds.has(focused) ? focused : null,
    selectedTargetIds,
    activeOverlayId: nullableString(input.activeOverlayId, 128),
    assistantPresentation: new Set([
      "recommendations",
      "clarification",
      "no_match",
    ]).has(input.assistantPresentation)
      ? input.assistantPresentation
      : null,
    activeFilters: normalizeFilters(input.activeFilters),
    eventFacetCatalog: normalizeEventFacetCatalog(input.eventFacetCatalog),
    plan: {
      stopIds: uniqueStrings(plan.stopIds, 20),
      addableTargetIds: uniqueStrings(
        plan.addableTargetIds ?? input.addableTargetIds,
        50,
      ),
      travelMode: travelModes.has(plan.travelMode)
        ? plan.travelMode
        : "walking",
      routeAvailable: plan.routeAvailable === true,
    },
    location: {
      permission: permissions.has(location.permission)
        ? location.permission
        : "unavailable",
      status: locationStatuses.has(location.status) ? location.status : "error",
      coarseAreaId: nullableString(location.coarseAreaId, 256),
    },
    transit: {
      visible:
        transit.visible === true ||
        (transit.visible === undefined && input.transitVisible === true),
      constraintActive:
        transit.constraintActive === true ||
        (transit.constraintActive === undefined &&
          input.transitConstraintActive === true),
    },
    availableCapabilityIds: uniqueStrings(
      input.availableCapabilityIds || input.availableActionIds,
      128,
    )
      .filter((capabilityId) =>
        /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(capabilityId),
      )
      .sort(),
  };
}

function validateConnector(connector) {
  if (
    !connector ||
    typeof connector.connectorId !== "string" ||
    !connector.connectorId ||
    typeof connector.snapshot !== "function" ||
    typeof connector.subscribe !== "function"
  )
    fail(
      "context_connector_invalid",
      "A connector requires connectorId, snapshot, and subscribe",
    );
  return connector;
}

export function createContextCoordinator({ connectors = [] } = {}) {
  const sources = [...connectors]
    .map(validateConnector)
    .sort((left, right) => left.connectorId.localeCompare(right.connectorId));
  if (
    new Set(sources.map(({ connectorId }) => connectorId)).size !==
    sources.length
  )
    fail("context_connector_duplicate", "Connector IDs must be unique");

  let current = null;
  let started = false;
  let destroyed = false;
  let queue = Promise.resolve();
  const listeners = new Set();
  const waiters = new Set();
  const unsubscribers = [];

  const ensureActive = () => {
    if (destroyed)
      fail(
        "context_coordinator_destroyed",
        "Context coordinator has been destroyed",
      );
  };

  const settleWaiters = () => {
    if (!current) return;
    for (const waiter of [...waiters]) {
      if (current.revision < waiter.minimumRevision) continue;
      waiters.delete(waiter);
      waiter.resolve(current);
    }
  };

  const collectAndPublish = async () => {
    ensureActive();
    const parts = [];
    for (const connector of sources) parts.push(await connector.snapshot());
    const semantic = canonicalizeContextState(mergeParts(parts));
    const stateDigest = digest(semantic);
    if (current?.stateDigest === stateDigest) return current;
    const revision = current ? current.revision + 1 : 0;
    current = deepFreeze({ revision, stateDigest, ...semantic });
    if (revision > 0) for (const listener of listeners) listener(current);
    settleWaiters();
    return current;
  };

  const enqueuePublication = () => {
    ensureActive();
    queue = queue.catch(() => undefined).then(collectAndPublish);
    return queue;
  };

  return Object.freeze({
    async start() {
      ensureActive();
      if (started) return queue.then(() => current);
      started = true;
      for (const connector of sources) {
        const unsubscribe = connector.subscribe(() => {
          if (!destroyed) void enqueuePublication().catch(() => {});
        });
        if (typeof unsubscribe !== "function")
          fail(
            "context_connector_subscription_invalid",
            `Connector ${connector.connectorId} did not return an unsubscribe function`,
          );
        unsubscribers.push(unsubscribe);
      }
      return enqueuePublication();
    },
    snapshot() {
      ensureActive();
      if (!current)
        fail(
          "context_coordinator_not_started",
          "Context coordinator has not published its initial snapshot",
        );
      return current;
    },
    refresh: enqueuePublication,
    waitForIdle() {
      ensureActive();
      return queue.then(() => current);
    },
    waitForPublication(minimumRevision) {
      try {
        ensureActive();
        if (!Number.isInteger(minimumRevision) || minimumRevision < 0)
          fail(
            "context_revision_invalid",
            "Minimum context revision must be a non-negative integer",
          );
        if (current && current.revision >= minimumRevision)
          return Promise.resolve(current);
        return new Promise((resolve, reject) => {
          waiters.add({ minimumRevision, resolve, reject });
        });
      } catch (error) {
        return Promise.reject(error);
      }
    },
    subscribe(listener, { emitCurrent = false } = {}) {
      ensureActive();
      if (typeof listener !== "function")
        fail(
          "context_subscriber_invalid",
          "Context subscriber must be a function",
        );
      listeners.add(listener);
      if (emitCurrent && current) listener(current);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      listeners.clear();
      const error = new ContextCoordinatorError(
        "context_coordinator_destroyed",
        "Context coordinator has been destroyed",
      );
      for (const waiter of waiters) waiter.reject(error);
      waiters.clear();
      current = null;
    },
  });
}
