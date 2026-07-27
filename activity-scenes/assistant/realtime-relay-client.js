const OUTBOUND_TYPES = new Set([
  "turn.request",
  "audio.append",
  "audio.commit",
  "text.submit",
  "capability.result",
  "confirmation.pending",
  "confirmation.result",
  "deterministic.result",
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
  "capability.proposed",
  "confirmation.required",
  "capability.completed",
  "error",
  "session.stopped",
]);

export const VOICE_SERVICE_UNAVAILABLE_MESSAGE =
  "Voice service is currently unavailable. Please try again later.";

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
const identifier = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const RESULT_STATUSES = new Set([
  "completed",
  "empty",
  "unavailable",
  "failed",
  "confirmation_required",
]);
const RESULT_ERRORS = new Set([
  null,
  "invalid_arguments",
  "stale_context",
  "unknown_target",
  "unavailable",
  "confirmation_required",
  "execution_failed",
  "result_invalid",
]);

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
  let pendingCapability = null;
  let pendingConfirmation = null;
  let pendingConfirmationRequest = null;
  let publishedContextRevision = -1;

  const snapshot = () =>
    Object.freeze({
      state,
      sessionId: admission?.sessionId || null,
      protocolVersion: admission?.protocolVersion || null,
      queuedAudioChunks: playbackQueue.length,
      terminalReason,
      pendingCapabilityCallId: pendingCapability?.callId ?? null,
      pendingConfirmationId: pendingConfirmation?.confirmationId ?? null,
      publishedRevision: publishedContextRevision,
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
    if (!pendingListeningEvent || playbackRunning || playbackQueue.length)
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
    lifecycleTarget?.removeEventListener?.("pagehide", pagehideHandler);
    lifecycleTarget = null;
    pagehideHandler = null;
    pendingCapability = null;
    pendingConfirmation = null;
    pendingConfirmationRequest = null;
    publishedContextRevision = -1;
    terminalReason = reason;
    admission = null;
    socket = null;
    setState("stopped");
    return snapshot();
  };
  const unavailableReason = (code) => {
    if (code === "voice_disabled") return "disabled";
    if (code === "usage_limit") return "usage_limit";
    if (code === "protocol_mismatch" || code === "invalid_request")
      return "protocol";
    if (code === "network") return "network";
    return "provider";
  };
  const terminateUnavailable = (reason) => {
    const activeSocket = socket;
    terminal(reason);
    activeSocket?.close?.(1011, reason);
    const event = Object.freeze({
      type: "error",
      code: "voice_service_unavailable",
      message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
      reason,
      terminal: true,
    });
    emit(event);
    return event;
  };

  const protocolStop = () => {
    const activeSocket = socket;
    terminal("protocol");
    activeSocket?.close?.(4002, "protocol");
  };
  const protocolFail = (message) => {
    protocolStop();
    fail("protocol", message);
  };

  const validateResultEnvelope = (result, expected) => {
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      result.capabilityId !== expected.capabilityId ||
      result.kind !== expected.kind ||
      !RESULT_STATUSES.has(result.status) ||
      !Array.isArray(result.affectedTargetIds) ||
      result.affectedTargetIds.length > 20 ||
      new Set(result.affectedTargetIds).size !==
        result.affectedTargetIds.length ||
      !Number.isSafeInteger(result.contextRevision) ||
      result.contextRevision < 0 ||
      !RESULT_ERRORS.has(result.errorCode) ||
      (result.data !== null &&
        (typeof result.data !== "object" || Array.isArray(result.data))) ||
      (expected.kind === "query"
        ? result.changed !== null
        : typeof result.changed !== "boolean") ||
      (result.changed === true &&
        result.contextRevision <= expected.contextRevision) ||
      (result.changed !== true &&
        result.contextRevision < expected.contextRevision)
    )
      protocolFail("Capability result violates its proposal");
    return result;
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
    let deferred = false;
    if (event.type === "capability.proposed") {
      if (
        pendingCapability ||
        !identifier(event.callId) ||
        !CAPABILITY_ID.test(event.capabilityId || "") ||
        !["query", "command"].includes(event.kind) ||
        !event.arguments ||
        typeof event.arguments !== "object" ||
        Array.isArray(event.arguments) ||
        !Number.isSafeInteger(event.contextRevision) ||
        event.contextRevision < 0
      )
        protocolFail("Capability proposal is invalid or overlaps a call");
      pendingCapability = {
        callId: event.callId,
        capabilityId: event.capabilityId,
        kind: event.kind,
        contextRevision: event.contextRevision,
        returnedResult: null,
      };
    }
    if (event.type === "confirmation.required") {
      if (
        !pendingCapability ||
        pendingConfirmation ||
        !pendingConfirmationRequest ||
        event.callId !== pendingCapability.callId ||
        event.callId !== pendingConfirmationRequest.callId ||
        event.confirmationId !== pendingConfirmationRequest.confirmationId ||
        event.fingerprint !== pendingConfirmationRequest.fingerprint ||
        (event.targetId ?? null) !== pendingConfirmationRequest.targetId ||
        event.effectSummary !== pendingConfirmationRequest.effectSummary ||
        event.expiresAt !== pendingConfirmationRequest.expiresAt ||
        !identifier(event.confirmationId) ||
        typeof event.fingerprint !== "string" ||
        !event.fingerprint ||
        event.fingerprint.length > 256 ||
        typeof event.effectSummary !== "string" ||
        !event.effectSummary ||
        event.effectSummary.length > 240 ||
        typeof event.expiresAt !== "string"
      )
        protocolFail("Confirmation identity is invalid");
      pendingConfirmation = {
        callId: event.callId,
        confirmationId: event.confirmationId,
        fingerprint: event.fingerprint,
      };
      pendingConfirmationRequest = null;
    }
    if (event.type === "capability.completed") {
      if (
        !pendingCapability ||
        !pendingCapability.returnedResult ||
        event.callId !== pendingCapability.callId ||
        event.capabilityId !== pendingCapability.capabilityId ||
        event.kind !== pendingCapability.kind
      )
        protocolFail("Capability completion is out of order");
      validateResultEnvelope(event.result, pendingCapability);
      if (
        JSON.stringify(event.result) !==
        JSON.stringify(pendingCapability.returnedResult)
      )
        protocolFail("Capability completion result does not match");
      if (
        event.result.changed === true &&
        publishedContextRevision < event.result.contextRevision
      ) {
        pendingCapability.deferredCompletion = structuredClone(event);
        deferred = true;
      } else {
        pendingCapability = null;
        pendingConfirmation = null;
        pendingConfirmationRequest = null;
      }
    }
    if (event.type === "error")
      return terminateUnavailable(unavailableReason(event.code));
    if (event.type === "assistant.audio.delta") queueAudio(event.audio);
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
          protocolVersion: "1.1",
          disclosureAccepted: true,
          capabilities,
        }),
      });
    } catch {
      terminal("network");
      fail("network", VOICE_SERVICE_UNAVAILABLE_MESSAGE);
    }
    const payload = await response.json().catch(() => null);
    const protocolMismatch =
      response.ok &&
      payload?.data?.sessionId &&
      payload.data.protocolVersion !== "1.1";
    if (
      !response.ok ||
      !payload?.data?.sessionId ||
      payload.data.protocolVersion !== "1.1"
    ) {
      terminal(
        response.ok ? "protocol" : unavailableReason(payload?.error?.code),
      );
      fail(
        protocolMismatch
          ? "protocol_mismatch"
          : (payload?.error?.code ?? "provider_unavailable"),
        protocolMismatch
          ? "Voice relay protocol version does not match"
          : VOICE_SERVICE_UNAVAILABLE_MESSAGE,
      );
    }
    try {
      sameOriginUrl(payload.data.streamPath);
    } catch (error) {
      terminal("protocol");
      throw error;
    }
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
    if (typeof WebSocketImpl !== "function") {
      terminal("network");
      fail("network", VOICE_SERVICE_UNAVAILABLE_MESSAGE);
    }
    connectAttempted = true;
    const url = sameOriginUrl(admission.streamPath, { websocket: true });
    socket = new WebSocketImpl(url.href);
    socket.addEventListener?.("open", () => setState("listening"));
    socket.addEventListener?.("message", receive);
    socket.addEventListener?.("error", () => {
      if (state !== "stopped") terminateUnavailable("network");
    });
    socket.addEventListener?.("close", () => {
      if (state !== "stopped" && state !== "stopping")
        terminateUnavailable("network");
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

  const returnCapabilityResult = (value) => {
    if (
      !pendingCapability ||
      value?.callId !== pendingCapability.callId ||
      value.capabilityId !== pendingCapability.capabilityId ||
      value.kind !== pendingCapability.kind ||
      pendingCapability.returnedResult
    )
      protocolFail("Capability result does not match the pending call");
    validateResultEnvelope(value.result, pendingCapability);
    pendingCapability.returnedResult = structuredClone(value.result);
    return send({ type: "capability.result", ...value });
  };

  const returnConfirmation = (value) => {
    const expected = pendingConfirmation ?? pendingConfirmationRequest;
    if (
      !expected ||
      value?.callId !== expected.callId ||
      value.confirmationId !== expected.confirmationId ||
      value.fingerprint !== expected.fingerprint ||
      value.finalUserInput !== true ||
      !["accepted", "rejected"].includes(value.decision) ||
      (!pendingConfirmation && value.decision !== "rejected")
    )
      protocolFail("Confirmation result does not match the pending call");
    pendingConfirmation = null;
    pendingConfirmationRequest = null;
    return send({ type: "confirmation.result", ...value });
  };

  const returnDeterministicResult = (value) => {
    if (
      !CAPABILITY_ID.test(value?.capabilityId || "") ||
      !["query", "command"].includes(value?.kind)
    )
      protocolFail("Deterministic result identity is invalid");
    validateResultEnvelope(value.result, value);
    return send({ type: "deterministic.result", ...value });
  };

  const requestConfirmation = (value) => {
    if (
      !pendingCapability ||
      pendingConfirmation ||
      pendingConfirmationRequest ||
      value?.callId !== pendingCapability.callId ||
      value.capabilityId !== pendingCapability.capabilityId ||
      !identifier(value.confirmationId) ||
      typeof value.fingerprint !== "string" ||
      !value.fingerprint ||
      typeof value.effectSummary !== "string" ||
      !value.effectSummary ||
      typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.expiresAt))
    )
      protocolFail("Pending confirmation does not match the pending call");
    pendingConfirmationRequest = {
      callId: value.callId,
      confirmationId: value.confirmationId,
      fingerprint: value.fingerprint,
      targetId: value.targetId ?? null,
      effectSummary: value.effectSummary,
      expiresAt: value.expiresAt,
    };
    return send({ type: "confirmation.pending", ...value });
  };

  const updateContext = (context) => {
    if (
      !context ||
      typeof context !== "object" ||
      !Number.isSafeInteger(context.revision) ||
      context.revision < 0 ||
      context.revision < publishedContextRevision
    )
      protocolFail("Interface context revision is invalid");
    publishedContextRevision = context.revision;
    const message = send({ type: "context.update", context });
    const completion = pendingCapability?.deferredCompletion;
    if (
      completion &&
      publishedContextRevision >= completion.result.contextRevision
    ) {
      pendingCapability = null;
      pendingConfirmation = null;
      emit(completion);
    }
    return message;
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
    returnCapabilityResult,
    requestConfirmation,
    returnConfirmation,
    returnDeterministicResult,
    cancelResponse: () => send({ type: "response.cancel" }),
    updateContext,
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
