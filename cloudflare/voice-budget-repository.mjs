const LEDGER_ID = 1;

const RESERVATION_FIELDS = new Set([
  "reservationId",
  "sessionIdHash",
  "kind",
  "requestedMicroUsd",
  "rateCardVersion",
  "createdAt",
]);

const PERSONAL_DATA_FIELDS = new Set([
  "audio",
  "transcript",
  "coordinates",
  "exactLocation",
  "latitude",
  "location",
  "longitude",
  "uiContext",
  "providerPayload",
]);

export class VoiceBudgetRepositoryError extends Error {
  constructor(code, message, status = 409, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "VoiceBudgetRepositoryError";
    this.code = code;
    this.status = status;
  }
}

function repositoryError(code, message, status, cause) {
  return new VoiceBudgetRepositoryError(code, message, status, cause);
}

function assertObject(value, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw repositoryError(code, `${label} must be an object`, 400);
  }
}

function assertIsoTimestamp(value, field) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    throw repositoryError(
      "budget_input_invalid",
      `${field} must be an ISO timestamp`,
      400,
    );
  }
}

function assertNonNegativeInteger(value, field, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw repositoryError(
      "budget_input_invalid",
      `${field} must be a ${positive ? "positive" : "non-negative"} safe integer`,
      400,
    );
  }
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value || value.length > 256) {
    throw repositoryError("budget_input_invalid", `${field} is invalid`, 400);
  }
}

function validateReservationInput(input) {
  assertObject(input, "budget_input_invalid", "reservation");
  for (const field of Object.keys(input)) {
    if (PERSONAL_DATA_FIELDS.has(field)) {
      throw repositoryError(
        "reservation_personal_data_forbidden",
        `Budget reservations cannot contain ${field}`,
        400,
      );
    }
    if (!RESERVATION_FIELDS.has(field)) {
      throw repositoryError(
        "budget_input_invalid",
        `Unknown reservation field: ${field}`,
        400,
      );
    }
  }
  assertIdentifier(input.reservationId, "reservationId");
  assertIdentifier(input.sessionIdHash, "sessionIdHash");
  if (!input.sessionIdHash.startsWith("sha256:")) {
    throw repositoryError(
      "budget_input_invalid",
      "sessionIdHash must be non-reversible",
      400,
    );
  }
  if (!["input_transcription", "response"].includes(input.kind)) {
    throw repositoryError("budget_input_invalid", "kind is invalid", 400);
  }
  assertNonNegativeInteger(input.requestedMicroUsd, "requestedMicroUsd", {
    positive: true,
  });
  assertIdentifier(input.rateCardVersion, "rateCardVersion");
  assertIsoTimestamp(input.createdAt, "createdAt");
}

function validateSettlementInput(input) {
  assertObject(input, "budget_input_invalid", "settlement");
  const allowed = new Set([
    "reservationId",
    "settledMicroUsd",
    "usageShapeHash",
    "settledAt",
  ]);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) {
      throw repositoryError(
        "budget_input_invalid",
        `Unknown settlement field: ${field}`,
        400,
      );
    }
  }
  assertIdentifier(input.reservationId, "reservationId");
  assertNonNegativeInteger(input.settledMicroUsd, "settledMicroUsd");
  assertIdentifier(input.usageShapeHash, "usageShapeHash");
  if (!input.usageShapeHash.startsWith("sha256:")) {
    throw repositoryError(
      "budget_input_invalid",
      "usageShapeHash must be a SHA-256 identity",
      400,
    );
  }
  assertIsoTimestamp(input.settledAt, "settledAt");
}

function validateHoldInput(input) {
  assertObject(input, "budget_input_invalid", "hold");
  const allowed = new Set(["reservationId", "reason", "heldAt"]);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) {
      throw repositoryError(
        "budget_input_invalid",
        `Unknown hold field: ${field}`,
        400,
      );
    }
  }
  assertIdentifier(input.reservationId, "reservationId");
  assertIdentifier(input.reason, "reason");
  assertIsoTimestamp(input.heldAt, "heldAt");
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function mapLedger(row) {
  if (!row)
    throw repositoryError(
      "budget_ledger_missing",
      "Voice budget ledger is unavailable",
      503,
    );
  return {
    capMicroUsd: Number(row.cap_micro_usd),
    spentMicroUsd: Number(row.spent_micro_usd),
    reservedMicroUsd: Number(row.reserved_micro_usd),
    enabled: row.enabled === 1 || row.enabled === true,
    updatedAt: row.updated_at,
  };
}

function mapReservation(row) {
  if (!row) return null;
  return {
    reservationId: row.reservation_id,
    sessionIdHash: row.session_id_hash,
    kind: row.kind,
    reservedMicroUsd: Number(row.reserved_micro_usd),
    settledMicroUsd: Number(row.settled_micro_usd),
    status: row.status,
    usageShapeHash: row.usage_shape_hash ?? null,
    rateCardVersion: row.rate_card_version,
    createdAt: row.created_at,
    settledAt: row.settled_at ?? null,
  };
}

export class D1VoiceBudgetRepository {
  constructor(database) {
    if (
      !database ||
      typeof database.prepare !== "function" ||
      typeof database.batch !== "function"
    ) {
      throw repositoryError(
        "budget_repository_unavailable",
        "A D1 database binding is required",
        503,
      );
    }
    this.database = database;
  }

  async getLedger() {
    try {
      const row = await this.database
        .prepare(
          "SELECT cap_micro_usd, spent_micro_usd, reserved_micro_usd, enabled, updated_at FROM voice_budget_ledger WHERE id = ?",
        )
        .bind(LEDGER_ID)
        .first();
      return mapLedger(row);
    } catch (error) {
      if (error instanceof VoiceBudgetRepositoryError) throw error;
      throw repositoryError(
        "budget_repository_failure",
        "Unable to read voice budget ledger",
        503,
        error,
      );
    }
  }

  async getReservation(reservationId) {
    assertIdentifier(reservationId, "reservationId");
    try {
      const row = await this.database
        .prepare(
          "SELECT * FROM voice_budget_reservations WHERE reservation_id = ?",
        )
        .bind(reservationId)
        .first();
      return mapReservation(row);
    } catch (error) {
      if (error instanceof VoiceBudgetRepositoryError) throw error;
      throw repositoryError(
        "budget_repository_failure",
        "Unable to read voice budget reservation",
        503,
        error,
      );
    }
  }

  async setEnabled({ enabled, updatedAt }) {
    if (typeof enabled !== "boolean") {
      throw repositoryError(
        "budget_input_invalid",
        "enabled must be boolean",
        400,
      );
    }
    assertIsoTimestamp(updatedAt, "updatedAt");
    try {
      const result = await this.database
        .prepare(
          "UPDATE voice_budget_ledger SET enabled = ?, updated_at = ? WHERE id = ?",
        )
        .bind(enabled ? 1 : 0, updatedAt, LEDGER_ID)
        .run();
      if (changes(result) !== 1) {
        throw repositoryError(
          "budget_ledger_missing",
          "Voice budget ledger is unavailable",
          503,
        );
      }
      return this.getLedger();
    } catch (error) {
      if (error instanceof VoiceBudgetRepositoryError) throw error;
      throw repositoryError(
        "budget_repository_failure",
        "Unable to change the runtime voice kill switch",
        503,
        error,
      );
    }
  }

  async reserve(input) {
    validateReservationInput(input);
    const insert = this.database
      .prepare(
        `
      INSERT INTO voice_budget_reservations (
        reservation_id, session_id_hash, kind, reserved_micro_usd,
        settled_micro_usd, status, usage_shape_hash, rate_card_version,
        created_at, settled_at
      )
      SELECT ?, ?, ?, ?, 0, 'reserved', NULL, ?, ?, NULL
      FROM voice_budget_ledger
      WHERE id = ?
        AND enabled = 1
        AND spent_micro_usd + reserved_micro_usd + ? <= cap_micro_usd
    `,
      )
      .bind(
        input.reservationId,
        input.sessionIdHash,
        input.kind,
        input.requestedMicroUsd,
        input.rateCardVersion,
        input.createdAt,
        LEDGER_ID,
        input.requestedMicroUsd,
      );
    const update = this.database
      .prepare(
        `
      UPDATE voice_budget_ledger
      SET reserved_micro_usd = reserved_micro_usd + ?, updated_at = ?
      WHERE id = ?
        AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM voice_budget_reservations
          WHERE reservation_id = ? AND status = 'reserved'
        )
    `,
      )
      .bind(
        input.requestedMicroUsd,
        input.createdAt,
        LEDGER_ID,
        input.reservationId,
      );

    try {
      const [insertResult, updateResult] = await this.database.batch([
        insert,
        update,
      ]);
      if (changes(insertResult) === 1 && changes(updateResult) === 1) {
        return this.getReservation(input.reservationId);
      }
      const ledger = await this.getLedger();
      if (!ledger.enabled)
        throw repositoryError(
          "budget_disabled",
          "Voice budget is disabled",
          503,
        );
      if (
        ledger.spentMicroUsd +
          ledger.reservedMicroUsd +
          input.requestedMicroUsd >
        ledger.capMicroUsd
      ) {
        throw repositoryError(
          "budget_cap_exceeded",
          "Voice budget cap would be exceeded",
          429,
        );
      }
      throw repositoryError(
        "budget_reservation_conflict",
        "Voice budget reservation was not created",
        409,
      );
    } catch (error) {
      if (error instanceof VoiceBudgetRepositoryError) throw error;
      if (/unique|constraint/i.test(String(error?.message))) {
        throw repositoryError(
          "budget_reservation_conflict",
          "Reservation identity already exists",
          409,
          error,
        );
      }
      throw repositoryError(
        "budget_repository_failure",
        "Unable to reserve voice budget",
        503,
        error,
      );
    }
  }

  async settle(input) {
    validateSettlementInput(input);
    const ledgerUpdate = this.database
      .prepare(
        `
      UPDATE voice_budget_ledger
      SET spent_micro_usd = spent_micro_usd + ?,
          reserved_micro_usd = reserved_micro_usd - (
            SELECT reserved_micro_usd FROM voice_budget_reservations WHERE reservation_id = ?
          ),
          updated_at = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM voice_budget_reservations
          WHERE reservation_id = ?
            AND status = 'reserved'
            AND ? <= reserved_micro_usd
        )
    `,
      )
      .bind(
        input.settledMicroUsd,
        input.reservationId,
        input.settledAt,
        LEDGER_ID,
        input.reservationId,
        input.settledMicroUsd,
      );
    const reservationUpdate = this.database
      .prepare(
        `
      UPDATE voice_budget_reservations
      SET settled_micro_usd = ?, status = 'settled', usage_shape_hash = ?, settled_at = ?
      WHERE reservation_id = ?
        AND changes() = 1
        AND status = 'reserved'
        AND ? <= reserved_micro_usd
    `,
      )
      .bind(
        input.settledMicroUsd,
        input.usageShapeHash,
        input.settledAt,
        input.reservationId,
        input.settledMicroUsd,
      );

    try {
      const [ledgerResult, reservationResult] = await this.database.batch([
        ledgerUpdate,
        reservationUpdate,
      ]);
      if (changes(ledgerResult) === 1 && changes(reservationResult) === 1) {
        return this.getReservation(input.reservationId);
      }
      const reservation = await this.getReservation(input.reservationId);
      if (!reservation)
        throw repositoryError(
          "reservation_not_found",
          "Reservation was not found",
          404,
        );
      if (input.settledMicroUsd > reservation.reservedMicroUsd) {
        throw repositoryError(
          "settlement_exceeds_reservation",
          "Settlement exceeds reservation",
          409,
        );
      }
      throw repositoryError(
        "reservation_not_active",
        "Reservation is not active",
        409,
      );
    } catch (error) {
      if (error instanceof VoiceBudgetRepositoryError) throw error;
      throw repositoryError(
        "budget_repository_failure",
        "Unable to settle voice budget",
        503,
        error,
      );
    }
  }

  async hold(input) {
    validateHoldInput(input);
    const ledgerUpdate = this.database
      .prepare(
        `
      UPDATE voice_budget_ledger
      SET enabled = 0, updated_at = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM voice_budget_reservations
          WHERE reservation_id = ? AND status = 'reserved'
        )
    `,
      )
      .bind(input.heldAt, LEDGER_ID, input.reservationId);
    const reservationUpdate = this.database
      .prepare(
        `
      UPDATE voice_budget_reservations
      SET status = 'held', settled_at = ?
      WHERE reservation_id = ? AND status = 'reserved' AND changes() = 1
    `,
      )
      .bind(input.heldAt, input.reservationId);

    try {
      const [ledgerResult, reservationResult] = await this.database.batch([
        ledgerUpdate,
        reservationUpdate,
      ]);
      if (changes(ledgerResult) === 1 && changes(reservationResult) === 1) {
        return this.getReservation(input.reservationId);
      }
      const reservation = await this.getReservation(input.reservationId);
      if (!reservation)
        throw repositoryError(
          "reservation_not_found",
          "Reservation was not found",
          404,
        );
      throw repositoryError(
        "reservation_not_active",
        "Reservation is not active",
        409,
      );
    } catch (error) {
      if (error instanceof VoiceBudgetRepositoryError) throw error;
      throw repositoryError(
        "budget_repository_failure",
        "Unable to hold voice budget",
        503,
        error,
      );
    }
  }
}

export function runtimeVoiceEnabled({ environmentEnabled, ledger }) {
  return environmentEnabled === true && ledger?.enabled === true;
}
