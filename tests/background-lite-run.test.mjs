import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BACKGROUND_LITE_POLICY,
  assembleTileset,
  atomicWrite,
  canonicalJson,
  canonicalSourcePath,
  indexTileset,
  inventorySource,
  runBackgroundLite,
  validatePolicy,
} from "../scripts/lib/background-lite-run.mjs";
import {
  createSyntheticSource,
  syntheticTile,
} from "./fixtures/background-lite-local/fixture.mjs";

const temporaryRoot = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

test("canonical paths, policies, and JSON reject unsafe or unstable input", () => {
  assert.equal(canonicalSourcePath("tiles/1/2/3_0.b3dm"), "1/2/3_0.b3dm");
  assert.equal(
    canonicalSourcePath("optimized-tiles\\1\\2\\3_0.b3dm"),
    "1/2/3_0.b3dm",
  );
  for (const unsafe of [
    "../tiles/a.b3dm",
    "1/../a.b3dm",
    "././a.b3dm",
    "/a.b3dm",
    "a.json",
  ])
    assert.throws(() => canonicalSourcePath(unsafe), /Unsafe/u, unsafe);
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"b":1}',
  );
  assert.equal(validatePolicy(BACKGROUND_LITE_POLICY), BACKGROUND_LITE_POLICY);
  assert.throws(
    () => validatePolicy({ ...BACKGROUND_LITE_POLICY, jpegQuality: 101 }),
    /jpegQuality/u,
  );
});

test("inventory rejects missing, duplicate, and linked tiles outside the source", async () => {
  const root = temporaryRoot("background-lite-invalid-");
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 1 });
    const tilesetPath = path.join(sourceRoot, "tileset.json");
    const original = JSON.parse(fs.readFileSync(tilesetPath));
    const missing = structuredClone(original);
    missing.root.children[0].content.uri = "./missing.b3dm";
    fs.writeFileSync(tilesetPath, JSON.stringify(missing));
    assert.throws(
      () => inventorySource({ sourceRoot }),
      /Missing source tile/u,
    );

    const duplicate = structuredClone(original);
    duplicate.root.children.push(structuredClone(duplicate.root.children[0]));
    fs.writeFileSync(tilesetPath, JSON.stringify(duplicate));
    assert.throws(
      () => inventorySource({ sourceRoot }),
      /Duplicate source tile/u,
    );

    fs.writeFileSync(tilesetPath, JSON.stringify(original));
    const outside = path.join(root, "outside.b3dm");
    fs.writeFileSync(outside, await syntheticTile());
    fs.rmSync(path.join(sourceRoot, "1/2/0_0.b3dm"));
    fs.symlinkSync(outside, path.join(sourceRoot, "1/2/0_0.b3dm"));
    assert.throws(
      () => inventorySource({ sourceRoot }),
      /escaped root through a link/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("isomorphic assembly preserves hierarchy but includes exactly selected content", async () => {
  const root = temporaryRoot("background-lite-assembly-");
  try {
    const { tileset } = await createSyntheticSource(root, { count: 3 });
    const assembled = assembleTileset(tileset, [
      "1/2/0_0.b3dm",
      "1/2/2_0.b3dm",
    ]);
    assert.equal(assembled.root.refine, "ADD");
    assert.deepEqual(
      indexTileset(assembled).map(({ canonicalPath }) => canonicalPath),
      ["1/2/0_0.b3dm", "1/2/2_0.b3dm"],
    );
    assert.throws(
      () => assembleTileset(tileset, ["missing.b3dm"]),
      /does not exactly match/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("inventory-to-tileset run has one terminal outcome per source tile", async () => {
  const root = temporaryRoot("background-lite-run-");
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 3 });
    const outputRoot = path.join(root, "output");
    const sourceHashes = inventorySource({ sourceRoot }).records.map(
      ({ sourceSha256 }) => sourceSha256,
    );
    const first = await runBackgroundLite({
      sourceRoot,
      outputRoot,
      batchSize: 2,
      concurrency: 2,
      reserveBytes: 0,
    });
    assert.equal(first.complete, true);
    assert.equal(first.commandOutcome, "complete");
    assert.deepEqual(first.outcomes, {
      processed: 3,
      resumed: 0,
      excluded: 0,
      failed: 0,
      terminal: 3,
    });
    assert.equal(first.records[0].identityPreserved, true);
    assert.equal(first.records[0].geometryPreserved, true);
    assert.equal(first.records[0].retainedBuffersPreserved, true);
    assert.equal(first.records[0].dracoPreserved, true);
    assert.ok(first.totals.outputBytes < first.totals.sourceBytes);
    assert.deepEqual(
      inventorySource({ sourceRoot }).records.map(
        ({ sourceSha256 }) => sourceSha256,
      ),
      sourceHashes,
      "source bytes changed",
    );
    const outputTileset = JSON.parse(
      fs.readFileSync(path.join(outputRoot, "background-lite", "tileset.json")),
    );
    assert.deepEqual(
      indexTileset(outputTileset).map(({ canonicalPath }) => canonicalPath),
      ["1/2/0_0.b3dm", "1/2/1_0.b3dm", "1/2/2_0.b3dm"],
    );

    const outputPath = path.join(outputRoot, "background-lite", "1/2/0_0.b3dm");
    const beforeMtime = fs.statSync(outputPath).mtimeMs;
    const second = await runBackgroundLite({
      sourceRoot,
      outputRoot,
      reserveBytes: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(second.complete, true);
    assert.equal(second.commandOutcome, "noop");
    assert.equal(second.resumedCount, 3);
    assert.equal(fs.statSync(outputPath).mtimeMs, beforeMtime);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a bounded interrupted run resumes verified outputs without rewriting them", async () => {
  const root = temporaryRoot("background-lite-interrupt-");
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 5 });
    const outputRoot = path.join(root, "output");
    await assert.rejects(
      runBackgroundLite({
        sourceRoot,
        outputRoot,
        batchSize: 2,
        reserveBytes: 0,
        onCheckpoint(checkpoint) {
          if (checkpoint.records.length === 2)
            throw new Error("fixture interruption");
        },
      }),
      /fixture interruption/u,
    );
    const completedPath = path.join(
      outputRoot,
      "background-lite",
      "1/2/0_0.b3dm",
    );
    const completedMtime = fs.statSync(completedPath).mtimeMs;
    const resumed = await runBackgroundLite({
      sourceRoot,
      outputRoot,
      batchSize: 2,
      reserveBytes: 0,
    });
    assert.equal(resumed.complete, true);
    assert.equal(resumed.resumedCount, 2);
    assert.equal(fs.statSync(completedPath).mtimeMs, completedMtime);
    assert.equal(resumed.outcomes.terminal, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resume rejects corrupt checkpoints, stale sources, and stale policies", async () => {
  const root = temporaryRoot("background-lite-stale-");
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 1 });
    const outputRoot = path.join(root, "output");
    await runBackgroundLite({ sourceRoot, outputRoot, reserveBytes: 0 });
    const checkpointPath = path.join(outputRoot, "checkpoints", "latest.json");
    const checkpoint = fs.readFileSync(checkpointPath);
    fs.writeFileSync(checkpointPath, "{");
    await assert.rejects(
      runBackgroundLite({ sourceRoot, outputRoot, reserveBytes: 0 }),
      /Checkpoint is corrupt/u,
    );
    fs.writeFileSync(checkpointPath, checkpoint);
    fs.appendFileSync(path.join(sourceRoot, "1/2/0_0.b3dm"), "changed");
    await assert.rejects(
      runBackgroundLite({ sourceRoot, outputRoot, reserveBytes: 0 }),
      /different run/u,
    );

    const fresh = temporaryRoot("background-lite-policy-");
    try {
      const { sourceRoot: freshSource } = await createSyntheticSource(fresh, {
        count: 1,
      });
      const freshOutput = path.join(fresh, "output");
      await runBackgroundLite({
        sourceRoot: freshSource,
        outputRoot: freshOutput,
        reserveBytes: 0,
      });
      await assert.rejects(
        runBackgroundLite({
          sourceRoot: freshSource,
          outputRoot: freshOutput,
          reserveBytes: 0,
          policy: { ...BACKGROUND_LITE_POLICY, jpegQuality: 54 },
        }),
        /different run/u,
      );
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt output is regenerated and atomic writes clean temporary files", async () => {
  const root = temporaryRoot("background-lite-corrupt-output-");
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 1 });
    const outputRoot = path.join(root, "output");
    await runBackgroundLite({ sourceRoot, outputRoot, reserveBytes: 0 });
    const outputPath = path.join(outputRoot, "background-lite", "1/2/0_0.b3dm");
    fs.writeFileSync(outputPath, "corrupt");
    const repaired = await runBackgroundLite({
      sourceRoot,
      outputRoot,
      reserveBytes: 0,
    });
    assert.equal(repaired.processedCount, 1);
    assert.equal(repaired.resumedCount, 0);

    const impossibleDestination = path.join(root, "existing-directory");
    fs.mkdirSync(impossibleDestination);
    assert.throws(() => atomicWrite(impossibleDestination, "data"));
    assert.equal(
      fs.existsSync(`${impossibleDestination}.${process.pid}.tmp`),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("capacity blocks before a pending tile write and partial failures are terminal but incomplete", async () => {
  const root = temporaryRoot("background-lite-capacity-");
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 2 });
    const outputRoot = path.join(root, "output");
    const blocked = await runBackgroundLite({
      sourceRoot,
      outputRoot,
      reserveBytes: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(blocked.commandOutcome, "blocked-by-capacity");
    assert.equal(blocked.complete, false);
    assert.equal(blocked.unresolved.length, 2);
    assert.equal(
      fs.existsSync(path.join(outputRoot, "background-lite", "1/2/0_0.b3dm")),
      false,
    );

    const tilesetPath = path.join(sourceRoot, "tileset.json");
    const tileset = JSON.parse(fs.readFileSync(tilesetPath));
    const invalidPath = path.join(sourceRoot, "1/2/1_0.b3dm");
    fs.writeFileSync(invalidPath, "not-a-b3dm");
    fs.writeFileSync(tilesetPath, JSON.stringify(tileset));
    const partial = await runBackgroundLite({
      sourceRoot,
      outputRoot: path.join(root, "partial"),
      reserveBytes: 0,
    });
    assert.equal(partial.complete, false);
    assert.equal(partial.failedCount, 1);
    assert.equal(partial.outcomes.terminal, 2);
    assert.equal(
      fs.existsSync(path.join(root, "partial/background-lite/tileset.json")),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the bounded fixture processes exactly 20 mixed source tiles", async () => {
  const root = temporaryRoot("background-lite-twenty-");
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 20 });
    const outputRoot = path.join(root, "output");
    const report = await runBackgroundLite({
      sourceRoot,
      outputRoot,
      limit: 20,
      batchSize: 5,
      concurrency: 3,
      reserveBytes: 0,
    });
    assert.equal(report.selectedTileCount, 20);
    assert.equal(report.complete, true);
    assert.equal(report.records.length, 20);
    assert.equal(report.failedCount, 0);
    assert.equal(
      indexTileset(
        JSON.parse(
          fs.readFileSync(
            path.join(outputRoot, "background-lite/tileset.json"),
          ),
        ),
      ).length,
      20,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
