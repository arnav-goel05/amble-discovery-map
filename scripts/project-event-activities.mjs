#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { projectEventActivities } from "./lib/event-pipeline/activity-projection.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const atomicJson = (path, value) => {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
};
const pointer = join(root, "data/approved-snapshot.json");
const requested = option("--run") ?? (existsSync(pointer) ? readJson(pointer).snapshotId : null);
if (!requested) throw new Error("Pass --run <run-id-or-directory>.");
const direct = resolve(requested);
const runDir = existsSync(direct) ? direct : join(root, "outputs/event-pipeline", requested);
const eventsPath = join(runDir, "normalized/events.json");
if (!existsSync(eventsPath)) throw new Error(`Normalized events not found: ${eventsPath}`);
const eventArtifact = readJson(eventsPath);
const runPath = join(runDir, "run.json");
const run = existsSync(runPath) ? readJson(runPath) : {};
const existingActivitiesPath = join(runDir, "normalized/activities.json");
const previousActivities = existsSync(existingActivitiesPath)
  ? readJson(existingActivitiesPath).records ?? []
  : [];
const before = performance.now();
const projected = projectEventActivities({
  events: eventArtifact.records ?? eventArtifact,
  previousActivities,
  runId: run.runId ?? eventArtifact.runId ?? requested,
  generatedAt: run.startedAt ?? run.createdAt ?? eventArtifact.createdAt ?? new Date().toISOString(),
});
const durationMs = Math.round((performance.now() - before) * 100) / 100;
atomicJson(join(runDir, "normalized/activities.json"), projected.activities);
atomicJson(join(runDir, "normalized/activity-grouping-reviews.json"), projected.reviews);
atomicJson(join(runDir, "normalized/activity-grouping-decisions.json"), projected.decisions);
process.stdout.write(`${JSON.stringify({
  status: "success",
  runId: projected.activities.runId,
  durationMs,
  counts: projected.activities.counts,
  externalRequests: 0,
  reconciliation: projected.decisions.counts,
  artifacts: [
    "normalized/activities.json",
    "normalized/activity-grouping-reviews.json",
    "normalized/activity-grouping-decisions.json",
  ],
}, null, 2)}\n`);
