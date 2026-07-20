import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  D1VoiceBudgetRepository,
  VoiceBudgetRepositoryError,
} from "../cloudflare/voice-budget-repository.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "cloudflare/migrations/0003_voice_budget.sql",
);
const NOW = "2026-07-18T00:00:00.000Z";
const RATE_CARD_VERSION = "openai-2026-07-18-gpt-realtime-2.1";

class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class SqliteD1Binding {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function openMigratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migration = fs.readFileSync(migrationPath, "utf8");
  database.exec(migration);
  return { database, migration };
}

function reservationInput(overrides = {}) {
  return {
    reservationId: "repository-reservation-1",
    sessionIdHash: "sha256:anonymous-session",
    kind: "response",
    requestedMicroUsd: 4_000_000,
    rateCardVersion: RATE_CARD_VERSION,
    createdAt: NOW,
    ...overrides,
  };
}

test("D1 migration is restart-safe and enforces one bounded ledger", () => {
  const { database, migration } = openMigratedDatabase();
  database.exec(migration);

  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM voice_budget_ledger").get()
      .count,
    1,
  );
  const ledger = database.prepare("SELECT * FROM voice_budget_ledger").get();
  assert.equal(ledger.cap_micro_usd, 10_000_000);
  assert.equal(ledger.spent_micro_usd, 0);
  assert.equal(ledger.reserved_micro_usd, 0);
  assert.equal(ledger.enabled, 0);

  assert.throws(() =>
    database
      .prepare(
        `
    INSERT INTO voice_budget_ledger
      (id, cap_micro_usd, spent_micro_usd, reserved_micro_usd, enabled, updated_at)
    VALUES (2, 10000000, 0, 0, 0, ?)
  `,
      )
      .run(NOW),
  );
  assert.throws(() =>
    database
      .prepare(
        `
    UPDATE voice_budget_ledger
    SET spent_micro_usd = 9000000, reserved_micro_usd = 2000000
    WHERE id = 1
  `,
      )
      .run(),
  );

  database.close();
});

test("D1 migration keeps reservation identity and accounting fields immutable", () => {
  const { database } = openMigratedDatabase();
  database
    .prepare("UPDATE voice_budget_ledger SET enabled = 1 WHERE id = 1")
    .run();
  database
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
      "immutable-1",
      "sha256:session",
      "response",
      1000,
      RATE_CARD_VERSION,
      NOW,
    );

  assert.throws(() =>
    database
      .prepare(
        `
    UPDATE voice_budget_reservations
    SET reserved_micro_usd = 1
    WHERE reservation_id = 'immutable-1'
  `,
      )
      .run(),
  );
  assert.throws(() =>
    database
      .prepare(
        `
    DELETE FROM voice_budget_reservations
    WHERE reservation_id = 'immutable-1'
  `,
      )
      .run(),
  );
  assert.throws(() =>
    database
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
        "immutable-1",
        "sha256:other",
        "response",
        1000,
        RATE_CARD_VERSION,
        NOW,
      ),
  );

  database.close();
});

test("D1 repository reserves and settles against the singleton ledger", async () => {
  const { database } = openMigratedDatabase();
  const repository = new D1VoiceBudgetRepository(new SqliteD1Binding(database));
  await repository.setEnabled({ enabled: true, updatedAt: NOW });

  const reservation = await repository.reserve(reservationInput());
  assert.equal(reservation.status, "reserved");
  assert.equal(reservation.reservedMicroUsd, 4_000_000);
  assert.deepEqual(await repository.getLedger(), {
    capMicroUsd: 10_000_000,
    spentMicroUsd: 0,
    reservedMicroUsd: 4_000_000,
    enabled: true,
    updatedAt: NOW,
  });

  const settled = await repository.settle({
    reservationId: "repository-reservation-1",
    settledMicroUsd: 1_250_000,
    usageShapeHash: "sha256:trusted-provider-usage-shape",
    settledAt: "2026-07-18T00:00:01.000Z",
  });
  assert.equal(settled.status, "settled");
  assert.deepEqual(await repository.getLedger(), {
    capMicroUsd: 10_000_000,
    spentMicroUsd: 1_250_000,
    reservedMicroUsd: 0,
    enabled: true,
    updatedAt: "2026-07-18T00:00:01.000Z",
  });

  database.close();
});

test("D1 repository fails closed for disabled, cap-exhausted, and held usage", async () => {
  const { database } = openMigratedDatabase();
  const repository = new D1VoiceBudgetRepository(new SqliteD1Binding(database));

  await assert.rejects(
    repository.reserve(reservationInput()),
    (error) =>
      error instanceof VoiceBudgetRepositoryError &&
      error.code === "budget_disabled",
  );

  await repository.setEnabled({ enabled: true, updatedAt: NOW });
  await repository.reserve(reservationInput({ requestedMicroUsd: 10_000_000 }));
  await assert.rejects(
    repository.reserve(
      reservationInput({ reservationId: "over-cap", requestedMicroUsd: 1 }),
    ),
    (error) =>
      error instanceof VoiceBudgetRepositoryError &&
      error.code === "budget_cap_exceeded",
  );

  const held = await repository.hold({
    reservationId: "repository-reservation-1",
    reason: "missing_or_untrusted_usage",
    heldAt: "2026-07-18T00:00:02.000Z",
  });
  assert.equal(held.status, "held");
  const ledger = await repository.getLedger();
  assert.equal(ledger.reservedMicroUsd, 10_000_000);
  assert.equal(ledger.enabled, false);

  database.close();
});

test("D1 schema and repository records contain no personal-data fields", async () => {
  const { database } = openMigratedDatabase();
  const repository = new D1VoiceBudgetRepository(new SqliteD1Binding(database));
  await repository.setEnabled({ enabled: true, updatedAt: NOW });

  const columns = database
    .prepare("PRAGMA table_info(voice_budget_reservations)")
    .all()
    .map(({ name }) => name);
  for (const forbidden of [
    "audio",
    "transcript",
    "latitude",
    "longitude",
    "location",
    "ui_context",
    "provider_payload",
  ]) {
    assert.equal(columns.includes(forbidden), false);
  }

  await assert.rejects(
    repository.reserve(reservationInput({ transcript: "private speech" })),
    (error) =>
      error instanceof VoiceBudgetRepositoryError &&
      error.code === "reservation_personal_data_forbidden",
  );
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM voice_budget_reservations")
      .get().count,
    0,
  );

  database.close();
});
