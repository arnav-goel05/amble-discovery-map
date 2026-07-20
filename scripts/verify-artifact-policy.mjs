#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_PREFIXES = [
  "outputs/",
  "external-tools/",
  "tiles/",
  "public/poi-tiles/source/",
  "outputs/local-venue-index/",
  "outputs/event-pipeline/",
  "outputs/restaurant-pipeline/",
];
const RUNTIME_NAMES = [
  /\.lock$/,
  /\.tmp(?:-|$)/,
  /(?:^|\/)orchestrator-state\.json$/,
  /(?:^|\/)status\.(?:md|json)$/,
  /(?:^|\/)trace\.jsonl$/,
];
const APPROVED_REQUIRED = [
  "data/approved-snapshot.json",
  "data/provider-policy.json",
  "data/event-authority-registry.json",
  "data/venue-alias-registry.json",
  "data/snapshots/initial/manifest.json",
  "data/map-context-sources.json",
  "data/discovery-areas.geojson",
  "data/discovery-areas-manifest.json",
  "data/transit-context.geojson",
  "data/transit-context-manifest.json",
];
const APPROVED_MAP_ASSET =
  /^data\/(?:discovery-areas|transit-context)(?:-manifest)?\.(?:geojson|json)$/;
const APPROVED_FIXTURE = /^tests\/fixtures\/(?:voice|map-context)\//;

const lines = (value) => value.split("\0").filter(Boolean);
const git = (args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const isRuntime = (file) =>
  RUNTIME_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
  RUNTIME_NAMES.some((pattern) => pattern.test(file));

export function verifyArtifactPolicy({
  root = ROOT,
  tracked = lines(git(["ls-files", "-z"])),
  status = lines(
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ),
} = {}) {
  const presentTrackedRuntime = tracked.filter(
    (file) => isRuntime(file) && fs.existsSync(path.join(root, file)),
  );
  const changes = status
    .map((entry) => ({ code: entry.slice(0, 2), file: entry.slice(3) }))
    .filter(({ file }) => file);
  const statusPaths = changes.map(({ file }) => file);
  const presentRuntimeChanges = changes
    .filter(
      ({ code, file }) =>
        !code.includes("D") &&
        isRuntime(file) &&
        fs.existsSync(path.join(root, file)),
    )
    .map(({ file }) => file);
  const missingApproved = APPROVED_REQUIRED.filter(
    (file) => !fs.existsSync(path.join(root, file)),
  );
  const unclassifiedSnapshots = statusPaths.filter(
    (file) =>
      file.startsWith("data/snapshots/") &&
      !/\/(?:manifest|landmarks|pois|tileset|events)\.json$/.test(file),
  );
  const unclassifiedMapArtifacts = statusPaths.filter(
    (file) =>
      /(?:map-context|transit-context|discovery-areas)/.test(file) &&
      !APPROVED_MAP_ASSET.test(file) &&
      !APPROVED_FIXTURE.test(file) &&
      !file.startsWith("outputs/") &&
      !file.startsWith("scripts/") &&
      !file.startsWith("tests/") &&
      !file.startsWith("map-layers/") &&
      !file.startsWith("activity-scenes/") &&
      file !== "data/map-context-sources.json",
  );
  const violations = [
    ...presentTrackedRuntime.map((file) => ({
      code: "runtime_artifact_tracked",
      file,
    })),
    ...presentRuntimeChanges.map((file) => ({
      code: "runtime_artifact_present",
      file,
    })),
    ...missingApproved.map((file) => ({
      code: "approved_artifact_missing",
      file,
    })),
    ...unclassifiedSnapshots.map((file) => ({
      code: "snapshot_artifact_unclassified",
      file,
    })),
    ...unclassifiedMapArtifacts.map((file) => ({
      code: "map_artifact_unclassified",
      file,
    })),
  ];
  return {
    schemaVersion: "1.0",
    ok: violations.length === 0,
    approvedArtifacts: APPROVED_REQUIRED,
    approvedSnapshotArtifacts: ["manifest.json", "landmarks.json", "pois.json", "tileset.json", "events.json"],
    ignoredEventRuntimeArtifacts: ["raw rendered captures", "authority captures", "trace.jsonl", "orchestrator checkpoints", "status reports"],
    approvedFixtureClasses: [APPROVED_FIXTURE.source],
    ignoredRuntimeClasses: RUNTIME_PREFIXES,
    violations,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = verifyArtifactPolicy();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
