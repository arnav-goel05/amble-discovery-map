import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const {
  createRealtimeContentAuditLogger,
} = require("../scripts/lib/realtime-content-audit.cjs");

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

test("persistent audit requires every local development gate", () => {
  const auditRecords = [];
  const processRecords = [];
  const active = createLocalRelayOptions({
    ...baseRelayOptions(
      {
        NODE_ENV: "development",
        REALTIME_CONTENT_DEBUG: "true",
        REALTIME_CONTENT_AUDIT: "true",
      },
      "development",
    ),
    contentDebugLogger: (record) => processRecords.push(record),
    contentAuditLogger: (record) => auditRecords.push(record),
  });
  active.contentDebugLogger({ event: "voice.content_debug" });
  assert.equal(processRecords.length, 1);
  assert.equal(auditRecords.length, 1);

  for (const [runtimeMode, environment] of [
    ["development", { NODE_ENV: "development" }],
    [
      "development",
      { NODE_ENV: "development", REALTIME_CONTENT_AUDIT: "true" },
    ],
    [
      "development",
      { NODE_ENV: "development", REALTIME_CONTENT_DEBUG: "true" },
    ],
    [
      "preview",
      {
        NODE_ENV: "development",
        REALTIME_CONTENT_DEBUG: "true",
        REALTIME_CONTENT_AUDIT: "true",
      },
    ],
    [
      "development",
      {
        NODE_ENV: "production",
        REALTIME_CONTENT_DEBUG: "true",
        REALTIME_CONTENT_AUDIT: "true",
      },
    ],
  ]) {
    const ignoredAudit = [];
    const options = createLocalRelayOptions({
      ...baseRelayOptions(environment, runtimeMode),
      contentAuditLogger: (record) => ignoredAudit.push(record),
    });
    options.contentDebugLogger?.({ event: "voice.content_debug" });
    assert.equal(ignoredAudit.length, 0);
  }
});

test("persistent audit writes sanitized owner-only JSONL and compacts repeated static payloads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amble-audit-"));
  const warnings = [];
  const logger = createRealtimeContentAuditLogger({
    root,
    now: () => new Date("2026-07-30T06:00:00.000Z"),
    warningLogger: (warning) => warnings.push(warning),
  });
  const record = createRealtimeContentDebugRecord({
    sessionIdHash: "sha256:audit",
    rawSessionId: "raw-session-audit",
    direction: "relay_to_provider",
    payload: {
      type: "session.update",
      session: {
        instructions: "Use approved events",
        tools: [{ name: "catalog.search" }],
        authorization: "Bearer audit-secret",
      },
      audio: "AAAA",
    },
    occurredAt: new Date("2026-07-30T06:00:00.000Z"),
  });
  logger(record);
  for (let index = 1; index < 100; index += 1)
    logger({
      ...record,
      occurredAt: new Date(
        Date.parse(record.occurredAt) + index * 1_000,
      ).toISOString(),
    });

  const directory = path.join(root, "outputs/realtime-content-audit");
  const files = fs.readdirSync(directory);
  assert.equal(files.length, 1);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  const filePath = path.join(directory, files[0]);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  const bytes = fs.readFileSync(filePath, "utf8");
  const lines = bytes.trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 100);
  assert.equal(lines[0].event, "voice.content_debug");
  assert.equal(
    lines.slice(1).every((line) => line.event === "voice.content_debug.repeat"),
    true,
  );
  assert.match(lines[1].fingerprint, /^sha256:/);
  assert.doesNotMatch(
    bytes,
    /audit-secret|raw-session-audit|AAAA|Bearer audit-secret/,
  );
  assert.equal(warnings.length, 0);
});

test("persistent audit rotates, removes expired files, caps file count, and bounds oversized records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amble-audit-"));
  const directory = path.join(root, "outputs/realtime-content-audit");
  fs.mkdirSync(directory, { recursive: true });
  const oldPath = path.join(directory, "voice-audit-old.jsonl");
  fs.writeFileSync(oldPath, "{}\n");
  const oldDate = new Date("2026-07-01T00:00:00.000Z");
  fs.utimesSync(oldPath, oldDate, oldDate);

  let tick = 0;
  const logger = createRealtimeContentAuditLogger({
    root,
    now: () => new Date(1785391200000 + tick++ * 1000),
    maxBytes: 900,
    maxFiles: 3,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  });
  for (let index = 0; index < 12; index += 1)
    logger({
      schemaVersion: "1.0",
      event: "voice.content_debug",
      sessionIdHash: "sha256:rotation",
      occurredAt: new Date(1785391200000 + index * 1000).toISOString(),
      direction: "provider_to_relay",
      eventType: `response.event.${index}`,
      payload: { text: "x".repeat(index === 11 ? 2_000 : 240) },
    });

  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"));
  assert.ok(files.length <= 3);
  assert.equal(files.includes("voice-audit-old.jsonl"), false);
  for (const name of files)
    assert.ok(fs.statSync(path.join(directory, name)).size < 900);
  const bytes = files
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("");
  assert.match(bytes, /voice\.content_debug\.oversize/);
});

test("persistent audit I/O failure is non-throwing and emits a bounded safe warning", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amble-audit-"));
  fs.writeFileSync(path.join(root, "outputs"), "not-a-directory");
  const warnings = [];
  const logger = createRealtimeContentAuditLogger({
    root,
    warningLogger: (warning) => warnings.push(warning),
  });
  assert.doesNotThrow(() =>
    logger({
      event: "voice.content_debug",
      payload: { transcript: "private words" },
    }),
  );
  assert.equal(warnings.length, 1);
  assert.deepEqual(Object.keys(warnings[0]).sort(), [
    "code",
    "event",
    "operation",
  ]);
  assert.doesNotMatch(JSON.stringify(warnings[0]), /private words/);
});

test("persistent audit records provider transcripts but never synthesizes one from classification", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amble-audit-"));
  const logger = createRealtimeContentAuditLogger({ root });
  logger(
    createRealtimeContentDebugRecord({
      sessionIdHash: "sha256:native-audio",
      direction: "browser_to_relay",
      payload: {
        type: "audio.commit",
        turnId: "turn-native",
        audio: "AAAA",
      },
    }),
  );
  logger(
    createRealtimeContentDebugRecord({
      sessionIdHash: "sha256:native-audio",
      direction: "provider_to_relay",
      payload: {
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "input-item-001",
        delta: "events near",
      },
    }),
  );
  logger(
    createRealtimeContentDebugRecord({
      sessionIdHash: "sha256:native-audio",
      direction: "provider_to_relay",
      payload: {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "input-item-001",
        transcript: "events near Marina Bay",
      },
    }),
  );
  logger(
    createRealtimeContentDebugRecord({
      sessionIdHash: "sha256:native-audio",
      direction: "provider_to_relay",
      payload: {
        type: "response.function_call_arguments.done",
        name: "voice__classifyrequest",
        arguments: JSON.stringify({ domain: "event", eventQuery: null }),
      },
    }),
  );
  logger(
    createRealtimeContentDebugRecord({
      sessionIdHash: "sha256:native-audio",
      direction: "provider_to_relay",
      payload: {
        type: "response.output_audio_transcript.done",
        transcript: "Here are three events.",
      },
    }),
  );
  const directory = path.join(root, "outputs/realtime-content-audit");
  const bytes = fs.readFileSync(
    path.join(directory, fs.readdirSync(directory)[0]),
    "utf8",
  );
  assert.match(bytes, /events near/);
  assert.match(bytes, /events near Marina Bay/);
  assert.match(bytes, /Here are three events/);
  assert.match(bytes, /input_audio_transcription/);
  assert.doesNotMatch(bytes, /userTranscript|"utterance"|AAAA/);
});

test("persistent audit rotation and append failures remain non-throwing", () => {
  for (const failure of ["rotate", "append"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "amble-audit-"));
    const warnings = [];
    const fsImpl = Object.create(fs);
    if (failure === "rotate")
      fsImpl.writeFileSync = () => {
        throw new Error("fixture");
      };
    else
      fsImpl.appendFileSync = () => {
        throw new Error("fixture");
      };
    const logger = createRealtimeContentAuditLogger({
      root,
      fsImpl,
      warningLogger: (warning) => warnings.push(warning),
    });
    assert.doesNotThrow(() =>
      logger({
        event: "voice.content_debug",
        eventType: "response.done",
        payload: { transcript: "private fixture" },
      }),
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].operation, failure);
    assert.doesNotMatch(JSON.stringify(warnings), /private fixture/);
  }
});

test("content debug Worker has no activation or persistence surface", () => {
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
    /REALTIME_CONTENT_(?:DEBUG|AUDIT)|content(?:Debug|Audit)Logger|voice\.content_debug/,
  );
});
