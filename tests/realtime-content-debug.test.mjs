import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

import {
  createRealtimeContentDebugRecord,
  sanitizeRealtimeContent,
} from "../scripts/lib/realtime-content-debug.mjs";
import { validateBrowserMessage } from "../scripts/lib/realtime-relay-protocol.mjs";

const require = createRequire(import.meta.url);
const {
  createLocalRelayOptions,
} = require("../scripts/realtime-voice-api-plugin.cjs");

const baseRelayOptions = (environment, runtimeMode = "unconfigured") => ({
  policy: {},
  repository: {},
  environment,
  runtimeMode,
  providerConnector() {},
});

test("content diagnostics retain permitted protocol content and recursively redact secrets and audio", () => {
  const sanitized = sanitizeRealtimeContent({
    type: "response.output_audio.delta",
    transcript: "Show live music near Bugis",
    prompt: "Use approved events only",
    tool: {
      arguments: JSON.stringify({
        query: "jazz",
        authorization: "Bearer nested-secret",
      }),
      result: { title: "Late Night Jazz", cookie: "session-cookie" },
    },
    api_key: "sk-secret",
    max_output_tokens: 4096,
    delta: "UklGRgAAAA",
    nested: {
      accessToken: "access-secret",
      signing_key: "signing-secret",
      sessionId: "raw-session-id",
      ordinary: "visible",
    },
    error: "Authorization: Bearer error-token; api_key=sk-1234567890",
  });

  assert.equal(sanitized.transcript, "Show live music near Bugis");
  assert.equal(sanitized.prompt, "Use approved events only");
  assert.deepEqual(JSON.parse(sanitized.tool.arguments), {
    query: "jazz",
    authorization: "[REDACTED]",
  });
  assert.equal(sanitized.tool.result.title, "Late Night Jazz");
  assert.equal(sanitized.max_output_tokens, 4096);
  assert.equal(sanitized.nested.ordinary, "visible");
  assert.equal(sanitized.api_key, "[REDACTED]");
  assert.equal(sanitized.tool.result.cookie, "[REDACTED]");
  assert.equal(sanitized.nested.accessToken, "[REDACTED]");
  assert.equal(sanitized.nested.signing_key, "[REDACTED]");
  assert.equal(sanitized.nested.sessionId, "[REDACTED]");
  assert.deepEqual(sanitized.delta, {
    omitted: true,
    format: "encoded",
    byteCount: 7,
  });
  assert.doesNotMatch(
    JSON.stringify(sanitized),
    /sk-secret|nested-secret|session-cookie|access-secret|signing-secret|raw-session-id|error-token|sk-1234567890|UklGRgAAAA/,
  );
});

test("content diagnostic records use one-way session correlation and sanitized payloads", () => {
  const record = createRealtimeContentDebugRecord({
    sessionIdHash: "sha256:fixture",
    rawSessionId: "raw-session-fixture",
    direction: "browser_to_relay",
    payload: {
      type: "audio.append",
      turnId: "turn-1",
      audio: "AAAA",
      password: "password-secret",
      note: "provider failed for raw-session-fixture",
    },
    occurredAt: new Date("2026-07-29T09:00:00.000Z"),
  });

  assert.deepEqual(Object.keys(record), [
    "schemaVersion",
    "event",
    "sessionIdHash",
    "occurredAt",
    "direction",
    "eventType",
    "payload",
  ]);
  assert.equal(record.sessionIdHash, "sha256:fixture");
  assert.equal(record.eventType, "audio.append");
  assert.equal(record.payload.turnId, "turn-1");
  assert.equal(record.payload.password, "[REDACTED]");
  assert.equal(record.payload.note, "provider failed for [REDACTED]");
  assert.equal(record.payload.audio.omitted, true);
});

test("audio transcript deltas remain visible while audio deltas and sample arrays are omitted", () => {
  assert.equal(
    sanitizeRealtimeContent({
      type: "response.output_audio_transcript.delta",
      delta: "Here are events near you",
    }).delta,
    "Here are events near you",
  );
  assert.equal(
    sanitizeRealtimeContent({
      type: "response.output_audio.delta",
      delta: "AAAA",
    }).delta.omitted,
    true,
  );
  assert.deepEqual(
    sanitizeRealtimeContent({
      type: "input_audio_buffer.append",
      audio: [1, -1, 2, -2],
    }).audio,
    { omitted: true, format: "samples", byteCount: null },
  );
});

test("browser protocol cannot activate content diagnostics", () => {
  assert.throws(() =>
    validateBrowserMessage({
      type: "content_debug.enable",
      enabled: true,
    }),
  );
  assert.throws(() =>
    validateBrowserMessage({
      type: "text.submit",
      turnId: "turn-1",
      text: "hello",
      contentDebug: true,
    }),
  );
});

test("local relay injects process logging only for explicit development activation", () => {
  const active = createLocalRelayOptions(
    baseRelayOptions(
      {
        NODE_ENV: "development",
        REALTIME_CONTENT_DEBUG: "true",
      },
      "development",
    ),
  );
  assert.equal(typeof active.contentDebugLogger, "function");

  for (const environment of [
    {},
    { NODE_ENV: "development" },
    { NODE_ENV: "production", REALTIME_CONTENT_DEBUG: "true" },
    { NODE_ENV: "preview", REALTIME_CONTENT_DEBUG: "true" },
  ]) {
    const options = createLocalRelayOptions(
      baseRelayOptions(environment, "development"),
    );
    assert.equal("contentDebugLogger" in options, false);
  }
  const preview = createLocalRelayOptions(
    baseRelayOptions(
      {
        NODE_ENV: "development",
        REALTIME_CONTENT_DEBUG: "true",
      },
      "preview",
    ),
  );
  assert.equal("contentDebugLogger" in preview, false);
});

test("content debug implementation has no persistence or remote transport and Worker has no activation surface", () => {
  const debugSource = fs.readFileSync(
    "scripts/lib/realtime-content-debug.mjs",
    "utf8",
  );
  assert.doesNotMatch(
    debugSource,
    /\b(?:writeFile|appendFile|createWriteStream|localStorage|sessionStorage|indexedDB|CacheStorage|caches\.|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon)\b/,
  );

  const workerSource = fs.readFileSync(
    "cloudflare/cloud-native-worker.mjs",
    "utf8",
  );
  assert.doesNotMatch(
    workerSource,
    /REALTIME_CONTENT_DEBUG|contentDebugLogger|voice\.content_debug/,
  );
});
