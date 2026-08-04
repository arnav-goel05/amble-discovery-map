import assert from "node:assert/strict";
import test from "node:test";

import {
  collectApprovedBackgroundEntries,
  collectTilesetReleaseEntries,
  reconcileReleaseEntries,
} from "../scripts/lib/background-release-hydration.mjs";

const origin = new URL("https://example.test/");
const firstHash = "a".repeat(64);
const secondHash = "b".repeat(64);
const pois = [
  {
    id: "venue-one",
    data: "poi-tiles/venue-one/tileset.json",
    tiles: {
      "tiles/3/5/1_0.b3dm": [0],
      "tiles/3/5/1_1.b3dm": [0],
    },
  },
];
const extraction = {
  poiId: "venue-one",
  tiles: [
    {
      sourceTile: "tiles/3/5/1_0.b3dm",
      backgroundFile: "optimized-tiles/3/5/1_0.b3dm",
      backgroundSha256: firstHash,
    },
    {
      sourceTile: "tiles/3/5/1_1.b3dm",
      backgroundFile: "optimized-tiles/3/5/1_1.b3dm",
      backgroundSha256: secondHash,
    },
  ],
};

test("release hydration includes approved objects omitted from visible geometry", () => {
  const servedEntries = collectTilesetReleaseEntries({
    origin,
    tileset: {
      root: {
        content: { uri: "3/5/1_0.b3dm" },
        extras: {
          backgroundObjectSha256: firstHash,
          omittedContentUris: ["3/5/1_1.b3dm"],
        },
      },
    },
  });
  const approvedEntries = collectApprovedBackgroundEntries({
    pois,
    origin,
    readExtractionManifest: () => extraction,
  });

  assert.equal(servedEntries.length, 1);
  assert.equal(approvedEntries.length, 2);
  assert.deepEqual(
    reconcileReleaseEntries({
      servedEntries,
      approvedEntries,
      expectedCount: 2,
    }).map(({ pathname, sha256 }) => ({ pathname, sha256 })),
    [
      { pathname: "3/5/1_0.b3dm", sha256: firstHash },
      { pathname: "3/5/1_1.b3dm", sha256: secondHash },
    ],
  );
});

test("release hydration rejects served hashes that differ from approval", () => {
  const approvedEntries = collectApprovedBackgroundEntries({
    pois,
    origin,
    readExtractionManifest: () => extraction,
  });
  assert.throws(
    () =>
      reconcileReleaseEntries({
        servedEntries: [
          {
            pathname: "3/5/1_0.b3dm",
            sha256: secondHash,
          },
        ],
        approvedEntries,
        expectedCount: 2,
      }),
    /hash differs from approval/,
  );
});

test("release hydration requires the exact approved object count", () => {
  const approvedEntries = collectApprovedBackgroundEntries({
    pois,
    origin,
    readExtractionManifest: () => extraction,
  });
  assert.throws(
    () =>
      reconcileReleaseEntries({
        servedEntries: [],
        approvedEntries,
        expectedCount: 3,
      }),
    /approved object count mismatch/,
  );
});
