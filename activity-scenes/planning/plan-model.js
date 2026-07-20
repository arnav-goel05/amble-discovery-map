export const MAX_PLAN_STOPS = 20;

export function planStopKey(stop) {
  return stop &&
    ["event", "restaurant"].includes(stop.type) &&
    String(stop.id ?? "").trim()
    ? `${stop.type}:${String(stop.id).trim()}`
    : null;
}

export function hasRouteCoordinates(stop) {
  return (
    Number.isFinite(Number(stop?.latitude)) &&
    Number(stop.latitude) >= -90 &&
    Number(stop.latitude) <= 90 &&
    Number.isFinite(Number(stop?.longitude)) &&
    Number(stop.longitude) >= -180 &&
    Number(stop.longitude) <= 180
  );
}

const cloneStop = (stop) => ({
  ...structuredClone(stop),
  latitude: Number(stop.latitude),
  longitude: Number(stop.longitude),
});

export function createPlanState({ stops = [] } = {}) {
  const unique = [];
  const keys = new Set();
  for (const value of stops.slice(0, MAX_PLAN_STOPS)) {
    const key = planStopKey(value);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    unique.push(cloneStop(value));
  }
  return Object.freeze({ stops: Object.freeze(unique) });
}

export function addPlanStop(state, stop) {
  const key = planStopKey(stop);
  if (!key || !hasRouteCoordinates(stop) || !String(stop.title ?? "").trim())
    return { state, added: false, reason: "invalid" };
  if (state.stops.some((item) => planStopKey(item) === key))
    return { state, added: false, reason: "duplicate" };
  if (state.stops.length >= MAX_PLAN_STOPS)
    return { state, added: false, reason: "limit" };
  return {
    state: createPlanState({ stops: [...state.stops, stop] }),
    added: true,
    reason: null,
  };
}

export function removePlanStop(state, key) {
  if (!state.stops.some((item) => planStopKey(item) === key)) return state;
  return createPlanState({
    stops: state.stops.filter((item) => planStopKey(item) !== key),
  });
}

export function movePlanStop(state, fromIndex, toIndex) {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= state.stops.length ||
    toIndex >= state.stops.length ||
    fromIndex === toIndex
  )
    return state;
  const stops = [...state.stops];
  const [moved] = stops.splice(fromIndex, 1);
  stops.splice(toIndex, 0, moved);
  return createPlanState({ stops });
}

export function routeStops(state) {
  return state.stops.filter(hasRouteCoordinates).map(cloneStop);
}

export function planWarnings(state, { now = new Date() } = {}) {
  const warnings = [];
  const unavailable = state.stops.filter(
    (stop) => stop.availability === "unavailable" || stop.isAvailable === false,
  );
  if (unavailable.length)
    warnings.push(
      `${unavailable.length} venue${unavailable.length === 1 ? " is" : "s are"} marked unavailable.`,
    );
  const expired = state.stops.filter(
    (stop) =>
      stop.type === "event" &&
      (stop.endsAt || stop.expiresAt) &&
      Date.parse(stop.endsAt || stop.expiresAt) < now.valueOf(),
  );
  if (expired.length)
    warnings.push(
      `${expired.length} event${expired.length === 1 ? " has" : "s have"} expired.`,
    );
  const hoursMissing = state.stops.filter(
    (stop) => stop.type === "restaurant" && !stop.openingHours && !stop.detail,
  );
  if (hoursMissing.length)
    warnings.push(
      `Opening hours are missing for ${hoursMissing.length} food stop${hoursMissing.length === 1 ? "" : "s"}.`,
    );
  const invalid = state.stops.filter((stop) => !hasRouteCoordinates(stop));
  if (invalid.length)
    warnings.push(
      `${invalid.length} stop${invalid.length === 1 ? " has" : "s have"} invalid coordinates and cannot be routed.`,
    );
  return warnings;
}

function candidateCoordinates(value) {
  if (!hasRouteCoordinates(value)) return null;
  return Object.freeze([Number(value.longitude), Number(value.latitude)]);
}

function freezeCandidate(candidate) {
  if (candidate.coordinates) Object.freeze(candidate.coordinates);
  return Object.freeze(candidate);
}

export function createPlanningCandidateState(state, { games = [] } = {}) {
  const planStops = (state?.stops || []).map((stop, index) =>
    freezeCandidate({
      candidateId: `plan-stop:${planStopKey(stop)}`,
      candidateType: "plan_stop",
      stopKey: planStopKey(stop),
      stopType: stop.type,
      title: String(stop.title || "").trim(),
      place: String(stop.place || "").trim(),
      position: index + 1,
      coordinates: candidateCoordinates(stop),
      areaId:
        typeof stop.areaId === "string" && stop.areaId ? stop.areaId : null,
      availability:
        stop.availability ||
        (stop.isAvailable === false ? "unavailable" : "available"),
    }),
  );
  const gameIds = new Set();
  const publicGames = [];
  for (const game of Array.isArray(games) ? games : []) {
    const gameId = String(game?.id || game?.gameId || "").trim();
    const title = String(game?.title || game?.name || "").trim();
    if (!gameId || !title || gameIds.has(gameId)) continue;
    gameIds.add(gameId);
    publicGames.push(
      freezeCandidate({
        candidateId: `game:${gameId}`,
        candidateType: "game",
        gameId,
        title,
        status: String(game.status || "available"),
        theme: typeof game.theme === "string" && game.theme ? game.theme : null,
        coordinates: candidateCoordinates(game),
        areaId:
          typeof game.areaId === "string" && game.areaId ? game.areaId : null,
      }),
    );
  }
  publicGames.sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  return Object.freeze({
    schemaVersion: "1.0",
    planStops: Object.freeze(planStops),
    games: Object.freeze(publicGames),
  });
}
