const LIFECYCLE_INTENTS = new Set([
  "session.stop",
  "session.mute",
  "session.unmute",
  "session.interrupt",
]);
const PROTECTED_INTENTS = new Set([
  "session.consent",
  "session.disclosure",
  "session.confirm",
  "session.reject",
  "confirmation.accept",
  "confirmation.reject",
]);
const LOCAL_SOURCES = new Set(["browser_control", "user_utterance"]);
const PHRASES = new Map([
  ["stop voice", "session.stop"],
  ["stop listening", "session.stop"],
  ["end voice", "session.stop"],
  ["end voice session", "session.stop"],
  ["mute", "session.mute"],
  ["mute voice", "session.mute"],
  ["mute microphone", "session.mute"],
  ["unmute", "session.unmute"],
  ["unmute voice", "session.unmute"],
  ["resume voice", "session.unmute"],
  ["resume listening", "session.unmute"],
  ["interrupt", "session.interrupt"],
  ["interrupt voice", "session.interrupt"],
  ["stop talking", "session.interrupt"],
  ["be quiet", "session.interrupt"],
]);

export const SESSION_LIFECYCLE_INTENT_IDS = Object.freeze(
  [...LIFECYCLE_INTENTS].sort(),
);

export class SessionLifecycleRouterError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "SessionLifecycleRouterError";
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new SessionLifecycleRouterError(code, message, details);
};

function normalizePhrase(value) {
  if (typeof value !== "string" || value.length > 100) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

export function recognizeSessionLifecycleIntent(value) {
  const normalized = normalizePhrase(value);
  if (LIFECYCLE_INTENTS.has(normalized)) return normalized;
  return PHRASES.get(normalized) || null;
}

function validateConfiguration(configuration) {
  if (
    !configuration ||
    typeof configuration.snapshot !== "function" ||
    typeof configuration.stop !== "function" ||
    typeof configuration.setMuted !== "function" ||
    typeof configuration.interrupt !== "function"
  )
    fail(
      "lifecycle_owner_invalid",
      "Lifecycle routing requires snapshot, stop, setMuted, and interrupt owners",
    );
  for (const protectedName of [
    "consent",
    "confirm",
    "acceptConfirmation",
    "rejectConfirmation",
    "invokeModel",
  ])
    if (configuration[protectedName] !== undefined)
      fail(
        "protected_control_owner_forbidden",
        `Protected control ${protectedName} cannot be registered`,
      );
  return configuration;
}

function lifecycleState(snapshot) {
  const state = snapshot();
  if (
    !state ||
    typeof state !== "object" ||
    typeof state.active !== "boolean" ||
    typeof state.muted !== "boolean"
  )
    fail(
      "lifecycle_snapshot_invalid",
      "Lifecycle snapshot requires active and muted booleans",
    );
  return { active: state.active, muted: state.muted };
}

function resolveIntent(value) {
  const intentId =
    typeof value === "string"
      ? recognizeSessionLifecycleIntent(value)
      : recognizeSessionLifecycleIntent(value?.intentId);
  const requested =
    typeof value === "string" ? normalizePhrase(value) : value?.intentId;
  if (PROTECTED_INTENTS.has(requested))
    fail(
      "protected_control",
      "Consent and confirmation controls are browser-owned and not routable",
    );
  if (!intentId)
    fail(
      "lifecycle_intent_unknown",
      "Input is not a supported local lifecycle intent",
    );
  if (
    value &&
    typeof value === "object" &&
    (Array.isArray(value) ||
      Object.keys(value).some((field) => field !== "intentId"))
  )
    fail(
      "lifecycle_request_invalid",
      "Lifecycle requests accept only a local intent ID",
    );
  return intentId;
}

export function createSessionLifecycleRouter(configuration = {}) {
  const owners = validateConfiguration(configuration);
  let executionTail = Promise.resolve();

  const execute = async (intentId) => {
    const before = lifecycleState(owners.snapshot);
    let changed = false;
    if (intentId === "session.stop") {
      if (before.active) changed = (await owners.stop("user")) !== false;
    } else if (intentId === "session.mute") {
      if (before.active && !before.muted)
        changed = (await owners.setMuted(true)) !== false;
    } else if (intentId === "session.unmute") {
      if (before.active && before.muted)
        changed = (await owners.setMuted(false)) !== false;
    } else if (before.active) {
      changed = (await owners.interrupt()) !== false;
    }
    return Object.freeze({
      intentId,
      status: changed ? "routed" : "noop",
      changed,
      local: true,
    });
  };

  return Object.freeze({
    recognize: recognizeSessionLifecycleIntent,
    route(value, { source, inputStatus = "final" } = {}) {
      if (!LOCAL_SOURCES.has(source))
        return Promise.reject(
          new SessionLifecycleRouterError(
            "lifecycle_source_forbidden",
            "Lifecycle intents may originate only from protected browser controls or final user input",
          ),
        );
      if (source === "user_utterance" && inputStatus !== "final")
        return Promise.reject(
          new SessionLifecycleRouterError(
            "lifecycle_input_not_final",
            "User lifecycle intent must be final before routing",
          ),
        );
      let intentId;
      try {
        intentId = resolveIntent(value);
      } catch (error) {
        return Promise.reject(error);
      }
      const operation = () => execute(intentId);
      const result = executionTail.then(operation, operation);
      executionTail = result.catch(() => {});
      return result;
    },
  });
}
