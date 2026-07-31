"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const LEDGER_ID = 1;
const DEFAULT_DATABASE_PATH = path.join(
  process.cwd(),
  "outputs/realtime-voice/voice-budget.sqlite",
);
const DEFAULT_MIGRATION_PATH = path.resolve(
  __dirname,
  "../../cloudflare/migrations/0003_voice_budget.sql",
);

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

class VoiceBudgetRepositoryError extends Error {
  constructor(code, message, status = 409, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "VoiceBudgetRepositoryError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 409, cause) {
  throw new VoiceBudgetRepositoryError(code, message, status, cause);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("budget_input_invalid", `${label} must be an object`, 400);
  }
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value || value.length > 256) {
    fail("budget_input_invalid", `${field} is invalid`, 400);
  }
}

function assertTimestamp(value, field) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    fail("budget_input_invalid", `${field} must be an ISO timestamp`, 400);
  }
}

function assertMoney(value, field, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail(
      "budget_input_invalid",
      `${field} must be a ${positive ? "positive" : "non-negative"} safe integer`,
      400,
    );
  }
}

function validateReservation(input) {
  assertObject(input, "reservation");
  for (const field of Object.keys(input)) {
    if (PERSONAL_DATA_FIELDS.has(field)) {
      fail(
        "reservation_personal_data_forbidden",
        `Budget reservations cannot contain ${field}`,
        400,
      );
    }
    if (!RESERVATION_FIELDS.has(field)) {
      fail("budget_input_invalid", `Unknown reservation field: ${field}`, 400);
    }
  }
  assertIdentifier(input.reservationId, "reservationId");
  assertIdentifier(input.sessionIdHash, "sessionIdHash");
  if (!input.sessionIdHash.startsWith("sha256:")) {
    fail("budget_input_invalid", "sessionIdHash must be non-reversible", 400);
  }
  if (!["input_transcription", "response"].includes(input.kind)) {
    fail("budget_input_invalid", "kind is invalid", 400);
  }
  assertMoney(input.requestedMicroUsd, "requestedMicroUsd", true);
  assertIdentifier(input.rateCardVersion, "rateCardVersion");
  assertTimestamp(input.createdAt, "createdAt");
}

function validateSettlement(input) {
  assertObject(input, "settlement");
  const allowed = new Set([
    "reservationId",
    "settledMicroUsd",
    "usageShapeHash",
    "settledAt",
  ]);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field))
      fail("budget_input_invalid", `Unknown settlement field: ${field}`, 400);
  }
  assertIdentifier(input.reservationId, "reservationId");
  assertMoney(input.settledMicroUsd, "settledMicroUsd");
  assertIdentifier(input.usageShapeHash, "usageShapeHash");
  if (!input.usageShapeHash.startsWith("sha256:")) {
    fail(
      "budget_input_invalid",
      "usageShapeHash must be a SHA-256 identity",
      400,
    );
  }
  assertTimestamp(input.settledAt, "settledAt");
}

function validateHold(input) {
  assertObject(input, "hold");
  const allowed = new Set(["reservationId", "reason", "heldAt"]);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field))
      fail("budget_input_invalid", `Unknown hold field: ${field}`, 400);
  }
  assertIdentifier(input.reservationId, "reservationId");
  assertIdentifier(input.reason, "reason");
  assertTimestamp(input.heldAt, "heldAt");
}

function mapLedger(row) {
  if (!row)
    fail("budget_ledger_missing", "Voice budget ledger is unavailable", 503);
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

class LocalVoiceBudgetRepository {
  constructor({
    databasePath = DEFAULT_DATABASE_PATH,
    migrationPath = DEFAULT_MIGRATION_PATH,
  } = {}) {
    this.databasePath = databasePath;
    this.migrationPath = migrationPath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    try {
      this.db.exec(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
      );
      this.db.exec(fs.readFileSync(migrationPath, "utf8"));
    } catch (error) {
      this.db.close();
      fail(
        "budget_repository_unavailable",
        "Unable to initialize local voice budget storage",
        503,
        error,
      );
    }
  }

  transaction(work) {
    if (this.db.isTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  getLedger() {
    return mapLedger(
      this.db
        .prepare(
          `
      SELECT cap_micro_usd, spent_micro_usd, reserved_micro_usd, enabled, updated_at
      FROM voice_budget_ledger WHERE id = ?
    `,
        )
        .get(LEDGER_ID),
    );
  }

  getReservation(reservationId) {
    assertIdentifier(reservationId, "reservationId");
    return mapReservation(
      this.db
        .prepare(
          "SELECT * FROM voice_budget_reservations WHERE reservation_id = ?",
        )
        .get(reservationId),
    );
  }

  setEnabled({ enabled, updatedAt }) {
    if (typeof enabled !== "boolean")
      fail("budget_input_invalid", "enabled must be boolean", 400);
    assertTimestamp(updatedAt, "updatedAt");
    const result = this.db
      .prepare(
        `
      UPDATE voice_budget_ledger SET enabled = ?, updated_at = ? WHERE id = ?
    `,
      )
      .run(enabled ? 1 : 0, updatedAt, LEDGER_ID);
    if (Number(result.changes) !== 1) {
      fail("budget_ledger_missing", "Voice budget ledger is unavailable", 503);
    }
    return this.getLedger();
  }

  reserve(input) {
    validateReservation(input);
    return this.transaction(() => {
      const ledger = this.getLedger();
      if (!ledger.enabled)
        fail("budget_disabled", "Voice budget is disabled", 503);
      if (
        ledger.spentMicroUsd +
          ledger.reservedMicroUsd +
          input.requestedMicroUsd >
        ledger.capMicroUsd
      ) {
        fail("budget_cap_exceeded", "Voice budget cap would be exceeded", 429);
      }
      try {
        this.db
          .prepare(
            `
          INSERT INTO voice_budget_reservations (
            reservation_id, session_id_hash, kind, reserved_micro_usd,
            settled_micro_usd, status, usage_shape_hash, rate_card_version,
            created_at, settled_at
          ) VALUES (?, ?, ?, ?, 0, 'reserved', NULL, ?, ?, NULL)
        `,
          )
          .run(
            input.reservationId,
            input.sessionIdHash,
            input.kind,
            input.requestedMicroUsd,
            input.rateCardVersion,
            input.createdAt,
          );
        this.db
          .prepare(
            `
          UPDATE voice_budget_ledger
          SET reserved_micro_usd = reserved_micro_usd + ?, updated_at = ?
          WHERE id = ?
        `,
          )
          .run(input.requestedMicroUsd, input.createdAt, LEDGER_ID);
      } catch (error) {
        if (/unique|constraint/i.test(String(error?.message))) {
          fail(
            "budget_reservation_conflict",
            "Reservation identity already exists",
            409,
            error,
          );
        }
        throw error;
      }
      return this.getReservation(input.reservationId);
    });
  }

  settle(input) {
    validateSettlement(input);
    return this.transaction(() => {
      const reservation = this.getReservation(input.reservationId);
      if (!reservation)
        fail("reservation_not_found", "Reservation was not found", 404);
      if (reservation.status !== "reserved") {
        fail("reservation_not_active", "Reservation is not active", 409);
      }
      if (input.settledMicroUsd > reservation.reservedMicroUsd) {
        fail(
          "settlement_exceeds_reservation",
          "Settlement exceeds reservation",
          409,
        );
      }
      this.db
        .prepare(
          `
        UPDATE voice_budget_ledger
        SET spent_micro_usd = spent_micro_usd + ?,
            reserved_micro_usd = reserved_micro_usd - ?,
            updated_at = ?
        WHERE id = ?
      `,
        )
        .run(
          input.settledMicroUsd,
          reservation.reservedMicroUsd,
          input.settledAt,
          LEDGER_ID,
        );
      this.db
        .prepare(
          `
        UPDATE voice_budget_reservations
        SET settled_micro_usd = ?, status = 'settled', usage_shape_hash = ?, settled_at = ?
        WHERE reservation_id = ? AND status = 'reserved'
      `,
        )
        .run(
          input.settledMicroUsd,
          input.usageShapeHash,
          input.settledAt,
          input.reservationId,
        );
      return this.getReservation(input.reservationId);
    });
  }

  hold(input) {
    validateHold(input);
    return this.transaction(() => {
      const reservation = this.getReservation(input.reservationId);
      if (!reservation)
        fail("reservation_not_found", "Reservation was not found", 404);
      if (reservation.status !== "reserved") {
        fail("reservation_not_active", "Reservation is not active", 409);
      }
      this.db
        .prepare(
          `
        UPDATE voice_budget_ledger SET enabled = 0, updated_at = ? WHERE id = ?
      `,
        )
        .run(input.heldAt, LEDGER_ID);
      this.db
        .prepare(
          `
        UPDATE voice_budget_reservations
        SET status = 'held', settled_at = ?
        WHERE reservation_id = ? AND status = 'reserved'
      `,
        )
        .run(input.heldAt, input.reservationId);
      return this.getReservation(input.reservationId);
    });
  }
}

function runtimeVoiceEnabled({ environmentEnabled, ledger }) {
  return environmentEnabled === true && ledger?.enabled === true;
}

function createLocalVoiceBudgetRepository(options) {
  return new LocalVoiceBudgetRepository(options);
}

module.exports = {
  LocalVoiceBudgetRepository,
  NodeVoiceBudgetRepository: LocalVoiceBudgetRepository,
  VoiceBudgetRepositoryError,
  createLocalVoiceBudgetRepository,
  runtimeVoiceEnabled,
};
