import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  canonicalizePipelineValue,
  compareCanonicalSurfaces,
  hashCanonicalSurface,
} from "../scripts/lib/event-pipeline/equivalence.mjs";
import {
  createStageInputManifest,
  findReusableStageCheckpoint,
  runCheckpointedStage,
  writeStageCheckpoint,
} from "../scripts/lib/event-pipeline/stage-checkpoints.mjs";
import {
  evaluateCommitEligibility,
  nextPipelineAction,
} from "../scripts/lib/event-pipeline/run-state.mjs";
import { selectChangedPoiRecords } from "../scripts/event-frontend-snapshot.mjs";
import {
  deliveryIdentity,
  runIdempotentDelivery,
} from "../scripts/lib/event-pipeline/delivery-receipts.mjs";

const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
};

test("canonical equivalence ignores approved volatility and set ordering but catches domain changes", () => {
  const before = {
    runId: "before",
    createdAt: "2026-07-20T00:00:00.000Z",
    records: [
      { sourceRecordId: "two", title: "Second", mappingStatus: "approved" },
      { sourceRecordId: "one", title: "First", mappingStatus: "approved" },
    ],
  };
  const reordered = {
    runId: "after",
    createdAt: "2026-07-27T00:00:00.000Z",
    records: [
      { sourceRecordId: "one", title: "First", mappingStatus: "approved" },
      { sourceRecordId: "two", title: "Second", mappingStatus: "approved" },
    ],
  };
  assert.equal(
    hashCanonicalSurface("events", before),
    hashCanonicalSurface("events", reordered),
  );
  assert.deepEqual(
    compareCanonicalSurfaces({ events: before }, { events: reordered }),
    {
      equivalent: true,
      surfaces: {
        events: {
          equivalent: true,
          beforeHash: hashCanonicalSurface("events", before),
          afterHash: hashCanonicalSurface("events", reordered),
          differences: [],
        },
      },
    },
  );

  const changed = structuredClone(reordered);
  changed.records[0].mappingStatus = "pending_review";
  const report = compareCanonicalSurfaces(
    { events: before },
    { events: changed },
  );
  assert.equal(report.equivalent, false);
  assert.match(report.surfaces.events.differences[0].path, /mappingStatus/);
});

test("canonicalization preserves explicitly ordered semantic arrays", () => {
  const value = {
    sessions: [
      { id: "late", startsAt: "2026-08-02T20:00:00+08:00" },
      { id: "early", startsAt: "2026-08-01T20:00:00+08:00" },
    ],
  };
  assert.deepEqual(
    canonicalizePipelineValue(value).sessions.map(({ id }) => id),
    ["late", "early"],
  );
});

test("stage checkpoint reuse requires exact complete inputs and intact outputs", async () => {
  const root = mkdtempSync(join(tmpdir(), "event-checkpoint-"));
  const output = join(root, "output", "events.json");
  const manifest = createStageInputManifest({
    stage: "fixture-normalize",
    contractVersion: "1.0",
    codeIdentity: { files: [{ ref: "normalizer.mjs", sha256: "code-a" }] },
    configuration: [{ ref: "config.json", sha256: "config-a" }],
    upstreamArtifacts: [{ ref: "source.json", sha256: "source-a", bytes: 12 }],
    dependencies: { policyVersion: "3", timezone: "Asia/Singapore" },
  });
  let executions = 0;
  const first = await runCheckpointedStage({
    checkpointRoot: root,
    manifest,
    execute: async () => {
      executions += 1;
      write(output, "same output\n");
      return { outputs: [output], metrics: { externalRequests: 1 } };
    },
  });
  assert.equal(first.reused, false);
  assert.equal(first.metrics.bytesWritten, Buffer.byteLength("same output\n"));
  assert.equal(executions, 1);

  const second = await runCheckpointedStage({
    checkpointRoot: root,
    manifest,
    execute: async () => {
      executions += 1;
      return { outputs: [] };
    },
  });
  assert.equal(second.reused, true);
  assert.equal(second.metrics.gateReuses, 1);
  assert.equal(second.metrics.externalRequests, 0);
  assert.equal(second.metrics.bytesRead, Buffer.byteLength("same output\n"));
  assert.equal(executions, 1);

  writeFileSync(output, "tampered\n");
  assert.equal(findReusableStageCheckpoint(root, manifest), null);
});

test("stage checkpoint invalidates when configuration or execution context changes", () => {
  const root = mkdtempSync(join(tmpdir(), "event-checkpoint-input-"));
  const output = join(root, "result.json");
  writeFileSync(output, "{}\n");
  const base = {
    stage: "fixture",
    contractVersion: "1.0",
    codeIdentity: { commit: "abc" },
    configuration: [{ ref: "pipeline.json", sha256: "one" }],
    upstreamArtifacts: [],
    dependencies: {
      adapterVersion: "1",
      timezone: "Asia/Singapore",
      geographicProvider: "fixture-a",
    },
  };
  const first = createStageInputManifest(base);
  writeStageCheckpoint(root, {
    manifest: first,
    status: "success",
    outputs: [output],
  });
  assert.ok(findReusableStageCheckpoint(root, first));

  for (const changed of [
    { ...base, configuration: [{ ref: "pipeline.json", sha256: "two" }] },
    {
      ...base,
      dependencies: { ...base.dependencies, timezone: "Pacific/Auckland" },
    },
    {
      ...base,
      dependencies: {
        ...base.dependencies,
        geographicProvider: "fixture-b",
      },
    },
  ])
    assert.equal(
      findReusableStageCheckpoint(root, createStageInputManifest(changed)),
      null,
    );
});

test("stage checkpoint records are bounded and never include output contents", () => {
  const root = mkdtempSync(join(tmpdir(), "event-checkpoint-bounds-"));
  const output = join(root, "large.json");
  writeFileSync(output, `${"x".repeat(50_000)}\n`);
  const manifest = createStageInputManifest({
    stage: "bounded",
    contractVersion: "1",
    codeIdentity: { commit: "abc" },
    configuration: [],
    upstreamArtifacts: [],
    dependencies: {},
  });
  const checkpoint = writeStageCheckpoint(root, {
    manifest,
    status: "success",
    outputs: [output],
  });
  const serialized = JSON.stringify(checkpoint);
  assert.ok(serialized.length < 10_000);
  assert.equal(serialized.includes("x".repeat(100)), false);
  assert.equal(checkpoint.metrics.bytesWritten, 50_001);
  assert.equal(
    JSON.parse(readFileSync(checkpoint.path, "utf8")).inputHash,
    manifest.inputHash,
  );
});

test("a terminal needs-review venue does not block unrelated safe frontend work", () => {
  const stages = (resolve) => ({
    resolve,
    highlight: { status: "pending" },
    pill: { status: "pending" },
    panel: { status: "pending" },
  });
  const state = {
    sources: {
      Fixture: { status: "success", operatingMode: "required" },
    },
    normalization: {
      status: "success",
      sourceReconciliation: { accounted: true },
    },
    resolutionPreparation: { status: "success" },
    deduplication: { status: "success" },
    verification: { status: "pending" },
    venues: {
      approved: {
        stages: stages({ status: "success", resolutionStatus: "approved" }),
      },
      ambiguous: {
        stages: stages({
          status: "unresolved",
          resolutionStatus: "needs_review",
        }),
      },
    },
  };
  assert.deepEqual(nextPipelineAction(state), { action: "stage-frontend" });
  assert.deepEqual(
    evaluateCommitEligibility(state, { requireVerification: false }),
    {
      eligible: true,
      reasons: [],
    },
  );
});

test("frontend extraction selects only changed POIs and preserves 100 unchanged records", () => {
  const records = Array.from({ length: 112 }, (_, index) => ({
    id: `poi-${index}`,
    data: `poi-tiles/poi-${index}/tileset.json`,
  }));
  const changed = new Set(records.slice(0, 12).map(({ id }) => id));
  const plan = {
    classifications: records.map(({ id }) => ({
      poiId: id,
      highlightAction: changed.has(id) ? "update" : "noop",
    })),
  };
  assert.deepEqual(
    selectChangedPoiRecords(plan, records).map(({ id }) => id),
    records.slice(0, 12).map(({ id }) => id),
  );
  assert.equal(
    records.length - selectChangedPoiRecords(plan, records).length,
    100,
  );
});

test("directory checkpoint invalidates when any generated asset is tampered", () => {
  const root = mkdtempSync(join(tmpdir(), "event-asset-checkpoint-"));
  const assets = join(root, "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, "one.b3dm"), "one");
  writeFileSync(join(assets, "two.b3dm"), "two");
  const manifest = createStageInputManifest({
    stage: "frontend-assets",
    contractVersion: "1",
    codeIdentity: { commit: "abc" },
    configuration: [],
    upstreamArtifacts: [],
    dependencies: { changedPoiIds: ["one"] },
  });
  writeStageCheckpoint(root, {
    manifest,
    status: "success",
    outputs: [assets],
  });
  assert.ok(findReusableStageCheckpoint(root, manifest));
  writeFileSync(join(assets, "two.b3dm"), "tampered");
  assert.equal(findReusableStageCheckpoint(root, manifest), null);
});

test("delivery receipts execute once for identical content and retry changed or failed content", async () => {
  const root = mkdtempSync(join(tmpdir(), "event-delivery-receipt-"));
  let executions = 0;
  let elapsed = 100;
  const deliver = (payload, destination = "https://dashboard.test") =>
    runIdempotentDelivery({
      receiptRoot: root,
      operation: "dashboard_sync",
      payload,
      destination,
      execute: async () => {
        executions += 1;
        elapsed += 25;
        return { status: "success", httpStatus: 200 };
      },
      clock: () => elapsed,
    });
  const first = await deliver({ runId: "one", value: 1 });
  const repeated = await deliver({
    runId: "different-volatile-run",
    value: 1,
  });
  assert.equal(first.reused, false);
  assert.equal(first.metrics.blockingMs, 25);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.metrics.blockingMs, 0);
  assert.equal(executions, 1);
  assert.equal((await deliver({ value: 2 })).reused, false);
  assert.equal(
    (await deliver({ value: 2 }, "https://other-dashboard.test")).reused,
    false,
  );
  assert.equal(executions, 3);

  let failures = 0;
  const failedOptions = {
    receiptRoot: root,
    operation: "admin_reconcile",
    payload: { value: "retry" },
    destination: "admin",
  };
  const failed = await runIdempotentDelivery({
    ...failedOptions,
    execute: async () => {
      failures += 1;
      return { status: "failed", reasonCode: "temporary" };
    },
  });
  assert.equal(failed.receipt.status, "failed");
  const recovered = await runIdempotentDelivery({
    ...failedOptions,
    execute: async () => {
      failures += 1;
      return { status: "success" };
    },
  });
  assert.equal(recovered.reused, false);
  assert.equal(failures, 2);
});

test("delivery identity excludes approved volatile metadata but not destination or content", () => {
  const base = {
    operation: "dashboard_sync",
    contractVersion: "1",
    destination: "one",
    payload: { runId: "a", finalizedAt: "now", value: 1 },
  };
  assert.equal(
    deliveryIdentity(base).receiptId,
    deliveryIdentity({
      ...base,
      payload: { runId: "b", finalizedAt: "later", value: 1 },
    }).receiptId,
  );
  assert.notEqual(
    deliveryIdentity(base).receiptId,
    deliveryIdentity({ ...base, destination: "two" }).receiptId,
  );
});
