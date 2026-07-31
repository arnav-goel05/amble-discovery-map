#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createTraceWriter } from "./lib/event-sources/trace.mjs";
import {
  recoverMissingEventVenues,
  validateMissingVenueRecoveryConfig,
} from "./lib/event-sources/tinyfish-venue-recovery.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function runMissingVenueRecovery({
  runId,
  outputRoot = process.env.EVENT_PIPELINE_OUTPUT_ROOT ??
    join(ROOT, "outputs/event-pipeline"),
  configPath = join(ROOT, "data/event-pipeline-config.json"),
  force = false,
  searchClient,
  renderedClient,
} = {}) {
  if (!runId) throw new Error("Missing --run <run-id>");
  const runDir = join(resolve(outputRoot), runId);
  for (const name of ["run.json", "orchestrator-state.json"])
    if (!existsSync(join(runDir, name)))
      throw new Error(`Run is missing ${name}`);
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const state = JSON.parse(
    readFileSync(join(runDir, "orchestrator-state.json"), "utf8"),
  );
  const pipelineConfig = JSON.parse(readFileSync(configPath, "utf8"));
  const recoveryConfig = validateMissingVenueRecoveryConfig(
    pipelineConfig.missingVenueRecovery,
  );
  const trace = createTraceWriter({
    path: join(runDir, "logs/trace.jsonl"),
    runId,
    window: run.window,
  });
  return recoverMissingEventVenues({
    runDir,
    state,
    run,
    config: recoveryConfig,
    sourceDefinitions: pipelineConfig.sources,
    searchClient,
    renderedClient,
    force,
    logger: (entry) =>
      trace.write({
        stage: entry.stage ?? "venue_search_recovery",
        action: entry.action ?? "missing_venue_recovery",
        outcome:
          entry.outcome ??
          (entry.action?.includes("failed")
            ? "failed"
            : entry.action?.includes("reused")
              ? "reused"
              : entry.action?.includes("recovered")
                ? "success"
                : "started"),
        sourceName: entry.sourceName ?? null,
        entityType: "source_occurrence",
        entityId: entry.entityId ?? runId,
        reasonCode: entry.reasonCode ?? null,
        httpStatus: entry.httpStatus ?? null,
        counts: entry.counts ?? null,
        evidenceRef: entry.evidenceRef ?? null,
      }),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runIndex = process.argv.indexOf("--run");
  const runId = runIndex >= 0 ? process.argv[runIndex + 1] : null;
  try {
    const result = await runMissingVenueRecovery({
      runId,
      force: process.argv.includes("--force"),
    });
    process.stdout.write(
      `${JSON.stringify({ artifactRef: result.artifactRef, counts: result.counts, perSource: result.perSource }, null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
