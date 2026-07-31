import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { canonicalizePipelineValue } from "./equivalence.mjs";
import {
  createResourceMeter,
  normalizeResourceMetrics,
} from "./resource-metrics.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const hashFile = (path) => sha(readFileSync(path));
const safeStage = (stage) => String(stage).replace(/[^a-zA-Z0-9._-]/g, "_");

const atomicJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
};

export function createStageInputManifest({
  stage,
  contractVersion,
  codeIdentity,
  configuration = [],
  upstreamArtifacts = [],
  dependencies = {},
}) {
  if (!stage || !contractVersion || !codeIdentity)
    throw new Error(
      "Stage input manifest requires stage, contractVersion, and codeIdentity",
    );
  const payload = canonicalizePipelineValue(
    {
      schemaVersion: "1.0",
      stage,
      contractVersion,
      codeIdentity,
      configuration,
      upstreamArtifacts,
      dependencies,
    },
    { volatileKeys: new Set() },
  );
  return { ...payload, inputHash: sha(JSON.stringify(payload)) };
}

export const stageCheckpointPath = (root, manifest) =>
  join(resolve(root), safeStage(manifest.stage), `${manifest.inputHash}.json`);

function filesIn(root) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) entries.push(path);
    }
  };
  visit(root);
  return entries.sort();
}

export const fingerprintArtifact = (path, { ref = null } = {}) => {
  const resolved = resolve(path);
  const stats = statSync(resolved);
  if (stats.isFile())
    return {
      ref: ref ?? resolved,
      path: resolved,
      kind: "file",
      sha256: hashFile(resolved),
      bytes: stats.size,
      fileCount: 1,
    };
  if (!stats.isDirectory())
    throw new Error(
      `Checkpoint artifact is not a file or directory: ${resolved}`,
    );
  const digest = createHash("sha256");
  let bytes = 0;
  const files = filesIn(resolved);
  for (const file of files) {
    const relativePath = relative(resolved, file).split(/[/\\]/).join("/");
    const size = statSync(file).size;
    bytes += size;
    digest.update(`${relativePath}\u0000${size}\u0000`);
    digest.update(readFileSync(file));
  }
  return {
    ref: ref ?? resolved,
    path: resolved,
    kind: "directory",
    sha256: digest.digest("hex"),
    bytes,
    fileCount: files.length,
  };
};

export function writeStageCheckpoint(
  root,
  {
    manifest,
    status,
    outputs = [],
    metrics = {},
    invalidatedBy = [],
    now = () => new Date().toISOString(),
  },
) {
  const path = stageCheckpointPath(root, manifest);
  const fingerprintedOutputs =
    status === "success"
      ? outputs.map((output) => fingerprintArtifact(output))
      : [];
  const record = {
    schemaVersion: "1.0",
    checkpointId: `${safeStage(manifest.stage)}:${manifest.inputHash}`,
    stage: manifest.stage,
    inputHash: manifest.inputHash,
    status,
    outputs: fingerprintedOutputs,
    metrics: normalizeResourceMetrics({
      ...metrics,
      bytesWritten:
        Number(metrics.bytesWritten) > 0
          ? metrics.bytesWritten
          : fingerprintedOutputs.reduce(
              (total, output) => total + output.bytes,
              0,
            ),
    }),
    createdAt: now(),
    invalidatedBy: [...new Set(invalidatedBy)].slice(0, 100),
  };
  atomicJson(path, record);
  return { ...record, path };
}

export function findReusableStageCheckpoint(root, manifest) {
  const path = stageCheckpointPath(root, manifest);
  if (!existsSync(path)) return null;
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (
    record.status !== "success" ||
    record.stage !== manifest.stage ||
    record.inputHash !== manifest.inputHash
  )
    return null;
  for (const output of record.outputs ?? []) {
    const path = output.path ?? output.ref;
    if (!existsSync(path)) return null;
    try {
      const current = fingerprintArtifact(path);
      if (
        current.kind !== (output.kind ?? "file") ||
        current.bytes !== output.bytes ||
        current.fileCount !== (output.fileCount ?? 1) ||
        current.sha256 !== output.sha256
      )
        return null;
    } catch {
      return null;
    }
  }
  return { ...record, path };
}

export async function runCheckpointedStage({
  checkpointRoot,
  manifest,
  execute,
  now,
}) {
  const reusable = findReusableStageCheckpoint(checkpointRoot, manifest);
  if (reusable)
    return {
      ...reusable,
      reused: true,
      metrics: normalizeResourceMetrics({
        artifactsReused: reusable.outputs?.length ?? 0,
        cacheHits: 1,
        gateReuses: 1,
        bytesRead: (reusable.outputs ?? []).reduce(
          (total, output) => total + Number(output.bytes ?? 0),
          0,
        ),
        reasonCode: "exact_input_checkpoint_reused",
      }),
    };
  const meter = createResourceMeter();
  try {
    const result = (await execute()) ?? {};
    const metrics = meter.finish({
      ...result.metrics,
      cacheMisses: 1,
      artifactsCreated: result.outputs?.length ?? 0,
      gateExecutions: 1,
      reasonCode: result.metrics?.reasonCode ?? "checkpoint_executed",
    });
    return {
      ...writeStageCheckpoint(checkpointRoot, {
        manifest,
        status: "success",
        outputs: result.outputs ?? [],
        metrics,
        now,
      }),
      reused: false,
    };
  } catch (error) {
    writeStageCheckpoint(checkpointRoot, {
      manifest,
      status: "failed",
      metrics: meter.finish({
        cacheMisses: 1,
        gateExecutions: 1,
        reasonCode: "checkpoint_execution_failed",
      }),
      now,
    });
    throw error;
  }
}

export function summarizeStageCheckpointMetrics(root) {
  if (!existsSync(root))
    return {
      checkpoints: 0,
      reusableSuccesses: 0,
      failed: 0,
      metrics: normalizeResourceMetrics(),
    };
  const records = filesIn(resolve(root))
    .filter((path) => path.endsWith(".json"))
    .flatMap((path) => {
      try {
        return [JSON.parse(readFileSync(path, "utf8"))];
      } catch {
        return [];
      }
    })
    .filter((record) => record.schemaVersion === "1.0" && record.checkpointId);
  const totals = {};
  for (const record of records)
    for (const [key, value] of Object.entries(record.metrics ?? {}))
      if (key !== "reasonCode" && Number.isFinite(Number(value)))
        totals[key] = (totals[key] ?? 0) + Number(value);
  return {
    checkpoints: records.length,
    reusableSuccesses: records.filter(({ status }) => status === "success")
      .length,
    failed: records.filter(({ status }) => status === "failed").length,
    metrics: normalizeResourceMetrics({
      ...totals,
      reasonCode: "checkpoint_summary",
    }),
  };
}
