import assert from "node:assert/strict";
import test from "node:test";

import {
  RealtimeRelayClientError,
  createRealtimeRelayClient,
} from "../activity-scenes/assistant/realtime-relay-client.js";

class SocketFixture {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    SocketFixture.instances.push(this);
  }
  addEventListener(type, listener) {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
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
    this.emit("close");
  }
}

const admissionResponse = (overrides = {}) => ({
  ok: true,
  json: async () => ({
    ok: true,
    data: {
      sessionId: "session-1",
      protocolVersion: "1.1",
      streamPath: "/api/voice/sessions/session-1/stream",
      expiresAt: "2026-07-18T12:05:00.000Z",
      limits: { maxSessionSeconds: 300, idleSeconds: 60, maxResponses: 6 },
      ...overrides,
    },
  }),
});

async function connectedClient(options = {}) {
  const events = [];
  const client = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async () => admissionResponse(),
    WebSocketImpl: SocketFixture,
    onEvent: (event) => events.push(event),
    ...options,
  });
  await client.admit({ disclosureAccepted: true });
  const socket = client.connect();
  socket.open();
  return { client, events, socket };
}

const capabilityResult = ({
  capabilityId,
  kind,
  revision,
  changed = kind === "query" ? null : true,
  data = {},
}) => ({
  capabilityId,
  kind,
  status: "completed",
  changed,
  affectedTargetIds: [],
  contextRevision: revision,
  data,
  errorCode: null,
});

const receive = (socket, event) =>
  socket.emit("message", { data: JSON.stringify(event) });

test("relay admission and WebSocket stay same-origin and never reconnect", async () => {
  SocketFixture.instances = [];
  const requests = [];
  const client = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async (...args) => {
      requests.push(args);
      return admissionResponse();
    },
    WebSocketImpl: SocketFixture,
  });
  await assert.rejects(
    client.admit(),
    (error) => error.code === "disclosure_required",
  );
  await client.admit({ disclosureAccepted: true });
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    protocolVersion: "1.1",
    disclosureAccepted: true,
    capabilities: { audioInput: true, audioOutput: true, text: true },
  });
  const socket = client.connect();
  assert.equal(requests[0][0], "https://amble.example/api/voice/sessions");
  assert.equal(
    socket.url,
    "wss://amble.example/api/voice/sessions/session-1/stream",
  );
  socket.open();
  assert.equal(client.snapshot().state, "listening");
  assert.throws(
    client.connect,
    (error) => error.code === "reconnect_prohibited",
  );
});

test("relay admission rejects every non-1.1 response as a terminal mismatch", async () => {
  for (const protocolVersion of ["1.0", "1.2", "2.0", null]) {
    const client = createRealtimeRelayClient({
      origin: "https://amble.example",
      fetchImpl: async () => admissionResponse({ protocolVersion }),
      WebSocketImpl: SocketFixture,
    });
    await assert.rejects(
      client.admit({ disclosureAccepted: true }),
      (error) => error.code === "protocol_mismatch",
    );
    assert.equal(client.snapshot().state, "stopped");
    assert.equal(client.snapshot().terminalReason, "protocol");
    assert.throws(
      client.connect,
      (error) => error.code === "session_unavailable",
    );
  }
});

test("relay client sends only bounded protocol events and rejects external stream paths", async () => {
  const external = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async () =>
      admissionResponse({ streamPath: "https://attacker.example/stream" }),
    WebSocketImpl: SocketFixture,
  });
  await assert.rejects(
    external.admit({ disclosureAccepted: true }),
    (error) => error.code === "origin_rejected",
  );

  const client = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async () => admissionResponse(),
    WebSocketImpl: SocketFixture,
    limits: { maxMessageBytes: 512, maxAudioChunkBytes: 8, maxTextChars: 12 },
  });
  await client.admit({ disclosureAccepted: true });
  const socket = client.connect();
  socket.open();
  client.requestTurn("turn-1");
  client.appendAudio("turn-1", "AQIDBA==");
  client.commitAudio("turn-1");
  client.submitText("turn-2", "Can go?");
  assert.deepEqual(
    socket.sent.map(({ type }) => type),
    ["turn.request", "audio.append", "audio.commit", "text.submit"],
  );
  assert.throws(
    () => client.send({ type: "response.create" }),
    (error) => error.code === "browser_message_unapproved",
  );
  assert.throws(
    () => client.appendAudio("turn-1", "A".repeat(20)),
    (error) => error.code === "audio_chunk_too_large",
  );
  assert.throws(
    () => client.submitText("turn-2", "x".repeat(13)),
    (error) => error.code === "text_too_large",
  );
});

test("capability proposal, result, refreshed context, and completion stay ordered", async () => {
  const { client, events, socket } = await connectedClient();
  client.updateContext({ revision: 4 });

  const queryProposal = {
    type: "capability.proposed",
    callId: "call-query-1",
    capabilityId: "catalog.search",
    kind: "query",
    arguments: { query: "art", types: [], limit: 20 },
    contextRevision: 4,
  };
  receive(socket, queryProposal);
  const queryResult = capabilityResult({
    capabilityId: "catalog.search",
    kind: "query",
    revision: 4,
    data: {
      catalogRevision: "catalog:4",
      sources: [{ connectorId: "events", revision: "4" }],
      total: 1,
      truncated: false,
      items: [{ targetId: "event:1", type: "event", label: "Fixture" }],
      nextCursor: null,
    },
  });
  client.returnCapabilityResult({
    callId: queryProposal.callId,
    capabilityId: queryProposal.capabilityId,
    kind: queryProposal.kind,
    result: queryResult,
  });
  receive(socket, {
    type: "capability.completed",
    callId: queryProposal.callId,
    capabilityId: queryProposal.capabilityId,
    kind: queryProposal.kind,
    result: queryResult,
  });

  const commandProposal = {
    type: "capability.proposed",
    callId: "call-command-1",
    capabilityId: "map.zoomin",
    kind: "command",
    arguments: {},
    contextRevision: 4,
  };
  receive(socket, commandProposal);
  const commandResult = capabilityResult({
    capabilityId: "map.zoomin",
    kind: "command",
    revision: 5,
    data: { actionId: "map.zoomin", changed: true },
  });
  client.returnCapabilityResult({
    callId: commandProposal.callId,
    capabilityId: commandProposal.capabilityId,
    kind: commandProposal.kind,
    result: commandResult,
  });
  client.updateContext({
    revision: 5,
    availableCapabilityIds: ["map.zoomout"],
  });
  receive(socket, {
    type: "capability.completed",
    callId: commandProposal.callId,
    capabilityId: commandProposal.capabilityId,
    kind: commandProposal.kind,
    result: commandResult,
  });

  assert.deepEqual(
    socket.sent.map(({ type }) => type),
    [
      "context.update",
      "capability.result",
      "capability.result",
      "context.update",
    ],
  );
  assert.deepEqual(
    events
      .filter(({ type }) => type.startsWith("capability."))
      .map(({ type }) => type),
    [
      "capability.proposed",
      "capability.completed",
      "capability.proposed",
      "capability.completed",
    ],
  );
  assert.equal(client.snapshot().pendingCapabilityCallId, null);
  assert.equal(client.snapshot().publishedRevision, 5);
});

test("changed completion waits for refreshed context before it is emitted", async () => {
  const { client, events, socket } = await connectedClient();
  client.updateContext({ revision: 8 });
  const proposal = {
    type: "capability.proposed",
    callId: "call-command-stale",
    capabilityId: "map.zoomout",
    kind: "command",
    arguments: {},
    contextRevision: 8,
  };
  receive(socket, proposal);
  const result = capabilityResult({
    capabilityId: proposal.capabilityId,
    kind: proposal.kind,
    revision: 9,
    data: { actionId: proposal.capabilityId, changed: true },
  });
  client.returnCapabilityResult({
    callId: proposal.callId,
    capabilityId: proposal.capabilityId,
    kind: proposal.kind,
    result,
  });

  receive(socket, {
    type: "capability.completed",
    callId: proposal.callId,
    capabilityId: proposal.capabilityId,
    kind: proposal.kind,
    result,
  });
  assert.equal(
    events.some(({ type }) => type === "capability.completed"),
    false,
  );
  assert.equal(client.snapshot().pendingCapabilityCallId, proposal.callId);

  client.updateContext({
    revision: 9,
    availableCapabilityIds: ["map.zoomin"],
  });
  assert.equal(
    events.filter(({ type }) => type === "capability.completed").length,
    1,
  );
  assert.equal(client.snapshot().pendingCapabilityCallId, null);
  assert.equal(client.snapshot().state, "listening");
});

test("overlapping, mismatched, and out-of-order capability calls fail closed", async () => {
  for (const failure of ["overlap", "result_mismatch", "completion_first"]) {
    const { client, socket } = await connectedClient();
    client.updateContext({ revision: 2 });
    const proposal = {
      type: "capability.proposed",
      callId: `call-${failure}`,
      capabilityId: "app.inspect",
      kind: "query",
      arguments: {},
      contextRevision: 2,
    };
    receive(socket, proposal);

    assert.throws(
      () => {
        if (failure === "overlap")
          receive(socket, { ...proposal, callId: "call-overlap-second" });
        else if (failure === "result_mismatch")
          client.returnCapabilityResult({
            callId: proposal.callId,
            capabilityId: "catalog.get",
            kind: "query",
            result: capabilityResult({
              capabilityId: "catalog.get",
              kind: "query",
              revision: 2,
            }),
          });
        else
          receive(socket, {
            type: "capability.completed",
            callId: proposal.callId,
            capabilityId: proposal.capabilityId,
            kind: proposal.kind,
            result: capabilityResult({
              capabilityId: proposal.capabilityId,
              kind: proposal.kind,
              revision: 2,
            }),
          });
      },
      (error) => error.code === "protocol",
    );
    assert.equal(client.snapshot().state, "stopped", failure);
    assert.equal(client.snapshot().pendingCapabilityCallId, null, failure);
  }
});

test("confirmation result requires the same call, identity, fingerprint, and final user input", async () => {
  const { client, socket } = await connectedClient();
  client.updateContext({ revision: 6 });
  const proposal = {
    type: "capability.proposed",
    callId: "call-confirm-1",
    capabilityId: "navigation.openexternal",
    kind: "command",
    arguments: { targetId: "event:1" },
    contextRevision: 6,
  };
  receive(socket, proposal);
  client.requestConfirmation({
    callId: proposal.callId,
    capabilityId: proposal.capabilityId,
    confirmationId: "confirmation-1",
    fingerprint: "sha256:confirmation-1",
    targetId: "event:1",
    effectSummary: "Open the approved official event page.",
    expiresAt: "2026-07-26T10:00:25.000Z",
  });
  assert.equal(socket.sent.at(-1).type, "confirmation.pending");
  receive(socket, {
    type: "confirmation.required",
    callId: proposal.callId,
    confirmationId: "confirmation-1",
    fingerprint: "sha256:confirmation-1",
    targetId: "event:1",
    effectSummary: "Open the approved official event page.",
    expiresAt: "2026-07-26T10:00:25.000Z",
  });
  client.returnConfirmation({
    callId: proposal.callId,
    confirmationId: "confirmation-1",
    fingerprint: "sha256:confirmation-1",
    finalUserInput: true,
    decision: "accepted",
  });

  assert.deepEqual(socket.sent.at(-1), {
    type: "confirmation.result",
    callId: proposal.callId,
    confirmationId: "confirmation-1",
    fingerprint: "sha256:confirmation-1",
    finalUserInput: true,
    decision: "accepted",
  });
  assert.equal(client.snapshot().pendingConfirmationId, null);

  const invalid = await connectedClient();
  invalid.client.updateContext({ revision: 6 });
  receive(invalid.socket, proposal);
  invalid.client.requestConfirmation({
    callId: proposal.callId,
    capabilityId: proposal.capabilityId,
    confirmationId: "confirmation-1",
    fingerprint: "sha256:confirmation-1",
    targetId: "event:1",
    effectSummary: "Open the approved official event page.",
    expiresAt: "2026-07-26T10:00:25.000Z",
  });
  receive(invalid.socket, {
    type: "confirmation.required",
    callId: proposal.callId,
    confirmationId: "confirmation-1",
    fingerprint: "sha256:confirmation-1",
    targetId: "event:1",
    effectSummary: "Open the approved official event page.",
    expiresAt: "2026-07-26T10:00:25.000Z",
  });
  assert.throws(
    () =>
      invalid.client.returnConfirmation({
        callId: proposal.callId,
        confirmationId: "confirmation-1",
        fingerprint: "sha256:confirmation-1",
        finalUserInput: false,
        decision: "accepted",
      }),
    (error) => error.code === "protocol",
  );
  assert.equal(invalid.client.snapshot().state, "stopped");
});

test("audio playback is queued, cancellable, and invalid inbound events stop the session", async () => {
  const played = [];
  let cancelled = 0;
  const events = [];
  const client = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async () => admissionResponse(),
    WebSocketImpl: SocketFixture,
    audioPlayback: {
      play: async (audio) => {
        played.push(audio);
      },
      cancel: () => {
        cancelled += 1;
      },
    },
    onEvent: (event) => events.push(event.type),
  });
  await client.admit({ disclosureAccepted: true });
  const socket = client.connect();
  socket.open();
  socket.emit("message", {
    data: JSON.stringify({ type: "assistant.audio.delta", audio: "AQID" }),
  });
  socket.emit("message", {
    data: JSON.stringify({ type: "assistant.audio.delta", audio: "BAUG" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(played, ["AQID", "BAUG"]);
  client.cancelPlayback();
  assert.equal(cancelled, 1);
  assert.deepEqual(events, ["assistant.audio.delta", "assistant.audio.delta"]);

  assert.throws(
    () =>
      socket.emit("message", {
        data: JSON.stringify({ type: "provider.raw", secret: "no" }),
      }),
    (error) =>
      error instanceof RealtimeRelayClientError && error.code === "protocol",
  );
  assert.equal(client.snapshot().state, "stopped");
  assert.equal(client.snapshot().terminalReason, "protocol");
});

test("listening waits until queued assistant playback has actually finished", async () => {
  const events = [];
  let finishPlayback;
  const client = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async () => admissionResponse(),
    WebSocketImpl: SocketFixture,
    audioPlayback: {
      play: () =>
        new Promise((resolve) => {
          finishPlayback = resolve;
        }),
      cancel: () => finishPlayback?.(),
    },
    onEvent: (event) => events.push(`${event.type}:${event.state || ""}`),
  });
  await client.admit({ disclosureAccepted: true });
  const socket = client.connect();
  socket.open();
  socket.emit("message", {
    data: JSON.stringify({ type: "session.state", state: "speaking" }),
  });
  socket.emit("message", {
    data: JSON.stringify({ type: "assistant.audio.delta", audio: "AQID" }),
  });
  socket.emit("message", {
    data: JSON.stringify({ type: "session.state", state: "listening" }),
  });

  assert.notEqual(client.snapshot().state, "listening");
  assert.deepEqual(events, [
    "session.state:speaking",
    "assistant.audio.delta:",
  ]);
  finishPlayback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(client.snapshot().state, "listening");
  assert.deepEqual(events, [
    "session.state:speaking",
    "assistant.audio.delta:",
    "session.state:listening",
  ]);
});

test("terminal relay events clear pending capability, confirmation, context, and playback state", async () => {
  let finishPlayback;
  const { client, socket } = await connectedClient({
    audioPlayback: {
      play: () =>
        new Promise((resolve) => {
          finishPlayback = resolve;
        }),
      cancel: () => finishPlayback?.(),
    },
  });
  client.updateContext({ revision: 11 });
  receive(socket, {
    type: "capability.proposed",
    callId: "call-terminal",
    capabilityId: "navigation.openexternal",
    kind: "command",
    arguments: { targetId: "event:1" },
    contextRevision: 11,
  });
  client.requestConfirmation({
    callId: "call-terminal",
    capabilityId: "navigation.openexternal",
    confirmationId: "confirmation-terminal",
    fingerprint: "sha256:terminal",
    targetId: "event:1",
    effectSummary: "Open an approved official page.",
    expiresAt: "2026-07-26T10:00:25.000Z",
  });
  receive(socket, {
    type: "confirmation.required",
    callId: "call-terminal",
    confirmationId: "confirmation-terminal",
    fingerprint: "sha256:terminal",
    targetId: "event:1",
    effectSummary: "Open an approved official page.",
    expiresAt: "2026-07-26T10:00:25.000Z",
  });
  receive(socket, { type: "assistant.audio.delta", audio: "AQID" });
  receive(socket, { type: "session.stopped", reason: "duration" });

  assert.deepEqual(client.snapshot(), {
    state: "stopped",
    sessionId: null,
    protocolVersion: null,
    queuedAudioChunks: 0,
    terminalReason: "duration",
    pendingCapabilityCallId: null,
    pendingConfirmationId: null,
    publishedRevision: -1,
  });
});

test("explicit stop and pagehide send one terminal event and clear playback/session state", async () => {
  for (const reason of ["user", "pagehide"]) {
    const listeners = new Map();
    const page = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };
    const client = createRealtimeRelayClient({
      origin: "https://amble.example",
      fetchImpl: async () => admissionResponse(),
      WebSocketImpl: SocketFixture,
    });
    await client.admit({ disclosureAccepted: true });
    const socket = client.connect();
    socket.open();
    if (reason === "pagehide") {
      client.bindPageLifecycle(page);
      listeners.get("pagehide")();
    } else client.stop("user");
    assert.equal(socket.sent.at(-1).type, "session.stop");
    assert.equal(client.snapshot().state, "stopped");
    assert.equal(client.snapshot().sessionId, null);
    assert.equal(client.snapshot().queuedAudioChunks, 0);
    assert.equal(client.snapshot().terminalReason, reason);
  }
});
