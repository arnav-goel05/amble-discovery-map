const MAX_ADMISSION_BYTES = 64 * 1024;
const TERMINAL_REASONS = new Set([
  "user",
  "pagehide",
  "idle",
  "duration",
  "permission",
  "disabled",
  "usage_limit",
  "provider",
  "network",
  "protocol",
]);
const SERVER_OWNED_FIELDS = new Set([
  "model",
  "rateCardVersion",
  "instructions",
  "tools",
  "maxOutputTokens",
  "automaticResponseCreation",
  "providerEventType",
]);
const MESSAGE_FIELDS = Object.freeze({
  "turn.request": new Set(["type", "turnId"]),
  "audio.append": new Set(["type", "turnId", "audio"]),
  "audio.commit": new Set(["type", "turnId"]),
  "text.submit": new Set(["type", "turnId", "text"]),
  "action.result": new Set([
    "type",
    "callId",
    "actionId",
    "ok",
    "result",
    "error",
  ]),
  "confirmation.result": new Set([
    "type",
    "confirmationId",
    "fingerprint",
    "decision",
  ]),
  "response.cancel": new Set(["type"]),
  "context.update": new Set(["type", "context"]),
  "session.stop": new Set(["type"]),
});

export class RelayProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RelayProtocolError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new RelayProtocolError(code, message);
};
const byteLength = (value) => new TextEncoder().encode(value).byteLength;
const identifier = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);

export function validateSessionAdmission(input) {
  let requestOrigin;
  try {
    requestOrigin = new URL(input?.requestUrl).origin;
  } catch {
    fail("invalid_request", "Request URL is invalid");
  }
  if (input.origin !== requestOrigin)
    fail("origin_rejected", "Voice sessions require the application origin");
  if (
    String(input.contentType).split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    !Number.isSafeInteger(input.bodyBytes) ||
    input.bodyBytes < 0 ||
    input.bodyBytes > MAX_ADMISSION_BYTES
  ) {
    fail("invalid_request", "Voice session request is invalid");
  }
  if (input.environmentEnabled !== true || input.runtimeEnabled !== true)
    fail("voice_disabled", "Voice is disabled");
  if (input.providerPolicyValid !== true || input.rateCardValid !== true)
    fail("policy_mismatch", "Voice policy is unavailable");
  if (input.reservationAvailable !== true)
    fail("usage_limit", "Voice usage is unavailable");
  if (input.rateLimited === true)
    fail("rate_limited", "Too many voice sessions");
  const body = input.body;
  const capabilities = body?.capabilities;
  if (
    body?.protocolVersion !== "1.0" ||
    body.disclosureAccepted !== true ||
    !capabilities ||
    Object.keys(capabilities).some(
      (key) => !["audioInput", "audioOutput", "text"].includes(key),
    ) ||
    !["audioInput", "audioOutput", "text"].every(
      (key) => typeof capabilities[key] === "boolean",
    )
  ) {
    fail("invalid_request", "Voice disclosure and capabilities are required");
  }
  return {
    protocolVersion: "1.0",
    capabilities: {
      audioInput: capabilities.audioInput,
      audioOutput: capabilities.audioOutput,
      text: capabilities.text,
    },
  };
}

export function validateBrowserMessage(message, options = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    fail("browser_message_unapproved", "Browser message must be an object");
  const encoded = JSON.stringify(message);
  if (
    !Number.isSafeInteger(options.maxMessageBytes) ||
    byteLength(encoded) > options.maxMessageBytes
  )
    fail("browser_message_too_large", "Browser message exceeds its bound");
  const allowed = MESSAGE_FIELDS[message.type];
  if (!allowed)
    fail("browser_message_unapproved", "Browser message type is not approved");
  for (const field of Object.keys(message)) {
    if (SERVER_OWNED_FIELDS.has(field) || !allowed.has(field))
      fail(
        "browser_field_unapproved",
        `Browser field ${field} is not approved`,
      );
  }
  if (
    !["session.stop", "response.cancel"].includes(message.type) &&
    Object.keys(message).length < 2
  )
    fail("browser_message_unapproved", "Browser message is incomplete");
  if (
    ["turn.request", "audio.append", "audio.commit", "text.submit"].includes(
      message.type,
    ) &&
    !identifier(message.turnId)
  )
    fail("browser_message_unapproved", "Turn identity is invalid");
  if (
    ["audio.append", "audio.commit"].includes(message.type) &&
    message.turnId !== options.activeReservedTurnId
  )
    fail("turn_not_ready", "Audio turn is not reserved");
  if (
    message.type === "audio.append" &&
    (typeof message.audio !== "string" ||
      byteLength(message.audio) > options.maxAudioChunkBytes)
  )
    fail("audio_chunk_too_large", "Audio chunk exceeds its bound");
  if (
    message.type === "text.submit" &&
    (typeof message.text !== "string" ||
      !message.text.trim() ||
      message.text.length > options.maxTextChars)
  )
    fail("text_too_large", "Text exceeds its bound");
  if (message.type === "action.result") {
    if (
      !identifier(message.callId) ||
      !options.pendingCallIds?.has(message.callId)
    )
      fail("action_call_unmatched", "Action call is not pending");
    if (!identifier(message.actionId) || typeof message.ok !== "boolean")
      fail("browser_message_unapproved", "Action result is invalid");
  }
  if (message.type === "confirmation.result") {
    const pending = options.pendingConfirmation;
    if (
      !pending ||
      message.confirmationId !== pending.confirmationId ||
      message.fingerprint !== pending.fingerprint ||
      !["accepted", "rejected"].includes(message.decision)
    )
      fail("browser_message_unapproved", "Confirmation result is invalid");
  }
  if (message.type === "context.update") {
    const context = message.context;
    if (
      !context ||
      typeof context !== "object" ||
      !Number.isSafeInteger(context.revision) ||
      !Array.isArray(context.visibleTargets) ||
      context.visibleTargets.length > 100 ||
      !Array.isArray(context.availableActionIds) ||
      context.availableActionIds.length > 100
    )
      fail("browser_message_unapproved", "Interface context is invalid");
  }
  return structuredClone(message);
}

export function sanitizeProviderEvent(event) {
  if (!event || typeof event !== "object") return null;
  const transcriptTypes = {
    "conversation.item.input_audio_transcription.delta": "transcript.delta",
    "conversation.item.input_audio_transcription.completed": "transcript.final",
    "response.output_text.delta": "assistant.text.delta",
    "response.output_text.done": "assistant.text.done",
    "response.output_audio_transcript.delta": "assistant.text.delta",
    "response.output_audio_transcript.done": "assistant.text.done",
  };
  if (transcriptTypes[event.type]) {
    const text =
      typeof event.delta === "string"
        ? event.delta
        : (event.transcript ?? event.text);
    const itemId = event.item_id ?? event.itemId;
    if (!identifier(itemId) || typeof text !== "string") return null;
    return {
      browserEvent: {
        type: transcriptTypes[event.type],
        itemId,
        text: text.slice(0, 4_096),
      },
      trustedUsage: null,
    };
  }
  if (
    event.type === "response.output_audio.delta" &&
    typeof event.delta === "string"
  )
    return {
      browserEvent: { type: "assistant.audio.delta", audio: event.delta },
      trustedUsage: null,
    };
  if (event.type === "response.output_audio.done")
    return {
      browserEvent: { type: "assistant.audio.done" },
      trustedUsage: null,
    };
  if (event.type === "response.done")
    return {
      browserEvent: null,
      trustedUsage:
        event.response?.usage && typeof event.response.usage === "object"
          ? structuredClone(event.response.usage)
          : null,
    };
  return null;
}

export function cleanupRelaySession(session, reason = "protocol") {
  if (session?.state === "stopped" && session.terminalEvent) return session;
  const terminalReason = TERMINAL_REASONS.has(reason) ? reason : "protocol";
  try {
    session?.abortController?.abort();
  } catch {}
  try {
    session?.providerSocket?.close();
  } catch {}
  try {
    session?.browserSocket?.close();
  } catch {}
  clearTimeout(session?.idleTimer);
  clearTimeout(session?.durationTimer);
  if (session) {
    session.state = "stopped";
    session.terminalEvent = { type: "session.stopped", reason: terminalReason };
    session.transcriptItems = [];
    session.audioChunks = [];
    session.intent = null;
    session.exactLocation = null;
    session.interfaceContext = null;
    session.pendingConfirmation = null;
    session.pendingCallIds?.clear?.();
    session.openReservations = [];
    session.responseReservationId = null;
    session.inputReservationId = null;
    session.providerSocket = null;
    session.browserSocket = null;
    session.abortController = null;
    session.idleTimer = null;
    session.durationTimer = null;
  }
  return session;
}
