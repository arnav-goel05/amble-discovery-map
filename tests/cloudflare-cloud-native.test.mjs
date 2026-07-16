import assert from "node:assert/strict";
import test from "node:test";

import worker, { parseBbox } from "../cloudflare/cloud-native-worker.mjs";

const db = {
  prepare() {
    return {
      bind() { return this; },
      async first() { return null; },
      async run() { return { success: true }; },
    };
  },
};

test("cloud bbox validation preserves the public restaurant contract", () => {
  assert.deepEqual(parseBbox("1.28,103.84,1.30,103.86"), { south: 1.28, west: 103.84, north: 1.3, east: 103.86, key: "1.28000,103.84000,1.30000,103.86000" });
  assert.throws(() => parseBbox("invalid"), /bbox/);
  assert.throws(() => parseBbox("1,103,2,104"), /zoom in/);
});

test("cloud runtime serves approved snapshot metadata without a local origin", async () => {
  const response = await worker.fetch(new Request("https://amble.example/api/snapshot"), {}, {});
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.schemaVersion, "1.0");
  assert.equal(payload.data.snapshotId, "initial");
  assert.match(payload.data.landmarksRef, /^\/api\/snapshot\/assets\/initial\//);
});

test("cloud runtime keeps admin routes private and serves static assets from the binding", async () => {
  const admin = await worker.fetch(new Request("https://amble.example/admin.html"), {}, {});
  assert.equal(admin.status, 404);

  let assetRequest;
  const response = await worker.fetch(new Request("https://amble.example/"), {
    ASSETS: { async fetch(request) { assetRequest = request; return new Response("app"); } },
  }, {});
  assert.equal(await response.text(), "app");
  assert.equal(assetRequest.url, "https://amble.example/");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("missing R2 geometry fails closed instead of reaching a Mac", async () => {
  const response = await worker.fetch(new Request("https://amble.example/optimized-tiles/missing.b3dm"), {
    TILES_BUCKET: { async get() { return null; } },
  }, {});
  assert.equal(response.status, 404);
});

test("health checks report the cloud runtime ready", async () => {
  const response = await worker.fetch(new Request("https://amble.example/health/ready"), { RUNTIME_DB: db }, {});
  assert.deepEqual(await response.json(), { ok: true, runtime: "cloudflare" });
});

test("restaurant requests use D1 spatial data without a live upstream", async () => {
  const restaurant = { id: "osm-node-1", name: "Cloud Cafe", latitude: 1.29, longitude: 103.85 };
  const runtimeDb = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { return null; },
        async all() { return sql.includes("FROM restaurants") ? { results: [{ payload: JSON.stringify(restaurant) }] } : { results: [] }; },
      };
    },
  };
  const response = await worker.fetch(new Request("https://amble.example/api/restaurants?bbox=1.28,103.84,1.30,103.86"), { RUNTIME_DB: runtimeDb }, { waitUntil() {} });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cache, "database");
  assert.equal(payload.restaurants[0].name, "Cloud Cafe");
});

test("cloud deal discovery uses TinyFish and caches the completed result in D1", async (context) => {
  const restaurant = { id: "osm-node-42", name: "Cloud Cafe", website: "https://cloudcafe.sg/", address: "1 Cloud Road, Singapore 018900" };
  let dealRow = null;
  const runtimeDb = {
    prepare(sql) {
      let values = [];
      return {
        bind(...input) { values = input; return this; },
        async first() {
          if (sql.includes("FROM restaurant_deals")) return dealRow;
          if (sql.includes("FROM restaurants WHERE id")) return { payload: JSON.stringify(restaurant) };
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT OR IGNORE") && !dealRow) {
            dealRow = { status: "running", payload: null, fetched_at: values[3], expires_at: values[4] };
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE restaurant_deals")) dealRow = { status: values[0], payload: values[1], fetched_at: values[2], expires_at: values[3] };
          return { success: true, meta: { changes: sql.startsWith("UPDATE restaurant_deals") ? 1 : 0 } };
        },
      };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    if (url === "https://cloudcafe.sg/") return new Response("<p>General restaurant information.</p>", { headers: { "content-type": "text/html" } });
    if (url === "https://api.fetch.tinyfish.ai") return Response.json({ results: [{ final_url: "https://cloudcafe.sg/", text: "<p>Singapore diners enjoy 20% off dinner.</p>", links: [] }] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  context.after(() => { globalThis.fetch = originalFetch; });
  const response = await worker.fetch(new Request("https://amble.example/api/restaurant-deals?id=osm-node-42"), { RUNTIME_DB: runtimeDb, TINYFISH_API_KEY: "test-key" }, { waitUntil() {} });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, "success");
  assert.equal(payload.result.provider.id, "tinyfish-fetch");
  assert.match(payload.result.deals[0].evidence, /20% off dinner/);
  assert.equal(dealRow.status, "complete");
});
