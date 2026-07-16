import assert from "node:assert/strict";
import test from "node:test";

import { backgroundViewReadiness, geometryIdentityKeys, reconcilePoiGeometry, validatePoiGeometrySet } from "../map-layers/building-highlight-layers.js";

const poi = (id, batchId = 1) => ({ id, label: id.toUpperCase(), data: `poi-tiles/${id}/tileset.json`, tiles: { "tiles/1/2/3_0.b3dm": [batchId] } });

test("the initial viewport is ready only when every selected 3D tile is renderable and no requests remain", () => {
  const loadedTile = { contentAvailable: true, content: { type: "scenegraph" } };
  const missingTile = { contentAvailable: true, content: null };
  assert.deepEqual(backgroundViewReadiness({ selectedTiles: [loadedTile, missingTile], isLoaded: () => true }), { loaded: false, readyCount: 1, selectedCount: 2 });
  assert.equal(backgroundViewReadiness({ selectedTiles: [loadedTile], isLoaded: () => false }).loaded, false);
  assert.deepEqual(backgroundViewReadiness({ selectedTiles: [loadedTile], isLoaded: () => true }), { loaded: true, readyCount: 1, selectedCount: 1 });
});

test("one approved building identity appears only once in combined highlight geometry", () => {
  assert.deepEqual([...geometryIdentityKeys([poi("alpha")])], ["tiles/1/2/3_0.b3dm#1"]);
  assert.throws(() => validatePoiGeometrySet([poi("alpha"), poi("alpha", 2)]), /duplicate POI identity/i);
  assert.throws(() => validatePoiGeometrySet([poi("alpha"), poi("beta")]), /highlight geometry identity.*more than one POI/i);
});

test("background identities must be disjoint from highlighted identities", () => {
  const highlights = validatePoiGeometrySet([poi("alpha")]);
  assert.throws(() => validatePoiGeometrySet(highlights, { backgroundIdentityKeys: new Set(["tiles/1/2/3_0.b3dm#1"]) }), /remains in the background/i);
  assert.doesNotThrow(() => validatePoiGeometrySet(highlights, { backgroundIdentityKeys: new Set(["tiles/1/2/3_0.b3dm#9"]) }));
});

test("geometry reconciliation restores removals and no-ops unchanged POIs", () => {
  const alpha = poi("alpha"), beta = poi("beta", 2), updated = { ...alpha, label: "ALPHA UPDATED" };
  const unchanged = reconcilePoiGeometry([alpha], [structuredClone(alpha)]);
  assert.deepEqual(unchanged.actions, [{ id: "alpha", action: "noop" }]);
  assert.strictEqual(unchanged.pois[0], alpha);
  const changed = reconcilePoiGeometry([alpha, beta], [updated]);
  assert.deepEqual(changed.actions, [{ id: "alpha", action: "update" }, { id: "beta", action: "remove" }]);
  assert.deepEqual(changed.restorePoiIds, ["beta"]);
});
