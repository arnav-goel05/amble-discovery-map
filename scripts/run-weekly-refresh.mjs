#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

export function parseLastJson(value) {
  const text = String(value || "").trim();
  for (
    let index = text.lastIndexOf("{");
    index >= 0;
    index = text.lastIndexOf("{", index - 1)
  ) {
    try {
      return JSON.parse(text.slice(index));
    } catch {}
  }
  return null;
}

export function validateWeeklyConfig(config) {
  if (config?.schemaVersion !== "1.0" || config.timezone !== "Asia/Singapore")
    throw new Error(
      "weekly refresh config must use schemaVersion 1.0 and Asia/Singapore",
    );
  if (config.enabled !== undefined && typeof config.enabled !== "boolean")
    throw new Error("weekly refresh enabled flag must be boolean");
  if (!Array.isArray(config.event?.command) || config.event.command.length < 2)
    throw new Error("weekly event command is missing");
  if (
    !Number.isInteger(config.event.maximumContinuations) ||
    config.event.maximumContinuations < 1
  )
    throw new Error("weekly event continuation bound is invalid");
  if (
    !Array.isArray(config.restaurants?.coverage) ||
    !config.restaurants.coverage.length
  )
    throw new Error("restaurant refresh coverage is empty");
  const ids = new Set();
  for (const item of config.restaurants.coverage) {
    if (!item?.id || ids.has(item.id))
      throw new Error("restaurant coverage IDs must be unique");
    ids.add(item.id);
    const coordinates = String(item.bbox).split(",").map(Number);
    if (
      coordinates.length !== 4 ||
      coordinates.some((value) => !Number.isFinite(value))
    )
      throw new Error(`restaurant coverage ${item.id} has an invalid bbox`);
    const [south, west, north, east] = coordinates;
    if (
      north <= south ||
      east <= west ||
      north - south > 0.120001 ||
      east - west > 0.120001
    )
      throw new Error(
        `restaurant coverage ${item.id} exceeds the bounded viewport contract`,
      );
  }
  return config;
}

function defaultRunCommand({ command, args, cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
  });
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    signal: result.signal || null,
  };
}

function exactEventContinuation(payload) {
  const command = payload?.next?.command;
  const match =
    typeof command === "string" &&
    command.match(
      /^npm run event-pipeline -- advance --run ([A-Za-z0-9._+:\-]+)$/,
    );
  if (!match)
    throw new Error("event pipeline returned an invalid continuation command");
  return {
    command: "npm",
    args: ["run", "event-pipeline", "--", "advance", "--run", match[1]],
  };
}

function summarizeCommand(result) {
  const payload = parseLastJson(result.stdout);
  return {
    exitCode: result.status,
    runId: payload?.runId || null,
    complete: payload?.complete === true,
    status: payload?.status || (result.status === 0 ? "success" : "failed"),
    error:
      result.status > 0 && result.status !== 3
        ? String(result.stderr || "command failed")
            .trim()
            .slice(0, 500)
        : null,
    payload,
  };
}

function runCompleteEvent({ config, invoke, root, env }) {
  let command = {
    command: config.event.command[0],
    args: config.event.command.slice(1),
  };
  const attempts = [];
  for (let count = 0; count <= config.event.maximumContinuations; count += 1) {
    const result = invoke({ ...command, cwd: root, env, domain: "events" });
    const summary = summarizeCommand(result);
    attempts.push({
      exitCode: summary.exitCode,
      runId: summary.runId,
      status: summary.status,
    });
    if (summary.complete) return { ...summary, attempts };
    if (result.status !== 3) return { ...summary, complete: false, attempts };
    command = exactEventContinuation(summary.payload);
  }
  return {
    complete: false,
    status: "failed",
    error: "event_continuation_limit_exceeded",
    attempts,
  };
}

function runRestaurantCoverage({ config, coverage, invoke, root, env }) {
  let command = {
    command: config.restaurants.command[0],
    args: [...config.restaurants.command.slice(1), "--bbox", coverage.bbox],
  };
  const attempts = [];
  for (
    let count = 0;
    count <= config.restaurants.maximumContinuationsPerCoverage;
    count += 1
  ) {
    const result = invoke({
      ...command,
      cwd: root,
      env,
      domain: "restaurants",
      coverageId: coverage.id,
    });
    const summary = summarizeCommand(result);
    attempts.push({
      exitCode: summary.exitCode,
      runId: summary.runId,
      status: summary.status,
    });
    if (summary.complete)
      return { id: coverage.id, bbox: coverage.bbox, ...summary, attempts };
    if (result.status !== 3 || !summary.runId)
      return {
        id: coverage.id,
        bbox: coverage.bbox,
        ...summary,
        complete: false,
        attempts,
      };
    command = {
      command: "npm",
      args: [
        "run",
        "restaurant-pipeline",
        "--",
        "resume",
        "--run",
        summary.runId,
        "--retry-unavailable",
      ],
    };
  }
  return {
    id: coverage.id,
    bbox: coverage.bbox,
    complete: false,
    status: "failed",
    error: "restaurant_continuation_limit_exceeded",
    attempts,
  };
}

export function runWeeklyRefresh({
  root = ROOT,
  config = JSON.parse(
    fs.readFileSync(path.join(root, "data/weekly-refresh-config.json"), "utf8"),
  ),
  invoke = defaultRunCommand,
  now = () => new Date(),
  env = process.env,
} = {}) {
  validateWeeklyConfig(config);
  if (config.enabled === false) {
    return {
      schemaVersion: "1.0",
      complete: true,
      status: "disabled",
      reasonCode: "weekly_refresh_disabled",
      events: { status: "skipped" },
      restaurants: { status: "skipped", coverage: [] },
    };
  }
  const outputRoot = path.resolve(
    env.WEEKLY_REFRESH_OUTPUT_ROOT || path.join(root, "outputs/weekly-refresh"),
  );
  const lockPath = path.join(outputRoot, ".lock");
  fs.mkdirSync(outputRoot, { recursive: true });
  let lock;
  try {
    lock = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return {
      schemaVersion: "1.0",
      complete: false,
      status: "overlap_rejected",
      reasonCode: "weekly_refresh_locked",
      lockPath,
    };
  }
  const startedAt = now().toISOString();
  const runId = startedAt.replace(/[-:.]/g, "");
  const runDirectory = path.join(outputRoot, "runs", runId);
  fs.writeFileSync(
    lock,
    `${JSON.stringify({ schemaVersion: "1.0", runId, startedAt, owner: { host: os.hostname(), pid: process.pid } })}\n`,
  );
  fs.closeSync(lock);
  let status = {
    schemaVersion: "1.0",
    runId,
    startedAt,
    completedAt: null,
    complete: false,
    status: "running",
    events: { status: "pending" },
    restaurants: { status: "pending", coverage: [] },
  };
  try {
    atomicJson(path.join(runDirectory, "status.json"), status);
    status.events = runCompleteEvent({ config, invoke, root, env });
    const eventStale =
      status.events.complete === true && status.events.status === "partial";
    const eventReleaseFailed =
      !status.events.complete ||
      ["failed", "release_failed"].includes(status.events.status);
    if (eventStale || eventReleaseFailed) {
      status.events.publicationStatus = eventStale ? "stale" : "release_failed";
      status.restaurants = {
        status: "skipped",
        coverage: [],
        reasonCode: eventStale
          ? "event_snapshot_stale"
          : "event_release_failed",
      };
    } else {
      for (const coverage of config.restaurants.coverage) {
        const result = runRestaurantCoverage({
          config,
          coverage,
          invoke,
          root,
          env,
        });
        status.restaurants.coverage.push(result);
        if (
          !result.complete ||
          !["complete", "success"].includes(result.status)
        )
          break;
      }
      status.restaurants.status =
        status.restaurants.coverage.length ===
          config.restaurants.coverage.length &&
        status.restaurants.coverage.every((item) => item.complete)
          ? "success"
          : "partial";
    }
    status.complete =
      eventStale ||
      (status.events.complete === true &&
        status.events.status === "success" &&
        status.restaurants.status === "success");
    status.status = eventStale
      ? "stale"
      : eventReleaseFailed
        ? "release_failed"
        : status.complete
          ? "success"
          : "partial";
    status.completedAt = now().toISOString();
    atomicJson(path.join(runDirectory, "status.json"), status);
    atomicJson(path.join(outputRoot, "latest.json"), {
      schemaVersion: "1.0",
      runId,
      status: status.status,
      complete: status.complete,
      statusRef: `runs/${runId}/status.json`,
    });
    return status;
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    const result = runWeeklyRefresh();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.complete
      ? 0
      : result.status === "overlap_rejected"
        ? 4
        : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ schemaVersion: "1.0", error: { code: "weekly_refresh_failed", message: error.message } }, null, 2)}\n`,
    );
    process.exitCode = 1;
  }
}
