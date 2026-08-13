import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildBuildingReleaseInventory,
  collectContentUris,
  releaseObjectKey,
  verifyPublishedBuildingRelease,
} from "../scripts/lib/building-release-publish.mjs";

const b3dm = Buffer.concat([Buffer.from("b3dm"), Buffer.alloc(28)]);

test("building release inventory is exact, immutable, and evidence-bound", async () => {
  const outputRoot = mkdtempSync(path.join(os.tmpdir(), "building-release-"));
  mkdirSync(path.join(outputRoot, "background-lite/a"), { recursive: true });
  mkdirSync(path.join(outputRoot, "overlays/content"), { recursive: true });
  writeFileSync(path.join(outputRoot, "background-lite/a/tile.b3dm"), b3dm);
  writeFileSync(path.join(outputRoot, "overlays/content/overlay.b3dm"), b3dm);
  const sha256 = "f".repeat(64);
  const report = {
    complete: true,
    overlays: { snapshotId: "snapshot" },
    validation: {
      browser: true,
      identityParity: true,
      sourceProvenance: true,
      rollbackReady: true,
    },
    background: {
      excludedCount: 52,
      records: [
        {
          canonicalPath: "a/tile.b3dm",
          outputSha256: sha256,
          outputBytes: b3dm.length,
        },
      ],
    },
    payload: {
      uniqueBackgroundTileCount: 53,
      uniqueOverlayAssetCount: 1,
      backgroundBytes: b3dm.length,
      overlayBytes: b3dm.length,
    },
  };
  const actualHash = await import("node:crypto").then(({ createHash }) =>
    createHash("sha256").update(b3dm).digest("hex"),
  );
  report.background.records[0].outputSha256 = actualHash;
  const inventory = buildBuildingReleaseInventory({
    outputRoot,
    report,
    backgroundTileset: {
      root: { content: { uri: "a/tile.b3dm" } },
    },
    overlayTileset: {
      root: { content: { uri: "content/overlay.b3dm" } },
    },
    overlayCatalogue: {
      catalogueId: "catalogue",
      buildings: [
        {
          fragments: [
            {
              outputPath: "content/overlay.b3dm",
              outputSha256: actualHash,
              outputBytes: b3dm.length,
            },
          ],
        },
      ],
    },
  });
  assert.equal(inventory.background.length, 1);
  assert.equal(inventory.overlays.length, 1);
  assert.match(inventory.releaseId, /^[a-f0-9]{16}$/u);
  assert.equal(
    releaseObjectKey("overlay", inventory.releaseId, "content/a.b3dm"),
    `poi-tiles/releases/${inventory.releaseId}/content/a.b3dm`,
  );
});

test("content traversal deduplicates and rejects unsafe paths", () => {
  assert.deepEqual(
    collectContentUris({
      root: {
        content: { uri: "a.b3dm" },
        children: [{ content: { uri: "a.b3dm" } }],
      },
    }),
    ["a.b3dm"],
  );
});

test("published release verification binds immutable URLs, hashes, and counts", async () => {
  const { createHash } = await import("node:crypto");
  const releaseId = "a".repeat(16);
  const bytes = Buffer.from(
    `${JSON.stringify({ root: { content: { uri: "tile.b3dm" } } })}\n`,
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const descriptor = {
    releaseId,
    background: {
      tilesetUrl: `optimized-tiles/releases/${releaseId}/tileset.json`,
      manifestSha256: sha256,
      objectCount: 1,
    },
    overlays: {
      tilesetUrl: `poi-tiles/releases/${releaseId}/tileset.json`,
      manifestSha256: sha256,
      objectCount: 1,
    },
  };
  const report = await verifyPublishedBuildingRelease({
    descriptor,
    origin: "https://example.test",
    fetchImpl: async () => new Response(bytes),
  });
  assert.equal(report.complete, true);
  assert.equal(report.objectCount, 2);
  await assert.rejects(
    verifyPublishedBuildingRelease({
      descriptor: {
        ...descriptor,
        background: {
          ...descriptor.background,
          tilesetUrl: "optimized-tiles/tileset.json",
        },
      },
      origin: "https://example.test",
      fetchImpl: async () => new Response(bytes),
    }),
    /immutable release path/u,
  );
});
