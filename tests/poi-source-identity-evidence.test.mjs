import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  indexPoiSourceIdentityEvidence,
  loadApprovedPoiCatalogue,
  normalizeSourceTile,
} from "../scripts/lib/poi-source-identity-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("checked-in source identity evidence exactly covers the active POI catalogue", async () => {
  const active = loadApprovedPoiCatalogue({ root });
  const evidence = JSON.parse(
    await readFile(
      path.join(root, "data/poi-source-identity-evidence.json"),
      "utf8",
    ),
  );
  const records = indexPoiSourceIdentityEvidence({
    evidence,
    expectedSnapshotId: active.snapshotId,
  });
  const pois = active.pois;
  const expectedSources = new Set();
  for (const poi of pois) {
    const manifest = JSON.parse(
      await readFile(
        path.join(
          root,
          "public",
          path.dirname(poi.data),
          "extraction-manifest.json",
        ),
        "utf8",
      ),
    );
    for (const tile of manifest.tiles) {
      const sourceTile = normalizeSourceTile(tile.sourceTile);
      expectedSources.add(sourceTile);
      const record = records.get(sourceTile);
      assert.ok(record, `missing ${sourceTile}`);
      assert.equal(record.sourceSha256, tile.sourceSha256);
      assert.deepEqual(
        tile.originalBatchIds.map((batchId) => record.gmlIds[batchId]),
        tile.gmlIds,
      );
    }
  }
  assert.equal(records.size, expectedSources.size);
  assert.equal(records.size, 665);
});

test("source identity evidence rejects snapshot, hash, and coverage drift", async () => {
  const original = JSON.parse(
    await readFile(
      path.join(root, "data/poi-source-identity-evidence.json"),
      "utf8",
    ),
  );
  assert.throws(
    () =>
      indexPoiSourceIdentityEvidence({
        evidence: original,
        expectedSnapshotId: "different-snapshot",
      }),
    /snapshot mismatch/,
  );
  const invalidHash = structuredClone(original);
  invalidHash.records[0].sourceSha256 = "invalid";
  assert.throws(
    () => indexPoiSourceIdentityEvidence({ evidence: invalidHash }),
    /invalid source hash/,
  );
  const duplicate = structuredClone(original);
  duplicate.records.push(structuredClone(duplicate.records[0]));
  assert.throws(
    () => indexPoiSourceIdentityEvidence({ evidence: duplicate }),
    /duplicated/,
  );
});
