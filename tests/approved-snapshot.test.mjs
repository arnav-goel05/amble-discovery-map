import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { approvedSnapshot, temporaryState } from "./helpers/baseline-fixtures.mjs";
import { ApprovedSnapshotError, computeSnapshotContentHash, hashFile, loadApprovedSnapshot, writeActiveSnapshotPointer } from "../scripts/lib/approved-snapshot.mjs";

const require = createRequire(import.meta.url);
const { publicMetadata, publicTileset } = require("../scripts/approved-snapshot-api-plugin.cjs");

function createSnapshot(root, overrides = {}) {
  const snapshotDir = path.join(root, "data/snapshots/snapshot-fixture");
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, "landmarks.json"), "[]\n");
  fs.writeFileSync(path.join(snapshotDir, "pois.json"), "[]\n");
  fs.writeFileSync(path.join(snapshotDir, "tileset.json"), "{}\n");
  const base = approvedSnapshot({
    landmarksRef: "landmarks.json", poisRef: "pois.json", tilesetRef: "tileset.json",
    artifactHashes: {
      "landmarks.json": hashFile(path.join(snapshotDir, "landmarks.json")),
      "pois.json": hashFile(path.join(snapshotDir, "pois.json")),
      "tileset.json": hashFile(path.join(snapshotDir, "tileset.json")),
    },
    ...overrides,
  });
  const manifest = { ...base, contentHash: computeSnapshotContentHash(base) };
  fs.writeFileSync(path.join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeActiveSnapshotPointer({ root, snapshotId: manifest.snapshotId, manifestPath: path.join(snapshotDir, "manifest.json") });
  return { manifest, snapshotDir };
}

test("loads the active immutable snapshot and validates every artifact hash", () => {
  const state = temporaryState();
  try {
    createSnapshot(state.root);
    const loaded = loadApprovedSnapshot({ root: state.root, now: new Date("2026-07-15T00:00:00.000Z") });
    assert.equal(loaded.snapshotId, "snapshot-fixture");
    assert.equal(loaded.freshness, "fresh");
    assert.match(loaded.publicRefs.landmarks, /^\/api\/snapshot\/assets\//);
  } finally { state.cleanup(); }
});

test("missing active pointer fails closed", () => {
  const state = temporaryState();
  try {
    assert.throws(() => loadApprovedSnapshot({ root: state.root }), (error) => error instanceof ApprovedSnapshotError && error.code === "snapshot_pointer_missing");
  } finally { state.cleanup(); }
});

test("manifest and artifact hash mismatches fail closed", () => {
  const state = temporaryState();
  try {
    const { snapshotDir } = createSnapshot(state.root);
    fs.appendFileSync(path.join(snapshotDir, "manifest.json"), " ");
    assert.throws(() => loadApprovedSnapshot({ root: state.root }), (error) => error.code === "snapshot_manifest_hash_mismatch");
    writeActiveSnapshotPointer({ root: state.root, snapshotId: "snapshot-fixture", manifestPath: path.join(snapshotDir, "manifest.json") });
    fs.writeFileSync(path.join(snapshotDir, "pois.json"), "[{}]\n");
    assert.throws(() => loadApprovedSnapshot({ root: state.root }), (error) => error.code === "snapshot_artifact_hash_mismatch");
  } finally { state.cleanup(); }
});

test("stale metadata is surfaced without mutating the approved manifest", () => {
  const state = temporaryState();
  try {
    createSnapshot(state.root);
    const loaded = loadApprovedSnapshot({ root: state.root, now: new Date("2026-07-22T00:00:00.000Z") });
    assert.equal(loaded.freshness, "potentially_outdated");
    assert.equal(loaded.stale, true);
    assert.match(loaded.warning, /potentially outdated/i);
  } finally { state.cleanup(); }
});

test("public snapshot tilesets resolve POI dependencies from the site root", () => {
  const source = {
    root: {
      content: { uri: "/poi-tiles/hall/tileset.json" },
      children: [{ content: { url: "/poi-tiles/gallery/tileset.json" } }],
    },
  };
  const result = publicTileset(source);
  assert.equal(result.root.content.uri, "../../../../poi-tiles/hall/tileset.json");
  assert.equal(result.root.children[0].content.url, "../../../../poi-tiles/gallery/tileset.json");
  assert.equal(source.root.content.uri, "/poi-tiles/hall/tileset.json");
});

test("public snapshot metadata versions the corrected tileset representation", () => {
  const metadata = publicMetadata({
    schemaVersion: "1.0",
    snapshotId: "snapshot-fixture",
    publishedAt: "2026-07-14T00:00:00.000Z",
    coveredWindow: { start: "2026-07-14", end: "2026-07-21", timezone: "Asia/Singapore" },
    freshness: "fresh",
    staleAfter: "2026-07-21T00:00:00.000Z",
    publicRefs: { landmarks: "/landmarks", pois: "/pois", tileset: "/tileset" },
  });
  assert.equal(metadata.tilesetRef, "/tileset?assetPaths=site-root-v1");
});
