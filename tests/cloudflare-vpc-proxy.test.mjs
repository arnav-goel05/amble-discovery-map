import assert from "node:assert/strict";
import test from "node:test";

import worker, { isCacheableHashedAssetRequest, isCacheableTileRequest, isPrivatePath, originRequest, r2TileResponse, tileObjectKey } from "../cloudflare/workers-vpc-proxy.mjs";

test("the proxy preserves routes and queries while targeting the private local server", () => {
  const request = new Request("https://amble.example.workers.dev/optimized-tiles/6/1.b3dm?version=2", {
    headers: { "x-example": "kept" },
  });
  const proxied = originRequest(request);
  assert.equal(proxied.url, "http://127.0.0.1:4173/optimized-tiles/6/1.b3dm?version=2");
  assert.equal(proxied.headers.get("x-example"), "kept");
  assert.equal(proxied.headers.get("x-forwarded-host"), "amble.example.workers.dev");
  assert.equal(proxied.headers.get("x-forwarded-proto"), "https");
});

test("only full GET tile responses are eligible for edge caching", () => {
  assert.equal(isCacheableTileRequest(new Request("https://example.com/optimized-tiles/1.b3dm")), true);
  assert.equal(isCacheableTileRequest(new Request("https://example.com/poi-tiles/place/1.b3dm")), true);
  assert.equal(isCacheableTileRequest(new Request("https://example.com/optimized-tiles/1.b3dm", { headers: { Range: "bytes=0-99" } })), false);
  assert.equal(isCacheableTileRequest(new Request("https://example.com/", { method: "POST" })), false);
});

test("tile paths map directly to stable R2 object keys", () => {
  assert.equal(tileObjectKey(new Request("https://example.com/optimized-tiles/7/1/2_0.b3dm?version=2")), "optimized-tiles/7/1/2_0.b3dm");
  assert.equal(tileObjectKey(new Request("https://example.com/poi-tiles/event-venues/tileset.json")), "poi-tiles/event-venues/tileset.json");
  assert.equal(tileObjectKey(new Request("https://example.com/api/snapshot")), null);
});

const r2Object = (body, { key = "optimized-tiles/tileset.json", size = 2, range = null } = {}) => ({
  body,
  httpEtag: '"tile-etag"',
  key,
  range,
  size,
  writeHttpMetadata(headers) { headers.set("content-type", key.endsWith(".json") ? "application/json" : "application/octet-stream"); },
});

test("R2 serves full and ranged tile responses with browser metadata", async () => {
  const bucket = {
    async get(_key, options) {
      return options.range.has("range")
        ? r2Object(new Uint8Array([2, 3]), { key: "optimized-tiles/1.b3dm", size: 4, range: { offset: 1, length: 2 } })
        : r2Object("{}", { size: 2 });
    },
  };
  const full = await r2TileResponse(new Request("https://example.com/optimized-tiles/tileset.json"), bucket);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("x-amble-tile-source"), "r2");
  assert.equal(full.headers.get("etag"), '"tile-etag"');
  assert.match(full.headers.get("cache-control"), /max-age=300/);

  const partial = await r2TileResponse(new Request("https://example.com/optimized-tiles/1.b3dm", { headers: { range: "bytes=1-2" } }), bucket);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 1-2/4");
  assert.equal(partial.headers.get("content-length"), "2");
});

test("the Worker prefers R2 tiles and falls back to the private origin for missing objects", async () => {
  let originCalls = 0;
  const env = {
    TILES_BUCKET: { async get(key) { return key.endsWith("present.b3dm") ? r2Object("r2", { key, size: 2 }) : null; } },
    LOCAL_APP: { async fetch() { originCalls += 1; return new Response("origin"); } },
  };
  const fromR2 = await worker.fetch(new Request("https://example.com/optimized-tiles/present.b3dm"), env, {});
  assert.equal(await fromR2.text(), "r2");
  assert.equal(fromR2.headers.get("x-amble-tile-source"), "r2");
  assert.equal(originCalls, 0);

  const fromOrigin = await worker.fetch(new Request("https://example.com/optimized-tiles/missing.b3dm"), env, {});
  assert.equal(await fromOrigin.text(), "origin");
  assert.equal(originCalls, 1);
});

test("only content-hashed static assets are eligible for edge caching", () => {
  assert.equal(isCacheableHashedAssetRequest(new Request("https://example.com/assets/main.9b8f562b.js")), true);
  assert.equal(isCacheableHashedAssetRequest(new Request("https://example.com/assets/font.2153b52c.woff2")), true);
  assert.equal(isCacheableHashedAssetRequest(new Request("https://example.com/main.js")), false);
  assert.equal(isCacheableHashedAssetRequest(new Request("https://example.com/assets/main.js")), false);
  assert.equal(isCacheableHashedAssetRequest(new Request("https://example.com/assets/main.9b8f562b.js", { headers: { Range: "bytes=0-99" } })), false);
});

test("admin routes stay private on the public workers.dev proxy", async () => {
  assert.equal(isPrivatePath("/admin.html"), true);
  assert.equal(isPrivatePath("/api/admin/session"), true);
  assert.equal(isPrivatePath("/api/restaurants"), false);
  const response = await worker.fetch(new Request("https://example.workers.dev/api/admin/session"), {}, {});
  assert.equal(response.status, 404);
});

test("the Worker returns the private service response and fails closed when it is offline", async () => {
  let received;
  const env = {
    LOCAL_APP: {
      async fetch(request) {
        received = request;
        return new Response("online", { headers: { "cache-control": "no-cache" } });
      },
    },
  };
  const response = await worker.fetch(new Request("https://example.workers.dev/api/snapshot"), env, {});
  assert.equal(await response.text(), "online");
  assert.equal(received.url, "http://127.0.0.1:4173/api/snapshot");

  const offline = await worker.fetch(new Request("https://example.workers.dev/"), { LOCAL_APP: { fetch: async () => { throw new Error("offline"); } } }, {});
  assert.equal(offline.status, 502);
  assert.equal(offline.headers.get("cache-control"), "no-store");
});
