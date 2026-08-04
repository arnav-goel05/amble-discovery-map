import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import {
  buildCombinedPoiTileset,
  loadActivePoiCatalogue,
  validatePoiTilesetParity,
} from "../scripts/build-combined-poi-tileset.mjs";
import { makeTilesetUrisDurable } from "../scripts/event-frontend-snapshot.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const ROOT =
  process.env.PLAYWRIGHT_GEOMETRY_FIXTURE === "1"
    ? path.join(REPOSITORY_ROOT, "outputs/ci-geometry")
    : REPOSITORY_ROOT;

function writeFixture(root) {
  const poiRoot = path.join(root, "public/poi-tiles/venue-one");
  fs.mkdirSync(poiRoot, { recursive: true });
  fs.writeFileSync(path.join(poiRoot, "0.b3dm"), "fixture");
  fs.writeFileSync(
    path.join(poiRoot, "tileset.json"),
    JSON.stringify({
      root: {
        boundingVolume: { region: [1, 0.02, 1.01, 0.03, 0, 80] },
      },
    }),
  );
  fs.writeFileSync(
    path.join(poiRoot, "extraction-manifest.json"),
    JSON.stringify({
      poiId: "venue-one",
      tiles: [
        {
          sourceTile: "tiles/1/2/3_0.b3dm",
          poiFile: "0.b3dm",
          poiSha256: "a".repeat(64),
        },
      ],
    }),
  );
  const sourcePath = path.join(root, "optimized-tiles/tileset.json");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(
    sourcePath,
    JSON.stringify({
      asset: { version: "1.0" },
      geometricError: 8,
      root: {
        boundingVolume: { region: [1, 0.02, 1.01, 0.03, 0, 80] },
        geometricError: 8,
        children: [
          {
            boundingVolume: { region: [1, 0.02, 1.01, 0.03, 0, 80] },
            geometricError: 0,
            content: { uri: "1/2/3_0.b3dm" },
          },
        ],
      },
    }),
  );
  return { poiRoot, sourcePath };
}

test("combined POI parity rejects a venue omitted from the tileset", () => {
  const pois = [{ id: "venue-one" }, { id: "venue-two" }];
  const tileset = {
    root: {
      children: [{ extras: { poiId: "venue-one" } }],
    },
    extras: {
      venueCount: 1,
      venueIds: ["venue-one"],
    },
  };

  assert.throws(
    () => validatePoiTilesetParity(pois, tileset),
    /missing: venue-two/,
  );
});

test("served combined POIs exactly match the active immutable snapshot", () => {
  const { active, pois } = loadActivePoiCatalogue(ROOT);
  const servedTileset = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "public/poi-tiles/event-venues/tileset.json"),
      "utf8",
    ),
  );

  validatePoiTilesetParity(
    pois,
    servedTileset,
    `Served tileset for ${active.snapshotId}`,
  );
});

test("spatial catalogue removes the legacy manifest waterfall and shrinks transfer", () => {
  const { active, pois } = loadActivePoiCatalogue(ROOT);
  const legacyPath = path.join(active.directory, active.tilesetRef);
  const legacyPaths = [
    legacyPath,
    ...pois.map((poi) => path.join(ROOT, "public", poi.data)),
  ];
  const legacyBytes = legacyPaths.reduce(
    (total, file) => total + fs.statSync(file).size,
    0,
  );
  const legacyGzipBytes = legacyPaths.reduce(
    (total, file) => total + zlib.gzipSync(fs.readFileSync(file)).byteLength,
    0,
  );
  const spatialPath = path.join(
    ROOT,
    "public/poi-tiles/event-venues/tileset.json",
  );
  const spatialBytes = fs.statSync(spatialPath).size;
  const spatialGzipBytes = zlib.gzipSync(
    fs.readFileSync(spatialPath),
  ).byteLength;
  const spatial = JSON.parse(fs.readFileSync(spatialPath, "utf8"));
  let sourceFragmentCount = 0;
  const expectedFragments = pois.reduce((total, poi) => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(
          path.dirname(path.join(ROOT, "public", poi.data)),
          "extraction-manifest.json",
        ),
        "utf8",
      ),
    );
    sourceFragmentCount += manifest.tiles.length;
    return (
      total +
      new Set(
        manifest.tiles.map(({ sourceTile }) =>
          sourceTile.replace(/_\d+\.b3dm$/, ""),
        ),
      ).size
    );
  }, 0);

  assert.equal(legacyPaths.length - 1, pois.length);
  assert.equal(spatial.extras.externalTilesetCount, 0);
  assert.equal(spatial.extras.fragmentCount, expectedFragments);
  assert.equal(spatial.extras.sourceFragmentCount, sourceFragmentCount);
  assert.ok(spatialBytes < legacyBytes);
  assert.ok(spatialGzipBytes < legacyGzipBytes);
});

test("builder publishes direct geometry atomically and reports a no-op rebuild", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(process.cwd(), ".tmp-spatial-"));
  try {
    const { sourcePath } = writeFixture(fixtureRoot);
    const outputPath = path.join(
      fixtureRoot,
      "public/poi-tiles/event-venues/tileset.json",
    );
    const options = {
      pois: [
        {
          id: "venue-one",
          label: "Venue One",
          data: "poi-tiles/venue-one/tileset.json",
        },
      ],
      outputPath,
      sourceTilesetPath: sourcePath,
      resolveTilesetPath: (poi) => path.join(fixtureRoot, "public", poi.data),
    };

    const created = buildCombinedPoiTileset(options);
    const before = fs.readFileSync(outputPath, "utf8");
    const rebuilt = buildCombinedPoiTileset(options);

    assert.equal(created.writeOperation, "create");
    assert.equal(rebuilt.writeOperation, "noop");
    assert.equal(fs.readFileSync(outputPath, "utf8"), before);
    assert.equal(created.extras.externalTilesetCount, 0);
    assert.ok(before.includes("../venue-one/0.b3dm"));
    assert.ok(!before.includes("venue-one/tileset.json"));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("invalid rebuild preserves the existing served catalogue", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(process.cwd(), ".tmp-spatial-"));
  try {
    const { poiRoot, sourcePath } = writeFixture(fixtureRoot);
    const outputPath = path.join(
      fixtureRoot,
      "public/poi-tiles/event-venues/tileset.json",
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, "approved-before\n");
    fs.rmSync(path.join(poiRoot, "0.b3dm"));

    assert.throws(
      () =>
        buildCombinedPoiTileset({
          pois: [
            {
              id: "venue-one",
              label: "Venue One",
              data: "poi-tiles/venue-one/tileset.json",
            },
          ],
          outputPath,
          sourceTilesetPath: sourcePath,
          resolveTilesetPath: (poi) =>
            path.join(fixtureRoot, "public", poi.data),
        }),
      /missing highlight fragment/i,
    );
    assert.equal(fs.readFileSync(outputPath, "utf8"), "approved-before\n");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("immutable snapshots rewrite nested direct highlight content durably", () => {
  const tileset = {
    root: {
      children: [
        {
          children: [
            {
              content: {
                uri: "/poi-tiles/venue-one/0.b3dm",
              },
            },
          ],
        },
      ],
    },
  };

  makeTilesetUrisDurable(tileset);

  assert.equal(
    tileset.root.children[0].children[0].content.uri,
    "../../../../poi-tiles/venue-one/0.b3dm",
  );
});
