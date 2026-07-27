import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareVariants,
  compatibleVariants,
  median,
  summarizeCpuProfile,
  validateTrial,
  validateVariantConfig,
} from "../scripts/lib/map-performance-diagnostics.mjs";
import { inspectB3dm } from "../scripts/inspect-3d-tile-assets.mjs";

const config = validateVariantConfig(
  JSON.parse(
    await readFile(
      new URL("../config/map-performance-diagnostic-variants.json", import.meta.url),
      "utf8",
    ),
  ),
);

test("diagnostic variants are versioned, unique, and allowlisted", () => {
  assert.equal(config.schemaVersion, 1);
  assert.equal(new Set(config.variants.map(({ id }) => id)).size, config.variants.length);
  assert.throws(() =>
    validateVariantConfig({
      schemaVersion: 1,
      variants: [
        {
          id: "bad",
          comparisonGroup: "x",
          intendedDifference: "x",
          workloads: { background3d: true },
        },
      ],
    }),
  );
  const legacy = config.variants.find(
    ({ id }) => id === "legacy-full-moveend-refresh",
  );
  const primedViewport = config.variants.find(
    ({ id }) => id === "primed-viewport-moveend-refresh",
  );
  assert.equal(legacy.workloads.moveEndSearchRefreshMode, "full");
  assert.equal(legacy.controlId, "primed-viewport-moveend-refresh");
  assert.equal(primedViewport.workloads.primeEventSearch, true);
  assert.equal(legacy.workloads.primeEventSearch, true);
  assert.equal(compatibleVariants(primedViewport, legacy), true);
  const legacyMinimap = config.variants.find(
    ({ id }) => id === "legacy-minimap-render",
  );
  const full = config.variants.find(({ id }) => id === "full");
  assert.equal(legacyMinimap.workloads.minimapRenderMode, "legacy");
  assert.equal(legacyMinimap.controlId, "full");
  assert.equal(compatibleVariants(full, legacyMinimap), true);
});

test("CPU profiles are reduced to bounded self-time attribution", () => {
  const summary = summarizeCpuProfile(
    {
      nodes: [
        { id: 1, callFrame: { functionName: "slow", url: "app.js", lineNumber: 4 } },
        { id: 2, callFrame: { functionName: "fast", url: "app.js", lineNumber: 8 } },
      ],
      samples: [1, 2, 1],
      timeDeltas: [5_000, 1_000, 7_000],
    },
    1,
  );
  assert.deepEqual(summary, [
    {
      functionName: "slow",
      url: "app.js",
      lineNumber: 4,
      selfTimeMs: 12,
    },
  ]);
});

test("invalid trials cannot enter causal evidence", () => {
  const trial = validateTrial({
    visibility: "hidden",
    readiness: { complete: false },
    network: { activeAtMotionStart: 1, failed: 1 },
    motion: { averageFps: null, frameCount: 0 },
    validity: { reasons: [] },
  });
  assert.equal(trial.validity.state, "invalid");
  assert.deepEqual(trial.validity.reasons, [
    "background_execution",
    "incomplete_readiness",
    "network_active_at_motion_start",
    "failed_resources",
    "insufficient_motion_frames",
  ]);
});

test("median is deterministic and causal ranking requires repeated compatible trials", () => {
  assert.equal(median([40, 10, 20, 30]), 25);
  const variants = {
    ...config,
    variants: config.variants.filter(({ id }) =>
      ["full", "no-background-3d"].includes(id),
    ),
  };
  const trials = [];
  for (let runNumber = 1; runNumber <= 3; runNumber += 1) {
    trials.push({
      variantId: "full",
      runNumber,
      validity: { state: "valid", reasons: [] },
      motion: {
        averageFps: 10,
        medianFrameMs: 100,
        p95FrameMs: 120,
        longTaskMs: 20,
      },
    });
    trials.push({
      variantId: "no-background-3d",
      runNumber,
      validity: { state: "valid", reasons: [] },
      motion: {
        averageFps: 50,
        medianFrameMs: 20,
        p95FrameMs: 24,
        longTaskMs: 0,
      },
    });
  }
  const [comparison] = compareVariants(variants, trials);
  assert.equal(comparison.classification, "confirmed");
  assert.equal(comparison.effect.frameDeltaMs, 80);
  assert.equal(comparison.effect.fpsDelta, 40);
});

test("the report contract is versioned and forbids undeclared top-level fields", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../specs/011-diagnose-map-slowness/contracts/map-performance-diagnostic.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("comparisons"));
});

test("B3DM inspection attributes geometry and texture payloads", () => {
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(32, 20);
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: png.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
    accessors: [{ count: 9 }, { count: 9 }],
    images: [{ bufferView: 0, mimeType: "image/tiff" }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    ],
    extensionsUsed: ["KHR_draco_mesh_compression"],
  };
  const jsonBytes = Buffer.from(JSON.stringify(gltf));
  const jsonPadding = Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20);
  const jsonChunk = Buffer.concat([jsonBytes, jsonPadding]);
  const binaryPadding = Buffer.alloc((4 - (png.length % 4)) % 4);
  const binaryChunk = Buffer.concat([png, binaryPadding]);
  const glbLength =
    12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const glb = Buffer.alloc(glbLength);
  glb.write("glTF", 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glbLength, 8);
  glb.writeUInt32LE(jsonChunk.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(glb, 20);
  const binaryHeader = 20 + jsonChunk.length;
  glb.writeUInt32LE(binaryChunk.length, binaryHeader);
  glb.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binaryChunk.copy(glb, binaryHeader + 8);
  const b3dm = Buffer.alloc(28 + glb.length);
  b3dm.write("b3dm", 0);
  b3dm.writeUInt32LE(1, 4);
  b3dm.writeUInt32LE(b3dm.length, 8);
  glb.copy(b3dm, 28);

  const result = inspectB3dm(b3dm, "fixture.b3dm");
  assert.equal(result.vertices, 9);
  assert.equal(result.estimatedTriangles, 3);
  assert.equal(result.imageBytes, 24);
  assert.equal(result.imageDetails[0].detectedMimeType, "image/png");
  assert.equal(result.imageDetails[0].mimeTypeMismatch, true);
  assert.equal(result.estimatedDecodedRGBABytes, 64 * 32 * 4);
  assert.throws(() => inspectB3dm(Buffer.from("invalid"), "bad.b3dm"));
});
