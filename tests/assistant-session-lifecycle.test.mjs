import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionLifecycleRouter,
  recognizeSessionLifecycleIntent,
  SESSION_LIFECYCLE_INTENT_IDS,
} from "../activity-scenes/assistant/session-lifecycle-router.js";
import {
  createRealtimeRelayClient,
  VOICE_SERVICE_UNAVAILABLE_MESSAGE,
} from "../activity-scenes/assistant/realtime-relay-client.js";

class RelaySocketFixture {
  constructor() {
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) || []) listener(value);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close(code, reason) {
    this.readyState = 3;
    this.closed = { code, reason };
  }
}

const relayAdmission = (overrides = {}) => ({
  ok: true,
  json: async () => ({
    ok: true,
    data: {
      sessionId: "session-terminal",
      protocolVersion: "1.1",
      streamPath: "/api/voice/sessions/session-terminal/stream",
      limits: { maxResponseStagesPerTurn: 3, responseTimeoutSeconds: 30 },
      ...overrides,
    },
  }),
});

function lifecycleHarness({ active = true, muted = false } = {}) {
  const state = { active, muted };
  const calls = [];
  const router = createSessionLifecycleRouter({
    snapshot: () => ({ ...state }),
    stop(reason) {
      calls.push(["stop", reason]);
      state.active = false;
      return true;
    },
    setMuted(nextMuted) {
      calls.push(["setMuted", nextMuted]);
      state.muted = nextMuted;
      return true;
    },
    interrupt() {
      calls.push(["interrupt"]);
      return true;
    },
  });
  return { calls, router, state };
}

test("recognition is a closed deterministic allowlist", () => {
  assert.deepEqual(SESSION_LIFECYCLE_INTENT_IDS, [
    "session.interrupt",
    "session.mute",
    "session.stop",
    "session.unmute",
  ]);
  assert.equal(
    recognizeSessionLifecycleIntent("  Mute voice! "),
    "session.mute",
  );
  assert.equal(
    recognizeSessionLifecycleIntent("resume listening"),
    "session.unmute",
  );
  assert.equal(
    recognizeSessionLifecycleIntent("stop talking"),
    "session.interrupt",
  );
  for (const input of [
    "do not stop",
    "maybe mute later",
    "accept",
    "allow microphone",
    "confirm",
    "yes",
    "session.confirm",
    "confirmation.accept",
  ])
    assert.equal(recognizeSessionLifecycleIntent(input), null, input);
});

test("browser controls route stop, mute, unmute, and interrupt locally", async () => {
  const { calls, router, state } = lifecycleHarness();
  assert.deepEqual(
    await router.route("session.mute", { source: "browser_control" }),
    {
      intentId: "session.mute",
      status: "routed",
      changed: true,
      local: true,
    },
  );
  assert.equal(state.muted, true);
  await router.route("resume voice", {
    source: "user_utterance",
    inputStatus: "final",
  });
  await router.route(
    { intentId: "session.interrupt" },
    {
      source: "browser_control",
    },
  );
  await router.route("end voice session", {
    source: "user_utterance",
  });
  assert.deepEqual(calls, [
    ["setMuted", true],
    ["setMuted", false],
    ["interrupt"],
    ["stop", "user"],
  ]);
  assert.equal(state.active, false);
});

test("idempotent and terminal lifecycle requests are local no-ops", async () => {
  const { calls, router } = lifecycleHarness({ muted: true });
  assert.equal(
    (await router.route("session.mute", { source: "browser_control" })).status,
    "noop",
  );
  await router.route("session.stop", { source: "browser_control" });
  for (const intentId of [
    "session.stop",
    "session.mute",
    "session.unmute",
    "session.interrupt",
  ]) {
    const result = await router.route(intentId, {
      source: "browser_control",
    });
    assert.equal(result.status, "noop", intentId);
    assert.equal(result.changed, false, intentId);
  }
  assert.deepEqual(calls, [["stop", "user"]]);
});

test("consent, confirmation, and model/provider invocation stay protected", async () => {
  let invoked = false;
  assert.throws(
    () =>
      createSessionLifecycleRouter({
        snapshot: () => ({ active: true, muted: false }),
        stop() {},
        setMuted() {},
        interrupt() {},
        invokeModel() {
          invoked = true;
        },
      }),
    { code: "protected_control_owner_forbidden" },
  );
  const { calls, router } = lifecycleHarness();
  for (const source of ["model", "provider", "relay", "capability"]) {
    await assert.rejects(
      router.route("session.stop", { source }),
      { code: "lifecycle_source_forbidden" },
      source,
    );
  }
  for (const intentId of [
    "session.consent",
    "session.confirm",
    "confirmation.accept",
    "confirmation.reject",
  ])
    await assert.rejects(
      router.route({ intentId }, { source: "browser_control" }),
      { code: "protected_control" },
      intentId,
    );
  assert.deepEqual(calls, []);
  assert.equal(invoked, false);
});

test("partial user input and open request fields cannot cause effects", async () => {
  const { calls, router } = lifecycleHarness();
  await assert.rejects(
    router.route("mute", {
      source: "user_utterance",
      inputStatus: "partial",
    }),
    { code: "lifecycle_input_not_final" },
  );
  await assert.rejects(
    router.route(
      { intentId: "session.stop", confirmation: "accepted" },
      { source: "browser_control" },
    ),
    { code: "lifecycle_request_invalid" },
  );
  await assert.rejects(
    router.route("please search the website", {
      source: "user_utterance",
    }),
    { code: "lifecycle_intent_unknown" },
  );
  assert.deepEqual(calls, []);
});

test("concurrent local inputs execute in arrival order", async () => {
  const state = { active: true, muted: false };
  const calls = [];
  const router = createSessionLifecycleRouter({
    snapshot: () => ({ ...state }),
    async stop() {
      calls.push("stop:start");
      await Promise.resolve();
      state.active = false;
      calls.push("stop:end");
      return true;
    },
    async setMuted(nextMuted) {
      calls.push(`mute:${nextMuted}`);
      state.muted = nextMuted;
      return true;
    },
    interrupt() {
      calls.push("interrupt");
      return true;
    },
  });
  const stopping = router.route("session.stop", {
    source: "browser_control",
  });
  const muting = router.route("session.mute", {
    source: "browser_control",
  });
  const [stopResult, muteResult] = await Promise.all([stopping, muting]);
  assert.equal(stopResult.status, "routed");
  assert.equal(muteResult.status, "noop");
  assert.deepEqual(calls, ["stop:start", "stop:end"]);
});

test("online service errors are terminal, clear pending work, and expose one exact message", async () => {
  let cancelled = 0;
  const events = [];
  const client = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async () => relayAdmission(),
    WebSocketImpl: RelaySocketFixture,
    audioPlayback: {
      play: () => new Promise(() => {}),
      cancel: () => {
        cancelled += 1;
      },
    },
    onEvent: (event) => events.push(event),
  });
  await client.admit({ disclosureAccepted: true });
  const socket = client.connect();
  socket.open();
  client.updateContext({ revision: 9 });
  socket.emit("message", {
    data: JSON.stringify({
      type: "capability.proposed",
      callId: "call-terminal",
      capabilityId: "navigation.openexternal",
      kind: "command",
      arguments: { targetId: "event:fixture" },
      contextRevision: 9,
    }),
  });
  client.requestConfirmation({
    callId: "call-terminal",
    capabilityId: "navigation.openexternal",
    confirmationId: "confirmation-terminal",
    fingerprint: "sha256:terminal",
    targetId: "event:fixture",
    effectSummary: "Open an approved page.",
    expiresAt: "2026-07-26T10:00:25.000Z",
  });
  socket.emit("message", {
    data: JSON.stringify({
      type: "confirmation.required",
      callId: "call-terminal",
      confirmationId: "confirmation-terminal",
      fingerprint: "sha256:terminal",
      targetId: "event:fixture",
      effectSummary: "Open an approved page.",
      expiresAt: "2026-07-26T10:00:25.000Z",
    }),
  });
  socket.emit("message", {
    data: JSON.stringify({ type: "assistant.audio.delta", audio: "AQID" }),
  });

  socket.emit("message", {
    data: JSON.stringify({
      type: "error",
      code: "usage_limit",
      message: "Provider-specific text must not reach the user.",
    }),
  });

  assert.deepEqual(client.snapshot(), {
    state: "stopped",
    sessionId: null,
    protocolVersion: null,
    queuedAudioChunks: 0,
    terminalReason: "usage_limit",
    pendingCapabilityCallId: null,
    pendingConfirmationId: null,
    publishedRevision: -1,
  });
  assert.ok(cancelled >= 1);
  assert.deepEqual(events.at(-1), {
    type: "error",
    code: "voice_service_unavailable",
    message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    reason: "usage_limit",
    terminal: true,
  });
  assert.equal(
    VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    "Voice service is currently unavailable. Please try again later.",
  );
});

test("failed admission is terminal and retry requires a fresh client session", async () => {
  for (const [code, reason] of [
    ["voice_disabled", "disabled"],
    ["usage_limit", "usage_limit"],
    ["provider_unavailable", "provider"],
    ["admission_failed", "provider"],
  ]) {
    const failed = createRealtimeRelayClient({
      origin: "https://amble.example",
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({
          ok: false,
          error: { code, message: "Internal policy detail" },
        }),
      }),
      WebSocketImpl: RelaySocketFixture,
    });
    await assert.rejects(
      failed.admit({ disclosureAccepted: true }),
      (error) =>
        error.code === code &&
        error.message === VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    );
    assert.equal(failed.snapshot().state, "stopped", code);
    assert.equal(failed.snapshot().terminalReason, reason, code);
    await assert.rejects(
      failed.admit({ disclosureAccepted: true }),
      (error) => error.code === "session_active",
    );
  }

  const retry = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async () => relayAdmission({ sessionId: "session-retry" }),
    WebSocketImpl: RelaySocketFixture,
  });
  await retry.admit({ disclosureAccepted: true });
  const socket = retry.connect();
  socket.open();
  assert.equal(retry.snapshot().state, "connecting");
  socket.emit("message", {
    data: JSON.stringify({ type: "session.state", state: "listening" }),
  });
  assert.equal(retry.snapshot().state, "listening");
  assert.equal(retry.snapshot().sessionId, "session-retry");
});
