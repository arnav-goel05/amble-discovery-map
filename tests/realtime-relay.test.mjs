import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
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
  buildAmbleSessionInstructions,
  createRealtimeRelay,
  describeAvailableCapabilities,
  validateDiscoveryToolArguments,
} from "../cloudflare/realtime-relay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    protocolVersion: "1.0",
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

test("session admission returns only bounded public configuration", () => {
  const result = validateSessionAdmission(admission());

  assert.deepEqual(result, {
    protocolVersion: "1.0",
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
          protocolVersion: "1.0",
          disclosureAccepted: false,
          capabilities: { audioInput: true, audioOutput: true, text: true },
        },
      },
    ],
  ];

  for (const [code, override] of cases)
    throwsCode(() => validateSessionAdmission(admission(override)), code);
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
    "Hi, I'm Amble, your Singapore discovery guide. Tell me what you're in the mood for, and I can suggest areas and places, search events or restaurants, and control the map—including your location and MRT context.",
  );
  assert.match(instructions, /opening greeting/i);
  assert.match(
    instructions,
    new RegExp(AMBLE_WELCOME_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(
    instructions,
    /what's up|tiny mystery|just saying hello/i,
  );
});

test("browser message validation accepts only the declared protocol allowlist", () => {
  const allowed = [
    { type: "turn.request", turnId: "turn-001" },
    { type: "audio.append", turnId: "turn-001", audio: "fixture-audio" },
    { type: "audio.commit", turnId: "turn-001" },
    { type: "text.submit", turnId: "turn-002", text: "Somewhere calm" },
    {
      type: "action.result",
      callId: "call-001",
      actionId: "map.openarea",
      ok: true,
      result: { focusedAreaId: "ura-subzone:marina-south" },
    },
    {
      type: "confirmation.result",
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
      decision: "rejected",
    },
    { type: "session.stop" },
  ];
  const options = {
    activeReservedTurnId: "turn-001",
    pendingCallIds: new Set(["call-001"]),
    pendingConfirmation: {
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
    },
    maxMessageBytes: 4096,
    maxAudioChunkBytes: 1024,
    maxTextChars: 512,
  };

  for (const message of allowed)
    assert.equal(validateBrowserMessage(message, options).type, message.type);

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

test("action results cannot smuggle arbitrary provider events or calls", () => {
  const options = {
    pendingCallIds: new Set(["call-001"]),
    maxMessageBytes: 4096,
  };
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "action.result",
          callId: "unknown-call",
          actionId: "map.openarea",
          ok: true,
          result: {},
        },
        options,
      ),
    "action_call_unmatched",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "action.result",
          callId: "call-001",
          actionId: "map.openarea",
          ok: true,
          result: {},
          providerEventType: "response.create",
        },
        options,
      ),
    "browser_field_unapproved",
  );
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
  });
  const admitted = await relay.admit(admission());
  await relay.attach(admitted.data.sessionId, socket(browserMessages));

  assert.equal(providerMessages[0].type, "session.update");
  assert.equal(providerMessages[0].session.model, "gpt-realtime-2.1");
  assert.equal(providerMessages[0].session.audio.input.turn_detection, null);
  assert.ok(
    providerMessages[0].session.tools.every(({ name }) =>
      name.startsWith("discovery."),
    ),
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
        availableActionIds: ["map.zoomin"],
      },
    }),
  );
  const contextualSession = providerMessages
    .filter(({ type }) => type === "session.update")
    .at(-1).session;
  assert.deepEqual(
    contextualSession.tools.map(({ name }) => name),
    ["discovery.presentareas", "discovery.refine", "map.zoomin"],
  );
  assert.match(contextualSession.instructions, /map\.zoomin/);
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
  assert.equal(providerMessages.at(-1).type, "response.create");
  assert.equal(browserMessages.at(-1).type, "turn.ready");
  assert.doesNotMatch(
    JSON.stringify(browserMessages),
    /api.?key|server-only-fixture|rateCard/i,
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
    settlements[1].usageShapeHash,
    "sha256:fixed-transcription-on-response-complete",
  );
  assert.equal(
    browserMessages.filter(
      (message) =>
        message.type === "session.state" && message.state === "listening",
    ).length,
    2,
  );

  // A late provider transcription completion must be harmless and must not
  // reopen or settle the already completed turn a second time.
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
