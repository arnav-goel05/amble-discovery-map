import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  assertRestaurantProviderConfig,
  collectRestaurantDeals,
  collectRestaurants,
  discoverRestaurantWebsite,
} = require("../scripts/lib/restaurant-pipeline-core.cjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "data/provider-policy.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(root, "data/restaurant-pipeline-config.json"), "utf8"));
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("restaurant configuration is allowlisted free/open policy and rejects paid or unknown providers", () => {
  const approved = assertRestaurantProviderConfig(config, policy);
  assert.deepEqual(approved.map(({ id, costClass }) => ({ id, costClass })), [
    { id: "openstreetmap-overpass", costClass: "open" },
    { id: "openstreetmap", costClass: "open" },
    { id: "wikidata", costClass: "open" },
    { id: "tinyfish-fetch", costClass: "free" },
    { id: "tinyfish-search", costClass: "free" },
  ]);
  assert.throws(() => assertRestaurantProviderConfig({ ...config, providerIds: [...config.providerIds, "paid-search"] }, {
    ...policy,
    providers: [...policy.providers, { id: "paid-search", owner: "Paid", domains: ["paid.example"], costClass: "paid", enabled: true }],
  }), /free\/open/);
  assert.throws(() => assertRestaurantProviderConfig({ ...config, providerIds: ["missing-provider"] }, policy), /not approved/);
  assert.equal(config.dealRetrieval.mode, "direct_http_with_tinyfish_fetch");
  assert.equal(config.dealRetrieval.tinyfish.endpoint, "https://api.fetch.tinyfish.ai");
  assert.equal(config.websiteDiscovery.tinyfishSearch.endpoint, "https://api.search.tinyfish.ai");
  assert.equal(JSON.stringify(config).includes("brave"), false);
});

test("Overpass collection validates configured provider domains and records provenance", async () => {
  const fetchImpl = async () => Response.json({ elements: [{ type: "node", id: 7, lat: 1.29, lon: 103.85, tags: { amenity: "cafe", name: "Policy Cafe" } }] });
  const result = await collectRestaurants({
    bbox: "1.28,103.84,1.30,103.86",
    endpoints: ["https://overpass-api.de/api/interpreter"],
    fetchImpl,
    providerPolicy: policy,
  });
  assert.deepEqual(result.provider, { id: "openstreetmap-overpass", owner: "OpenStreetMap community", costClass: "open" });
  assert.equal(result.attempts[0].providerId, "openstreetmap-overpass");
  await assert.rejects(() => collectRestaurants({
    bbox: "1.28,103.84,1.30,103.86",
    endpoints: ["https://paid.example/interpreter"],
    fetchImpl,
    providerPolicy: policy,
  }), /not approved/);
});

test("website discovery accepts only evidenced official pages and never invokes unapproved search fallbacks", async () => {
  let fetchCalls = 0;
  const direct = await discoverRestaurantWebsite({
    id: "osm-node-1",
    name: "Official Cafe",
    website: "https://official.example.sg/",
    osm: { url: "https://www.openstreetmap.org/node/1" },
  }, { providerPolicy: policy, fetchImpl: async () => { fetchCalls += 1; throw new Error("must not search"); } });
  assert.equal(direct.status, "approved");
  assert.equal(direct.source, "osm_viewport");
  assert.deepEqual(direct.evidence, ["https://www.openstreetmap.org/node/1"]);
  assert.equal(fetchCalls, 0);

  const unresolved = await discoverRestaurantWebsite({ id: "unknown", name: "Unknown Cafe" }, {
    catalog: { entries: [] }, providerPolicy: policy, fetchImpl: async () => { fetchCalls += 1; throw new Error("must not search"); },
  });
  assert.equal(unresolved.status, "not_found");
  assert.equal(fetchCalls, 0);
});

test("official deal retrieval checks robots, fetches directly first, records provenance, and drops expired claims", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    return new Response("<p>Enjoy 25% off dinner. Offer valid until 1 July 2026.</p><p>Happy hour every Friday.</p>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  const result = await collectRestaurantDeals({ id: "official", name: "Official", website: "https://official.example.sg/" }, {
    fetchImpl,
    lookup: publicLookup,
    clock: () => new Date("2026-07-14T00:00:00Z"),
  });
  assert.deepEqual(calls.map(({ url }) => url), ["https://official.example.sg/robots.txt", "https://official.example.sg/"]);
  assert.equal(calls.some(({ url }) => /tinyfish/i.test(url)), false);
  assert.equal(result.pagesInspected[0].retrieval, "direct_http");
  assert.deepEqual(result.provider, { id: "official-website-direct", costClass: "free", domain: "official.example.sg" });
  assert.equal(result.deals.some(({ evidence }) => /1 July 2026/.test(evidence)), false);
  assert.equal(result.deals.some(({ evidence }) => /Happy hour/.test(evidence)), true);
  assert.equal(result.expiredEvidenceCount, 1);
});

test("robots denial prevents any official-page retrieval", async () => {
  const calls = [];
  const result = await collectRestaurantDeals({ id: "blocked", name: "Blocked", website: "https://blocked.example.sg/private" }, {
    lookup: publicLookup,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response("User-agent: *\nDisallow: /private", { status: 200, headers: { "content-type": "text/plain" } });
    },
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /robots\.txt/);
  assert.deepEqual(calls, ["https://blocked.example.sg/robots.txt"]);
});
