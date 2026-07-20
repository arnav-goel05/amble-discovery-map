const SPECIFICITY = new Set(["area", "place", "item"]);
const SESSION_STATES = new Set([
  "idle",
  "disclosure",
  "connecting",
  "listening",
  "processing",
  "speaking",
  "awaiting_confirmation",
  "degraded",
  "stopping",
  "stopped",
]);
const TRANSCRIPT_ROLES = new Set(["user", "assistant", "system"]);
const TRANSCRIPT_MODALITIES = new Set(["audio", "text"]);
const TRANSCRIPT_STATUSES = new Set(["partial", "final", "cancelled"]);
const TERMINAL_REASONS = new Set([
  "user",
  "pagehide",
  "idle",
  "duration",
  "response_limit",
  "permission",
  "disabled",
  "usage_limit",
  "provider",
  "network",
  "protocol",
]);
const TRANSITIONS = Object.freeze({
  idle: ["disclosure", "stopping"],
  disclosure: ["connecting", "degraded", "stopping"],
  connecting: ["listening", "degraded", "stopping"],
  listening: [
    "processing",
    "speaking",
    "awaiting_confirmation",
    "degraded",
    "stopping",
  ],
  processing: [
    "listening",
    "speaking",
    "awaiting_confirmation",
    "degraded",
    "stopping",
  ],
  speaking: [
    "listening",
    "processing",
    "awaiting_confirmation",
    "degraded",
    "stopping",
  ],
  awaiting_confirmation: ["listening", "processing", "degraded", "stopping"],
  degraded: ["connecting", "listening", "stopping"],
  stopping: ["stopped"],
  stopped: [],
});

export class ConversationModelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConversationModelError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ConversationModelError(code, message);
};
const timestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    fail("invalid_time", "Conversation timestamp is invalid");
  return date.toISOString();
};
const freezeSession = (session) => {
  const copy = structuredClone(session);
  for (const item of copy.transcriptItems || []) Object.freeze(item);
  Object.freeze(copy.transcriptItems);
  return Object.freeze(copy);
};

export const CONVERSATION_LIMITS = Object.freeze({
  maxSessionSeconds: 300,
  idleSeconds: 60,
  maxResponses: 6,
  maxTranscriptChars: 4_000,
});

export function createConversationSession({
  sessionId = null,
  protocolVersion = "1.0",
  now = Date.now(),
  limits = {},
} = {}) {
  const createdAt = timestamp(now);
  const normalizedLimits = { ...CONVERSATION_LIMITS, ...limits };
  for (const name of [
    "maxSessionSeconds",
    "idleSeconds",
    "maxResponses",
    "maxTranscriptChars",
  ]) {
    if (
      !Number.isSafeInteger(normalizedLimits[name]) ||
      normalizedLimits[name] <= 0
    ) {
      fail("invalid_limits", `Conversation limit ${name} is invalid`);
    }
  }
  return freezeSession({
    sessionId,
    protocolVersion,
    state: "idle",
    createdAt,
    lastActivityAt: createdAt,
    expiresAt: timestamp(
      new Date(createdAt).getTime() +
        normalizedLimits.maxSessionSeconds * 1_000,
    ),
    responseCount: 0,
    transcriptItems: [],
    intent: null,
    interfaceContext: null,
    exactLocation: null,
    contextRevision: 0,
    pendingConfirmationId: null,
    terminalReason: null,
    limits: normalizedLimits,
  });
}

export function transitionConversationSession(
  session,
  nextState,
  { now = Date.now() } = {},
) {
  if (!SESSION_STATES.has(session?.state) || !SESSION_STATES.has(nextState))
    fail("invalid_state", "Conversation state is invalid");
  if (session.state === nextState) return session;
  if (!TRANSITIONS[session.state].includes(nextState))
    fail(
      "invalid_transition",
      `Conversation cannot transition from ${session.state} to ${nextState}`,
    );
  return freezeSession({
    ...session,
    state: nextState,
    lastActivityAt: timestamp(now),
  });
}

export function touchConversationSession(session, { now = Date.now() } = {}) {
  if (session?.state === "stopped") return session;
  return freezeSession({ ...session, lastActivityAt: timestamp(now) });
}

function transcriptFields(event) {
  const type = String(event?.type || "");
  const assistant = type.startsWith("assistant.");
  const role = event?.role || (assistant ? "assistant" : "user");
  const modality =
    event?.modality || (type.startsWith("transcript.") ? "audio" : "text");
  const status =
    event?.status ||
    (type.endsWith(".final") || type.endsWith(".done")
      ? "final"
      : type.endsWith(".cancelled")
        ? "cancelled"
        : "partial");
  if (
    !event?.itemId ||
    !TRANSCRIPT_ROLES.has(role) ||
    !TRANSCRIPT_MODALITIES.has(modality) ||
    !TRANSCRIPT_STATUSES.has(status)
  ) {
    fail("invalid_transcript_item", "Transcript item is invalid");
  }
  return {
    itemId: event.itemId,
    role,
    modality,
    status,
    text: String(event.text || ""),
  };
}

export function reconcileTranscriptItem(
  session,
  event,
  { now = Date.now() } = {},
) {
  if (session?.state === "stopped")
    fail("session_stopped", "Stopped conversation content cannot change");
  const incoming = transcriptFields(event);
  if (incoming.text.length > session.limits.maxTranscriptChars)
    fail("transcript_too_large", "Transcript item exceeds its bound");
  const items = session.transcriptItems.map((item) => structuredClone(item));
  const index = items.findIndex(({ itemId }) => itemId === incoming.itemId);
  const existing = items[index];
  if (
    existing &&
    (existing.role !== incoming.role || existing.modality !== incoming.modality)
  ) {
    fail(
      "transcript_identity_conflict",
      "Transcript identity changed role or modality",
    );
  }
  if (existing?.status === "final" && incoming.status === "partial")
    return session;
  const createdAt = existing?.createdAt || timestamp(now);
  let text = incoming.text;
  if (existing && incoming.status === "partial") {
    text = incoming.text.startsWith(existing.text)
      ? incoming.text
      : `${existing.text}${incoming.text}`;
  }
  if (text.length > session.limits.maxTranscriptChars)
    fail("transcript_too_large", "Transcript item exceeds its bound");
  const item = { ...incoming, text, createdAt };
  if (index === -1) items.push(item);
  else items[index] = item;
  const becameFinalAssistant =
    incoming.role === "assistant" &&
    incoming.status === "final" &&
    existing?.status !== "final";
  const responseCount = session.responseCount + Number(becameFinalAssistant);
  if (responseCount > session.limits.maxResponses)
    fail("response_limit", "Conversation response limit is exhausted");
  return freezeSession({
    ...session,
    transcriptItems: items,
    responseCount,
    lastActivityAt: timestamp(now),
  });
}

export function conversationLimitReason(session, { now = Date.now() } = {}) {
  if (!session || session.state === "stopped")
    return session?.terminalReason || null;
  const current = new Date(timestamp(now)).getTime();
  if (current >= new Date(session.expiresAt).getTime()) return "duration";
  if (
    current - new Date(session.lastActivityAt).getTime() >=
    session.limits.idleSeconds * 1_000
  )
    return "idle";
  if (session.responseCount >= session.limits.maxResponses)
    return "response_limit";
  return null;
}

export function stopConversationSession(
  session,
  reason = "user",
  { now = Date.now() } = {},
) {
  if (!TERMINAL_REASONS.has(reason))
    fail("invalid_terminal_reason", "Conversation terminal reason is invalid");
  if (session?.state === "stopped") return session;
  let stopping =
    session.state === "stopping"
      ? session
      : transitionConversationSession(session, "stopping", { now });
  stopping = transitionConversationSession(stopping, "stopped", { now });
  return freezeSession({
    ...stopping,
    transcriptItems: [],
    intent: null,
    interfaceContext: null,
    exactLocation: null,
    pendingConfirmationId: null,
    terminalReason: reason,
  });
}

const normalizeList = (values = []) => [
  ...new Set(
    values.map((value) => String(value).trim().toLowerCase()).filter(Boolean),
  ),
];

function normalizeIntent(input, revision) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Discovery intent must be an object");
  const specificity = input.specificity ?? "area";
  if (!SPECIFICITY.has(specificity))
    throw new TypeError("Discovery specificity is invalid");
  return Object.freeze({
    revision,
    freeTextSummary: String(input.freeTextSummary ?? "")
      .trim()
      .slice(0, 500),
    interests: Object.freeze(normalizeList(input.interests)),
    exclusions: Object.freeze(normalizeList(input.exclusions)),
    timeWindow: input.timeWindow ?? null,
    priceRange: input.priceRange ?? null,
    crowdPreference: input.crowdPreference ?? null,
    transitConstraint: input.transitConstraint
      ? structuredClone(input.transitConstraint)
      : null,
    specificity,
  });
}

export function createDiscoveryIntent(input = {}) {
  return normalizeIntent(input, 0);
}

export function refineDiscoveryIntent(current, refinement = {}) {
  if (!current || !Number.isSafeInteger(current.revision))
    throw new TypeError("Current discovery intent is invalid");
  return normalizeIntent(
    {
      ...current,
      ...refinement,
      interests: [
        ...(current.interests || []),
        ...(refinement.interests || []),
      ],
      exclusions:
        refinement.exclusions === undefined
          ? current.exclusions
          : [...current.exclusions, ...refinement.exclusions],
    },
    current.revision + 1,
  );
}

export function discoveryNeedsClarification(intent) {
  return (
    !intent?.freeTextSummary &&
    !intent?.interests?.length &&
    !intent?.timeWindow &&
    !intent?.crowdPreference
  );
}
