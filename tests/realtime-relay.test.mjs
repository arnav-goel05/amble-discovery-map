import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  RelayProtocolError,
  cleanupRelaySession,
  sanitizeProviderEvent,
  validateBrowserMessage,
  validateSessionAdmission,
} from "../scripts/lib/realtime-relay-protocol.mjs";
import {
  AMBLE_WELCOME_MESSAGE,
  OUT_OF_SCOPE_RESPONSE,
  buildAmbleSessionInstructions,
  buildVerbatimSpeechInstructions,
  createRealtimeRelay,
  describeAvailableCapabilities,
  validateDiscoveryToolArguments,
} from "../cloudflare/realtime-relay.mjs";
import { VOICE_SERVICE_UNAVAILABLE_MESSAGE } from "../activity-scenes/assistant/realtime-relay-client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const {
  createLocalRelayOptions,
} = require("../scripts/realtime-voice-api-plugin.cjs");
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/voice", name), "utf8"),
  );

const admission = (overrides = {}) => ({
  requestUrl: "https://amble.example/api/voice/sessions",
  origin: "https://amble.example",
  contentType: "application/json",
  bodyBytes: 128,
  body: {
    protocolVersion: "1.1",
    disclosureAccepted: true,
    capabilities: { audioInput: true, audioOutput: true, text: true },
  },
  environmentEnabled: true,
  runtimeEnabled: true,
  providerPolicyValid: true,
  rateCardValid: true,
  reservationAvailable: true,
  rateLimited: false,
  ...overrides,
});

const throwsCode = (callback, code) =>
  assert.throws(
    callback,
    (error) => error instanceof RelayProtocolError && error.code === code,
  );

const flushRelay = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function createSocket(messages, listeners = {}) {
  return {
    readyState: 1,
    accept() {},
    close() {},
    send(value) {
      messages.push(JSON.parse(value));
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
}

async function createRelayHarness({
  operationalLogger = () => {},
  contentDebugLogger = null,
  responseSetTimeout,
  responseClearTimeout,
  now = () => new Date("2026-07-26T10:00:00.000Z"),
  budgetRepository: budgetOverrides = {},
} = {}) {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const providerMessages = [];
  const browserMessages = [];
  const providerListeners = {};
  const providerSocket = createSocket(providerMessages, providerListeners);
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve() {},
      async settle() {},
      async hold() {},
      ...budgetOverrides,
    },
    providerConnector: async () => providerSocket,
    randomId: () => `relay-fixture-${++identity}`,
    hash: async () => "sha256:relay-fixture",
    now,
    openingGreeting: false,
    operationalLogger,
    ...(contentDebugLogger ? { contentDebugLogger } : {}),
    ...(responseSetTimeout ? { responseSetTimeout } : {}),
    ...(responseClearTimeout ? { responseClearTimeout } : {}),
  });
  const admitted = await relay.admit(admission());
  await relay.attach(admitted.data.sessionId, createSocket(browserMessages));
  return {
    admitted,
    browserMessages,
    providerListeners,
    providerMessages,
    relay,
  };
}

test("voice operational traces expose only allowlisted phase timing", async () => {
  const records = [];
  const scheduled = [];
  const cleared = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
    responseSetTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    responseClearTimeout(timer) {
      cleared.push(timer);
    },
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-sensitive",
      text: "secret transcript at 1.3001,103.8001",
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.created",
      response: { id: "provider-secret-id" },
    }),
  });
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.output_audio.delta",
      delta: "secret-audio-payload",
    }),
  });
  const completion = fixture("transcript-provider-events.json").events.find(
    (event) => event.type === "response.done",
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.done",
      api_key: "sk-secret-sentinel",
      response: { usage: completion.usage },
    }),
  });
  await flushRelay();

  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["response_requested", "response_created", "first_audio", "response_done"],
  );
  const fields = [
    "elapsedMs",
    "event",
    "eventCode",
    "occurredAt",
    "phase",
    "schemaVersion",
    "sessionIdHash",
    "sincePreviousPhaseMs",
    "terminalReason",
    "turnNumber",
  ].sort();
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), fields);
    assert.equal(record.event, "voice.phase");
    assert.equal(record.sessionIdHash, "sha256:relay-fixture");
    assert.equal(Number.isInteger(record.elapsedMs), true);
    assert.equal(Number.isInteger(record.sincePreviousPhaseMs), true);
  }
  assert.doesNotMatch(
    JSON.stringify(records),
    /secret transcript|1\.3001|103\.8001|provider-secret|secret-audio|sk-secret|turn-sensitive/i,
  );
  assert.equal(scheduled.length, 1);
  assert.equal(cleared.includes(scheduled[0]), true);
});

test("audio turns trace commit and transcription before response creation", async () => {
  const records = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-audio" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-audio" }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item",
      transcript: "find an event",
    }),
  });
  await flushRelay();

  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["audio_committed", "transcription_completed", "response_requested"],
  );
  harness.relay.stop(sessionId, "user");
});

test("stalled transcriptions terminate at the provider-stage deadline", async () => {
  const records = [];
  const held = [];
  const settled = [];
  const scheduled = [];
  const cleared = [];
  let currentMs = Date.parse("2026-07-29T10:00:00.000Z");
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
    now: () => new Date(currentMs),
    responseSetTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    responseClearTimeout(timer) {
      cleared.push(timer);
    },
    budgetRepository: {
      async hold(value) {
        held.push(value);
      },
      async settle(value) {
        settled.push(value);
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "turn.request",
      turnId: "turn-transcription-timeout",
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "audio.commit",
      turnId: "turn-transcription-timeout",
    }),
  );
  const transcriptionTimer = scheduled.find(({ delay }) => delay === 30_000);
  assert(transcriptionTimer);
  currentMs += 30_000;
  transcriptionTimer.callback();
  await flushRelay();

  assert.equal(
    harness.providerMessages.some(({ type }) => type === "response.create"),
    false,
  );
  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(held.length, 1);
  assert.equal(held[0].reason, "terminal_without_trusted_usage");
  assert.equal(settled.length, 1);
  assert.equal(settled[0].settledMicroUsd, 0);
  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["audio_committed", "transcription_timeout", "session_terminal"],
  );
  assert.equal(records.at(-2).terminalReason, "provider");
  assert.equal(cleared.includes(transcriptionTimer), true);
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "error" &&
        message.code === "provider_unavailable" &&
        message.message === VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    ),
    true,
  );
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "session.stopped" && message.reason === "provider",
    ),
    true,
  );
});

test("explicit transcription failures terminate without waiting for the deadline", async () => {
  const records = [];
  const held = [];
  const scheduled = [];
  const cleared = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
    responseSetTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    responseClearTimeout(timer) {
      cleared.push(timer);
    },
    budgetRepository: {
      async hold(value) {
        held.push(value);
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "turn.request",
      turnId: "turn-transcription-failed",
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "audio.commit",
      turnId: "turn-transcription-failed",
    }),
  );
  const transcriptionTimer = scheduled.find(({ delay }) => delay === 30_000);
  assert(transcriptionTimer);
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "input-item-failed",
      error: { type: "server_error", code: "transcription_failed" },
    }),
  });
  await flushRelay();

  assert.equal(
    harness.providerMessages.some(({ type }) => type === "response.create"),
    false,
  );
  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(held.length, 1);
  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["audio_committed", "transcription_failed", "session_terminal"],
  );
  assert.equal(cleared.includes(transcriptionTimer), true);
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "error" && message.code === "provider_unavailable",
    ),
    true,
  );
});

test("stalled responses cancel and terminate at the response deadline", async () => {
  const records = [];
  const held = [];
  const scheduled = [];
  const cleared = [];
  let currentMs = Date.parse("2026-07-29T10:00:00.000Z");
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
    now: () => new Date(currentMs),
    responseSetTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    responseClearTimeout(timer) {
      cleared.push(timer);
    },
    budgetRepository: {
      async hold(value) {
        held.push(value);
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;
  assert.equal(harness.admitted.data.limits.responseTimeoutSeconds, 30);

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-timeout",
      text: "find events",
    }),
  );
  const responseTimer = scheduled.find(({ delay }) => delay === 30_000);
  assert(responseTimer);
  currentMs += 30_000;
  responseTimer.callback();
  await flushRelay();

  assert.equal(
    harness.providerMessages.some(({ type }) => type === "response.cancel"),
    true,
  );
  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(held.length, 1);
  assert.equal(held[0].reason, "terminal_without_trusted_usage");
  assert.equal(records.at(-1).phase, "response_timeout");
  assert.equal(records.at(-1).terminalReason, "response_timeout");
  assert.equal(cleared.includes(responseTimer), true);
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "error" &&
        message.code === "provider_unavailable" &&
        message.message === VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    ),
    true,
  );
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "session.stopped" &&
        message.reason === "response_timeout",
    ),
    true,
  );
});

const inspectCapabilityResult = (revision = 7) => ({
  capabilityId: "app.inspect",
  kind: "query",
  status: "completed",
  changed: null,
  affectedTargetIds: [],
  contextRevision: revision,
  data: {
    revision,
    stateDigest: `sha256:context-${revision}`,
    viewport: { zoom: 12, bearing: 0 },
    visibleLayers: {
      recommendations: false,
      location: false,
      mrtStations: false,
      mrtLines: false,
    },
    visibleTargets: [],
    focusedTargetId: null,
    selectedTargetIds: [],
    activeOverlayId: null,
    assistantPresentation: null,
    activeFilters: {},
    plan: { stopIds: [], travelMode: "walking", routeAvailable: false },
    location: {
      permission: "prompt",
      status: "idle",
      coarseAreaId: null,
    },
    transit: { visible: false, constraintActive: false },
    availableCapabilityIds: ["app.inspect", "catalog.get", "catalog.search"],
  },
  errorCode: null,
});

test("explicit content diagnostics trace all relay boundaries with permitted content and terminal cleanup", async () => {
  const records = [];
  const harness = await createRelayHarness({
    contentDebugLogger: (record) => records.push(structuredClone(record)),
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-debug",
      text: "find jazz near Bugis",
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "app.inspect",
      call_id: "call-debug",
      arguments: "{}",
      api_key: "sk-provider-secret",
    }),
  });
  await flushRelay();
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-debug",
      capabilityId: "app.inspect",
      kind: "query",
      result: inspectCapabilityResult(),
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.output_audio.delta",
      delta: "UklGRkFVRElP",
    }),
  });
  await flushRelay();

  assert.deepEqual(
    [...new Set(records.map(({ direction }) => direction))].sort(),
    [
      "browser_to_relay",
      "provider_to_relay",
      "relay_to_browser",
      "relay_to_provider",
    ],
  );
  assert.equal(
    records.every(
      ({ event, sessionIdHash }) =>
        event === "voice.content_debug" &&
        sessionIdHash === "sha256:relay-fixture",
    ),
    true,
  );
  const serialized = JSON.stringify(records);
  assert.match(serialized, /find jazz near Bugis/);
  assert.match(serialized, /Current eligible capabilities/);
  assert.match(serialized, /call-debug/);
  assert.match(serialized, /stateDigest/);
  assert.doesNotMatch(serialized, /sk-provider-secret|UklGRkFVRElP/);
  assert.match(serialized, /"omitted":true/);

  harness.relay.stop(sessionId, "user");
  const stoppedCount = records.length;
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.created",
      transcript: "late content",
    }),
  });
  await flushRelay();
  assert.equal(records.length, stoppedCount);
  assert.doesNotMatch(JSON.stringify(records), /relay-fixture-1/);
});

test("session admission returns only bounded public configuration", () => {
  const result = validateSessionAdmission(admission());

  assert.deepEqual(result, {
    protocolVersion: "1.1",
    capabilities: { audioInput: true, audioOutput: true, text: true },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /api.?key|credential|providerCall|remaining.*(?:usd|balance)|usage/i,
  );
});

test("session admission fails closed for every trust and capacity gate", () => {
  const cases = [
    ["origin_rejected", { origin: "https://attacker.example" }],
    ["invalid_request", { contentType: "text/plain" }],
    ["invalid_request", { bodyBytes: 65 * 1024 }],
    ["voice_disabled", { environmentEnabled: false }],
    ["voice_disabled", { runtimeEnabled: false }],
    ["policy_mismatch", { providerPolicyValid: false }],
    ["policy_mismatch", { rateCardValid: false }],
    ["usage_limit", { reservationAvailable: false }],
    ["rate_limited", { rateLimited: true }],
    [
      "invalid_request",
      {
        body: {
          protocolVersion: "1.1",
          disclosureAccepted: false,
          capabilities: { audioInput: true, audioOutput: true, text: true },
        },
      },
    ],
  ];

  for (const [code, override] of cases)
    throwsCode(() => validateSessionAdmission(admission(override)), code);
});

test("session admission requires the exact protocol 1.1 version", () => {
  for (const protocolVersion of ["1.0", "1.2", "2.0", null])
    throwsCode(
      () =>
        validateSessionAdmission(
          admission({
            body: {
              ...admission().body,
              protocolVersion,
            },
          }),
        ),
      "invalid_request",
    );
});

test("Amble's session contract rejects general chat and describes only eligible app capabilities", () => {
  const tools = [
    {
      type: "function",
      name: "map.zoomin",
      description: "Increase the map zoom by one step.",
      parameters: { type: "object", additionalProperties: false },
    },
    {
      type: "function",
      name: "event.search",
      description: "Search approved events already available in Amble.",
      parameters: { type: "object", additionalProperties: false },
    },
  ];

  assert.deepEqual(describeAvailableCapabilities(tools), [
    "map.zoomin: Increase the map zoom by one step.",
    "event.search: Search approved events already available in Amble.",
  ]);

  const instructions = buildAmbleSessionInstructions(tools);
  assert.match(instructions, /You are Amble/i);
  assert.match(instructions, /not a general-purpose assistant/i);
  assert.match(
    instructions,
    /I can only help you explore Singapore and use Amble/i,
  );
  assert.match(instructions, /must not browse or search the open web/i);
  assert.match(instructions, /tool result confirms/i);
  assert.match(instructions, /map\.zoomin: Increase the map zoom/i);
  assert.match(instructions, /event\.search: Search approved events/i);
  assert.doesNotMatch(instructions, /browser automation|unrestricted control/i);
});

test("Amble's capability description never includes actions absent from current context", () => {
  const instructions = buildAmbleSessionInstructions([
    {
      type: "function",
      name: "map.zoomout",
      description: "Decrease the map zoom by one step.",
      parameters: { type: "object", additionalProperties: false },
    },
  ]);

  assert.match(instructions, /map\.zoomout/);
  assert.doesNotMatch(instructions, /event\.search|navigation\.openexternal/);
});

test("Amble answers an opening greeting with a specific product introduction", () => {
  const instructions = buildAmbleSessionInstructions([]);

  assert.equal(
    AMBLE_WELCOME_MESSAGE,
    "Hi, I'm Amble, your Singapore discovery guide. Tell me what you're in the mood for—I can find events, restaurants, and places, or help you explore the map.",
  );
  assert.match(instructions, /opening greeting/i);
  assert.match(instructions, /CRITICAL VERBATIM SPEECH RULES/);
  assert.match(instructions, /EXACTLY AND ONLY/);
  assert.match(instructions, /DO NOT.*PREFACE/);
  assert.match(instructions, /DO NOT.*PARAPHRASE/);
  assert.match(
    instructions,
    new RegExp(AMBLE_WELCOME_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(
    instructions,
    /what's up|tiny mystery|just saying hello/i,
  );
  assert.match(
    instructions,
    new RegExp(OUT_OF_SCOPE_RESPONSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(instructions, /offer a relevant in-app alternative/i);
});

test("verbatim speech instructions contain one exact payload and forbid additions", () => {
  const instructions = buildVerbatimSpeechInstructions(AMBLE_WELCOME_MESSAGE);

  assert.equal(instructions.split(AMBLE_WELCOME_MESSAGE).length - 1, 1);
  assert.match(instructions, /SPEAK EXACTLY AND ONLY/);
  assert.match(instructions, /DO NOT ADD A PREFACE/);
  assert.match(instructions, /DO NOT.*PARAPHRASE/);
  assert.match(instructions, /exact supplied text and nothing else/i);
});

test("a new voice session reserves and starts Amble's welcome before user audio", async () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const providerMessages = [];
  const browserMessages = [];
  const reservations = [];
  const operationalRecords = [];
  const providerSocket = createSocket(providerMessages);
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve(value) {
        reservations.push(value);
      },
      async settle() {},
      async hold() {},
    },
    providerConnector: async () => providerSocket,
    randomId: () => `welcome-fixture-${++identity}`,
    hash: async () => "sha256:welcome-fixture",
    now: () => new Date("2026-07-29T17:00:00.000Z"),
    operationalLogger: (record) =>
      operationalRecords.push(structuredClone(record)),
  });
  const admitted = await relay.admit(admission());

  await relay.attach(admitted.data.sessionId, createSocket(browserMessages));

  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].kind, "response");
  assert.equal(browserMessages.at(-1).type, "session.state");
  assert.equal(browserMessages.at(-1).state, "processing");
  assert.deepEqual(
    operationalRecords.map(({ phase }) => phase),
    ["response_requested"],
  );
  assert.deepEqual(
    providerMessages.slice(-2).map(({ type }) => type),
    ["conversation.item.create", "response.create"],
  );
  assert.equal(
    providerMessages.at(-1).response.instructions,
    buildVerbatimSpeechInstructions(AMBLE_WELCOME_MESSAGE),
  );
  assert.equal("max_output_tokens" in providerMessages.at(-1).response, false);
  assert.match(
    providerMessages.at(-2).item.content[0].text,
    new RegExp(AMBLE_WELCOME_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(relay.sessions.get(admitted.data.sessionId).responseCount, 1);
});

test("browser message validation accepts only the declared protocol allowlist", () => {
  const allowed = [
    { type: "turn.request", turnId: "turn-001" },
    { type: "audio.append", turnId: "turn-001", audio: "fixture-audio" },
    { type: "audio.commit", turnId: "turn-001" },
    { type: "text.submit", turnId: "turn-002", text: "Somewhere calm" },
    {
      type: "capability.result",
      callId: "call-001",
      capabilityId: "map.openarea",
      kind: "command",
      result: {
        capabilityId: "map.openarea",
        kind: "command",
        status: "completed",
        changed: true,
        affectedTargetIds: ["ura-subzone:marina-south"],
        contextRevision: 2,
        data: { focusedAreaId: "ura-subzone:marina-south" },
        errorCode: null,
      },
    },
    {
      type: "confirmation.pending",
      callId: "call-confirm-001",
      capabilityId: "navigation.openexternal",
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
      targetId: "event:1",
      effectSummary: "Open the approved official event page.",
      expiresAt: "2026-07-26T10:00:25.000Z",
    },
    {
      type: "confirmation.result",
      callId: "call-001",
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
      finalUserInput: true,
      decision: "rejected",
    },
    {
      type: "deterministic.result",
      capabilityId: "map.zoomin",
      kind: "command",
      result: {
        capabilityId: "map.zoomin",
        kind: "command",
        status: "completed",
        changed: true,
        affectedTargetIds: [],
        contextRevision: 2,
        data: { actionId: "map.zoomin", changed: true },
        errorCode: null,
      },
    },
    { type: "session.stop" },
  ];
  const options = {
    activeReservedTurnId: "turn-001",
    pendingCallIds: new Set(["call-001"]),
    pendingConfirmation: {
      callId: "call-001",
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
    },
    pendingCalls: new Map([
      [
        "call-001",
        {
          capabilityId: "map.openarea",
          kind: "command",
        },
      ],
      [
        "call-confirm-001",
        {
          capabilityId: "navigation.openexternal",
          kind: "command",
          confirmationClass: "consequential",
        },
      ],
    ]),
    pendingDeterministic: {
      capabilityId: "map.zoomin",
      kind: "command",
      proposalRevision: 1,
      validateResult() {},
    },
    maxMessageBytes: 4096,
    maxAudioChunkBytes: 1024,
    maxTextChars: 512,
  };

  for (const message of allowed)
    assert.equal(
      validateBrowserMessage(
        message,
        message.type === "confirmation.pending"
          ? { ...options, pendingConfirmation: null }
          : options,
      ).type,
      message.type,
    );

  for (const type of [
    "response.create",
    "session.update",
    "conversation.item.create",
    "provider.forward",
    "tool.execute",
  ])
    throwsCode(
      () => validateBrowserMessage({ type }, options),
      "browser_message_unapproved",
    );
});

test("consequential provider calls use browser-owned confirmation and always complete", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [
          { targetId: "event:fixture", type: "event", label: "Fixture" },
        ],
        availableCapabilityIds: ["navigation.openexternal"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-navigation",
      text: "open the official reference",
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-navigation-001",
      name: "navigation.openexternal",
      arguments: JSON.stringify({
        targetId: "event:fixture",
        linkKind: "reference",
      }),
    }),
  });
  await flushRelay();

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "confirmation.pending",
      callId: "call-navigation-001",
      capabilityId: "navigation.openexternal",
      confirmationId: "confirmation-navigation-001",
      fingerprint: "sha256:confirmation-navigation-001",
      targetId: "event:fixture",
      effectSummary: "Open the approved official event page.",
      expiresAt: "2026-07-26T10:00:25.000Z",
    }),
  );
  assert.equal(harness.browserMessages.at(-1).type, "confirmation.required");

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "confirmation.result",
      callId: "call-navigation-001",
      confirmationId: "confirmation-navigation-001",
      fingerprint: "sha256:confirmation-navigation-001",
      finalUserInput: true,
      decision: "rejected",
    }),
  );
  const rejected = {
    capabilityId: "navigation.openexternal",
    kind: "command",
    status: "failed",
    changed: false,
    affectedTargetIds: [],
    contextRevision: 7,
    data: null,
    errorCode: "confirmation_required",
  };
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-navigation-001",
      capabilityId: "navigation.openexternal",
      kind: "command",
      result: rejected,
    }),
  );

  assert.equal(harness.relay.sessions.get(sessionId).pendingCalls.size, 0);
  assert.equal(harness.relay.sessions.get(sessionId).pendingConfirmation, null);
  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.completed",
    callId: "call-navigation-001",
    capabilityId: "navigation.openexternal",
    kind: "command",
    result: rejected,
  });
  const proposalCount = harness.browserMessages.filter(
    ({ type }) => type === "capability.proposed",
  ).length;
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-navigation-001",
      name: "navigation.openexternal",
      arguments: JSON.stringify({
        linkKind: "reference",
        targetId: "event:fixture",
      }),
    }),
  });
  await flushRelay();
  assert.equal(
    harness.browserMessages.filter(({ type }) => type === "capability.proposed")
      .length,
    proposalCount,
  );
  assert.equal(harness.relay.sessions.get(sessionId).pendingCalls.size, 0);
});

test("deterministic commands delay the model reply until the browser returns an outcome", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );
  const providerStart = harness.providerMessages.length;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-deterministic",
      text: "zoom in",
    }),
  );
  assert.equal(
    harness.providerMessages
      .slice(providerStart)
      .some(({ type }) => type === "response.create"),
    false,
  );

  const result = {
    capabilityId: "map.zoomin",
    kind: "command",
    status: "completed",
    changed: true,
    affectedTargetIds: [],
    contextRevision: 8,
    data: { actionId: "map.zoomin", changed: true },
    errorCode: null,
  };
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "deterministic.result",
      capabilityId: "map.zoomin",
      kind: "command",
      result,
    }),
  );

  assert.equal(
    harness.relay.sessions.get(sessionId).pendingDeterministic,
    null,
  );
  assert.deepEqual(
    harness.providerMessages.slice(-2).map(({ type }) => type),
    ["conversation.item.create", "response.create"],
  );
  assert.match(
    harness.providerMessages.at(-2).item.content[0].text,
    /completed/i,
  );
});

test("deterministic unavailable and failed outcomes are authoritative before acknowledgement", async () => {
  for (const [status, errorCode] of [
    ["unavailable", "unavailable"],
    ["failed", "execution_failed"],
  ]) {
    const harness = await createRelayHarness();
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "context.update",
        context: {
          revision: 7,
          visibleTargets: [],
          availableCapabilityIds: ["map.zoomin"],
        },
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-deterministic-${status}`,
        text: "zoom in",
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "deterministic.result",
        capabilityId: "map.zoomin",
        kind: "command",
        result: {
          capabilityId: "map.zoomin",
          kind: "command",
          status,
          changed: false,
          affectedTargetIds: [],
          contextRevision: 7,
          data: null,
          errorCode,
        },
      }),
    );

    assert.match(
      harness.providerMessages.at(-2).item.content[0].text,
      new RegExp(`"status":"${status}"`),
    );
    assert.equal(harness.providerMessages.at(-1).type, "response.create");
  }
});

test("audio and text remain bounded and require an admitted turn", () => {
  const options = {
    activeReservedTurnId: "turn-001",
    maxMessageBytes: 4096,
    maxAudioChunkBytes: 32,
    maxTextChars: 24,
  };

  throwsCode(
    () =>
      validateBrowserMessage(
        { type: "audio.append", turnId: "turn-other", audio: "fixture" },
        options,
      ),
    "turn_not_ready",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "audio.append",
          turnId: "turn-001",
          audio: "x".repeat(33),
        },
        options,
      ),
    "audio_chunk_too_large",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "text.submit",
          turnId: "turn-002",
          text: "x".repeat(25),
        },
        options,
      ),
    "text_too_large",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        { type: "text.submit", turnId: "turn-002", text: "ok" },
        { ...options, maxMessageBytes: 8 },
      ),
    "browser_message_too_large",
  );
});

test("modified clients cannot set provider-owned session or response fields", () => {
  const options = { maxMessageBytes: 4096, maxTextChars: 512 };
  for (const field of [
    "model",
    "rateCardVersion",
    "instructions",
    "tools",
    "maxOutputTokens",
    "automaticResponseCreation",
    "providerEventType",
  ])
    throwsCode(
      () =>
        validateBrowserMessage(
          { type: "turn.request", turnId: "turn-001", [field]: "modified" },
          options,
        ),
      "browser_field_unapproved",
    );
});

test("provider events are mapped to a small sanitized browser vocabulary", () => {
  const transcript = sanitizeProviderEvent({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "user-item-001",
    delta: "Somewhere calm",
    response_id: "provider-response-secret",
  });
  assert.deepEqual(transcript, {
    browserEvent: {
      type: "transcript.delta",
      itemId: "user-item-001",
      role: "user",
      text: "Somewhere calm",
    },
    trustedUsage: null,
  });

  const providerCompletion = fixture(
    "transcript-provider-events.json",
  ).events.find((event) => event.type === "response.done");
  const completion = sanitizeProviderEvent({
    type: "response.done",
    response_id: "provider-response-secret",
    api_key: "fixture-secret",
    response: { usage: providerCompletion.usage },
  });
  assert.equal(completion.browserEvent, null);
  assert.deepEqual(completion.trustedUsage, providerCompletion.usage);
  assert.deepEqual(
    sanitizeProviderEvent({
      type: "response.output_audio.delta",
      delta: "AQIDBA==",
    }).browserEvent,
    { type: "assistant.audio.delta", audio: "AQIDBA==" },
  );
  assert.doesNotMatch(
    JSON.stringify(completion.browserEvent),
    /response-secret|fixture-secret|usage|api_key/i,
  );

  assert.equal(
    sanitizeProviderEvent({ type: "unknown.provider.event", data: "secret" }),
    null,
  );
});

test("capability results cannot smuggle arbitrary provider events or calls", () => {
  const options = {
    pendingCallIds: new Set(["call-001"]),
    maxMessageBytes: 4096,
  };
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "capability.result",
          callId: "unknown-call",
          capabilityId: "map.openarea",
          kind: "command",
          result: {
            capabilityId: "map.openarea",
            kind: "command",
            status: "completed",
            changed: true,
            affectedTargetIds: [],
            contextRevision: 2,
            data: {},
            errorCode: null,
          },
        },
        options,
      ),
    "capability_call_unmatched",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "capability.result",
          callId: "call-001",
          capabilityId: "map.openarea",
          kind: "command",
          result: {
            capabilityId: "map.openarea",
            kind: "command",
            status: "completed",
            changed: true,
            affectedTargetIds: [],
            contextRevision: 2,
            data: {},
            errorCode: null,
          },
          providerEventType: "response.create",
        },
        options,
      ),
    "browser_field_unapproved",
  );
});

test("relay completes a validated query before allowing provider continuation", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;

  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-inspect-001",
      name: "app.inspect",
      arguments: "{}",
    }),
  });
  await flushRelay();

  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.proposed",
    callId: "call-inspect-001",
    capabilityId: "app.inspect",
    kind: "query",
    arguments: {},
    contextRevision: 0,
  });

  const providerStart = harness.providerMessages.length;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-inspect-001",
      capabilityId: "app.inspect",
      kind: "query",
      result: inspectCapabilityResult(0),
    }),
  );

  assert.deepEqual(
    harness.providerMessages.slice(providerStart).map(({ type }) => type),
    ["conversation.item.create", "response.create"],
  );
  assert.deepEqual(
    JSON.parse(harness.providerMessages[providerStart].item.output),
    inspectCapabilityResult(0),
  );
  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.completed",
    callId: "call-inspect-001",
    capabilityId: "app.inspect",
    kind: "query",
    result: inspectCapabilityResult(0),
  });
});

test("changed command completion waits for refreshed context and tools", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-map-command",
      text: "adjust the map",
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-zoom-001",
      name: "map.zoomin",
      arguments: "{}",
    }),
  });
  await flushRelay();

  const result = {
    capabilityId: "map.zoomin",
    kind: "command",
    status: "completed",
    changed: true,
    affectedTargetIds: [],
    contextRevision: 8,
    data: { actionId: "map.zoomin", changed: true },
    errorCode: null,
  };
  const providerStart = harness.providerMessages.length;
  const browserStart = harness.browserMessages.length;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-zoom-001",
      capabilityId: "map.zoomin",
      kind: "command",
      result,
    }),
  );
  assert.equal(harness.providerMessages.length, providerStart);
  assert.equal(harness.browserMessages.length, browserStart);

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 8,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomout"],
      },
    }),
  );

  assert.deepEqual(
    harness.providerMessages.slice(providerStart).map(({ type }) => type),
    ["conversation.item.create", "conversation.item.create", "response.create"],
  );
  assert.deepEqual(
    harness.relay.sessions.get(sessionId).tools.map(({ name }) => name),
    ["app.inspect", "catalog.search", "catalog.get", "map.zoomin"],
  );
  assert.equal(
    harness.providerMessages[providerStart + 1].item.type,
    "function_call_output",
  );
  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.completed",
    callId: "call-zoom-001",
    capabilityId: "map.zoomin",
    kind: "command",
    result,
  });
});

test("invalid, stale, or overlapping capability calls fail closed and clean up", async () => {
  for (const failure of [
    "common_envelope",
    "proposal_schema",
    "specific_result",
    "stale_revision",
    "overlap",
  ]) {
    const harness = await createRelayHarness();
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "context.update",
        context: {
          revision: 7,
          visibleTargets: [],
          availableCapabilityIds: ["map.zoomin"],
        },
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-map-${failure}`,
        text: "adjust the map",
      }),
    );
    harness.providerListeners.message({
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call-first",
        name: "map.zoomin",
        arguments:
          failure === "proposal_schema"
            ? JSON.stringify({ selector: "#unapproved" })
            : "{}",
      }),
    });
    await flushRelay();

    if (failure === "proposal_schema") {
      assert.equal(harness.relay.sessions.has(sessionId), false, failure);
      continue;
    } else if (failure === "overlap") {
      harness.providerListeners.message({
        data: JSON.stringify({
          type: "response.function_call_arguments.done",
          call_id: "call-second",
          name: "app.inspect",
          arguments: "{}",
        }),
      });
      await flushRelay();
    } else {
      await harness.relay.handleBrowserMessage(
        sessionId,
        JSON.stringify({
          type: "capability.result",
          callId: "call-first",
          capabilityId: "map.zoomin",
          kind: "command",
          result: {
            capabilityId: "map.zoomin",
            kind: "command",
            status: "completed",
            changed: true,
            affectedTargetIds: [],
            contextRevision: failure === "stale_revision" ? 7 : 8,
            data: {
              actionId: "map.zoomin",
              changed: failure === "specific_result" ? "yes" : true,
            },
            errorCode: null,
            ...(failure === "common_envelope"
              ? { providerDebug: "must-not-pass" }
              : {}),
          },
        }),
      );
    }

    assert.equal(harness.relay.sessions.has(sessionId), false, failure);
  }
});

test("local relay passes the same capability contracts and fixtures to the shared relay", () => {
  const capabilityContracts = [{ capabilityId: "fixture.query" }];
  const tools = [{ type: "function", name: "fixture.query" }];
  const approvedCandidateIds = ["event:fixture"];
  const approvedCandidates = [{ candidateId: "event:fixture" }];
  const repository = { kind: "fixture-repository" };
  const providerConnector = () => {};
  const options = createLocalRelayOptions({
    policy: { schemaVersion: "fixture" },
    repository,
    environment: { OPENAI_API_KEY: "server-only-fixture" },
    providerConnector,
    capabilityContracts,
    tools,
    approvedCandidateIds,
    approvedCandidates,
  });

  assert.equal(options.budgetRepository, repository);
  assert.equal(options.providerConnector, providerConnector);
  assert.equal(options.capabilityContracts, capabilityContracts);
  assert.equal(options.tools, tools);
  assert.equal(options.approvedCandidateIds, approvedCandidateIds);
  assert.equal(options.approvedCandidates, approvedCandidates);
  assert.equal(options.apiKey, "server-only-fixture");
});

test("every terminal reason performs complete idempotent cleanup", () => {
  const terminalFixtures = fixture("terminal-errors.json");

  for (const terminalCase of terminalFixtures.cases) {
    const calls = [];
    const session = {
      state: "speaking",
      providerSocket: { close: () => calls.push("provider-close") },
      browserSocket: { close: () => calls.push("browser-close") },
      abortController: { abort: () => calls.push("abort") },
      pendingConfirmation: { confirmationId: "confirmation-001" },
      transcriptItems: [{ itemId: "transcript-001", text: "memory-only" }],
      intent: { freeTextSummary: "memory-only" },
      exactLocation: { coordinates: [103.8, 1.3] },
      interfaceContext: { revision: 1 },
    };

    const first = cleanupRelaySession(session, terminalCase.terminal.reason);
    const second = cleanupRelaySession(session, terminalCase.terminal.reason);

    assert.deepEqual(first.terminalEvent, terminalCase.terminal);
    assert.equal(first.state, "stopped");
    assert.deepEqual(first.transcriptItems, []);
    assert.equal(first.intent, null);
    assert.equal(first.exactLocation, null);
    assert.equal(first.interfaceContext, null);
    assert.equal(first.pendingConfirmation, null);
    assert.deepEqual(calls, ["abort", "provider-close", "browser-close"]);
    assert.equal(second, first);
  }
});

test("the browser terminal contract uses one provider-independent unavailable message", () => {
  assert.equal(
    VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    "Voice service is currently unavailable. Please try again later.",
  );
  for (const code of [
    "voice_disabled",
    "usage_limit",
    "provider_unavailable",
    "network",
    "admission_failed",
  ])
    assert.doesNotMatch(VOICE_SERVICE_UNAVAILABLE_MESSAGE, new RegExp(code));
});

test("server relay owns provider configuration and reserves before billable events", async () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const reservations = [];
  const settlements = [];
  const providerMessages = [];
  const browserMessages = [];
  const providerListeners = {};
  const socket = (messages, listeners = {}) => ({
    readyState: 1,
    accept() {},
    close() {},
    send(value) {
      messages.push(JSON.parse(value));
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  });
  const providerSocket = socket(providerMessages, providerListeners);
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve(value) {
        reservations.push(value);
        return value;
      },
      async settle(value) {
        settlements.push(value);
      },
      async hold() {},
    },
    providerConnector: async () => providerSocket,
    randomId: () => `identity-${++identity}`,
    hash: async () => "sha256:fixture",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    openingGreeting: false,
  });
  const admitted = await relay.admit(admission());
  await relay.attach(admitted.data.sessionId, socket(browserMessages));

  assert.equal(providerMessages[0].type, "session.update");
  assert.equal(providerMessages[0].session.model, "gpt-realtime-2.1-mini");
  assert.equal("fallback_model" in providerMessages[0].session, false);
  assert.equal("max_output_tokens" in providerMessages[0].session, false);
  assert.equal(providerMessages[0].session.audio.input.turn_detection, null);
  assert.deepEqual(
    providerMessages[0].session.tools.map(({ name }) => name),
    ["app.inspect", "catalog.search", "catalog.get"],
  );
  assert.match(
    providerMessages[0].session.instructions,
    /not a general-purpose assistant/i,
  );

  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 1,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );
  const contextualSession = providerMessages
    .filter(({ type }) => type === "session.update")
    .at(-1).session;
  assert.deepEqual(
    contextualSession.tools.map(({ name }) => name),
    ["app.inspect", "catalog.search", "catalog.get"],
  );
  assert.doesNotMatch(contextualSession.instructions, /map\.zoomin/);
  assert.doesNotMatch(contextualSession.instructions, /event\.search/);

  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-001" }),
  );
  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-001" }),
  );

  assert.deepEqual(
    reservations.map(({ kind }) => kind),
    ["input_transcription", "response"],
  );
  assert.equal(providerMessages.at(-1).type, "input_audio_buffer.commit");
  assert.equal(browserMessages.at(-1).type, "turn.ready");
  assert.doesNotMatch(
    JSON.stringify(browserMessages),
    /api.?key|server-only-fixture|rateCard/i,
  );

  providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-001",
      transcript: "zoom in",
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerMessages.at(-1).type, "session.update");
  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({
      type: "deterministic.result",
      capabilityId: "map.zoomin",
      kind: "command",
      result: {
        capabilityId: "map.zoomin",
        kind: "command",
        status: "completed",
        changed: true,
        affectedTargetIds: [],
        contextRevision: 2,
        data: { actionId: "map.zoomin", changed: true },
        errorCode: null,
      },
    }),
  );
  assert.deepEqual(
    providerMessages.slice(-3).map(({ type }) => type),
    ["session.update", "conversation.item.create", "response.create"],
  );
  assert.equal(
    providerMessages
      .at(-3)
      .session.tools.some(({ name }) => name === "map.zoomin"),
    false,
  );
  assert.match(
    providerMessages.at(-2).item.content[0].text,
    /authoritative result/i,
  );

  const providerCompletion = fixture(
    "transcript-provider-events.json",
  ).events.find((event) => event.type === "response.done");
  providerListeners.message({
    data: JSON.stringify({
      type: "response.done",
      response: { usage: providerCompletion.usage },
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(relay.sessions.has(admitted.data.sessionId), true);
  assert.equal(
    settlements[0].usageShapeHash,
    "sha256:fixed-transcription-reservation",
  );
  assert.equal(settlements[1].usageShapeHash, "sha256:fixture");
  assert.equal(
    browserMessages.filter(
      (message) =>
        message.type === "session.state" && message.state === "listening",
    ).length,
    2,
  );

  // A duplicate provider transcription completion must be harmless and must
  // not reopen, respond to, or settle the completed turn a second time.
  const responseCreates = providerMessages.filter(
    ({ type }) => type === "response.create",
  ).length;
  providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-001",
      transcript: "",
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(relay.sessions.has(admitted.data.sessionId), true);
  assert.equal(settlements.length, 2);
  assert.equal(
    providerMessages.filter(({ type }) => type === "response.create").length,
    responseCreates,
  );
  assert.equal(
    browserMessages.filter(
      (message) =>
        message.type === "session.state" && message.state === "listening",
    ).length,
    2,
  );

  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "session.stop" }),
  );
  assert.equal(settlements.length, 2);
  assert.deepEqual(
    settlements.map(({ reservationId }) => reservationId).sort(),
    reservations.map(({ reservationId }) => reservationId).sort(),
  );
});

test("server relay rejects overlapping turns without overwriting reservation identity", async () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const reservations = [];
  const settlements = [];
  const socket = () => ({
    readyState: 1,
    accept() {},
    close() {},
    send() {},
    addEventListener() {},
  });
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve(value) {
        reservations.push(value);
      },
      async settle(value) {
        settlements.push(value);
      },
      async hold() {},
    },
    providerConnector: async () => socket(),
    randomId: () => `identity-${++identity}`,
    hash: async () => "sha256:fixture",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    openingGreeting: false,
  });
  const admitted = await relay.admit(admission());
  await relay.attach(admitted.data.sessionId, socket());
  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-001" }),
  );
  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-002" }),
  );

  assert.equal(reservations.length, 1);
  assert.equal(relay.sessions.has(admitted.data.sessionId), false);
  assert.equal(settlements[0].reservationId, reservations[0].reservationId);
  assert.equal(settlements[0].settledMicroUsd, 0);
});

test("discovery tools reject result identities outside the server-approved set", () => {
  const args = {
    result: {
      areas: [
        {
          candidateIds: ["candidate:approved"],
          reasons: [{ candidateIds: ["candidate:approved"] }],
        },
      ],
    },
  };
  assert.deepEqual(
    validateDiscoveryToolArguments(
      "discovery.presentareas",
      args,
      new Set(["candidate:approved"]),
    ),
    args,
  );
  assert.throws(
    () =>
      validateDiscoveryToolArguments(
        "discovery.presentareas",
        {
          result: {
            areas: [{ candidateIds: ["candidate:invented"], reasons: [] }],
          },
        },
        new Set(["candidate:approved"]),
      ),
    TypeError,
  );
});
