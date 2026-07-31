"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUDIT_PREFIX = "voice-audit-";
const AUDIT_SUFFIX = ".jsonl";
const STATIC_EVENT_TYPES = new Set(["session.update"]);

const fingerprint = (value) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;

const auditFiles = (fsImpl, directory) =>
  fsImpl
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(AUDIT_PREFIX) &&
        entry.name.endsWith(AUDIT_SUFFIX),
    )
    .map((entry) => {
      const filePath = path.join(directory, entry.name);
      return {
        name: entry.name,
        path: filePath,
        mtimeMs: fsImpl.statSync(filePath).mtimeMs,
      };
    })
    .sort(
      (left, right) =>
        left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name),
    );

function createRealtimeContentAuditLogger({
  root,
  now = () => new Date(),
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = DEFAULT_MAX_FILES,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  fsImpl = fs,
  warningLogger = (record) => console.warn(JSON.stringify(record)),
} = {}) {
  if (
    typeof root !== "string" ||
    !root ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 512 ||
    !Number.isSafeInteger(maxFiles) ||
    maxFiles < 1 ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs <= 0
  )
    throw new TypeError("Realtime content audit configuration is invalid");

  const directory = path.join(root, "outputs", "realtime-content-audit");
  const staticFingerprints = new Set();
  let currentFilePath = null;
  let currentBytes = 0;
  let sequence = 0;
  let unavailable = false;
  let warned = false;

  const warn = (operation) => {
    if (warned) return;
    warned = true;
    try {
      warningLogger({
        event: "voice.content_audit_warning",
        code: "local_audit_unavailable",
        operation,
      });
    } catch {}
  };

  const guard = (operation, task) => {
    if (unavailable) return false;
    try {
      task();
      return true;
    } catch {
      unavailable = true;
      warn(operation);
      return false;
    }
  };

  const cleanup = ({ reserveSlot = false } = {}) => {
    const cutoff = now().getTime() - maxAgeMs;
    const files = auditFiles(fsImpl, directory);
    for (const file of files) {
      if (file.mtimeMs < cutoff) fsImpl.unlinkSync(file.path);
    }
    const remaining = auditFiles(fsImpl, directory);
    const targetCount = reserveSlot ? Math.max(0, maxFiles - 1) : maxFiles;
    while (remaining.length > targetCount) {
      const oldest = remaining.shift();
      if (oldest.path === currentFilePath) {
        remaining.push(oldest);
        if (remaining.every((file) => file.path === currentFilePath)) break;
        continue;
      }
      fsImpl.unlinkSync(oldest.path);
    }
  };

  const initialize = () =>
    guard("initialize", () => {
      fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fsImpl.chmodSync(directory, 0o700);
      cleanup();
    });

  const openNextFile = () => {
    let opened = false;
    guard("rotate", () => {
      currentFilePath = null;
      currentBytes = 0;
      cleanup({ reserveSlot: true });
      const stamp = now()
        .toISOString()
        .replace(/[-:.TZ]/g, "")
        .slice(0, 17);
      let candidate;
      do {
        candidate = path.join(
          directory,
          `${AUDIT_PREFIX}${stamp}-${process.pid}-${String(sequence++).padStart(3, "0")}${AUDIT_SUFFIX}`,
        );
      } while (fsImpl.existsSync(candidate));
      fsImpl.writeFileSync(candidate, "", { mode: 0o600, flag: "wx" });
      fsImpl.chmodSync(candidate, 0o600);
      currentFilePath = candidate;
      currentBytes = 0;
      opened = true;
    });
    return opened;
  };

  const boundedLine = (record) => {
    const serialized = JSON.stringify(record);
    let line = `${serialized}\n`;
    if (Buffer.byteLength(line) < maxBytes) return line;
    const marker = {
      schemaVersion: "1.0",
      event: "voice.content_debug.oversize",
      sessionIdHash:
        typeof record?.sessionIdHash === "string"
          ? record.sessionIdHash
          : "unavailable",
      occurredAt:
        typeof record?.occurredAt === "string"
          ? record.occurredAt
          : now().toISOString(),
      direction:
        typeof record?.direction === "string" ? record.direction : "unknown",
      eventType:
        typeof record?.eventType === "string" ? record.eventType : "unknown",
      originalByteCount: Buffer.byteLength(line),
      fingerprint: fingerprint(serialized),
    };
    line = `${JSON.stringify(marker)}\n`;
    return Buffer.byteLength(line) < maxBytes ? line : null;
  };

  const compact = (record) => {
    if (!STATIC_EVENT_TYPES.has(record?.eventType)) return record;
    const serialized = JSON.stringify({
      direction: record.direction,
      eventType: record.eventType,
      payload: record.payload,
    });
    const contentFingerprint = fingerprint(serialized);
    if (!staticFingerprints.has(contentFingerprint)) {
      staticFingerprints.add(contentFingerprint);
      return record;
    }
    const tools = Array.isArray(record?.payload?.session?.tools)
      ? record.payload.session.tools
      : [];
    return {
      schemaVersion: "1.0",
      event: "voice.content_debug.repeat",
      sessionIdHash: record.sessionIdHash,
      occurredAt: record.occurredAt,
      direction: record.direction,
      eventType: record.eventType,
      fingerprint: contentFingerprint,
      toolCount: tools.length,
      toolNames: tools
        .map((tool) => tool?.name)
        .filter((name) => typeof name === "string")
        .slice(0, 128),
    };
  };

  initialize();

  const logger = (record) => {
    if (unavailable) return;
    const line = boundedLine(compact(record));
    if (!line) {
      unavailable = true;
      return warn("serialize");
    }
    const lineBytes = Buffer.byteLength(line);
    if (!currentFilePath || currentBytes + lineBytes >= maxBytes) {
      if (!openNextFile()) return;
    }
    guard("append", () => {
      fsImpl.appendFileSync(currentFilePath, line, {
        encoding: "utf8",
        mode: 0o600,
      });
      currentBytes += lineBytes;
    });
  };

  Object.defineProperty(logger, "directory", {
    value: directory,
    enumerable: true,
  });
  return logger;
}

module.exports = {
  createRealtimeContentAuditLogger,
};
