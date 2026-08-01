import fs from "node:fs";

const EXACT = Object.freeze({
  owner: "Arnav",
  modelId: "gpt-realtime-2.1-mini",
  transcriptionModelId: "gpt-realtime-whisper",
  capMicroUsd: 10_000_000,
  maxResponseStagesPerTurn: 3,
  responseTimeoutSeconds: 30,
  providerMaxOutputTokens: 4_096,
  maxContextTokens: 4_000,
  maxTranscriptionAudioSeconds: 60,
});

const RATE_KEYS = [
  "textInputMicroUsdPerMillionTokens",
  "cachedTextInputMicroUsdPerMillionTokens",
  "textOutputMicroUsdPerMillionTokens",
  "audioInputMicroUsdPerMillionTokens",
  "cachedAudioInputMicroUsdPerMillionTokens",
  "audioOutputMicroUsdPerMillionTokens",
  "transcriptionMicroUsdPerMinute",
];

export class RealtimePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RealtimePolicyError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new RealtimePolicyError(code, message);
};
const safeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const checkedCeilProduct = (amount, rate, divisor) => {
  if (
    !safeInteger(amount) ||
    !safeInteger(rate) ||
    !safeInteger(divisor) ||
    divisor === 0
  )
    fail(
      "policy_integer_invalid",
      "Rate arithmetic requires non-negative safe integers",
    );
  const product = amount * rate;
  if (!Number.isSafeInteger(product))
    fail(
      "policy_arithmetic_overflow",
      "Rate arithmetic overflowed safe integer precision",
    );
  return Math.ceil(product / divisor);
};

export function calculateWorstCaseReservations(policy) {
  const rates = policy?.rateCard?.rates || {};
  for (const key of RATE_KEYS)
    if (!safeInteger(rates[key]))
      fail("policy_rate_unknown", `Missing or invalid rate ${key}`);
  const response = policy?.worstCaseReservation?.response;
  const responseInputMicroUsd = checkedCeilProduct(
    response?.maxInputTokens,
    rates.audioInputMicroUsdPerMillionTokens,
    1_000_000,
  );
  const responseOutputMicroUsd = checkedCeilProduct(
    response?.providerMaxOutputTokens,
    rates.audioOutputMicroUsdPerMillionTokens,
    1_000_000,
  );
  const responseMicroUsd = responseInputMicroUsd + responseOutputMicroUsd;
  const inputTranscription = policy?.worstCaseReservation?.inputTranscription;
  const transcriptionMicroUsd = checkedCeilProduct(
    inputTranscription?.maxAudioSeconds,
    rates.transcriptionMicroUsdPerMinute,
    60,
  );
  const turnMicroUsd = responseMicroUsd + transcriptionMicroUsd;
  if (![responseMicroUsd, turnMicroUsd].every(Number.isSafeInteger))
    fail(
      "policy_arithmetic_overflow",
      "Reservation sum overflowed safe integer precision",
    );
  return {
    responseInputMicroUsd,
    responseOutputMicroUsd,
    responseMicroUsd,
    transcriptionMicroUsd,
    turnMicroUsd,
  };
}

export function validateRealtimePolicy(policy) {
  if (policy?.schemaVersion !== "1.1")
    fail("policy_schema_invalid", "Unsupported realtime policy schema");
  if (policy.owner !== EXACT.owner)
    fail("policy_owner_invalid", "Realtime policy owner is invalid");
  if (policy.modelId !== EXACT.modelId)
    fail("policy_model_unknown", "Realtime model is not approved");
  if (policy.transcriptionModelId !== EXACT.transcriptionModelId)
    fail(
      "policy_transcription_model_unknown",
      "Realtime input-transcription model is not approved",
    );
  if (!safeInteger(policy.capMicroUsd))
    fail("policy_integer_invalid", "Budget cap must be a safe integer");
  if (policy.capMicroUsd !== EXACT.capMicroUsd || policy.resetPolicy !== "none")
    fail(
      "policy_cap_invalid",
      "Budget cap or reset policy differs from owner approval",
    );
  if ("maxOutputTokens" in policy)
    fail(
      "policy_output_ceiling_forbidden",
      "Realtime policy must not impose an application output-token ceiling",
    );
  for (const removedLimit of [
    "maxSessionSeconds",
    "idleSeconds",
    "maxResponses",
  ])
    if (removedLimit in policy)
      fail(
        "policy_session_limit_forbidden",
        `${removedLimit} must not limit a voice session`,
      );
  for (const key of [
    "maxResponseStagesPerTurn",
    "responseTimeoutSeconds",
    "maxContextTokens",
  ]) {
    if (!safeInteger(policy[key]))
      fail("policy_integer_invalid", `${key} must be a safe integer`);
    if (policy[key] !== EXACT[key])
      fail("policy_limit_invalid", `${key} differs from the reviewed limit`);
  }
  if (
    policy.worstCaseReservation?.response?.providerMaxOutputTokens !==
    EXACT.providerMaxOutputTokens
  )
    fail(
      "policy_reservation_bound_invalid",
      "Response reservation must use the reviewed provider maximum",
    );
  if (
    policy.worstCaseReservation?.inputTranscription?.maxAudioSeconds !==
      EXACT.maxTranscriptionAudioSeconds ||
    policy.worstCaseReservation?.inputTranscription?.rateMicroUsdPerMinute !==
      policy.rateCard?.rates?.transcriptionMicroUsdPerMinute
  )
    fail(
      "policy_transcription_bound_invalid",
      "Input transcription reservation must use the reviewed duration and rate",
    );
  if (policy.rateCardVersion !== policy.rateCard?.version)
    fail("policy_rate_card_mismatch", "Rate-card versions differ");
  const calculated = calculateWorstCaseReservations(policy);
  const declared = policy.worstCaseReservation;
  const values = [
    [
      declared.inputTranscription?.reservedMicroUsd,
      calculated.transcriptionMicroUsd,
    ],
    [declared.response.inputReservedMicroUsd, calculated.responseInputMicroUsd],
    [
      declared.response.outputReservedMicroUsd,
      calculated.responseOutputMicroUsd,
    ],
    [declared.response.reservedMicroUsd, calculated.responseMicroUsd],
    [declared.maxTurnReservedMicroUsd, calculated.turnMicroUsd],
  ];
  if (
    values.some(([actual, minimum]) => !safeInteger(actual) || actual < minimum)
  )
    fail(
      "policy_reservation_understated",
      "Declared reservation understates worst-case cost",
    );
  return Object.freeze(structuredClone(policy));
}

export function loadRealtimePolicy(file) {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(
      "policy_unreadable",
      `Realtime policy could not be loaded: ${error.message}`,
    );
  }
  return validateRealtimePolicy(policy);
}

export function assertRealtimeEnabled(
  policy,
  { environmentEnabled = false, runtimeEnabled = false } = {},
) {
  validateRealtimePolicy(policy);
  if (environmentEnabled !== true || runtimeEnabled !== true)
    fail("voice_disabled", "Realtime voice requires both kill switches");
  return true;
}
