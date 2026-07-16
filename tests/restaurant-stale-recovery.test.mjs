import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RestaurantService } = require("../scripts/lib/restaurant-service.cjs");

const policy = { schemaVersion: "1.0", providers: [
  { id: "openstreetmap-overpass", owner: "Fixture", domains: ["overpass.test"], costClass: "open", enabled: true },
  { id: "openstreetmap", owner: "OSM", domains: ["openstreetmap.org"], costClass: "open", enabled: true },
  { id: "wikidata", owner: "Wikimedia", domains: ["wikidata.org"], costClass: "open", enabled: true },
] };
const config = {
  schemaVersion: "1.0", providerIds: ["openstreetmap-overpass", "openstreetmap", "wikidata"],
  overpassEndpoints: ["https://overpass.test/api"], dealRetrieval: { mode: "direct_http", costClass: "free", respectRobots: true },
  viewportCacheTtlMinutes: 1, dealCacheTtlHours: 1,
};

test("restaurant recovery serves only approved stale fallback, then replaces it after a fresh source succeeds", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-recovery-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let available = false;
  const service = new RestaurantService({ root, cacheRoot: path.join(root, "cache"), config, providerPolicy: policy, fetchImpl: async () => available
    ? Response.json({ elements: [{ type: "node", id: 2, lat: 1.285, lon: 103.855, tags: { amenity: "cafe", name: "Recovered" } }] })
    : new Response("down", { status: 503 }) });
  const bbox = "1.28,103.85,1.29,103.86";
  const cachePath = service.viewportPath(require("../scripts/lib/restaurant-pipeline-core.cjs").parseBbox(bbox));
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ schemaVersion: "1.0", fetchedAt: "2026-01-01T00:00:00.000Z", bbox: { south: 1.28, west: 103.85, north: 1.29, east: 103.86 }, restaurants: [{ id: "saved", name: "Saved", latitude: 1.285, longitude: 103.855 }] }));
  const stale = await service.search(bbox);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.data.restaurants.map(({ id }) => id), ["saved"]);
  available = true;
  const fresh = await service.search(bbox, { refresh: true });
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.data.restaurants.map(({ id }) => id), ["osm-node-2"]);
});

test("stale deal fallback retains still-valid evidence but removes expired claims", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deal-recovery-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new RestaurantService({ root, cacheRoot: path.join(root, "cache"), config, providerPolicy: policy });
  const file = service.dealPath("osm-node-2");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    extractorVersion: "4.2", discoveryVersion: "1.2", restaurantId: "osm-node-2", status: "success", fetchedAt: "2026-01-01T00:00:00.000Z",
    provider: { id: "official-website-direct", costClass: "free" }, pagesInspected: [], deals: [
      { id: "valid", title: "Valid", evidence: "20% off", sourceUrl: "https://example.sg/", validUntil: "2099-01-01T00:00:00.000Z" },
      { id: "expired", title: "Expired", evidence: "10% off", sourceUrl: "https://example.sg/", validUntil: "2020-01-01T00:00:00.000Z" },
    ],
  }));
  const stale = service.dealStatus("osm-node-2");
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.data.deals.map(({ id }) => id), ["valid"]);
});
