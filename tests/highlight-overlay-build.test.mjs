import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

import {
  b3dmIdentity,
  inspectGlb,
  readB3dm,
  writeB3dm,
} from "../scripts/lib/background-lite-b3dm.mjs";
import {
  buildSparseAssetHierarchy,
  buildOverlayCatalogue,
  deriveHighlightEvidence,
  extractOverlayFragment,
  selectCanonicalHighlightRecords,
} from "../scripts/lib/highlight-overlay-build.mjs";
import { assertOverlayCatalogueContract } from "../scripts/lib/highlight-overlay-reconcile.mjs";
import { sha256 } from "../scripts/lib/background-lite-run.mjs";

const pad = (value) => {
  let json = JSON.stringify(value);
  while (Buffer.byteLength(json) % 8) json += " ";
  return Buffer.from(json);
};

async function fixtureB3dm() {
  const image = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 19, g: 99, b: 171 },
    },
  })
    .png()
    .toBuffer();
  const document = new Document();
  const buffer = document.createBuffer();
  const texture = document
    .createTexture("original-colour")
    .setImage(image)
    .setMimeType("image/png");
  const material = document
    .createMaterial("original-material")
    .setBaseColorTexture(texture);
  const primitive = document
    .createPrimitive()
    .setIndices(
      document
        .createAccessor()
        .setType(Accessor.Type.SCALAR)
        .setArray(new Uint16Array([0, 1, 2, 3, 4, 5]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "POSITION",
      document
        .createAccessor()
        .setType(Accessor.Type.VEC3)
        .setArray(
          new Float32Array([
            0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
          ]),
        )
        .setBuffer(buffer),
    )
    .setAttribute(
      "_BATCHID",
      document
        .createAccessor()
        .setType(Accessor.Type.SCALAR)
        .setArray(new Uint16Array([0, 0, 0, 1, 1, 1]))
        .setBuffer(buffer),
    )
    .setMaterial(material);
  const mesh = document.createMesh().addPrimitive(primitive);
  document.createNode().setMesh(mesh);
  document.createScene().addChild(document.getRoot().listNodes()[0]);
  const glb = Buffer.from(await new NodeIO().writeBinary(document));
  return writeB3dm(
    {
      header: { version: 1 },
      featureTableJson: pad({ BATCH_LENGTH: 2 }),
      featureTableBinary: Buffer.alloc(0),
      batchTableJson: pad({
        "gml:id": ["building-a", "building-b"],
        "gml:name": ["Building A", "Building B"],
      }),
      batchTableBinary: Buffer.alloc(0),
    },
    glb,
  );
}

function writeApprovedEvidence(root, poiId, tiles) {
  const directory = path.join(root, poiId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "extraction-manifest.json"),
    JSON.stringify({ schemaVersion: "1.0", poiId, tiles }),
  );
}

function replaceFixtureIdentities(bytes, gmlIds, gmlNames = gmlIds) {
  const parts = readB3dm(bytes);
  const table = JSON.parse(parts.batchTableJson.toString("utf8").trim());
  table["gml:id"] = gmlIds;
  table["gml:name"] = gmlNames;
  parts.batchTableJson = pad(table);
  return writeB3dm(parts, parts.glb);
}

test("source evidence resolves canonical identities and reports ambiguity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-evidence-"));
  const sourceRoot = path.join(root, "tiles");
  fs.mkdirSync(path.join(sourceRoot, "1"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "1/tile.b3dm"), await fixtureB3dm());
  fs.writeFileSync(
    path.join(sourceRoot, "tileset.json"),
    JSON.stringify({
      asset: { version: "1.0" },
      geometricError: 0,
      root: {
        boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
        geometricError: 0,
        content: { uri: "1/tile.b3dm" },
      },
    }),
  );
  const evidence = deriveHighlightEvidence({
    snapshotId: "snapshot-1",
    sourceRoot,
    pois: [
      { id: "one", names: ["Building A"], tiles: { "tiles/1/tile.b3dm": [0] } },
      {
        id: "shared",
        names: ["Building A"],
        tiles: { "optimized-tiles/1/tile.b3dm": [1] },
      },
      { id: "bad", names: ["Wrong"], tiles: { "tiles/1/tile.b3dm": [1] } },
      { id: "missing", names: ["None"], tiles: { "tiles/1/tile.b3dm": [9] } },
      {
        id: "ambiguous",
        names: ["Building A", "Building B"],
        tiles: { "tiles/1/tile.b3dm": [9] },
      },
    ],
  });
  assert.equal(evidence.resolved.length, 1);
  assert.deepEqual(evidence.resolved[0].ownerPoiIds, ["one", "shared"]);
  assert.equal(evidence.resolved[0].batchId, 0);
  assert.equal(evidence.review.length, 3);
  assert.deepEqual(evidence.review.map((record) => record.reason).sort(), [
    "batch_name_ambiguous",
    "batch_name_not_found",
    "batch_out_of_range",
  ]);
});

test("unique name recovery is rejected when LOD siblings disagree on identity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-lod-"));
  const sourceRoot = path.join(root, "tiles");
  fs.mkdirSync(path.join(sourceRoot, "1"), { recursive: true });
  const first = await fixtureB3dm();
  const secondParts = readB3dm(first);
  const secondTable = JSON.parse(
    secondParts.batchTableJson.toString("utf8").trim(),
  );
  secondTable["gml:id"][0] = "different-building-a";
  secondParts.batchTableJson = pad(secondTable);
  const second = writeB3dm(secondParts, secondParts.glb);
  fs.writeFileSync(path.join(sourceRoot, "1/tile_0.b3dm"), first);
  fs.writeFileSync(path.join(sourceRoot, "1/tile_1.b3dm"), second);
  fs.writeFileSync(
    path.join(sourceRoot, "tileset.json"),
    JSON.stringify({
      asset: { version: "1.0" },
      geometricError: 0,
      root: {
        boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
        geometricError: 0,
        children: ["tile_0.b3dm", "tile_1.b3dm"].map((uri) => ({
          boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
          geometricError: 0,
          content: { uri: `1/${uri}` },
        })),
      },
    }),
  );
  const evidence = deriveHighlightEvidence({
    snapshotId: "snapshot",
    sourceRoot,
    pois: [
      {
        id: "one",
        names: ["Building A"],
        tiles: {
          "tiles/1/tile_0.b3dm": [1],
          "tiles/1/tile_1.b3dm": [1],
        },
      },
    ],
  });
  assert.equal(evidence.resolved.length, 0);
  assert.deepEqual(
    evidence.review.map(({ reason }) => reason),
    ["lod_identity_disagreement", "lod_identity_disagreement"],
  );
});

test("approved gml:id evidence recovers a moved batch without trusting names", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-gml-recovery-"));
  const sourceRoot = path.join(root, "tiles");
  const approvedOverlayRoot = path.join(root, "approved-overlays");
  fs.mkdirSync(path.join(sourceRoot, "1"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "1/tile.b3dm"), await fixtureB3dm());
  fs.writeFileSync(
    path.join(sourceRoot, "tileset.json"),
    JSON.stringify({
      asset: { version: "1.0" },
      geometricError: 0,
      root: {
        boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
        geometricError: 0,
        content: { uri: "1/tile.b3dm" },
      },
    }),
  );
  writeApprovedEvidence(approvedOverlayRoot, "moved", [
    {
      sourceTile: "tiles/1/tile.b3dm",
      originalBatchIds: [1],
      gmlIds: ["building-a"],
      gmlNames: ["Old approved name"],
    },
  ]);
  const evidence = deriveHighlightEvidence({
    snapshotId: "snapshot",
    sourceRoot,
    approvedOverlayRoot,
    pois: [
      {
        id: "moved",
        names: ["Name that cannot match"],
        tiles: { "tiles/1/tile.b3dm": [1] },
      },
    ],
  });
  assert.equal(evidence.review.length, 0);
  assert.equal(evidence.resolved.length, 1);
  assert.equal(evidence.resolved[0].requestedBatchId, 1);
  assert.equal(evidence.resolved[0].batchId, 0);
  assert.equal(evidence.resolved[0].gmlId, "building-a");
  assert.equal(evidence.resolved[0].resolution, "approved_gml_id_recovery");
});

test("approved gml:id absence stays in review instead of falling back to a name", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-gml-missing-"));
  const sourceRoot = path.join(root, "tiles");
  const approvedOverlayRoot = path.join(root, "approved-overlays");
  fs.mkdirSync(path.join(sourceRoot, "1"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "1/tile.b3dm"), await fixtureB3dm());
  fs.writeFileSync(
    path.join(sourceRoot, "tileset.json"),
    JSON.stringify({
      asset: { version: "1.0" },
      geometricError: 0,
      root: {
        boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
        geometricError: 0,
        content: { uri: "1/tile.b3dm" },
      },
    }),
  );
  writeApprovedEvidence(approvedOverlayRoot, "changed", [
    {
      sourceTile: "tiles/1/tile.b3dm",
      originalBatchIds: [0],
      gmlIds: ["retired-building-id"],
      gmlNames: ["Building A"],
    },
  ]);
  const evidence = deriveHighlightEvidence({
    snapshotId: "snapshot",
    sourceRoot,
    approvedOverlayRoot,
    pois: [
      {
        id: "changed",
        names: ["Building A"],
        tiles: { "tiles/1/tile.b3dm": [0] },
      },
    ],
  });
  assert.equal(evidence.resolved.length, 0);
  assert.equal(evidence.review.length, 1);
  assert.equal(evidence.review[0].reason, "approved_gml_id_not_found");
  assert.equal(evidence.review[0].approvedGmlId, "retired-building-id");
});

test("exact snapshot-bound pristine source evidence resolves a retired current identity without inference", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-legacy-exact-"));
  const sourceRoot = path.join(root, "tiles");
  const approvedOverlayRoot = path.join(root, "public", "poi-tiles");
  const evidencePath = path.join(
    root,
    "data",
    "poi-source-identity-evidence.json",
  );
  fs.mkdirSync(path.join(sourceRoot, "1"), { recursive: true });
  fs.mkdirSync(path.join(approvedOverlayRoot, "source", "1"), {
    recursive: true,
  });
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const current = await fixtureB3dm();
  const legacy = replaceFixtureIdentities(
    current,
    ["retired-building-id", "building-b"],
    ["Retired approved building", "Building B"],
  );
  const legacyFragment = await extractOverlayFragment(legacy, { batchId: 0 });
  fs.writeFileSync(path.join(sourceRoot, "1/tile.b3dm"), current);
  fs.writeFileSync(
    path.join(approvedOverlayRoot, "source", "1/tile.b3dm"),
    legacy,
  );
  fs.mkdirSync(path.join(approvedOverlayRoot, "changed"), { recursive: true });
  fs.writeFileSync(
    path.join(approvedOverlayRoot, "changed", "retired.b3dm"),
    legacyFragment,
  );
  fs.writeFileSync(
    path.join(sourceRoot, "tileset.json"),
    JSON.stringify({
      asset: { version: "1.0" },
      geometricError: 0,
      root: {
        boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
        geometricError: 0,
        content: { uri: "1/tile.b3dm" },
      },
    }),
  );
  writeApprovedEvidence(approvedOverlayRoot, "changed", [
    {
      sourceTile: "tiles/1/tile.b3dm",
      sourceSha256: sha256(legacy),
      originalBatchIds: [0],
      gmlIds: ["retired-building-id"],
      gmlNames: ["Retired approved building"],
      poiFile: "retired.b3dm",
      poiSha256: sha256(legacyFragment),
      poiTriangles: inspectGlb(readB3dm(legacyFragment).glb).triangles,
    },
  ]);
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({
      schemaVersion: "poi-source-identity-evidence-v1",
      snapshotId: "snapshot",
      records: [
        {
          sourceTile: "tiles/1/tile.b3dm",
          sourceSha256: sha256(legacy),
          gmlIds: ["retired-building-id", "building-b"],
        },
      ],
    }),
  );
  const options = {
    snapshotId: "snapshot",
    sourceRoot,
    approvedOverlayRoot,
    approvedSourceEvidencePath: evidencePath,
    pois: [
      {
        id: "changed",
        names: ["Building A"],
        tiles: { "tiles/1/tile.b3dm": [0] },
      },
    ],
  };
  const evidence = deriveHighlightEvidence(options);
  assert.equal(evidence.review.length, 0);
  assert.equal(evidence.resolved.length, 1);
  assert.equal(evidence.resolved[0].gmlId, "retired-building-id");
  assert.equal(
    evidence.resolved[0].sourceAuthority,
    "approved_pristine_source_cache",
  );
  assert.equal(evidence.resolved[0].sourceSha256, sha256(legacy));
  assert.equal(evidence.resolved[0].sourceProvenance.exactIdentityOnly, true);
  assert.equal(
    evidence.resolved[0].sourceProvenance.inferredByNameOrPosition,
    false,
  );

  const built = await buildOverlayCatalogue({
    ...options,
    outputRoot: path.join(root, "output"),
  });
  assert.equal(built.complete, true);
  const fragment = built.catalogue.buildings[0].fragments[0];
  assert.equal(fragment.gmlId, "retired-building-id");
  assert.equal(fragment.sourceSha256, sha256(legacy));
  assert.equal(fragment.sourceAuthority, "approved_pristine_source_cache");
  const outputIdentity = b3dmIdentity(
    readB3dm(fs.readFileSync(path.join(root, "output", fragment.outputPath))),
  );
  assert.deepEqual(outputIdentity.gmlIds, ["retired-building-id"]);

  fs.appendFileSync(
    path.join(approvedOverlayRoot, "changed", "retired.b3dm"),
    "corrupt",
  );
  const corrupt = deriveHighlightEvidence(options);
  assert.equal(corrupt.resolved.length, 0);
  assert.equal(corrupt.review[0].reason, "approved_gml_id_not_found");
  assert.equal(
    corrupt.review[0].exactLegacyEvidenceFailure,
    "approved_legacy_fragment_hash_mismatch",
  );

  fs.writeFileSync(
    path.join(approvedOverlayRoot, "changed", "retired.b3dm"),
    legacyFragment,
  );
  const evidenceDocument = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({ ...evidenceDocument, snapshotId: "stale-snapshot" }),
  );
  const stale = deriveHighlightEvidence(options);
  assert.equal(stale.resolved.length, 0);
  assert.equal(
    stale.review[0].exactLegacyEvidenceFailure,
    "approved_source_identity_evidence_invalid",
  );

  fs.writeFileSync(evidencePath, JSON.stringify(evidenceDocument));
  fs.appendFileSync(
    path.join(approvedOverlayRoot, "source", "1/tile.b3dm"),
    "corrupt",
  );
  const changedSource = deriveHighlightEvidence(options);
  assert.equal(changedSource.resolved.length, 0);
  assert.equal(
    changedSource.review[0].exactLegacyEvidenceFailure,
    "approved_pristine_source_hash_mismatch",
  );
});

test("fragment extraction keeps selected identity and original texture bytes", async () => {
  const source = await fixtureB3dm();
  const output = await extractOverlayFragment(source, { batchId: 1 });
  const parts = readB3dm(output);
  const table = JSON.parse(parts.batchTableJson.toString("utf8").trim());
  assert.deepEqual(table["gml:id"], ["building-b"]);
  const io = new NodeIO();
  const before = await io.readBinary(new Uint8Array(readB3dm(source).glb));
  const after = await io.readBinary(new Uint8Array(parts.glb));
  assert.deepEqual(
    Buffer.from(after.getRoot().listTextures()[0].getImage()),
    Buffer.from(before.getRoot().listTextures()[0].getImage()),
  );
  const batchIds = after
    .getRoot()
    .listMeshes()[0]
    .listPrimitives()[0]
    .getAttribute("_BATCHID")
    .getArray();
  assert.deepEqual([...batchIds], [0, 0, 0]);
});

test("canonical selection keeps one finest source LOD per building and merges owners", () => {
  const sourceTileset = {
    root: {
      content: { uri: "1/tile_2.b3dm" },
      geometricError: 8,
      children: [
        {
          content: { uri: "1/tile_1.b3dm" },
          geometricError: 2,
          children: [
            {
              content: { uri: "1/tile_0.b3dm" },
              geometricError: 0,
            },
          ],
        },
      ],
    },
  };
  const record = (sourcePath, ownerPoiIds) => ({
    state: "resolved",
    sourcePath,
    sourceSha256: sourcePath.padEnd(64, "a").slice(0, 64),
    sourceAuthority: "active_original_source_corpus",
    batchId: 1,
    gmlId: "building-a",
    ownerPoiIds,
  });
  const result = selectCanonicalHighlightRecords({
    records: [
      record("1/tile_2.b3dm", ["poi-a"]),
      record("1/tile_1.b3dm", ["poi-a"]),
      record("1/tile_0.b3dm", ["poi-b"]),
    ],
    sourceTileset,
  });
  assert.equal(result.sourceClaimCount, 3);
  assert.equal(result.review.length, 0);
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].sourcePath, "1/tile_0.b3dm");
  assert.deepEqual(result.resolved[0].ownerPoiIds, ["poi-a", "poi-b"]);
  assert.deepEqual(result.resolved[0].lodSelection, {
    strategy: "minimum-source-geometric-error",
    sourceClaimCount: 3,
    selectedGeometricError: 0,
  });
});

test("catalogue contract rejects duplicate reachable LOD geometry", () => {
  const fragment = {
    fragmentId: "fragment-a",
    assetId: "asset-a",
    outputPath: "content/a.b3dm",
  };
  const catalogue = {
    buildings: [
      {
        buildingIdentity: "building-a",
        fragments: [fragment, { ...fragment, fragmentId: "fragment-b" }],
      },
    ],
  };
  assert.throws(
    () =>
      assertOverlayCatalogueContract({
        catalogue,
        tileset: { root: { children: [] } },
      }),
    /reachable exactly once/u,
  );
});

test("sparse overlay attaches finest content beside the coarsest LOD branch", () => {
  const region = [1, 2, 3, 4, 0, 10];
  const sourceRoot = {
    boundingVolume: { region },
    geometricError: 100,
    refine: "ADD",
    children: [
      {
        boundingVolume: { region },
        geometricError: 50,
        content: { uri: "1/tile_2.b3dm" },
        children: [
          {
            boundingVolume: { region },
            geometricError: 2,
            content: { uri: "1/tile_1.b3dm" },
            children: [
              {
                boundingVolume: { region },
                geometricError: 0,
                content: { uri: "1/tile_0.b3dm" },
              },
            ],
          },
        ],
      },
    ],
  };
  const root = buildSparseAssetHierarchy(sourceRoot, [
    {
      assetId: "asset-a",
      sourcePath: "1/tile_0.b3dm",
      outputPath: "content/a.b3dm",
      boundingVolume: { region },
      buildingIdentity: new Set(["building-a"]),
      ownerPoiIds: new Set(["poi-a"]),
      fragmentIds: new Set(["fragment-a"]),
    },
  ]);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].extras.kind, "overlay-fragment");
  assert.equal(root.children[0].content.uri, "content/a.b3dm");
  assert.equal(root.children[0].geometricError, 0);
});

test("catalogue build is atomic, complete, deduplicated, and does not mutate background", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-catalogue-"));
  const sourceRoot = path.join(root, "tiles");
  const outputRoot = path.join(root, "output");
  const background = path.join(root, "background.b3dm");
  fs.mkdirSync(path.join(sourceRoot, "1"), { recursive: true });
  const source = await fixtureB3dm();
  fs.writeFileSync(path.join(sourceRoot, "1/tile.b3dm"), source);
  fs.writeFileSync(background, Buffer.from("stable-background"));
  fs.writeFileSync(
    path.join(sourceRoot, "tileset.json"),
    JSON.stringify({
      asset: { version: "1.0" },
      geometricError: 10,
      root: {
        boundingVolume: { region: [1, 2, 3, 4, 0, 10] },
        geometricError: 0,
        content: { uri: "1/tile.b3dm" },
      },
    }),
  );
  const before = fs.readFileSync(background);
  const first = await buildOverlayCatalogue({
    sourceRoot,
    outputRoot,
    snapshotId: "snapshot",
    pois: [
      { id: "one", names: ["Building A"], tiles: { "tiles/1/tile.b3dm": [0] } },
      { id: "two", names: ["Building A"], tiles: { "tiles/1/tile.b3dm": [0] } },
    ],
  });
  const beforeHash = sha256(fs.readFileSync(background));
  const result = await buildOverlayCatalogue({
    sourceRoot,
    outputRoot,
    snapshotId: "snapshot-updated",
    pois: [
      { id: "one", names: ["Building A"], tiles: { "tiles/1/tile.b3dm": [0] } },
      { id: "two", names: ["Building A"], tiles: { "tiles/1/tile.b3dm": [0] } },
      {
        id: "three",
        names: ["Building B"],
        tiles: { "tiles/1/tile.b3dm": [1] },
      },
    ],
  });
  const afterHash = sha256(fs.readFileSync(background));
  const cataloguePath = path.join(outputRoot, "catalogue.json");
  const tilesetPath = path.join(outputRoot, "tileset.json");
  const catalogueHash = sha256(fs.readFileSync(cataloguePath));
  const tilesetHash = sha256(fs.readFileSync(tilesetPath));
  const unchanged = await buildOverlayCatalogue({
    sourceRoot,
    outputRoot,
    snapshotId: "snapshot-updated",
    pois: [
      { id: "one", names: ["Building A"], tiles: { "tiles/1/tile.b3dm": [0] } },
      { id: "two", names: ["Building A"], tiles: { "tiles/1/tile.b3dm": [0] } },
      {
        id: "three",
        names: ["Building B"],
        tiles: { "tiles/1/tile.b3dm": [1] },
      },
    ],
  });
  assert.equal(first.complete, true);
  assert.equal(result.complete, true);
  assert.equal(first.catalogue.buildings.length, 1);
  assert.equal(result.catalogue.buildings.length, 2);
  assert.equal(first.catalogue.uniqueFragmentCount, 1);
  assert.equal(result.catalogue.uniqueFragmentCount, 2);
  assert.equal(result.catalogue.uniqueAssetCount, 1);
  assert.equal(result.tileset.root.children.length, 1);
  assert.equal(
    result.tileset.extras.layout,
    "sparse-source-hierarchy-finest-v2",
  );
  assert.equal(result.tileset.root.refine, "ADD");
  assert.equal(result.tileset.root.extras.kind, "overlay-spatial-node");
  assert.equal(result.tileset.root.children[0].refine, "ADD");
  assert.equal(result.tileset.root.children[0].extras.kind, "overlay-fragment");
  assert.deepEqual(result.tileset.root.children[0].extras.buildingIdentities, [
    result.catalogue.buildings[0].buildingIdentity,
    result.catalogue.buildings[1].buildingIdentity,
  ]);
  assert.deepEqual(first.catalogue.buildings[0].ownerPoiIds, ["one", "two"]);
  assert.notEqual(first.catalogue.catalogueId, result.catalogue.catalogueId);
  assert.equal(afterHash, beforeHash);
  assert.equal(unchanged.noOp, true);
  assert.deepEqual(unchanged.counts, {
    create: 0,
    update: 0,
    noop: 2,
    expire: 0,
    review: 0,
  });
  assert.equal(sha256(fs.readFileSync(cataloguePath)), catalogueHash);
  assert.equal(sha256(fs.readFileSync(tilesetPath)), tilesetHash);
  assert.ok(fs.existsSync(path.join(outputRoot, "catalogue.json")));
  assert.ok(fs.existsSync(path.join(outputRoot, "tileset.json")));
  assert.ok(fs.existsSync(path.join(outputRoot, "verification.json")));
  assert.equal(
    fs
      .readdirSync(path.join(outputRoot, "content"))
      .filter((name) => name.endsWith(".b3dm")).length,
    1,
  );
  assert.deepEqual(fs.readFileSync(background), before);
  if (process.env.BACKGROUND_LITE_OVERLAY_EVIDENCE) {
    const reportPath = path.resolve(
      process.env.BACKGROUND_LITE_OVERLAY_EVIDENCE,
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          schemaVersion: "local-overlay-isolation-evidence-v1",
          fixture: true,
          localOnly: true,
          productionChanged: false,
          before: {
            snapshotId: "snapshot",
            catalogueId: first.catalogue.catalogueId,
            uniqueBuildingCount: first.catalogue.uniqueBuildingCount,
            backgroundSha256: beforeHash,
          },
          after: {
            snapshotId: "snapshot-updated",
            catalogueId: result.catalogue.catalogueId,
            uniqueBuildingCount: result.catalogue.uniqueBuildingCount,
            backgroundSha256: afterHash,
          },
          backgroundUnchanged: beforeHash === afterHash,
          passed:
            beforeHash === afterHash &&
            first.catalogue.catalogueId !== result.catalogue.catalogueId,
        },
        null,
        2,
      )}\n`,
    );
  }
});
