import assert from "node:assert/strict";
import test from "node:test";

import {
  backgroundViewReadiness,
  createMovementRenderingGuard,
  LOCAL_BUILDING_RENDER_POLICY,
  optionalTilesetViewReadiness,
  overlayOnlyReloadPlan,
  rendererAssetManifestState,
} from "../map-layers/building-highlight-layers.js";

const poi = (id, tile = "tiles/1/2/building.b3dm", batchId = 4) => ({
  id,
  label: id,
  tiles: { [tile]: [batchId] },
});

const manifest = (overrides = {}) => ({
  schemaVersion: "local-building-assets-v1",
  state: "active-local",
  background: {
    complete: true,
    manifestId: "background:1",
    opacity: 0.3,
    url: "/background-lite/tileset.json",
  },
  overlays: {
    catalogueId: "overlay:1",
    complete: true,
    identityCount: 1,
    ownerCount: 1,
    opacity: 1,
    url: "/highlight-overlays/tileset.json",
  },
  ...overrides,
});

test("movement rendering preservation applies to exactly one camera movement", () => {
  const guard = createMovementRenderingGuard();

  assert.deepEqual(guard.begin(), {
    hideBackground: true,
    pauseTraversal: true,
  });
  guard.end();

  guard.preserveNext();
  assert.deepEqual(guard.begin(), {
    hideBackground: false,
    pauseTraversal: false,
  });
  guard.end();

  assert.deepEqual(guard.begin(), {
    hideBackground: true,
    pauseTraversal: true,
  });
});

test("renderer contract fixes background at 30%, overlays at 100%, and gives overlays a depth preference", () => {
  assert.equal(LOCAL_BUILDING_RENDER_POLICY.backgroundOpacity, 0.3);
  assert.deepEqual(LOCAL_BUILDING_RENDER_POLICY.buildingZoomRange, [13, 22.1]);
  assert.equal(LOCAL_BUILDING_RENDER_POLICY.hideBuildingsDuringMovement, true);
  assert.equal(
    LOCAL_BUILDING_RENDER_POLICY.maintainFullDetailDuringMovement,
    true,
  );
  assert.equal(LOCAL_BUILDING_RENDER_POLICY.overlayOpacity, 1);
  assert.deepEqual(LOCAL_BUILDING_RENDER_POLICY.overlayDepthParameters, {
    depthFunc: 515,
    depthTest: true,
    polygonOffset: [-1, -1],
    polygonOffsetFill: true,
  });
  assert.deepEqual(rendererAssetManifestState(manifest(), [poi("one")]), {
    errors: [],
    overlayEmpty: false,
    state: "ready",
  });
});

test("overlay building count is not confused with source LOD claims", () => {
  const multiLodPoi = poi("one");
  multiLodPoi.tiles = {
    "tiles/1/2/building_0.b3dm": [4],
    "tiles/1/2/building_1.b3dm": [4],
    "tiles/1/2/building_2.b3dm": [4],
  };
  assert.equal(
    rendererAssetManifestState(manifest(), [multiLodPoi]).state,
    "ready",
  );
  assert.deepEqual(
    rendererAssetManifestState(
      manifest({
        overlays: { ...manifest().overlays, ownerCount: 0 },
      }),
      [multiLodPoi],
    ).errors,
    ["overlay-owner-count-mismatch"],
  );
});

test("a complete overlay catalogue may serve a smaller active POI subset", () => {
  assert.deepEqual(
    rendererAssetManifestState(
      manifest({
        overlays: { ...manifest().overlays, ownerCount: 136 },
      }),
      [poi("one")],
    ).errors,
    [],
  );
});

test("renderer explicitly rejects partial or missing local assets", () => {
  const incomplete = manifest({
    background: { complete: false, opacity: 0.3 },
    overlays: { complete: false, opacity: 1 },
    state: "candidate",
  });
  const result = rendererAssetManifestState(incomplete, [poi("one")]);
  assert.equal(result.state, "intentionally-unavailable");
  assert.deepEqual(result.errors, [
    "manifest-not-active",
    "background-incomplete",
    "background-url-missing",
    "overlays-incomplete",
    "overlay-url-missing",
  ]);
});

test("a complete empty overlay catalogue is a valid explicit state", () => {
  const emptyManifest = manifest({
    overlays: {
      complete: true,
      empty: true,
      identityCount: 0,
      opacity: 1,
    },
  });
  assert.deepEqual(rendererAssetManifestState(emptyManifest, []), {
    errors: [],
    overlayEmpty: true,
    state: "empty-overlay",
  });
});

test("overlay reconciliation reloads only overlays and retains the background URL", () => {
  const backgroundUrl = "/background-lite/tileset.json";
  const plan = overlayOnlyReloadPlan({
    backgroundUrl,
    nextOverlayUrl: "/highlight-overlays/v2/tileset.json",
    nextPois: [poi("one"), poi("two", "tiles/3/4/other.b3dm", 7)],
    previousOverlayUrl: "/highlight-overlays/v1/tileset.json",
    previousPois: [poi("one")],
  });
  assert.equal(plan.backgroundChanged, false);
  assert.equal(plan.backgroundUrl, backgroundUrl);
  assert.equal(plan.overlayChanged, true);
  assert.deepEqual(plan.actions, [
    { action: "noop", id: "one" },
    { action: "create", id: "two" },
  ]);
});

test("view readiness requires selected content and supports an empty overlay view", () => {
  const tileset = {
    isLoaded: () => true,
    selectedTiles: [
      { content: {}, id: "ready" },
      { contentAvailable: false, id: "empty" },
    ],
  };
  assert.deepEqual(backgroundViewReadiness(tileset), {
    loaded: true,
    readyCount: 2,
    selectedCount: 2,
  });
  assert.deepEqual(
    optionalTilesetViewReadiness(
      { loaded: false, readyCount: 0, selectedCount: 0 },
      { selectedTiles: [] },
    ),
    { loaded: true, renderable: true },
  );
});
