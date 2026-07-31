const REDACTED = "[REDACTED]";

const normalizeKey = (key) =>
  String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const SECRET_KEYS = new Set([
  "apikey",
  "authorization",
  "auth",
  "bearer",
  "clientsecret",
  "cookie",
  "credentials",
  "credential",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "sessionid",
  "sessiontoken",
  "setcookie",
  "signature",
  "signingkey",
  "token",
  "idtoken",
  "webhooksecret",
  "xapikey",
  "accesstoken",
]);

const isBinary = (value) =>
  value instanceof ArrayBuffer || ArrayBuffer.isView(value);

const encodedAudioMetadata = (value) => {
  if (typeof value === "string") {
    const encodedChars = value.length;
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return Object.freeze({
      omitted: true,
      format: "encoded",
      byteCount: Math.max(0, Math.floor((encodedChars * 3) / 4) - padding),
    });
  }
  if (Array.isArray(value))
    return Object.freeze({
      omitted: true,
      format: "samples",
      byteCount: null,
    });
  const byteLength =
    value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
  return Object.freeze({
    omitted: true,
    format: "binary",
    byteCount: byteLength,
  });
};

const isAudioValue = ({ key, parentType, rootType, value }) => {
  if (typeof value !== "string" && !isBinary(value) && !Array.isArray(value))
    return false;
  const normalizedKey = normalizeKey(key);
  if (
    normalizedKey === "audio" ||
    normalizedKey === "audiodata" ||
    normalizedKey === "audiopayload"
  )
    return true;
  return (
    normalizedKey === "delta" &&
    [parentType, rootType].some((type) =>
      /^(?:response\.)?(?:output_)?audio\.delta$/.test(String(type)),
    )
  );
};

const redactSecretText = (value, redactValues) => {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return REDACTED;
  let sanitized = value;
  for (const redactValue of redactValues) {
    if (typeof redactValue === "string" && redactValue)
      sanitized = sanitized.split(redactValue).join(REDACTED);
  }
  return sanitized
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(
      /\b(api[_-]?key|authorization|cookie|password|secret|token)\s*[:=]\s*["']?[^"',;\s}]+/gi,
      (_match, label) => `${label}=${REDACTED}`,
    );
};

export function sanitizeRealtimeContent(value, { redactValues = [] } = {}) {
  const seen = new WeakSet();
  const rootType =
    value && typeof value === "object" && typeof value.type === "string"
      ? value.type
      : "";

  const visit = (candidate, key = "", parentType = rootType) => {
    if (SECRET_KEYS.has(normalizeKey(key))) return REDACTED;
    if (isAudioValue({ key, parentType, rootType, value: candidate }))
      return encodedAudioMetadata(candidate);
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          return JSON.stringify(visit(JSON.parse(candidate), key, parentType));
        } catch {}
      }
      return redactSecretText(candidate, redactValues);
    }
    if (
      candidate === null ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    )
      return candidate;
    if (typeof candidate === "bigint") return candidate.toString();
    if (typeof candidate === "undefined") return null;
    if (isBinary(candidate)) return encodedAudioMetadata(candidate);
    if (typeof candidate !== "object") return String(candidate);
    if (seen.has(candidate)) return "[Circular]";
    seen.add(candidate);
    const nextParentType =
      typeof candidate.type === "string" ? candidate.type : parentType;
    if (Array.isArray(candidate))
      return candidate.map((item) => visit(item, key, nextParentType));
    return Object.fromEntries(
      Object.entries(candidate).map(([childKey, childValue]) => [
        childKey,
        visit(childValue, childKey, nextParentType),
      ]),
    );
  };

  return visit(value);
}

export function createRealtimeContentDebugRecord({
  sessionIdHash,
  rawSessionId = null,
  direction,
  payload,
  occurredAt = new Date(),
}) {
  if (
    typeof sessionIdHash !== "string" ||
    !sessionIdHash ||
    ![
      "browser_to_relay",
      "relay_to_browser",
      "provider_to_relay",
      "relay_to_provider",
    ].includes(direction)
  )
    throw new TypeError("Realtime content diagnostic metadata is invalid");
  const eventType =
    payload && typeof payload === "object" && typeof payload.type === "string"
      ? payload.type.slice(0, 128)
      : "unknown";
  return Object.freeze({
    schemaVersion: "1.0",
    event: "voice.content_debug",
    sessionIdHash,
    occurredAt: occurredAt.toISOString(),
    direction,
    eventType,
    payload: sanitizeRealtimeContent(payload, {
      redactValues: rawSessionId ? [rawSessionId] : [],
    }),
  });
}
