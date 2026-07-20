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
      protocolVersion: "1.0",
      streamPath: "/api/voice/sessions/session-1/stream",
      expiresAt: "2026-07-18T12:05:00.000Z",
      limits: { maxSessionSeconds: 300, idleSeconds: 60, maxResponses: 6 },
      ...overrides,
    },
  }),
});

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
