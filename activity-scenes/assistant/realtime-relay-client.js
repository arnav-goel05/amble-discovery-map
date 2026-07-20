const OUTBOUND_TYPES = new Set([
  "turn.request",
  "audio.append",
  "audio.commit",
  "text.submit",
  "action.result",
  "confirmation.result",
  "response.cancel",
  "context.update",
  "session.stop",
]);
const INBOUND_TYPES = new Set([
  "session.state",
  "turn.ready",
  "transcript.delta",
  "transcript.final",
  "assistant.audio.delta",
  "assistant.audio.done",
  "assistant.text.delta",
  "assistant.text.done",
  "action.proposed",
  "confirmation.required",
  "action.completed",
  "error",
  "session.stopped",
]);

export class RealtimeRelayClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RealtimeRelayClientError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new RealtimeRelayClientError(code, message);
};
const encodedBytes = (value) => new TextEncoder().encode(value).byteLength;
const audioBytes = (value) =>
  typeof value === "string"
    ? Math.floor((value.replace(/=+$/, "").length * 3) / 4)
    : -1;

export const DEFAULT_RELAY_CLIENT_LIMITS = Object.freeze({
  maxMessageBytes: 64 * 1_024,
  maxAudioChunkBytes: 64 * 1_024,
  maxTextChars: 2_000,
});

export function createRealtimeRelayClient({
  origin = globalThis.location?.origin,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  audioPlayback = null,
  onEvent = null,
  onStateChange = null,
  limits = {},
} = {}) {
  if (!origin) throw new TypeError("Application origin is required");
  const bounds = Object.freeze({ ...DEFAULT_RELAY_CLIENT_LIMITS, ...limits });
  let state = "idle";
  let admission = null;
  let socket = null;
  let connectAttempted = false;
  let terminalReason = null;
  let playbackQueue = [];
  let playbackRunning = false;
  let playbackGeneration = 0;
  let pendingListeningEvent = null;
  let lifecycleTarget = null;
  let pagehideHandler = null;

  const snapshot = () =>
    Object.freeze({
      state,
      sessionId: admission?.sessionId || null,
      protocolVersion: admission?.protocolVersion || null,
      queuedAudioChunks: playbackQueue.length,
      terminalReason,
    });
  const setState = (next) => {
    state = next;
    onStateChange?.(snapshot());
  };
  const sameOriginUrl = (value, { websocket = false } = {}) => {
    const url = new URL(value, origin);
    const expected = new URL(origin);
    if (url.origin !== expected.origin)
      fail("origin_rejected", "Relay destination must be same-origin");
    if (websocket)
      url.protocol = expected.protocol === "https:" ? "wss:" : "ws:";
    return url;
  };
  const emit = (event) => onEvent?.(structuredClone(event));

  const releasePendingListening = () => {
    if (
      !pendingListeningEvent ||
      playbackRunning ||
      playbackQueue.length
    )
      return false;
    const event = pendingListeningEvent;
    pendingListeningEvent = null;
    setState("listening");
    emit(event);
    return true;
  };

  const cancelPlayback = () => {
    playbackGeneration += 1;
    playbackQueue = [];
    audioPlayback?.cancel?.();
    releasePendingListening();
    return snapshot();
  };
  const drainPlayback = async () => {
    if (playbackRunning || !audioPlayback?.play) return;
    playbackRunning = true;
    const generation = playbackGeneration;
    try {
      while (generation === playbackGeneration && playbackQueue.length) {
        const chunk = playbackQueue.shift();
        await audioPlayback.play(chunk);
      }
    } finally {
      playbackRunning = false;
      if (playbackQueue.length) void drainPlayback();
      else releasePendingListening();
    }
  };
  const queueAudio = (audio) => {
    const bytes = audioBytes(audio);
    if (bytes < 0 || bytes > bounds.maxAudioChunkBytes)
      fail("protocol", "Relay audio chunk exceeds its bound");
    if (!audioPlayback?.play) return;
    playbackQueue.push(audio);
    void drainPlayback();
  };

  const terminal = (reason) => {
    if (state === "stopped") return snapshot();
    pendingListeningEvent = null;
    cancelPlayback();
    terminalReason = reason;
    admission = null;
    socket = null;
    setState("stopped");
    return snapshot();
  };

  const protocolStop = () => {
    const activeSocket = socket;
    terminal("protocol");
    activeSocket?.close?.(1002, "protocol");
  };

  const receive = (raw) => {
    const text = typeof raw === "string" ? raw : raw?.data;
    if (
      typeof text !== "string" ||
      encodedBytes(text) > bounds.maxMessageBytes
    ) {
      protocolStop();
      fail("protocol", "Relay message exceeds its bound");
    }
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      protocolStop();
      fail("protocol", "Relay message is invalid JSON");
    }
    if (!INBOUND_TYPES.has(event?.type)) {
      protocolStop();
      fail("protocol", "Relay event type is not allowed");
    }
    if (event.type === "assistant.audio.delta") queueAudio(event.audio);
    let deferred = false;
    if (event.type === "session.state" && typeof event.state === "string") {
      if (
        event.state === "listening" &&
        (playbackRunning || playbackQueue.length)
      ) {
        pendingListeningEvent = structuredClone(event);
        deferred = true;
      } else {
        pendingListeningEvent = null;
        setState(event.state);
      }
    }
    if (event.type === "session.stopped") terminal(event.reason);
    if (!deferred) emit(event);
    return event;
  };

  const send = (message) => {
    if (!OUTBOUND_TYPES.has(message?.type))
      fail(
        "browser_message_unapproved",
        "Browser relay event type is not allowed",
      );
    const serialized = JSON.stringify(message);
    if (encodedBytes(serialized) > bounds.maxMessageBytes)
      fail(
        "browser_message_too_large",
        "Browser relay event exceeds its bound",
      );
    if (!socket || (socket.readyState !== undefined && socket.readyState !== 1))
      fail("socket_unavailable", "Relay socket is unavailable");
    socket.send(serialized);
    return message;
  };

  const admit = async ({
    disclosureAccepted = false,
    capabilities = { audioInput: true, audioOutput: true, text: true },
  } = {}) => {
    if (state !== "idle")
      fail("session_active", "Relay session admission has already started");
    if (disclosureAccepted !== true)
      fail("disclosure_required", "Voice disclosure must be accepted first");
    if (typeof fetchImpl !== "function")
      fail("network", "Relay admission is unavailable");
    setState("connecting");
    const url = sameOriginUrl("/api/voice/sessions");
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: "1.0",
          disclosureAccepted: true,
          capabilities,
        }),
      });
    } catch {
      terminal("network");
      fail("network", "Voice relay could not connect");
    }
    const payload = await response.json().catch(() => null);
    if (
      !response.ok ||
      !payload?.data?.sessionId ||
      payload.data.protocolVersion !== "1.0"
    ) {
      terminal(
        response.ok
          ? "protocol"
          : payload?.error?.code === "usage_limit"
            ? "usage_limit"
            : "provider",
      );
      fail(
        payload?.error?.code || "provider_unavailable",
        payload?.error?.message || "Voice relay admission failed",
      );
    }
    sameOriginUrl(payload.data.streamPath);
    admission = structuredClone(payload.data);
    return snapshot();
  };

  const connect = () => {
    if (!admission || state === "stopped")
      fail("session_unavailable", "Relay session is unavailable");
    if (connectAttempted)
      fail(
        "reconnect_prohibited",
        "Relay reconnect is prohibited; start a new session",
      );
    if (typeof WebSocketImpl !== "function")
      fail("network", "WebSocket is unavailable");
    connectAttempted = true;
    const url = sameOriginUrl(admission.streamPath, { websocket: true });
    socket = new WebSocketImpl(url.href);
    socket.addEventListener?.("open", () => setState("listening"));
    socket.addEventListener?.("message", receive);
    socket.addEventListener?.("error", () => terminal("network"));
    socket.addEventListener?.("close", () => {
      if (state !== "stopped" && state !== "stopping") terminal("network");
    });
    return socket;
  };

  const stop = (reason = "user") => {
    if (state === "stopped") return snapshot();
    setState("stopping");
    if (
      socket &&
      (socket.readyState === undefined || socket.readyState === 1)
    ) {
      try {
        send({ type: "session.stop" });
      } catch {
        // Cleanup remains terminal even when the socket closes between the state change and send.
      }
    }
    socket?.close?.(1000, reason);
    return terminal(reason);
  };

  return Object.freeze({
    admit,
    connect,
    send,
    receive,
    stop,
    cancelPlayback,
    snapshot,
    requestTurn: (turnId) => send({ type: "turn.request", turnId }),
    appendAudio: (turnId, audio) => {
      if (audioBytes(audio) > bounds.maxAudioChunkBytes)
        fail("audio_chunk_too_large", "Audio chunk exceeds its bound");
      return send({ type: "audio.append", turnId, audio });
    },
    commitAudio: (turnId) => send({ type: "audio.commit", turnId }),
    submitText: (turnId, text) => {
      if (typeof text !== "string" || text.length > bounds.maxTextChars)
        fail("text_too_large", "Text input exceeds its bound");
      return send({ type: "text.submit", turnId, text });
    },
    returnActionResult: (value) => send({ type: "action.result", ...value }),
    returnConfirmation: (value) =>
      send({ type: "confirmation.result", ...value }),
    cancelResponse: () => send({ type: "response.cancel" }),
    updateContext: (context) => send({ type: "context.update", context }),
    bindPageLifecycle(target = globalThis.window) {
      if (!target?.addEventListener || lifecycleTarget) return () => {};
      lifecycleTarget = target;
      pagehideHandler = () => stop("pagehide");
      lifecycleTarget.addEventListener("pagehide", pagehideHandler, {
        once: true,
      });
      return () => {
        lifecycleTarget?.removeEventListener?.("pagehide", pagehideHandler);
        lifecycleTarget = null;
        pagehideHandler = null;
      };
    },
  });
}
