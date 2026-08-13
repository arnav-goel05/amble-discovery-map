import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileOverlayCatalogue,
  stableBuildingIdentity,
} from "../scripts/lib/highlight-overlay-reconcile.mjs";

const resolved = (overrides = {}) => ({
  state: "resolved",
  sourcePath: "6/39/5_0.b3dm",
  sourceSha256: "a".repeat(64),
  batchId: 13,
  gmlId: "building-1",
  gmlName: "One",
  ownerPoiIds: ["poi-a"],
  outputPath: "content/fragment-a.b3dm",
  outputSha256: "b".repeat(64),
  outputBytes: 123,
  boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
  ...overrides,
});

test("stable building identity is independent of path aliases and venue owner", () => {
  assert.equal(
    stableBuildingIdentity({
      sourcePath: "tiles\\6\\39\\5_0.b3dm",
      batchId: 13,
      gmlId: "building-1",
    }),
    stableBuildingIdentity({
      sourcePath: "optimized-tiles/6/39/5_0.b3dm",
      batchId: 13,
      gmlId: "building-1",
    }),
  );
});

test("reconciliation classifies create, update, noop, expire, and review", () => {
  const unchanged = resolved();
  const priorChanged = resolved({
    sourcePath: "6/39/5_1.b3dm",
    gmlId: "building-2",
    outputPath: "content/fragment-b.b3dm",
    outputSha256: "c".repeat(64),
  });
  const expired = resolved({
    sourcePath: "6/39/5_2.b3dm",
    gmlId: "building-3",
    outputPath: "content/fragment-c.b3dm",
    outputSha256: "d".repeat(64),
  });
  const previous = reconcileOverlayCatalogue({
    snapshotId: "snapshot-old",
    evidenceIdentity: "evidence-old",
    records: [unchanged, priorChanged, expired],
  }).catalogue;

  const result = reconcileOverlayCatalogue({
    snapshotId: "snapshot-new",
    evidenceIdentity: "evidence-new",
    records: [
      unchanged,
      resolved({
        sourcePath: "6/39/5_1.b3dm",
        gmlId: "building-2",
        outputPath: "content/fragment-b.b3dm",
        outputSha256: "e".repeat(64),
      }),
      resolved({
        sourcePath: "6/39/5_3.b3dm",
        gmlId: "building-4",
        outputPath: "content/fragment-d.b3dm",
        outputSha256: "f".repeat(64),
      }),
      {
        state: "review",
        sourcePath: "6/39/5_4.b3dm",
        batchId: 99,
        ownerPoiIds: ["poi-review"],
        reason: "batch_out_of_range",
      },
    ],
    previousCatalogue: previous,
  });

  assert.deepEqual(result.counts, {
    create: 1,
    update: 1,
    noop: 1,
    expire: 1,
    review: 1,
  });
  assert.equal(result.catalogue.complete, false);
  assert.equal(result.catalogue.unresolved.length, 1);
});

test("shared building geometry is stored once with all owners", () => {
  const result = reconcileOverlayCatalogue({
    snapshotId: "snapshot",
    evidenceIdentity: "evidence",
    records: [
      resolved({ ownerPoiIds: ["poi-b"] }),
      resolved({ ownerPoiIds: ["poi-a"] }),
    ],
  });
  assert.equal(result.catalogue.buildings.length, 1);
  assert.deepEqual(result.catalogue.buildings[0].ownerPoiIds, [
    "poi-a",
    "poi-b",
  ]);
  assert.equal(result.counts.create, 1);
});

test("fragment identity includes the exact source version provenance", () => {
  const result = reconcileOverlayCatalogue({
    snapshotId: "snapshot",
    evidenceIdentity: "evidence",
    records: [
      resolved({ sourceSha256: "a".repeat(64) }),
      resolved({
        sourceSha256: "c".repeat(64),
        outputPath: "content/fragment-historical.b3dm",
        outputSha256: "d".repeat(64),
      }),
    ],
  });
  assert.equal(result.catalogue.buildings.length, 1);
  assert.equal(result.catalogue.buildings[0].fragments.length, 2);
  assert.notEqual(
    result.catalogue.buildings[0].fragments[0].fragmentId,
    result.catalogue.buildings[0].fragments[1].fragmentId,
  );
});
