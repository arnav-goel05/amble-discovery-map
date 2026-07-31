import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RealtimePolicyError,
  assertRealtimeEnabled,
  calculateWorstCaseReservations,
  loadRealtimePolicy,
  validateRealtimePolicy,
} from "../scripts/lib/realtime-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(root, "data/realtime-voice-policy.json");
const clone = (value) => structuredClone(value);
const rejectsWith = (callback, code) =>
  assert.throws(callback, (error) => {
    assert(error instanceof RealtimePolicyError);
    assert.equal(error.code, code);
    return true;
  });

test("checked-in realtime policy pins the approved model and budget without session limits", () => {
  const policy = loadRealtimePolicy(policyPath);

  assert.equal(policy.schemaVersion, "1.1");
  assert.equal(policy.owner, "Arnav");
  assert.equal(policy.modelId, "gpt-realtime-2.1-mini");
  assert.equal("transcriptionModelId" in policy, false);
  assert.equal(policy.capMicroUsd, 10_000_000);
  assert.equal(policy.resetPolicy, "none");
  assert.equal("maxSessionSeconds" in policy, false);
  assert.equal("idleSeconds" in policy, false);
  assert.equal("maxResponses" in policy, false);
  assert.equal(policy.maxResponseStagesPerTurn, 3);
  assert.equal(policy.responseTimeoutSeconds, 30);
  assert.equal("maxOutputTokens" in policy, false);
  assert.equal(
    policy.worstCaseReservation.response.providerMaxOutputTokens,
    4_096,
  );
  assert.equal(policy.maxContextTokens, 4_000);
  assert.equal(policy.automaticResponseCreation, false);
  assert.equal(policy.imageInputEnabled, false);
  assert.equal("fallbackModelId" in policy, false);
  assert.equal(
    "transcriptionMicroUsdPerMinute" in policy.rateCard.rates,
    false,
  );
  assert.equal("inputTranscription" in policy.worstCaseReservation, false);
});

test("schema and rate-card identity fail closed", () => {
  const policy = loadRealtimePolicy(policyPath);

  rejectsWith(
    () => validateRealtimePolicy({ ...clone(policy), schemaVersion: "2.0" }),
    "policy_schema_invalid",
  );
  rejectsWith(
    () => validateRealtimePolicy({ ...clone(policy), owner: "" }),
    "policy_owner_invalid",
  );
  rejectsWith(
    () =>
      validateRealtimePolicy({
        ...clone(policy),
        rateCardVersion: "unreviewed",
      }),
    "policy_rate_card_mismatch",
  );

  const missingRate = clone(policy);
  delete missingRate.rateCard.rates.audioOutputMicroUsdPerMillionTokens;
  rejectsWith(() => validateRealtimePolicy(missingRate), "policy_rate_unknown");
});

test("unknown models and altered response bounds are rejected", () => {
  const policy = loadRealtimePolicy(policyPath);

  rejectsWith(
    () =>
      validateRealtimePolicy({
        ...clone(policy),
        modelId: "gpt-realtime-latest",
      }),
    "policy_model_unknown",
  );
  rejectsWith(
    () =>
      validateRealtimePolicy({
        ...clone(policy),
        transcriptionModelId: "transcribe-latest",
      }),
    "policy_transcription_forbidden",
  );
  rejectsWith(
    () => validateRealtimePolicy({ ...clone(policy), capMicroUsd: 10_000_001 }),
    "policy_cap_invalid",
  );
  rejectsWith(
    () =>
      validateRealtimePolicy({
        ...clone(policy),
        responseTimeoutSeconds: 31,
      }),
    "policy_limit_invalid",
  );
  rejectsWith(
    () =>
      validateRealtimePolicy({
        ...clone(policy),
        maxResponseStagesPerTurn: 4,
      }),
    "policy_limit_invalid",
  );
  rejectsWith(
    () => validateRealtimePolicy({ ...clone(policy), maxOutputTokens: 512 }),
    "policy_output_ceiling_forbidden",
  );
  const alteredProviderBound = clone(policy);
  alteredProviderBound.worstCaseReservation.response.providerMaxOutputTokens = 512;
  rejectsWith(
    () => validateRealtimePolicy(alteredProviderBound),
    "policy_reservation_bound_invalid",
  );
  rejectsWith(
    () => validateRealtimePolicy({ ...clone(policy), maxContextTokens: 4_001 }),
    "policy_limit_invalid",
  );
});

test("money and token arithmetic rejects unsafe integers and multiplication overflow", () => {
  const policy = loadRealtimePolicy(policyPath);

  rejectsWith(
    () =>
      validateRealtimePolicy({
        ...clone(policy),
        capMicroUsd: Number.MAX_SAFE_INTEGER + 1,
      }),
    "policy_integer_invalid",
  );

  const overflow = clone(policy);
  overflow.rateCard.rates.audioInputMicroUsdPerMillionTokens =
    Number.MAX_SAFE_INTEGER;
  overflow.worstCaseReservation.response.inputRateMicroUsdPerMillionTokens =
    Number.MAX_SAFE_INTEGER;
  rejectsWith(
    () => calculateWorstCaseReservations(overflow),
    "policy_arithmetic_overflow",
  );
});

test("both kill switches default disabled and both must be explicitly enabled", () => {
  const policy = loadRealtimePolicy(policyPath);

  assert.equal(policy.enabled, false);
  assert.equal(policy.killSwitches.requireBothEnabled, true);
  assert.equal(policy.killSwitches.environment.defaultEnabled, false);
  assert.equal(policy.killSwitches.runtime.defaultEnabled, false);
  rejectsWith(() => assertRealtimeEnabled(policy), "voice_disabled");
  rejectsWith(
    () =>
      assertRealtimeEnabled(policy, {
        environmentEnabled: true,
        runtimeEnabled: false,
      }),
    "voice_disabled",
  );
  rejectsWith(
    () =>
      assertRealtimeEnabled(policy, {
        environmentEnabled: false,
        runtimeEnabled: true,
      }),
    "voice_disabled",
  );
  assert.equal(
    assertRealtimeEnabled(policy, {
      environmentEnabled: true,
      runtimeEnabled: true,
    }),
    true,
  );
});

test("worst-case reservations use uncached highest enabled rates and match policy invariants", () => {
  const policy = loadRealtimePolicy(policyPath);
  const reservation = calculateWorstCaseReservations(policy);

  assert.deepEqual(reservation, {
    responseInputMicroUsd: 40_000,
    responseOutputMicroUsd: 81_920,
    responseMicroUsd: 121_920,
    turnMicroUsd: 121_920,
  });
  assert.equal(
    reservation.responseInputMicroUsd,
    policy.worstCaseReservation.response.inputReservedMicroUsd,
  );
  assert.equal(
    reservation.responseOutputMicroUsd,
    policy.worstCaseReservation.response.outputReservedMicroUsd,
  );
  assert.equal(
    reservation.responseMicroUsd,
    policy.worstCaseReservation.response.reservedMicroUsd,
  );
  assert.equal(
    reservation.turnMicroUsd,
    policy.worstCaseReservation.maxTurnReservedMicroUsd,
  );
  assert(
    reservation.turnMicroUsd * policy.maxResponseStagesPerTurn <=
      policy.capMicroUsd,
  );
  assert.equal(
    policy.rateCard.reservationRules.ignoreCachedInputDiscounts,
    true,
  );
  assert.equal(
    policy.rateCard.reservationRules.useHighestEnabledInputRate,
    true,
  );
  assert.equal(
    policy.rateCard.reservationRules.useHighestEnabledOutputRate,
    true,
  );
});

test("declared reservation values cannot understate recomputed worst-case cost", () => {
  const policy = loadRealtimePolicy(policyPath);
  const understated = clone(policy);
  understated.worstCaseReservation.response.outputReservedMicroUsd -= 1;

  rejectsWith(
    () => validateRealtimePolicy(understated),
    "policy_reservation_understated",
  );
});
