import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import {
  loadLocalBuildingAssetManifest,
  planLocalOverlaySnapshotReconcile,
  validateBrowserBuildingAssetManifest,
} from "../activity-scenes/local-building-assets.js";

const require = createRequire(import.meta.url);
const {
  loadManifest,
  resolveAsset,
} = require("../scripts/local-building-assets-plugin.cjs");
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const manifest = (state = "active-local") => ({
  schemaVersion: "local-building-assets-v1",
  state,
  background: { complete: true, opacity: 0.3, url: "/local/background.json" },
  overlays: { complete: true, opacity: 1, url: "/local/overlays.json" },
});

const response = (status, value) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
});

test("normal local loading selects an active atomic manifest", async () => {
  const result = await loadLocalBuildingAssetManifest({
    enabled: true,
    fetchImpl: async () => response(200, manifest()),
  });
  assert.equal(result.state, "active-local");
  assert.equal(result.manifest.background.opacity, 0.3);
  assert.equal(result.manifest.overlays.opacity, 1);
});

test("active local overlays stay pinned to their exact source snapshot", () => {
  const currentPois = [{ id: "approved-a" }];
  const active = {
    ...manifest(),
    snapshotId: "snapshot-a",
    overlays: {
      ...manifest().overlays,
      url: "/__local-building-assets/overlays/tileset.json",
    },
  };
  assert.deepEqual(
    planLocalOverlaySnapshotReconcile({
      assetManifest: active,
      currentPois,
      nextPois: [{ id: "unbuilt-b" }],
      nextSnapshotId: "snapshot-b",
      nextTilesetUrl: "/legacy/snapshot-b.json",
    }),
    {
      pinned: true,
      pois: currentPois,
      snapshotMismatch: true,
      tilesetUrl: active.overlays.url,
    },
  );
});

test("legacy rendering may follow a refreshed snapshot", () => {
  const nextPois = [{ id: "next" }];
  assert.deepEqual(
    planLocalOverlaySnapshotReconcile({
      assetManifest: null,
      currentPois: [{ id: "old" }],
      nextPois,
      nextSnapshotId: "snapshot-b",
      nextTilesetUrl: "/next.json",
    }),
    {
      pinned: false,
      pois: nextPois,
      snapshotMismatch: false,
      tilesetUrl: "/next.json",
    },
  );
});

test("missing, invalid, and unavailable manifests stay explicit", async () => {
  const missing = await loadLocalBuildingAssetManifest({
    enabled: true,
    fetchImpl: async () => response(404, { state: "missing" }),
  });
  assert.equal(missing.state, "missing");
  assert.equal(missing.manifest.state, "intentionally-unavailable");
  assert.equal(missing.manifest.background.complete, false);
  assert.equal(
    (
      await loadLocalBuildingAssetManifest({
        enabled: true,
        fetchImpl: async () => response(503, { state: "invalid" }),
      })
    ).state,
    "invalid",
  );
  assert.equal(
    (
      await loadLocalBuildingAssetManifest({
        enabled: true,
        fetchImpl: async () => {
          throw new Error("offline");
        },
      })
    ).state,
    "unavailable",
  );
});

test("a verified rollback manifest resumes normal rendering", async () => {
  const result = await loadLocalBuildingAssetManifest({
    enabled: true,
    fetchImpl: async () => response(200, manifest("rolled-back")),
  });
  assert.equal(result.state, "rolled-back");
  assert.equal(result.observedState, "rolled-back");
  assert.equal(result.manifest.state, "active-local");
});

test("browser validation rejects incomplete candidates", () => {
  assert.throws(
    () =>
      validateBrowserBuildingAssetManifest({
        ...manifest(),
        background: { complete: false, opacity: 0.3 },
      }),
    /background-unavailable/u,
  );
});

test("the dev server exposes only hash-verified assets selected by the active manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-building-assets-"));
  try {
    const backgroundDirectory = path.join(root, "background");
    const overlayDirectory = path.join(root, "overlays");
    await Promise.all([mkdir(backgroundDirectory), mkdir(overlayDirectory)]);
    const backgroundPath = path.join(backgroundDirectory, "tileset.json");
    const overlayPath = path.join(overlayDirectory, "tileset.json");
    const activeManifestPath = path.join(root, "active.json");
    const background = Buffer.from('{"root":{}}');
    const overlays = Buffer.from('{"root":{}}');
    await Promise.all([
      writeFile(backgroundPath, background),
      writeFile(overlayPath, overlays),
      writeFile(
        activeManifestPath,
        JSON.stringify({
          ...manifest(),
          background: {
            complete: true,
            opacity: 0.3,
            path: backgroundPath,
            sha256: digest(background),
          },
          overlays: {
            complete: true,
            opacity: 1,
            path: overlayPath,
            sha256: digest(overlays),
          },
        }),
      ),
    ]);

    const loaded = loadManifest(activeManifestPath);
    assert.equal(
      loaded.manifest.background.url,
      "/__local-building-assets/background/tileset.json",
    );
    assert.equal(
      resolveAsset(
        "/__local-building-assets/background/tileset.json",
        loaded.directories,
      ),
      backgroundPath,
    );
    assert.equal(
      resolveAsset(
        "/__local-building-assets/background/../active.json",
        loaded.directories,
      ),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
