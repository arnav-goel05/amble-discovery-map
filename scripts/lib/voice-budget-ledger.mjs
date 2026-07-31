const RESERVATION_KINDS = new Set(["input_transcription", "response"]);
const PERSONAL_DATA_FIELDS = new Set([
  "audio",
  "coordinates",
  "exactLocation",
  "latitude",
  "location",
  "longitude",
  "providerPayload",
  "transcript",
  "uiContext",
]);

export class VoiceBudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VoiceBudgetError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new VoiceBudgetError(code, message);
}

function requireSafeInteger(value, field, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail(
      "budget_integer_invalid",
      `${field} must be a ${positive ? "positive" : "non-negative"} safe integer`,
    );
  }
  return value;
}

function safeAdd(left, right) {
  const value = left + right;
  if (!Number.isSafeInteger(value))
    fail(
      "budget_arithmetic_overflow",
      "Budget arithmetic exceeded safe integer precision",
    );
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "")
    fail("budget_field_invalid", `${field} must be a non-empty string`);
  return value;
}

function requireTimestamp(value, field) {
  requireString(value, field);
  if (!Number.isFinite(Date.parse(value)))
    fail("budget_timestamp_invalid", `${field} must be an ISO timestamp`);
  return value;
}

function rejectPersonalData(value, visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (PERSONAL_DATA_FIELDS.has(key)) {
      fail(
        "reservation_personal_data_forbidden",
        `Reservation accounting cannot contain ${key}`,
      );
    }
    rejectPersonalData(nestedValue, visited);
  }
}

function validateLedger(ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger))
    fail("budget_state_invalid", "Budget ledger is required");
  const capMicroUsd = requireSafeInteger(ledger.capMicroUsd, "capMicroUsd", {
    positive: true,
  });
  const spentMicroUsd = requireSafeInteger(
    ledger.spentMicroUsd,
    "spentMicroUsd",
  );
  const reservedMicroUsd = requireSafeInteger(
    ledger.reservedMicroUsd,
    "reservedMicroUsd",
  );
  if (typeof ledger.enabled !== "boolean")
    fail("budget_state_invalid", "enabled must be boolean");
  requireTimestamp(ledger.updatedAt, "updatedAt");
  if (safeAdd(spentMicroUsd, reservedMicroUsd) > capMicroUsd) {
    fail(
      "budget_cap_exceeded",
      "Existing budget accounting exceeds the cumulative cap",
    );
  }
  return {
    capMicroUsd,
    spentMicroUsd,
    reservedMicroUsd,
    enabled: ledger.enabled,
    updatedAt: ledger.updatedAt,
  };
}

function cloneReservation(reservation) {
  return { ...reservation };
}

function cloneState(state) {
  return {
    ledger: { ...state.ledger },
    reservations: state.reservations.map(cloneReservation),
  };
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state))
    fail("budget_state_invalid", "Budget state is required");
  const ledger = validateLedger(state.ledger);
  if (!Array.isArray(state.reservations))
    fail("budget_state_invalid", "reservations must be an array");
  const reservations = state.reservations.map(cloneReservation);
  const identities = new Set();
  for (const reservation of reservations) {
    rejectPersonalData(reservation);
    requireString(reservation.reservationId, "reservationId");
    if (identities.has(reservation.reservationId))
      fail("reservation_duplicate", "Reservation identity must be unique");
    identities.add(reservation.reservationId);
  }
  return { ledger, reservations };
}

function findOpenReservation(state, reservationId) {
  requireString(reservationId, "reservationId");
  const index = state.reservations.findIndex(
    (reservation) => reservation.reservationId === reservationId,
  );
  if (index < 0) fail("reservation_not_found", "Reservation does not exist");
  if (state.reservations[index].status !== "reserved")
    fail("reservation_not_open", "Reservation is no longer open");
  return index;
}

export function createVoiceBudgetState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("budget_state_invalid", "Budget state input is required");
  rejectPersonalData(input);
  return validateState({
    ledger: {
      capMicroUsd: input.capMicroUsd,
      spentMicroUsd: input.spentMicroUsd,
      reservedMicroUsd: input.reservedMicroUsd,
      enabled: input.enabled,
      updatedAt: input.updatedAt,
    },
    reservations: input.reservations ?? [],
  });
}

export function reserveVoiceBudget(stateInput, input) {
  const state = validateState(stateInput);
  rejectPersonalData(input);
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("reservation_invalid", "Reservation input is required");
  if (!state.ledger.enabled)
    fail("budget_disabled", "Voice budget admission is disabled");

  const reservationId = requireString(input.reservationId, "reservationId");
  if (
    state.reservations.some(
      (reservation) => reservation.reservationId === reservationId,
    )
  ) {
    fail("reservation_duplicate", "Reservation identity already exists");
  }
  const sessionIdHash = requireString(input.sessionIdHash, "sessionIdHash");
  if (!RESERVATION_KINDS.has(input.kind))
    fail("reservation_kind_invalid", "Reservation kind is not allowed");
  const requestedMicroUsd = requireSafeInteger(
    input.requestedMicroUsd,
    "requestedMicroUsd",
    { positive: true },
  );
  const rateCardVersion = requireString(
    input.rateCardVersion,
    "rateCardVersion",
  );
  const createdAt = requireTimestamp(input.createdAt, "createdAt");
  const admittedTotal = safeAdd(
    safeAdd(state.ledger.spentMicroUsd, state.ledger.reservedMicroUsd),
    requestedMicroUsd,
  );
  if (admittedTotal > state.ledger.capMicroUsd)
    fail(
      "budget_cap_exceeded",
      "Reservation would exceed the cumulative voice budget",
    );

  const next = cloneState(state);
  next.ledger.reservedMicroUsd = safeAdd(
    next.ledger.reservedMicroUsd,
    requestedMicroUsd,
  );
  next.ledger.updatedAt = createdAt;
  next.reservations.push({
    reservationId,
    sessionIdHash,
    kind: input.kind,
    reservedMicroUsd: requestedMicroUsd,
    settledMicroUsd: 0,
    status: "reserved",
    usageShapeHash: null,
    rateCardVersion,
    createdAt,
    settledAt: null,
  });
  return next;
}

export function settleVoiceBudgetReservation(stateInput, input) {
  const state = validateState(stateInput);
  rejectPersonalData(input);
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("settlement_invalid", "Settlement input is required");
  const index = findOpenReservation(state, input.reservationId);
  const settledMicroUsd = requireSafeInteger(
    input.settledMicroUsd,
    "settledMicroUsd",
  );
  const usageShapeHash = requireString(input.usageShapeHash, "usageShapeHash");
  const settledAt = requireTimestamp(input.settledAt, "settledAt");
  const reservation = state.reservations[index];
  if (settledMicroUsd > reservation.reservedMicroUsd) {
    fail(
      "settlement_exceeds_reservation",
      "Trusted usage exceeds its reserved envelope",
    );
  }

  const next = cloneState(state);
  next.ledger.reservedMicroUsd -= reservation.reservedMicroUsd;
  next.ledger.spentMicroUsd = safeAdd(
    next.ledger.spentMicroUsd,
    settledMicroUsd,
  );
  next.ledger.updatedAt = settledAt;
  next.reservations[index] = {
    ...next.reservations[index],
    settledMicroUsd,
    status: "settled",
    usageShapeHash,
    settledAt,
  };
  return next;
}

export function holdVoiceBudgetReservation(stateInput, input) {
  const state = validateState(stateInput);
  rejectPersonalData(input);
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("reservation_invalid", "Hold input is required");
  const index = findOpenReservation(state, input.reservationId);
  requireString(input.reason, "reason");
  const heldAt = requireTimestamp(input.heldAt, "heldAt");

  const next = cloneState(state);
  next.ledger.enabled = false;
  next.ledger.updatedAt = heldAt;
  next.reservations[index] = {
    ...next.reservations[index],
    status: "held",
    settledAt: heldAt,
  };
  return next;
}

export function setVoiceBudgetEnabled(stateInput, input) {
  const state = validateState(stateInput);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.enabled !== "boolean"
  ) {
    fail(
      "budget_state_invalid",
      "Kill-switch update requires a boolean enabled value",
    );
  }
  const updatedAt = requireTimestamp(input.updatedAt, "updatedAt");
  const next = cloneState(state);
  next.ledger.enabled = input.enabled;
  next.ledger.updatedAt = updatedAt;
  return next;
}
