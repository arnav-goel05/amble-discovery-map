import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const SECRET_KEYS = /authorization|cookie|api[-_]?key|token|secret|password/i;
export const TRACE_REASON_CODES = new Set([
  "eligible_activity",
  "ordinary_attraction_admission",
  "pure_promotion",
  "online_only",
  "outside_sg",
  "expired",
  "anytime",
  "schedule_unverified",
  "direct",
  "direct_corroborated",
  "editorial_sufficient",
  "editorial_evidence_incomplete",
  "evidence_conflict",
  "building_approved",
  "secret_tba",
  "multiple_locations",
  "mobile_route",
  "broad_area",
  "geometry_unavailable",
  "location_conflict",
  "repeat",
  "merged",
  "distinct",
  "possible_duplicate_review",
  "identity_conflict_review",
  "carry_forward_stale",
  "hold_new",
  "source_incomplete",
  "source_unavailable",
  "release_validation_failed",
  "activation_failed",
]);
const redactUrl = (value) => {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()])
      if (SECRET_KEYS.test(key)) url.searchParams.set(key, "[REDACTED]");
    return url.href;
  } catch {
    return value;
  }
};
export function redactTraceValue(value, key = "") {
  if (SECRET_KEYS.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactTraceValue(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([name]) => !/rawBody|responseBody/i.test(name))
        .map(([name, item]) => [name, redactTraceValue(item, name)]),
    );
  if (typeof value === "string" && /^https?:/i.test(value))
    return redactUrl(value);
  return value;
}

export function validateTraceRecord(record) {
  for (const field of ["timestamp", "runId", "stage", "action", "outcome"])
    if (!record?.[field]) throw new Error(`Trace record requires ${field}`);
  if (Number.isNaN(Date.parse(record.timestamp)))
    throw new Error("Trace timestamp is invalid");
  if (
    record.durationMs != null &&
    (!Number.isFinite(record.durationMs) || record.durationMs < 0)
  )
    throw new Error("Trace duration must be non-negative");
  if (
    record.resumeDisposition &&
    !["new", "reused", "retried", "skipped"].includes(record.resumeDisposition)
  )
    throw new Error("Trace resume disposition is invalid");
  if (
    record.reasonCode &&
    !TRACE_REASON_CODES.has(record.reasonCode) &&
    !/^[a-z][a-z0-9_]{1,63}$/.test(record.reasonCode)
  )
    throw new Error("Trace reason code is invalid");
  return redactTraceValue(record);
}

export function createTraceWriter({
  path,
  runId,
  window,
  now = () => new Date().toISOString(),
}) {
  mkdirSync(dirname(path), { recursive: true });
  return {
    write(record) {
      const value = validateTraceRecord({
        schemaVersion: "1.0",
        timestamp: now(),
        runId,
        window,
        level: "info",
        ...record,
      });
      appendFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      return value;
    },
    read() {
      return readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map(JSON.parse);
    },
    finalize(statusPath, summary) {
      const temporary = `${statusPath}.tmp-${process.pid}`;
      mkdirSync(dirname(statusPath), { recursive: true });
      writeFileSync(
        temporary,
        `${JSON.stringify(redactTraceValue(summary), null, 2)}\n`,
      );
      renameSync(temporary, statusPath);
    },
  };
}
