const VALID_PERMISSIONS = new Set([
  "prompt",
  "granted",
  "denied",
  "unavailable",
]);
const VALID_STATUSES = new Set(["idle", "locating", "fresh", "stale", "error"]);
const clone = (value) => structuredClone(value);

const initialState = () => ({
  permission: "prompt",
  status: "idle",
  coordinates: null,
  accuracyMeters: null,
  observedAt: null,
  coarseAreaId: null,
  errorCode: null,
});

function validCoordinates(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1]) &&
    coordinates[0] >= -180 &&
    coordinates[0] <= 180 &&
    coordinates[1] >= -90 &&
    coordinates[1] <= 90
  );
}

function pointInRing([x, y], ring = []) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const [xi, yi] = ring[index] || [];
    const [xj, yj] = ring[previous] || [];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function resolveCoarseAreaFromFeatures(coordinates, featureCollection) {
  if (!validCoordinates(coordinates)) return null;
  for (const feature of featureCollection?.features || []) {
    const polygons =
      feature.geometry?.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry?.type === "MultiPolygon"
          ? feature.geometry.coordinates
          : [];
    if (
      polygons.some(
        (polygon) =>
          pointInRing(coordinates, polygon[0]) &&
          !polygon.slice(1).some((hole) => pointInRing(coordinates, hole)),
      )
    )
      return feature.properties?.areaId || null;
  }
  return null;
}

export function createLocationModel({
  now = () => Date.now(),
  staleAfterMs = 120_000,
  resolveCoarseArea = () => null,
} = {}) {
  if (
    typeof now !== "function" ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= 0
  ) {
    throw new TypeError(
      "A clock and positive location freshness duration are required",
    );
  }
  let state = initialState();
  const subscribers = new Set();

  const refresh = () => {
    if (
      state.status === "fresh" &&
      state.observedAt !== null &&
      now() - state.observedAt > staleAfterMs
    ) {
      state = { ...state, status: "stale" };
    }
  };
  const publicSnapshot = (includeExact = false) => {
    refresh();
    const snapshot = {
      permission: state.permission,
      status: state.status,
      accuracyMeters: state.accuracyMeters,
      observedAt: state.observedAt,
      coarseAreaId: state.coarseAreaId,
      errorCode: state.errorCode,
    };
    if (includeExact)
      snapshot.coordinates = state.coordinates ? [...state.coordinates] : null;
    return Object.freeze(snapshot);
  };
  const emit = () => {
    const snapshot = publicSnapshot(true);
    for (const subscriber of subscribers) subscriber(snapshot);
  };
  const replace = (next) => {
    state = next;
    emit();
    return publicSnapshot(true);
  };

  return Object.freeze({
    snapshot({ includeExact = false } = {}) {
      return publicSnapshot(includeExact);
    },
    subscribe(subscriber, { emitCurrent = true } = {}) {
      if (typeof subscriber !== "function")
        throw new TypeError("Location subscriber must be a function");
      subscribers.add(subscriber);
      if (emitCurrent) subscriber(publicSnapshot(true));
      return () => subscribers.delete(subscriber);
    },
    setPermission(permission) {
      if (!VALID_PERMISSIONS.has(permission))
        throw new TypeError("Invalid location permission");
      const clearsExact =
        permission === "denied" || permission === "unavailable";
      return replace({
        ...state,
        permission,
        status: clearsExact ? "error" : state.status,
        coordinates: clearsExact ? null : state.coordinates,
        accuracyMeters: clearsExact ? null : state.accuracyMeters,
        observedAt: clearsExact ? null : state.observedAt,
        coarseAreaId: clearsExact ? null : state.coarseAreaId,
        errorCode: clearsExact ? permission : null,
      });
    },
    beginRequest() {
      return replace({ ...state, status: "locating", errorCode: null });
    },
    receivePosition({ coordinates, accuracyMeters, observedAt = now() } = {}) {
      if (
        !validCoordinates(coordinates) ||
        !Number.isFinite(accuracyMeters) ||
        accuracyMeters < 0 ||
        !Number.isFinite(observedAt)
      ) {
        throw new TypeError("Location position is invalid");
      }
      const coarseAreaId = resolveCoarseArea([...coordinates]);
      return replace({
        permission: "granted",
        status: now() - observedAt > staleAfterMs ? "stale" : "fresh",
        coordinates: [...coordinates],
        accuracyMeters,
        observedAt,
        coarseAreaId: coarseAreaId || null,
        errorCode: null,
      });
    },
    setError(
      errorCode = "unavailable",
      { permission = state.permission } = {},
    ) {
      if (!VALID_PERMISSIONS.has(permission))
        throw new TypeError("Invalid location permission");
      return replace({
        ...state,
        permission,
        status: "error",
        coordinates: null,
        accuracyMeters: null,
        observedAt: null,
        coarseAreaId: null,
        errorCode: String(errorCode),
      });
    },
    refresh() {
      const before = state.status;
      refresh();
      if (state.status !== before) emit();
      return publicSnapshot(true);
    },
    clearExact({ resetPermission = false } = {}) {
      return replace({
        ...initialState(),
        permission: resetPermission ? "prompt" : state.permission,
      });
    },
    destroy() {
      state = initialState();
      subscribers.clear();
    },
    statusValues: Object.freeze([...VALID_STATUSES]),
  });
}
