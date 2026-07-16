import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  collectRestaurantDeals,
  collectRestaurants,
  parseBbox,
  robotsDecision,
  evidenceSnippets,
  discoverRestaurantWebsite,
  searchResultCandidate,
  selectCatalogCandidate,
} = require("../scripts/lib/restaurant-pipeline-core.cjs");
const { RestaurantService } = require("../scripts/lib/restaurant-service.cjs");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const approvedProviderPolicy = (domain = "overpass.invalid") => ({
  schemaVersion: "1.0",
  providers: [
    { id: "openstreetmap-overpass", owner: "Fixture OSM", domains: [domain], costClass: "open", enabled: true },
    { id: "openstreetmap", owner: "OSM", domains: ["openstreetmap.org"], costClass: "open", enabled: true },
    { id: "wikidata", owner: "Wikimedia", domains: ["wikidata.org"], costClass: "open", enabled: true },
    { id: "tinyfish-fetch", owner: "TinyFish", domains: ["api.fetch.tinyfish.ai"], costClass: "free", enabled: true },
    { id: "tinyfish-search", owner: "TinyFish", domains: ["api.search.tinyfish.ai"], costClass: "free", enabled: true },
  ],
});
const approvedConfig = (overpassEndpoints) => ({
  schemaVersion: "1.0",
  providerIds: ["openstreetmap-overpass", "openstreetmap", "wikidata"],
  overpassEndpoints,
  dealRetrieval: { mode: "direct_http", costClass: "free", respectRobots: true },
  viewportCacheTtlMinutes: 1440,
});

function assertEnvelope(result, { stale, status = "success" }) {
  assert.equal(result.schemaVersion, "1.0");
  assert.equal(result.status, status);
  assert.equal(result.stale, stale);
  assert.ok("data" in result);
  assert.ok("fetchedAt" in result);
  assert.ok("warning" in result);
  assert.match(result.source.costClass, /^(free|open)$/);
}

test("viewport validation rejects inverted and excessively large bounds", () => {
  assert.throws(() => parseBbox("1.3,103.8,1.2,103.9"), /invalid/);
  assert.throws(() => parseBbox("1.1,103.7,1.4,104.0"), /zoom in/);
  assert.deepEqual(parseBbox("1.28,103.85,1.29,103.86"), {
    south: 1.28, west: 103.85, north: 1.29, east: 103.86, key: "1.28000,103.85000,1.29000,103.86000",
  });
});

test("restaurant collection continues with the next Overpass endpoint and normalizes details", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length === 1) return new Response("busy", { status: 504 });
    return Response.json({ elements: [{
      type: "node", id: 42, lat: 1.285, lon: 103.858,
      tags: {
        amenity: "restaurant", name: "Example Kitchen", cuisine: "singaporean;asian",
        "addr:housenumber": "3", "addr:street": "Example Road", "addr:postcode": "018900",
        opening_hours: "Mo-Su 11:00-22:00", phone: "+65 6000 0000", website: "example.com/deals", "diet:vegetarian": "yes",
      },
    }] });
  };
  const result = await collectRestaurants({ bbox: "1.28,103.85,1.29,103.86", endpoints: ["https://first.test", "https://second.test"], fetchImpl });
  assert.equal(result.endpoint, "https://second.test");
  assert.deepEqual(result.attempts.map(({ status }) => status), ["failed", "success"]);
  assert.equal(result.restaurants[0].id, "osm-node-42");
  assert.equal(result.restaurants[0].address, "3, Example Road, 018900");
  assert.equal(result.restaurants[0].website, "https://example.com/deals");
  assert.deepEqual(result.restaurants[0].dietary, ["vegetarian"]);
});

test("restaurant search reuses a fresh cached viewport that contains the requested area", async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-covering-cache-test-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const cacheRoot = path.join(temporary, "cache");
  fs.mkdirSync(path.join(cacheRoot, "viewports"), { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, "viewports", "covering.json"), JSON.stringify({
    schemaVersion: "1.0",
    bbox: { south: 1.27, west: 103.84, north: 1.30, east: 103.87 },
    fetchedAt: new Date().toISOString(),
    restaurants: [
      { id: "inside", name: "Inside", latitude: 1.285, longitude: 103.855 },
      { id: "outside", name: "Outside", latitude: 1.299, longitude: 103.869 },
    ],
  }));
  let fetchCalled = false;
  const service = new RestaurantService({
    cacheRoot,
    config: approvedConfig(["https://overpass.invalid"]),
    providerPolicy: approvedProviderPolicy(),
    fetchImpl: async () => { fetchCalled = true; throw new Error("network should not be called"); },
  });
  const result = await service.search("1.28,103.85,1.29,103.86");
  assert.equal(result.cache, "covering-hit");
  assertEnvelope(result, { stale: false });
  assert.deepEqual(result.data.restaurants.map(({ id }) => id), ["inside"]);
  assert.deepEqual(result.restaurants.map(({ id }) => id), ["inside"]);
  assert.equal(fetchCalled, false);
});

test("restaurant search reuses a substantially overlapping cached viewport instead of blocking on the network", async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-overlap-cache-test-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const cacheRoot = path.join(temporary, "cache");
  fs.mkdirSync(path.join(cacheRoot, "viewports"), { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, "viewports", "overlap.json"), JSON.stringify({
    schemaVersion: "1.0",
    bbox: { south: 1.27, west: 103.84, north: 1.30, east: 103.858 },
    fetchedAt: new Date().toISOString(),
    restaurants: [{ id: "nearby", name: "Nearby", latitude: 1.285, longitude: 103.855 }],
  }));
  let fetchCalled = false;
  const service = new RestaurantService({
    cacheRoot,
    config: approvedConfig(["https://overpass.invalid"]),
    providerPolicy: approvedProviderPolicy(),
    fetchImpl: async () => { fetchCalled = true; throw new Error("network should not be called"); },
  });
  const result = await service.search("1.28,103.85,1.29,103.86");
  assert.equal(result.cache, "overlap-hit");
  assertEnvelope(result, { stale: false });
  assert.deepEqual(result.restaurants.map(({ id }) => id), ["nearby"]);
  assert.ok(result.viewportCoverage >= 0.5 && result.viewportCoverage < 1);
  assert.equal(fetchCalled, false);
});

test("restaurant search returns expired saved results immediately while refreshing in the background", async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-stale-while-refreshing-test-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const cacheRoot = path.join(temporary, "cache");
  const service = new RestaurantService({
    cacheRoot,
    config: approvedConfig(["https://overpass.invalid"]),
    providerPolicy: approvedProviderPolicy(),
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return Response.json({ elements: [{ type: "node", id: 2, lat: 1.285, lon: 103.855, tags: { amenity: "cafe", name: "Refreshed" } }] });
    },
  });
  const bbox = parseBbox("1.28,103.85,1.29,103.86");
  const cachePath = service.viewportPath(bbox);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({
    schemaVersion: "1.0",
    bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east },
    fetchedAt: "2026-01-01T00:00:00.000Z",
    restaurants: [{ id: "saved", name: "Saved", latitude: 1.285, longitude: 103.855 }],
  }));

  const startedAt = Date.now();
  const result = await service.search(bbox.key);
  assert.equal(result.cache, "stale");
  assert.equal(result.stale, true);
  assert.deepEqual(result.restaurants.map(({ id }) => id), ["saved"]);
  assert.ok(Date.now() - startedAt < 150, "saved results should not wait for the live refresh");
  assert.equal(service.viewportRefreshes.size, 1);
  await [...service.viewportRefreshes.values()][0];
  assert.equal(JSON.parse(fs.readFileSync(cachePath, "utf8")).restaurants[0].name, "Refreshed");
});

test("restaurant search returns a retryable empty result when Overpass is unavailable and no cache covers the area", async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-unavailable-test-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const service = new RestaurantService({
    cacheRoot: path.join(temporary, "cache"),
    config: approvedConfig(["https://overpass.invalid"]),
    providerPolicy: approvedProviderPolicy(),
    fetchImpl: async () => new Response("gateway timeout", { status: 504 }),
  });
  const result = await service.search("1.31,103.90,1.32,103.91");
  assert.equal(result.cache, "unavailable");
  assertEnvelope(result, { stale: false, status: "unavailable" });
  assert.equal(result.data, null);
  assert.deepEqual(result.restaurants, []);
  assert.match(result.warning, /All Overpass endpoints failed/);
});

test("exact and overlapping approved fallback responses use stale common envelopes", async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-stale-envelope-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const cacheRoot = path.join(temporary, "cache");
  fs.mkdirSync(path.join(cacheRoot, "viewports"), { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, "viewports", "stale.json"), JSON.stringify({
    schemaVersion: "1.0",
    bbox: { south: 1.27, west: 103.84, north: 1.30, east: 103.858 },
    fetchedAt: "2026-01-01T00:00:00.000Z",
    restaurants: [{ id: "saved", name: "Saved", latitude: 1.285, longitude: 103.855 }],
  }));
  const service = new RestaurantService({
    cacheRoot,
    config: approvedConfig(["https://overpass.invalid"]),
    providerPolicy: approvedProviderPolicy(),
    fetchImpl: async () => new Response("down", { status: 503 }),
  });
  const exactPath = service.viewportPath(parseBbox("1.28,103.85,1.29,103.86"));
  fs.writeFileSync(exactPath, JSON.stringify({
    schemaVersion: "1.0",
    bbox: { south: 1.28, west: 103.85, north: 1.29, east: 103.86 },
    fetchedAt: "2026-01-01T00:00:00.000Z",
    restaurants: [{ id: "exact", name: "Exact", latitude: 1.285, longitude: 103.855 }],
  }));
  const exact = await service.search("1.28,103.85,1.29,103.86");
  assert.equal(exact.cache, "stale");
  assertEnvelope(exact, { stale: true });
  assert.equal(exact.data.restaurants[0].id, "exact");
  fs.unlinkSync(exactPath);
  const overlap = await service.search("1.28,103.85,1.29,103.86");
  assert.equal(overlap.cache, "stale-overlap");
  assertEnvelope(overlap, { stale: true });
  assert.equal(overlap.data.restaurants[0].id, "saved");
});

test("deal jobs use pending, success, stale, and unavailable common envelopes", async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-deal-envelope-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const service = new RestaurantService({
    cacheRoot: path.join(temporary, "cache"),
    config: { ...approvedConfig(["https://overpass.invalid"]), dealCacheTtlHours: 24, noDealsCacheTtlHours: 12 },
    providerPolicy: approvedProviderPolicy(),
    lookup: publicLookup,
    fetchImpl: async (url) => String(url).endsWith("robots.txt")
      ? new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } })
      : new Response("<p>Enjoy 20% off lunch in Singapore.</p>", { status: 200, headers: { "content-type": "text/html" } }),
  });
  service.remember([
    { id: "osm-node-10", name: "Current", website: "https://current.sg/" },
    { id: "osm-node-11", name: "No website", website: null },
  ]);
  const pending = service.enqueue("osm-node-10");
  assertEnvelope(pending, { stale: false, status: "pending" });
  assert.equal(pending.progress.stage, "finding_website");
  assert.match(pending.progress.label, /official website/i);
  const [success] = await service.waitFor(["osm-node-10"]);
  assertEnvelope(success, { stale: false, status: "success" });
  assert.equal(success.data.deals.length, 1);
  service.enqueue("osm-node-11");
  const [unavailable] = await service.waitFor(["osm-node-11"]);
  assertEnvelope(unavailable, { stale: false, status: "unavailable" });

  const stalePath = service.dealPath("osm-node-12");
  fs.mkdirSync(path.dirname(stalePath), { recursive: true });
  fs.writeFileSync(stalePath, JSON.stringify({
    extractorVersion: "4.2", discoveryVersion: "1.2", restaurantId: "osm-node-12", status: "success",
    fetchedAt: "2026-01-01T00:00:00.000Z", provider: { id: "official-website-direct", costClass: "free" },
    deals: [{ id: "old", title: "Still valid", evidence: "20% off", sourceUrl: "https://old.sg/", validUntil: "2027-01-01T00:00:00.000Z" }],
  }));
  const stale = service.dealStatus("osm-node-12");
  assertEnvelope(stale, { stale: true, status: "idle" });
  assert.equal(stale.data.deals.length, 1);
});

test("website discovery prefers repeated Singapore OSM evidence and records provenance", async () => {
  const catalog = { entries: [
    { normalizedName: "din tai fung", website: "https://www.dintaifung.com.tw/", osm: { url: "https://www.openstreetmap.org/node/1" } },
    { normalizedName: "din tai fung", website: "https://www.dintaifung.com.sg/", osm: { url: "https://www.openstreetmap.org/node/2" } },
    { normalizedName: "din tai fung", website: "https://dintaifung.com.sg/stores", osm: { url: "https://www.openstreetmap.org/node/3" } },
  ] };
  const selected = selectCatalogCandidate({ name: "Din Tai Fung" }, catalog);
  assert.equal(selected.status, "approved");
  assert.match(selected.website, /dintaifung\.com\.sg/);
  assert.equal(selected.evidence.length, 2);
  const discovered = await discoverRestaurantWebsite({ id: "x", name: "Din Tai Fung" }, { catalog });
  assert.equal(discovered.source, "osm_exact_name");
  assert.equal(discovered.attempts[0].status, "approved");
});

test("website discovery stops safely when approved open evidence is exhausted", async () => {
  let externalCalls = 0;
  const discovered = await discoverRestaurantWebsite({ id: "free-bites", name: "Free Bites" }, {
    catalog: { entries: [] },
    fetchImpl: async () => { externalCalls += 1; throw new Error("unexpected search"); },
  });
  assert.equal(discovered.status, "not_found");
  assert.equal(discovered.website, null);
  assert.equal(externalCalls, 0);
});

test("website discovery uses TinyFish Search and Fetch only as a verified final fallback", async () => {
  const searchCalls = [];
  const fetchCalls = [];
  const discovered = await discoverRestaurantWebsite({
    id: "burnt-ends", name: "Burnt Ends", address: "7 Dempsey Road, Singapore 249671",
  }, {
    catalog: { entries: [] },
    tinyfishApiKey: "test-key",
    tinyfishSearchConfig: { endpoint: "https://api.search.tinyfish.ai", location: "SG", language: "en", timeoutMs: 20_000 },
    tinyfishFetchConfig: { providerId: "tinyfish-fetch", endpoint: "https://api.fetch.tinyfish.ai", format: "html", timeoutMs: 45_000 },
    lookup: publicLookup,
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    },
    tinyfishSearchImpl: async (url, options) => {
      searchCalls.push({ url, options });
      return Response.json({ results: [
        { title: "Burnt Ends Official", snippet: "Singapore restaurant at Dempsey Road", url: "https://burntends.com.sg/" },
        { title: "Burnt Ends Reviews", snippet: "Singapore restaurant", url: "https://www.tripadvisor.com/burnt-ends" },
      ] });
    },
    tinyfishFetchImpl: async (url, options) => {
      fetchCalls.push(String(url));
      assert.equal(options.headers["X-API-Key"], "test-key");
      return Response.json({ results: [{ url: "https://burntends.com.sg/", final_url: "https://burntends.com.sg/", text: "<h1>Burnt Ends</h1><p>7 Dempsey Road, Singapore 249671</p>", links: [] }], errors: [] });
    },
  });
  assert.equal(discovered.status, "approved");
  assert.equal(discovered.source, "tinyfish_search_verified");
  assert.equal(discovered.website, "https://burntends.com.sg/");
  assert.equal(searchCalls.length, 1);
  assert.match(searchCalls[0].url, /location=SG/);
  assert.equal(searchCalls[0].options.headers["X-API-Key"], "test-key");
  assert.equal(fetchCalls.some((url) => url === "https://api.fetch.tinyfish.ai"), true);
});

test("website discovery replaces a dead saved OSM website with a uniquely verified TinyFish candidate", async () => {
  let renderedCalls = 0;
  const progress = [];
  const discovered = await discoverRestaurantWebsite({
    id: "example", name: "Example Kitchen", address: "3 Example Road, Singapore 018900", website: "https://old.example.sg/",
    osm: { url: "https://www.openstreetmap.org/node/42" },
  }, {
    catalog: { entries: [] },
    tinyfishApiKey: "test-key",
    tinyfishSearchConfig: { endpoint: "https://api.search.tinyfish.ai", location: "SG", language: "en" },
    tinyfishFetchConfig: { providerId: "tinyfish-fetch", endpoint: "https://api.fetch.tinyfish.ai", format: "html" },
    lookup: publicLookup,
    fetchImpl: async (url) => String(url).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } })
      : new Response("gone", { status: 404, headers: { "content-type": "text/html" } }),
    tinyfishSearchImpl: async () => Response.json({ results: [{
      title: "Example Kitchen Official", snippet: "Official Singapore restaurant", url: "https://examplekitchen.com.sg/",
    }] }),
    tinyfishFetchImpl: async () => {
      renderedCalls += 1;
      if (renderedCalls === 1) return Response.json({ results: [], errors: [{ url: "https://old.example.sg/", error: "page_not_found" }] });
      return Response.json({ results: [{
        url: "https://examplekitchen.com.sg/", final_url: "https://examplekitchen.com.sg/",
        text: "<h1>Example Kitchen</h1><p>3 Example Road, Singapore 018900</p>", links: [],
      }], errors: [] });
    },
    onProgress: (state) => progress.push(state.stage),
  });
  assert.equal(discovered.status, "approved");
  assert.equal(discovered.source, "tinyfish_search_verified");
  assert.equal(discovered.website, "https://examplekitchen.com.sg/");
  assert.equal(discovered.attempts[0].source, "osm_viewport");
  assert.equal(discovered.attempts[0].status, "failed");
  assert.equal(renderedCalls, 2);
  assert.deepEqual(progress, ["validating_website", "rendering_website", "searching_website", "verifying_website"]);
});

test("ambiguous website candidates remain reviewable and search results reject aggregators", () => {
  const ambiguous = selectCatalogCandidate({ name: "Same Name" }, { entries: [
    { normalizedName: "same name", website: "https://one.sg/", osm: { url: "https://www.openstreetmap.org/node/1" } },
    { normalizedName: "same name", website: "https://two.sg/", osm: { url: "https://www.openstreetmap.org/node/2" } },
  ] });
  assert.equal(ambiguous.status, "needs_review");
  assert.equal(searchResultCandidate({ name: "Example Kitchen" }, { title: "Example Kitchen Singapore", url: "https://www.tripadvisor.com/example", description: "Official listing" }), null);
  assert.ok(searchResultCandidate({ name: "Example Kitchen" }, { title: "Example Kitchen Official", url: "https://examplekitchen.com.sg/", description: "Singapore restaurant" }));
});

test("robots rules use the longest matching wildcard rule", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/promotions\n";
  assert.equal(robotsDecision(robots, "/private/menu"), false);
  assert.equal(robotsDecision(robots, "/private/promotions/july"), true);
  assert.equal(robotsDecision(robots, "/public"), true);
});

test("deal collection follows same-origin promotion links and preserves evidence", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { status: 200, headers: { "content-type": "text/plain" } });
    if (url.endsWith("/promotions")) return new Response("<html><body><h1>July promotion</h1><p>Enjoy 20% off dinner from Monday to Thursday.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response('<html><body><a href="/promotions">Promotions</a><a href="https://elsewhere.test/deals">Other</a></body></html>', { status: 200, headers: { "content-type": "text/html" } });
  };
  const result = await collectRestaurantDeals({ id: "osm-node-42", name: "Example Kitchen", website: "https://example.sg/" }, { fetchImpl, lookup: publicLookup });
  assert.equal(result.status, "success");
  assert.equal(result.deals.length, 1);
  assert.match(result.deals[0].evidence, /20% off dinner/);
  assert.equal(result.deals[0].sourceUrl, "https://example.sg/promotions");
  assert.equal(calls.filter((url) => url.endsWith("robots.txt")).length, 1);
  assert.equal(calls.some((url) => url.includes("elsewhere.test")), false);
});

test("dynamic official pages use TinyFish Fetch after direct retrieval finds only a JavaScript shell", async () => {
  const calls = [];
  const tinyfishCalls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { status: 200, headers: { "content-type": "text/plain" } });
    return new Response(`<html><body><p>${"Restaurant navigation and general dining information. ".repeat(5)}</p><script>renderPromotions()</script></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  const result = await collectRestaurantDeals({ id: "shell", name: "Shell", website: "https://shell.sg/" }, {
    fetchImpl,
    tinyfishFetchImpl: async (url, options) => {
      tinyfishCalls.push({ url, options });
      return Response.json({
        results: [{
          url: "https://shell.sg/",
          final_url: "https://shell.sg/",
          format: "html",
          text: "<p>Singapore diners enjoy 20% off dinner.</p>",
          links: [],
        }],
        errors: [],
      });
    },
    tinyfishApiKey: "test-key",
    tinyfishConfig: {
      providerId: "tinyfish-fetch", endpoint: "https://api.fetch.tinyfish.ai", format: "html", cacheTtlSeconds: 3600, timeoutMs: 45_000,
    },
    lookup: publicLookup,
  });
  assert.equal(result.status, "success");
  assert.match(result.deals[0].evidence, /20% off dinner/);
  assert.equal(result.deals[0].retrieval, "tinyfish_fetch");
  assert.deepEqual(result.provider, { id: "tinyfish-fetch", costClass: "free", domain: "shell.sg" });
  assert.deepEqual(result.pagesInspected.map(({ retrieval }) => retrieval), ["direct_http", "tinyfish_fetch"]);
  assert.equal(tinyfishCalls.length, 1);
  assert.equal(tinyfishCalls[0].url, "https://api.fetch.tinyfish.ai");
  assert.equal(tinyfishCalls[0].options.headers["X-API-Key"], "test-key");
  assert.deepEqual(JSON.parse(tinyfishCalls[0].options.body).urls, ["https://shell.sg/"]);
});

test("restaurant service passes its TinyFish configuration and API key into queued deal enrichment", async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-tinyfish-service-test-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const config = {
    ...approvedConfig(["https://overpass.invalid"]),
    providerIds: ["openstreetmap-overpass", "openstreetmap", "wikidata", "tinyfish-fetch"],
    dealRetrieval: {
      mode: "direct_http_with_tinyfish_fetch",
      costClass: "free",
      respectRobots: true,
      tinyfish: { providerId: "tinyfish-fetch", endpoint: "https://api.fetch.tinyfish.ai", format: "html", timeoutMs: 45_000 },
    },
  };
  let observedApiKey = null;
  let tinyfishCalls = 0;
  const service = new RestaurantService({
    cacheRoot: path.join(temporary, "cache"),
    config,
    providerPolicy: approvedProviderPolicy(),
    tinyfishApiKey: "service-test-key",
    lookup: publicLookup,
    fetchImpl: async (url) => String(url).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } })
      : new Response("<script>renderPromotions()</script>", { status: 200, headers: { "content-type": "text/html" } }),
    tinyfishFetchImpl: async (_url, options) => {
      tinyfishCalls += 1;
      observedApiKey = options.headers["X-API-Key"];
      return Response.json({ results: [{ url: "https://service.sg/", final_url: "https://service.sg/", text: "<p>Singapore customers save S$10 today.</p>", links: [] }], errors: [] });
    },
  });
  service.remember([{ id: "osm-node-901", name: "Service", website: "https://service.sg/" }]);
  service.enqueue("osm-node-901", { allowTinyfish: true });
  const [status] = await service.waitFor(["osm-node-901"]);
  assert.equal(observedApiKey, "service-test-key");
  assert.equal(status.status, "success");
  assert.equal(status.data.provider.id, "tinyfish-fetch");
  assert.equal(status.data.deals[0].retrieval, "tinyfish_fetch");
  assert.equal(tinyfishCalls, 1);

  service.remember([{ id: "osm-node-902", name: "Batch Service", website: "https://service.sg/" }]);
  service.enqueue("osm-node-902");
  const [batchStatus] = await service.waitFor(["osm-node-902"]);
  assert.equal(batchStatus.data.status, "no_deals_found");
  assert.equal(tinyfishCalls, 1);
});

test("generic offer, award, order, and promotion navigation text is not treated as a deal", () => {
  const html = "<p>We offer authentic food and have won 51 international awards.</p><p>Order online.</p><a>Singapore Dining Promotion</a><a>Weekly set menu</a>";
  assert.deepEqual(evidenceSnippets(html), []);
});

test("deal evidence remains centered on a signal found late in minified page text", () => {
  const evidence = evidenceSnippets(`<p>${"generic restaurant copy ".repeat(80)}Daily HAPPY HOUR promotions run from 6–8pm with selected drinks.</p>`);
  assert.equal(evidence[0].title, "HAPPY HOUR");
  assert.match(evidence[0].evidence, /HAPPY HOUR promotions run from 6–8pm/);
  assert.ok(evidence[0].evidence.length <= 420);
  assert.equal(evidenceSnippets("Enjoy complimentary parking with a minimum spend of S$100.")[0].title, "Complimentary parking");
});

test("deal collection deduplicates claims and excludes foreign-scope promotions", async () => {
  const responses = {
    "https://example.sg/": '<a href="/promotions">Promotions</a><p>Enjoy 20% off dinner.</p>',
    "https://example.sg/promotions": "<p>Enjoy 20% off dinner every weekday.</p>",
    "https://example.co.id/": "<p>Claim your 15% off in Jakarta.</p>",
  };
  const fetchImpl = async (url) => {
    if (url.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    return new Response(responses[url], { status: 200, headers: { "content-type": "text/html" } });
  };
  const local = await collectRestaurantDeals({ id: "local", name: "Local", website: "https://example.sg/" }, { fetchImpl, lookup: publicLookup });
  assert.equal(local.deals.length, 1);
  const foreign = await collectRestaurantDeals({ id: "foreign", name: "Foreign", website: "https://example.co.id/" }, { fetchImpl, lookup: publicLookup });
  assert.equal(foreign.status, "no_deals_found");
  assert.deepEqual(foreign.deals, []);
});

test("deal collection records robots denial and missing websites without fabricating offers", async () => {
  const denied = await collectRestaurantDeals({ id: "a", name: "A", website: "https://example.com/private" }, {
    lookup: publicLookup,
    fetchImpl: async (url) => url.endsWith("robots.txt")
      ? new Response("User-agent: *\nDisallow: /private\n", { status: 200, headers: { "content-type": "text/plain" } })
      : new Response("<p>50% off</p>", { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.equal(denied.status, "unavailable");
  assert.match(denied.reason, /robots\.txt/);
  assert.deepEqual(denied.deals, []);
  const missing = await collectRestaurantDeals({ id: "b", name: "B", website: null });
  assert.equal(missing.status, "not_available");
  assert.deepEqual(missing.deals, []);
});

function run(command, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, command, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("pipeline completes a run and resume preserves valid restaurant stages", async (context) => {
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      assert.match(body, /amenity/);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ elements: [
        { type: "node", id: 1, lat: 1.285, lon: 103.858, tags: { amenity: "restaurant", name: "No Site One" } },
        { type: "node", id: 2, lat: 1.286, lon: 103.859, tags: { amenity: "cafe", name: "No Site Two" } },
      ] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "restaurant-pipeline-test-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const configPath = path.join(temporary, "config.json");
  const policyPath = path.join(temporary, "provider-policy.json");
  const outputRoot = path.join(temporary, "runs");
  fs.writeFileSync(policyPath, JSON.stringify(approvedProviderPolicy("127.0.0.1")));
  fs.writeFileSync(configPath, JSON.stringify({
    ...approvedConfig([`http://127.0.0.1:${server.address().port}`]),
    providerPolicy: policyPath,
    dealConcurrency: 2,
  }));
  const env = { ...process.env, RESTAURANT_PIPELINE_CONFIG: configPath, RESTAURANT_PIPELINE_OUTPUT_ROOT: outputRoot, RESTAURANT_PIPELINE_CACHE_ROOT: path.join(temporary, "cache") };
  const first = await run(["scripts/restaurant-pipeline.mjs", "start", "--bbox", "1.28,103.85,1.29,103.86"], { cwd: process.cwd(), env });
  assert.equal(first.code, 0, first.stderr);
  const summary = JSON.parse(first.stdout);
  assert.equal(summary.complete, true);
  assert.equal(summary.restaurantCount, 2);
  assert.deepEqual(summary.stageCounts, { complete: 2 });
  const statePath = path.join(process.cwd(), summary.output, "orchestrator-state.json");
  const state = JSON.parse(fs.readFileSync(statePath));
  const preserved = state.restaurants["osm-node-1"].result.fetchedAt;
  state.restaurants["osm-node-2"].status = "failed";
  state.restaurants["osm-node-2"].error = "synthetic retry";
  state.complete = false;
  fs.writeFileSync(statePath, JSON.stringify(state));
  const resumed = await run(["scripts/restaurant-pipeline.mjs", "resume", "--run", summary.runId], { cwd: process.cwd(), env });
  assert.equal(resumed.code, 0, resumed.stderr);
  const resumedState = JSON.parse(fs.readFileSync(statePath));
  assert.equal(resumedState.complete, true);
  assert.equal(resumedState.restaurants["osm-node-1"].result.fetchedAt, preserved);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const refreshed = await run(["scripts/restaurant-pipeline.mjs", "resume", "--run", summary.runId, "--refresh", "true"], { cwd: process.cwd(), env });
  assert.equal(refreshed.code, 0, refreshed.stderr);
  const refreshedState = JSON.parse(fs.readFileSync(statePath));
  assert.notEqual(refreshedState.restaurants["osm-node-1"].result.fetchedAt, preserved);
});
