#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import {
  auditEventDates,
  DATE_QUALITY_POLICY_VERSION,
} from "./lib/event-pipeline/date-quality-audit.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function defaultRunId() {
  return readJson(join(root, "data/approved-snapshot.json")).snapshotId;
}

function resolveRun(input) {
  const value = input ?? defaultRunId();
  const direct = resolve(value);
  return existsSync(direct)
    ? direct
    : join(root, "outputs/event-pipeline", value);
}

const runRoot = resolveRun(option("--run"));
const eventsPath = option("--events")
  ? resolve(option("--events"))
  : join(runRoot, "normalized/events.json");
if (!existsSync(eventsPath))
  throw new Error(
    `Normalized event artifact not found: ${eventsPath}. Pass --run <run-id-or-directory> or --events <file>.`,
  );

const artifact = readJson(eventsPath);
const records = Array.isArray(artifact) ? artifact : artifact.records;
if (!Array.isArray(records))
  throw new Error(
    "The event artifact must be an array or contain a records array.",
  );

let run = {};
const runPath = join(runRoot, "run.json");
if (existsSync(runPath)) run = readJson(runPath);
const asOf =
  option("--as-of") ??
  run.window?.start ??
  run.createdAt ??
  new Date().toISOString();
const futureHorizonYears = Number(option("--future-years") ?? 3);
const maximumDurationDays = Number(option("--maximum-duration-days") ?? 730);
if (!Number.isFinite(futureHorizonYears) || futureHorizonYears <= 0)
  throw new Error("--future-years must be a positive number");
if (!Number.isFinite(maximumDurationDays) || maximumDurationDays <= 0)
  throw new Error("--maximum-duration-days must be a positive number");

const audit = auditEventDates(records, {
  asOf,
  futureHorizonYears,
  maximumDurationDays,
});
const report = {
  schemaVersion: "1.0",
  createdAt: new Date().toISOString(),
  runId: run.runId ?? artifact.runId ?? null,
  eventsPath,
  policy: {
    version: DATE_QUALITY_POLICY_VERSION,
    asOf,
    futureHorizonYears,
    maximumDurationDays,
  },
  counts: audit.counts,
  byReason: audit.byReason,
  bySource: audit.bySource,
  examplesByReason: audit.examplesByReason,
};

const output = option("--output");
if (output) {
  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify({ ...report, assessments: audit.assessments }, null, 2)}\n`,
  );
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
