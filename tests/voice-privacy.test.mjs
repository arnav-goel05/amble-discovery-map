import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createAudioController } from "../activity-scenes/assistant/audio-controller.js";
import {
  createConversationSession,
  reconcileTranscriptItem,
  stopConversationSession,
  transitionConversationSession,
} from "../activity-scenes/assistant/conversation-model.js";
import { createRealtimeRelayClient } from "../activity-scenes/assistant/realtime-relay-client.js";

const privateModules = [
  "activity-scenes/assistant/audio-controller.js",
  "activity-scenes/assistant/conversation-model.js",
  "activity-scenes/assistant/realtime-relay-client.js",
];

test("voice client modules contain no storage, cache, analytics, or logging sink", () => {
  for (const file of privateModules) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /\b(?:localStorage|sessionStorage|indexedDB|CacheStorage|sendBeacon|console\.(?:log|info|warn|error|debug)|analytics|telemetry)\b/i,
      `${file} must keep session content memory-only`,
    );
  }
});

test("audio chunks are forwarded without entering controller snapshots or retained queues", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  let forwarded = null;
  const track = {
    readyState: "live",
    addEventListener() {},
    removeEventListener() {},
    stop() {
      this.readyState = "ended";
    },
  };
  const controller = createAudioController({
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    onChunk: (chunk) => {
      forwarded = chunk;
    },
  });
  await controller.start({ disclosureAccepted: true });
  controller.setVadState("speech_started");
  controller.appendChunk(bytes);
  assert.equal(forwarded, bytes);
  assert.doesNotMatch(
    JSON.stringify(controller.snapshot()),
    /AQIDBA|1,2,3,4|audio|chunk/i,
  );
  controller.stop("user");
  forwarded = null;
  assert.equal(controller.snapshot().activeTrackCount, 0);
});

test("terminal conversation cleanup removes transcript, context, intent, exact location, and confirmation", () => {
  let session = createConversationSession({ sessionId: "private-session" });
  session = transitionConversationSession(session, "disclosure");
  session = transitionConversationSession(session, "connecting");
  session = transitionConversationSession(session, "listening");
  session = reconcileTranscriptItem(session, {
    type: "transcript.final",
    itemId: "private-item",
    text: "lah, meet near Raffles Place MRT",
  });
  session = Object.freeze({
    ...session,
    intent: { freeTextSummary: "quiet near me" },
    interfaceContext: { revision: 3, visibleTargets: ["candidate:one"] },
    exactLocation: { coordinates: [103.851, 1.284] },
    pendingConfirmationId: "private-confirmation",
  });
  const stopped = stopConversationSession(session, "pagehide");
  assert.doesNotMatch(
    JSON.stringify(stopped),
    /Raffles|quiet near me|103\.851|private-confirmation|candidate:one/,
  );
});

test("relay client uses only supplied transport and playback dependencies", async () => {
  const fetchCalls = [];
  class Socket {
    constructor() {
      this.readyState = 1;
    }
    addEventListener() {}
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  const client = createRealtimeRelayClient({
    origin: "https://amble.example",
    fetchImpl: async (...args) => {
      fetchCalls.push(args);
      return {
        ok: true,
        json: async () => ({
          data: {
            sessionId: "opaque",
            protocolVersion: "1.0",
            streamPath: "/api/voice/sessions/opaque/stream",
          },
        }),
      };
    },
    WebSocketImpl: Socket,
  });
  await client.admit({ disclosureAccepted: true });
  client.connect();
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0][1].credentials, "same-origin");
  assert.equal(client.snapshot().queuedAudioChunks, 0);
  assert.doesNotMatch(
    JSON.stringify(client.snapshot()),
    /transcript|coordinates|location|context|AQID/i,
  );
});
