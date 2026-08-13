import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  indexTileset,
  inventorySource,
  runBackgroundLite,
  sha256,
} from "../scripts/lib/background-lite-run.mjs";
import { createSyntheticSource } from "./fixtures/background-lite-local/fixture.mjs";

const temporaryRoot = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "background-source-exclusion-"));

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function createLedger(root, excludedPath) {
  const sourceRoot = path.join(root, "tiles");
  const canonicalExcludedPath = excludedPath.replace(/^\.\//u, "");
  const failurePath = path.join(sourceRoot, "download-failures.json");
  const descriptorPath = path.join(
    root,
    "data/background-geometry-release.json",
  );
  const providerUrl = `https://www.onemap.gov.sg/omapi/tilesets/sg_noterrain_tiles/${canonicalExcludedPath}`;
  writeJson(failurePath, [
    {
      uri: canonicalExcludedPath,
      url: providerUrl,
      error: `Failed 403 ${providerUrl}`,
    },
  ]);
  writeJson(descriptorPath, {
    releaseId: "fixture-release",
    manifestSha256: "a".repeat(64),
  });
  writeJson(path.join(root, "data/background-source-exclusions.json"), {
    schemaVersion: "background-source-exclusions-v1",
    sourceTilesetSha256: sha256(
      fs.readFileSync(path.join(sourceRoot, "tileset.json")),
    ),
    providerFailureEvidence: {
      path: "tiles/download-failures.json",
      sha256: sha256(fs.readFileSync(failurePath)),
      requiredStatus: 403,
      urlRoot: "https://www.onemap.gov.sg/omapi/tilesets/sg_noterrain_tiles/",
    },
    releaseEvidence: {
      descriptorPath: "data/background-geometry-release.json",
      descriptorSha256: sha256(fs.readFileSync(descriptorPath)),
      releaseId: "fixture-release",
      tilesetSha256: "a".repeat(64),
    },
    reason: "fixture-authoritative-exclusion",
    paths: [canonicalExcludedPath],
  });
}

test("a hash-bound provider exclusion is terminal while descendants remain reachable", async () => {
  const root = temporaryRoot();
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 2 });
    const tilesetPath = path.join(sourceRoot, "tileset.json");
    const tileset = JSON.parse(fs.readFileSync(tilesetPath));
    const [excludedNode, descendantNode] = tileset.root.children;
    excludedNode.children = [descendantNode];
    tileset.root.children = [excludedNode];
    fs.writeFileSync(tilesetPath, JSON.stringify(tileset));
    const excludedPath = excludedNode.content.uri;
    const canonicalExcludedPath = excludedPath.replace(/^\.\//u, "");
    const canonicalDescendantPath = descendantNode.content.uri.replace(
      /^\.\//u,
      "",
    );
    fs.rmSync(path.join(sourceRoot, excludedPath));
    createLedger(root, excludedPath);

    const inventory = inventorySource({ sourceRoot });
    assert.equal(inventory.totalRecordCount, 2);
    assert.deepEqual(
      inventory.exclusions.map(({ canonicalPath, outcome }) => ({
        canonicalPath,
        outcome,
      })),
      [{ canonicalPath: canonicalExcludedPath, outcome: "excluded" }],
    );
    assert.deepEqual(
      inventory.records.map(({ canonicalPath }) => canonicalPath),
      [canonicalDescendantPath],
    );

    const outputRoot = path.join(root, "output");
    const report = await runBackgroundLite({
      sourceRoot,
      outputRoot,
      reserveBytes: 0,
    });
    assert.equal(report.complete, true);
    assert.equal(report.excludedCount, 1);
    assert.deepEqual(report.outcomes, {
      processed: 1,
      resumed: 0,
      excluded: 1,
      failed: 0,
      terminal: 2,
    });
    const outputTileset = JSON.parse(
      fs.readFileSync(path.join(outputRoot, "background-lite/tileset.json")),
    );
    assert.deepEqual(
      indexTileset(outputTileset).map(({ canonicalPath }) => canonicalPath),
      [canonicalDescendantPath],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the exclusion contract rejects any unrecorded missing path or changed evidence", async () => {
  const root = temporaryRoot();
  try {
    const { sourceRoot } = await createSyntheticSource(root, { count: 2 });
    const tileset = JSON.parse(
      fs.readFileSync(path.join(sourceRoot, "tileset.json")),
    );
    const [first, second] = tileset.root.children.map(
      (node) => node.content.uri,
    );
    fs.rmSync(path.join(sourceRoot, first));
    createLedger(root, first);
    fs.rmSync(path.join(sourceRoot, second));
    assert.throws(
      () => inventorySource({ sourceRoot }),
      /do not exactly match/u,
    );

    fs.writeFileSync(
      path.join(sourceRoot, second),
      "not-needed-for-ledger-check",
    );
    fs.appendFileSync(path.join(sourceRoot, "download-failures.json"), " ");
    assert.throws(
      () => inventorySource({ sourceRoot }),
      /Provider failure evidence hash changed/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
