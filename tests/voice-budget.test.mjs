import assert from "node:assert/strict";
import test from "node:test";

import {
  VoiceBudgetError,
  createVoiceBudgetState,
  holdVoiceBudgetReservation,
  reserveVoiceBudget,
  setVoiceBudgetEnabled,
  settleVoiceBudgetReservation,
} from "../scripts/lib/voice-budget-ledger.mjs";

const NOW = "2026-07-18T00:00:00.000Z";
const RATE_CARD_VERSION = "openai-2026-07-18-gpt-realtime-2.1";

function createEnabledState(overrides = {}) {
  return createVoiceBudgetState({
    capMicroUsd: 10_000_000,
    spentMicroUsd: 0,
    reservedMicroUsd: 0,
    enabled: true,
    updatedAt: NOW,
    reservations: [],
    ...overrides,
  });
}

function reservationInput(overrides = {}) {
  return {
    reservationId: "reservation-1",
    sessionIdHash: "sha256:anonymous-session",
    kind: "response",
    requestedMicroUsd: 4_000_000,
    rateCardVersion: RATE_CARD_VERSION,
    createdAt: NOW,
    ...overrides,
  };
}

function assertBudgetError(code) {
  return (error) => error instanceof VoiceBudgetError && error.code === code;
}

test("reservation is an immutable atomic state transition", () => {
  const original = createEnabledState();
  const next = reserveVoiceBudget(original, reservationInput());

  assert.notEqual(next, original);
  assert.deepEqual(original.ledger, {
    capMicroUsd: 10_000_000,
    spentMicroUsd: 0,
    reservedMicroUsd: 0,
    enabled: true,
    updatedAt: NOW,
  });
  assert.equal(original.reservations.length, 0);
  assert.equal(next.ledger.reservedMicroUsd, 4_000_000);
  assert.deepEqual(next.reservations, [
    {
      reservationId: "reservation-1",
      sessionIdHash: "sha256:anonymous-session",
      kind: "response",
      reservedMicroUsd: 4_000_000,
      settledMicroUsd: 0,
      status: "reserved",
      usageShapeHash: null,
      rateCardVersion: RATE_CARD_VERSION,
      createdAt: NOW,
      settledAt: null,
    },
  ]);
});

test("concurrent admissions cannot authorize more than the cumulative cap", () => {
  const first = reserveVoiceBudget(
    createEnabledState(),
    reservationInput({
      reservationId: "concurrent-a",
      requestedMicroUsd: 6_000_000,
    }),
  );

  assert.throws(
    () =>
      reserveVoiceBudget(
        first,
        reservationInput({
          reservationId: "concurrent-b",
          requestedMicroUsd: 6_000_000,
        }),
      ),
    assertBudgetError("budget_cap_exceeded"),
  );
  assert.equal(
    first.ledger.spentMicroUsd + first.ledger.reservedMicroUsd,
    6_000_000,
  );
  assert.equal(first.reservations.length, 1);
});

test("trusted settlement moves actual usage to spent and releases unused reservation", () => {
  const reserved = reserveVoiceBudget(createEnabledState(), reservationInput());
  const settled = settleVoiceBudgetReservation(reserved, {
    reservationId: "reservation-1",
    settledMicroUsd: 1_500_000,
    usageShapeHash: "sha256:trusted-provider-usage-shape",
    settledAt: "2026-07-18T00:00:01.000Z",
  });

  assert.equal(settled.ledger.spentMicroUsd, 1_500_000);
  assert.equal(settled.ledger.reservedMicroUsd, 0);
  assert.deepEqual(settled.reservations[0], {
    ...reserved.reservations[0],
    settledMicroUsd: 1_500_000,
    status: "settled",
    usageShapeHash: "sha256:trusted-provider-usage-shape",
    settledAt: "2026-07-18T00:00:01.000Z",
  });
  assert.equal(reserved.reservations[0].status, "reserved");

  assert.throws(
    () =>
      settleVoiceBudgetReservation(reserved, {
        reservationId: "reservation-1",
        settledMicroUsd: 4_000_001,
        usageShapeHash: "sha256:oversized",
        settledAt: "2026-07-18T00:00:01.000Z",
      }),
    assertBudgetError("settlement_exceeds_reservation"),
  );
});

test("missing or untrusted usage holds the full reservation and disables admission", () => {
  const reserved = reserveVoiceBudget(createEnabledState(), reservationInput());
  const held = holdVoiceBudgetReservation(reserved, {
    reservationId: "reservation-1",
    reason: "missing_or_untrusted_usage",
    heldAt: "2026-07-18T00:00:02.000Z",
  });

  assert.equal(held.ledger.reservedMicroUsd, 4_000_000);
  assert.equal(held.ledger.spentMicroUsd, 0);
  assert.equal(held.ledger.enabled, false);
  assert.equal(held.reservations[0].status, "held");
  assert.equal(held.reservations[0].settledMicroUsd, 0);
  assert.throws(
    () =>
      reserveVoiceBudget(
        held,
        reservationInput({ reservationId: "after-hold" }),
      ),
    assertBudgetError("budget_disabled"),
  );
});

test("cap and kill switches fail closed", () => {
  const exact = reserveVoiceBudget(
    createEnabledState({ spentMicroUsd: 9_000_000 }),
    reservationInput({ requestedMicroUsd: 1_000_000 }),
  );
  assert.equal(
    exact.ledger.spentMicroUsd + exact.ledger.reservedMicroUsd,
    10_000_000,
  );
  assert.throws(
    () =>
      reserveVoiceBudget(
        exact,
        reservationInput({ reservationId: "over-cap", requestedMicroUsd: 1 }),
      ),
    assertBudgetError("budget_cap_exceeded"),
  );

  const disabled = setVoiceBudgetEnabled(createEnabledState(), {
    enabled: false,
    updatedAt: "2026-07-18T00:00:03.000Z",
  });
  assert.throws(
    () => reserveVoiceBudget(disabled, reservationInput()),
    assertBudgetError("budget_disabled"),
  );
});

test("reservation accounting rejects and never persists personal data", () => {
  const personalFields = {
    transcript: "Take me somewhere near home",
    audio: "base64-audio",
    coordinates: [103.85, 1.29],
    exactLocation: { latitude: 1.29, longitude: 103.85 },
    uiContext: { selectedPlace: "private-selection" },
  };

  for (const [field, value] of Object.entries(personalFields)) {
    assert.throws(
      () =>
        reserveVoiceBudget(
          createEnabledState(),
          reservationInput({
            reservationId: `personal-${field}`,
            [field]: value,
          }),
        ),
      assertBudgetError("reservation_personal_data_forbidden"),
    );
  }

  const accepted = reserveVoiceBudget(createEnabledState(), reservationInput());
  const serialized = JSON.stringify(accepted);
  for (const value of [
    "Take me somewhere near home",
    "base64-audio",
    "103.85",
    "private-selection",
  ]) {
    assert.equal(serialized.includes(value), false);
  }
});
