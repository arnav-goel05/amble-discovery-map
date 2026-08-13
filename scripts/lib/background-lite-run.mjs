import fs from "node:fs";
import path from "node:path";

import {
  b3dmIdentity,
  inspectGlb,
  inspectTextureSemantics,
  makeBackgroundTextureLite,
  readB3dm,
} from "./background-lite-b3dm.mjs";
import {
  assembleTileset,
  atomicLink,
  assertCapacity,
  atomicWrite,
  canonicalJson,
  inventorySource,
  readCheckpoint,
  sha256,
  validatePolicy,
} from "./background-lite-run-support.mjs";

export {
  assembleTileset,
  assertCapacity,
  atomicWrite,
  availableCapacity,
  canonicalJson,
  canonicalSourcePath,
  indexTileset,
  inventorySource,
  sha256,
  validatePolicy,
} from "./background-lite-run-support.mjs";

export const BACKGROUND_LITE_POLICY = Object.freeze({
  schemaVersion: "background-lite-policy-v1",
  maximumTextureDimension: 128,
  jpegQuality: 55,
  blurSigma: 0,
  preserveSourceColour: true,
  backgroundOpacity: 0.3,
});

export function policyId(policy = BACKGROUND_LITE_POLICY) {
  return sha256(canonicalJson(validatePolicy(policy))).slice(0, 16);
}

export function verifyBackgroundLiteIntegrity(sourceBytes, outputBytes) {
  const sourceParts = readB3dm(sourceBytes);
  const outputParts = readB3dm(outputBytes);
  const sourceGlb = inspectGlb(sourceParts.glb);
  const outputGlb = inspectGlb(outputParts.glb);
  const identityPreserved =
    canonicalJson(b3dmIdentity(sourceParts)) ===
    canonicalJson(b3dmIdentity(outputParts));
  const retainedBuffersPreserved =
    sourceGlb.retainedBufferViewSha256 === outputGlb.retainedBufferViewSha256;
  const dracoPreserved =
    canonicalJson(sourceGlb.semantics) === canonicalJson(outputGlb.semantics) &&
    canonicalJson(sourceGlb.dracoSemantics) ===
      canonicalJson(outputGlb.dracoSemantics) &&
    canonicalJson(sourceGlb.extensionsRequired) ===
      canonicalJson(outputGlb.extensionsRequired);
  return {
    identityPreserved,
    retainedBuffersPreserved,
    dracoPreserved,
    geometryPreserved:
      sourceGlb.vertices === outputGlb.vertices &&
      sourceGlb.triangles === outputGlb.triangles &&
      retainedBuffersPreserved &&
      dracoPreserved,
  };
}

function writeCheckpoint(outputRoot, report) {
  atomicWrite(
    path.join(outputRoot, "checkpoints", "latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function mapConcurrent(records, concurrency, worker) {
  const outcomes = new Array(records.length);
  let cursor = 0;
  async function consume() {
    while (cursor < records.length) {
      const index = cursor;
      cursor += 1;
      outcomes[index] = await worker(records[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, records.length) }, consume),
  );
  return outcomes;
}

export async function runBackgroundLite({
  sourceRoot,
  outputRoot,
  limit = 0,
  batchSize = 20,
  concurrency = 2,
  reserveBytes = 1_073_741_824,
  policy = BACKGROUND_LITE_POLICY,
  onCheckpoint = null,
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error("batchSize must be a positive integer");
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("concurrency must be a positive integer");
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error("limit must be a non-negative integer");
  const source = inventorySource({ sourceRoot });
  const resolvedOutput = path.resolve(outputRoot);
  if (
    resolvedOutput === source.resolvedRoot ||
    resolvedOutput.startsWith(`${source.resolvedRoot}${path.sep}`) ||
    source.resolvedRoot.startsWith(`${resolvedOutput}${path.sep}`)
  )
    throw new Error("Output must not replace the original source");
  fs.mkdirSync(resolvedOutput, { recursive: true });
  const activePolicyId = policyId(policy);
  const runId = sha256(`${source.inventoryId}\n${activePolicyId}`).slice(0, 16);
  const checkpointPath = path.join(
    resolvedOutput,
    "checkpoints",
    "latest.json",
  );
  let previous = null;
  if (fs.existsSync(checkpointPath)) {
    previous = readCheckpoint(checkpointPath, runId);
  }
  const completed = new Map(
    (previous?.records ?? []).map((record) => [record.canonicalPath, record]),
  );
  const selected = limit > 0 ? source.records.slice(0, limit) : source.records;
  let resumedCount = 0;
  let capacityBlock = null;
  for (let offset = 0; offset < selected.length; offset += batchSize) {
    const batch = selected.slice(offset, offset + batchSize);
    const pending = batch.filter((record) => {
      const old = completed.get(record.canonicalPath);
      const outputPath = path.join(
        resolvedOutput,
        "background-lite",
        record.canonicalPath,
      );
      if (
        !old ||
        old.sourceSha256 !== record.sourceSha256 ||
        old.policyId !== activePolicyId ||
        !fs.existsSync(outputPath) ||
        sha256(fs.readFileSync(outputPath)) !== old.outputSha256
      )
        return true;
      resumedCount += 1;
      return false;
    });
    if (pending.length) {
      try {
        assertCapacity({
          destination: resolvedOutput,
          requiredBytes: pending.reduce(
            (sum, record) => sum + record.sourceBytes,
            0,
          ),
          reserveBytes,
        });
      } catch (error) {
        if (error.code !== "BACKGROUND_LITE_CAPACITY") throw error;
        capacityBlock = {
          offset,
          pendingTileCount: pending.length,
          ...error.details,
        };
        writeCheckpoint(resolvedOutput, {
          schemaVersion: "local-background-lite-run-v1",
          runId,
          inventoryId: source.inventoryId,
          policyId: activePolicyId,
          complete: false,
          capacityBlock,
          records: [...completed.values()].sort((a, b) =>
            a.canonicalPath.localeCompare(b.canonicalPath),
          ),
        });
        break;
      }
    }
    await mapConcurrent(pending, concurrency, async (record) => {
      const sourceBytes = fs.readFileSync(record.sourcePath);
      try {
        const semantics = await inspectTextureSemantics(sourceBytes);
        if (semantics.ambiguousImages.length)
          throw new Error("Ambiguous texture semantics");
        const outputBytes = await makeBackgroundTextureLite(sourceBytes, {
          maximumDimension: policy.maximumTextureDimension,
          quality: policy.jpegQuality,
          blurSigma: policy.blurSigma,
          preserveSourceColour: policy.preserveSourceColour,
        });
        const checks = verifyBackgroundLiteIntegrity(sourceBytes, outputBytes);
        if (!checks.identityPreserved || !checks.geometryPreserved)
          throw new Error("Geometry or identity changed");
        const outputPath = path.join(
          resolvedOutput,
          "background-lite",
          record.canonicalPath,
        );
        atomicWrite(outputPath, outputBytes);
        completed.set(record.canonicalPath, {
          canonicalPath: record.canonicalPath,
          sourceSha256: record.sourceSha256,
          sourceBytes: record.sourceBytes,
          outputSha256: sha256(outputBytes),
          outputBytes: outputBytes.length,
          policyId: activePolicyId,
          outcome: "processed",
          textureSemantics: semantics,
          ...checks,
        });
      } catch (error) {
        completed.set(record.canonicalPath, {
          canonicalPath: record.canonicalPath,
          sourceSha256: record.sourceSha256,
          sourceBytes: record.sourceBytes,
          outputSha256: null,
          outputBytes: 0,
          policyId: activePolicyId,
          outcome: "failed",
          error: error.message,
        });
      }
    });
    const checkpoint = {
      schemaVersion: "local-background-lite-run-v1",
      runId,
      inventoryId: source.inventoryId,
      policyId: activePolicyId,
      complete: false,
      records: [...completed.values()].sort((a, b) =>
        a.canonicalPath.localeCompare(b.canonicalPath),
      ),
    };
    writeCheckpoint(resolvedOutput, checkpoint);
    if (onCheckpoint) await onCheckpoint(checkpoint);
  }
  const processedRecords = selected
    .map((record) => completed.get(record.canonicalPath))
    .filter(Boolean);
  const includedExclusions = limit === 0 ? source.exclusions : [];
  const records = [...processedRecords, ...includedExclusions].sort((a, b) =>
    a.canonicalPath.localeCompare(b.canonicalPath),
  );
  const failed = records.filter(({ outcome }) => outcome === "failed");
  const sourceBytes = records.reduce(
    (sum, record) => sum + record.sourceBytes,
    0,
  );
  const outputBytes = records.reduce(
    (sum, record) => sum + record.outputBytes,
    0,
  );
  const complete =
    !capacityBlock &&
    processedRecords.length === selected.length &&
    failed.length === 0;
  let tilesetSha256 = null;
  if (complete) {
    const tileset = assembleTileset(
      source.tileset,
      selected.map(({ canonicalPath }) => canonicalPath),
    );
    const tilesetBytes = `${canonicalJson(tileset)}\n`;
    atomicWrite(
      path.join(resolvedOutput, "background-lite", "tileset.json"),
      tilesetBytes,
    );
    tilesetSha256 = sha256(tilesetBytes);
  }
  const processedCount =
    records.filter(({ outcome }) => outcome === "processed").length -
    resumedCount;
  const report = {
    schemaVersion: "local-background-lite-run-v1",
    runId,
    inventoryId: source.inventoryId,
    policyId: activePolicyId,
    policy,
    complete,
    commandOutcome: capacityBlock
      ? "blocked-by-capacity"
      : complete
        ? processedCount === 0
          ? "noop"
          : "complete"
        : "failed-validation",
    localOnly: true,
    productionChanged: false,
    selectedTileCount: selected.length + includedExclusions.length,
    sourceTileCount: source.totalRecordCount,
    excludedCount: includedExclusions.length,
    resumedCount,
    failedCount: failed.length,
    processedCount,
    tilesetSha256,
    capacityBlock,
    unresolved: selected
      .filter(({ canonicalPath }) => !completed.has(canonicalPath))
      .map(({ canonicalPath }) => canonicalPath),
    outcomes: {
      processed: processedCount,
      resumed: resumedCount,
      excluded: includedExclusions.length,
      failed: failed.length,
      terminal: records.length,
    },
    totals: {
      sourceBytes,
      outputBytes,
      reductionPercent:
        sourceBytes > 0
          ? Number(
              (((sourceBytes - outputBytes) / sourceBytes) * 100).toFixed(2),
            )
          : 0,
    },
    records,
  };
  writeCheckpoint(resolvedOutput, report);
  const finalCheckpointPath = path.join(
    resolvedOutput,
    "checkpoints",
    "latest.json",
  );
  const finalReportPath = path.join(
    resolvedOutput,
    "reports",
    "background.json",
  );
  try {
    atomicLink(finalCheckpointPath, finalReportPath);
  } catch (error) {
    if (!["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP"].includes(error.code))
      throw error;
    atomicWrite(finalReportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
