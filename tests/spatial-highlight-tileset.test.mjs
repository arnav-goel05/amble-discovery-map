import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpatialHighlightTileset,
  validateSpatialHighlightTileset,
} from "../scripts/lib/spatial-highlight-tileset.mjs";

const region = (offset = 0) => [1 + offset, 0.02, 1.01 + offset, 0.03, 0, 80];

function sourceTile(uri, geometricError, children = []) {
  return {
    boundingVolume: { region: region() },
    geometricError,
    refine: "REPLACE",
    content: { uri },
    children,
  };
}

function fixtureSource() {
  return {
    asset: { version: "1.0" },
    geometricError: 32,
    root: {
      boundingVolume: { region: region() },
      geometricError: 32,
      refine: "ADD",
      children: [
        {
          boundingVolume: { region: region() },
          geometricError: 16,
          children: [
            sourceTile("5/19/3_2.b3dm", 4, [
              sourceTile("5/19/3_1.b3dm", 2, [sourceTile("5/19/3_0.b3dm", 0)]),
            ]),
          ],
        },
      ],
    },
  };
}

const fragments = (poiId, levels = [0, 1, 2]) =>
  levels.map((level) => ({
    sourceTile: `tiles/5/19/3_${level}.b3dm`,
    poiFile: `3_${level}-${poiId}.b3dm`,
    poiSha256: `${level}`.repeat(64),
  }));

test("builds a sparse hierarchy that directly selects the finest fragment", () => {
  const tileset = buildSpatialHighlightTileset({
    sourceTileset: fixtureSource(),
    venues: [
      {
        poi: { id: "venue-one", label: "Venue One" },
        fragments: fragments("one"),
        resolveContentUri: ({ fragment }) => `../venue-one/${fragment.poiFile}`,
      },
    ],
  });

  const branch = tileset.root.children[0].children[0];
  assert.equal(branch.extras.poiId, "venue-one");
  assert.equal(branch.extras.level, 0);
  assert.equal(branch.refine, "ADD");
  assert.equal(branch.geometricError, 0);
  assert.equal(branch.content.uri, "../venue-one/3_0-one.b3dm");
  assert.equal(branch.children, undefined);
  assert.equal(branch.extras.sourceFragmentCount, 3);
  assert.equal(tileset.extras.externalTilesetCount, 0);
  assert.equal(tileset.extras.fragmentCount, 1);
  assert.equal(tileset.extras.sourceFragmentCount, 3);
  assert.equal(tileset.extras.spatialNodeCount, 2);
});

test("keeps venues sharing a source tile in independent deterministic branches", () => {
  const input = [
    {
      poi: { id: "venue-z", label: "Venue Z" },
      fragments: fragments("z"),
      resolveContentUri: ({ fragment }) => `../venue-z/${fragment.poiFile}`,
    },
    {
      poi: { id: "venue-a", label: "Venue A" },
      fragments: fragments("a"),
      resolveContentUri: ({ fragment }) => `../venue-a/${fragment.poiFile}`,
    },
  ];
  const first = buildSpatialHighlightTileset({
    sourceTileset: fixtureSource(),
    venues: input,
  });
  const second = buildSpatialHighlightTileset({
    sourceTileset: fixtureSource(),
    venues: [...input].reverse(),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.root.children[0].children.map((child) => child.extras.poiId),
    ["venue-a", "venue-z"],
  );
});

test("rejects source fragments that are absent from the spatial evidence", () => {
  assert.throws(
    () =>
      buildSpatialHighlightTileset({
        sourceTileset: fixtureSource(),
        venues: [
          {
            poi: { id: "venue-one", label: "Venue One" },
            fragments: [
              {
                sourceTile: "tiles/9/9/9_0.b3dm",
                poiFile: "missing.b3dm",
                poiSha256: "a".repeat(64),
              },
            ],
          },
        ],
      }),
    /venue-one.*source tile.*not present/i,
  );
});

test("rejects unsafe fragment and content paths", () => {
  assert.throws(
    () =>
      buildSpatialHighlightTileset({
        sourceTileset: fixtureSource(),
        venues: [
          {
            poi: { id: "venue-one", label: "Venue One" },
            fragments: [
              {
                sourceTile: "tiles/5/19/3_0.b3dm",
                poiFile: "../secret.b3dm",
                poiSha256: "a".repeat(64),
              },
            ],
          },
        ],
      }),
    /unsafe poiFile/i,
  );

  assert.throws(
    () =>
      buildSpatialHighlightTileset({
        sourceTileset: fixtureSource(),
        venues: [
          {
            poi: { id: "venue-one", label: "Venue One" },
            fragments: fragments("one", [0]),
            resolveContentUri: () => "https://untrusted.example/venue.b3dm",
          },
        ],
      }),
    /unsafe content URI/i,
  );
  assert.throws(
    () =>
      buildSpatialHighlightTileset({
        sourceTileset: fixtureSource(),
        venues: [
          {
            poi: { id: "venue-one", label: "Venue One" },
            fragments: fragments("one", [0]),
            resolveContentUri: () => "../venue-one/different.b3dm",
          },
        ],
      }),
    /unsafe content URI/i,
  );
});

test("supports a valid empty approved catalogue", () => {
  const tileset = buildSpatialHighlightTileset({
    sourceTileset: fixtureSource(),
    venues: [],
  });

  assert.equal(tileset.extras.venueCount, 0);
  assert.equal(tileset.extras.fragmentCount, 0);
  assert.equal(tileset.extras.sourceFragmentCount, 0);
  assert.deepEqual(tileset.root.children, []);
  validateSpatialHighlightTileset([], tileset);
});
