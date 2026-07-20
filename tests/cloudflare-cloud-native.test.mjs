import assert from "node:assert/strict";
import test from "node:test";

import worker, { parseBbox } from "../cloudflare/cloud-native-worker.mjs";

const db = {
  prepare() {
    return {
      bind() {
        return this;
      },
      async first() {
        return null;
      },
      async run() {
        return { success: true };
      },
    };
  },
};

test("cloud bbox validation preserves the public restaurant contract", () => {
  assert.deepEqual(parseBbox("1.28,103.84,1.30,103.86"), {
    south: 1.28,
    west: 103.84,
    north: 1.3,
    east: 103.86,
    key: "1.28000,103.84000,1.30000,103.86000",
  });
  assert.throws(() => parseBbox("invalid"), /bbox/);
  assert.throws(() => parseBbox("1,103,2,104"), /zoom in/);
});

test("cloud runtime serves approved snapshot metadata without a local origin", async () => {
  const response = await worker.fetch(
    new Request("https://amble.example/api/snapshot"),
    {},
    {},
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.schemaVersion, "1.0");
  assert.equal(payload.data.snapshotId, "initial");
  assert.match(
    payload.data.landmarksRef,
    /^\/api\/snapshot\/assets\/initial\//,
  );
});

test("cloud runtime keeps admin routes private and serves static assets from the binding", async () => {
  const admin = await worker.fetch(
    new Request("https://amble.example/admin.html"),
    {},
    {},
  );
  assert.equal(admin.status, 404);

  let assetRequest;
  const response = await worker.fetch(
    new Request("https://amble.example/"),
    {
      ASSETS: {
        async fetch(request) {
          assetRequest = request;
          return new Response("app");
        },
      },
    },
    {},
  );
  assert.equal(await response.text(), "app");
  assert.equal(assetRequest.url, "https://amble.example/");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("cloud runtime normalizes canonical aliases and preserves true asset 404s", async () => {
  const assets = {
    async fetch(request) {
      return new URL(request.url).pathname === "/"
        ? new Response("app")
        : new Response("missing", { status: 404 });
    },
  };
  for (const [input, location] of [
    ["http://amblefinds.com/path?q=1", "https://amblefinds.com/path?q=1"],
    ["https://www.amblefinds.com/path?q=1", "https://amblefinds.com/path?q=1"],
    [
      "https://amble.project-hub-arnav.workers.dev/path?q=1",
      "https://amblefinds.com/path?q=1",
    ],
    ["https://amblefinds.com/index.html", "https://amblefinds.com/"],
  ]) {
    const response = await worker.fetch(
      new Request(input),
      { ASSETS: assets },
      {},
    );
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), location);
  }
  const unknown = await worker.fetch(
    new Request("https://amblefinds.com/unknown"),
    { ASSETS: assets },
    {},
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("x-frame-options"), "DENY");
});

test("cloud runtime serves repository-owned discovery files before asset fallback", async () => {
  let assetFetches = 0;
  const env = {
    ASSETS: {
      async fetch() {
        assetFetches += 1;
        return new Response("managed crawler content", { status: 200 });
      },
    },
  };
  for (const [pathname, contentType] of [
    ["/robots.txt", "text/plain; charset=utf-8"],
    ["/sitemap.xml", "application/xml; charset=utf-8"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://amblefinds.com${pathname}`),
      env,
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), contentType);
    assert.match(response.headers.get("cache-control"), /max-age=3600/);
    assert.doesNotMatch(
      await response.text(),
      /managed crawler content|<html/i,
    );
  }
  assert.equal(assetFetches, 0);

  const privateResponse = await worker.fetch(
    new Request("https://amblefinds.com/api/admin/state"),
    env,
    {},
  );
  assert.equal(privateResponse.status, 404);
  assert.equal(assetFetches, 0);
});

test("missing R2 geometry fails closed instead of reaching a Mac", async () => {
  const response = await worker.fetch(
    new Request("https://amble.example/optimized-tiles/missing.b3dm"),
    {
      TILES_BUCKET: {
        async get() {
          return null;
        },
      },
    },
    {},
  );
  assert.equal(response.status, 404);
});

test("health checks report the cloud runtime ready", async () => {
  const response = await worker.fetch(
    new Request("https://amble.example/health/ready"),
    { RUNTIME_DB: db },
    {},
  );
  assert.deepEqual(await response.json(), { ok: true, runtime: "cloudflare" });
});

test("restaurant requests use D1 spatial data without a live upstream", async () => {
  const restaurant = {
    id: "osm-node-1",
    name: "Cloud Cafe",
    latitude: 1.29,
    longitude: 103.85,
  };
  const runtimeDb = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
        async all() {
          return sql.includes("FROM restaurants")
            ? { results: [{ payload: JSON.stringify(restaurant) }] }
            : { results: [] };
        },
      };
    },
  };
  const response = await worker.fetch(
    new Request(
      "https://amble.example/api/restaurants?bbox=1.28,103.84,1.30,103.86",
    ),
    { RUNTIME_DB: runtimeDb },
    { waitUntil() {} },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cache, "database");
  assert.equal(payload.restaurants[0].name, "Cloud Cafe");
});

test("cloud deal discovery uses TinyFish and caches the completed result in D1", async (context) => {
  const restaurant = {
    id: "osm-node-42",
    name: "Cloud Cafe",
    website: "https://cloudcafe.sg/",
    address: "1 Cloud Road, Singapore 018900",
  };
  let dealRow = null;
  const runtimeDb = {
    prepare(sql) {
      let values = [];
      return {
        bind(...input) {
          values = input;
          return this;
        },
        async first() {
          if (sql.includes("FROM restaurant_deals")) return dealRow;
          if (sql.includes("FROM restaurants WHERE id"))
            return { payload: JSON.stringify(restaurant) };
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT OR IGNORE") && !dealRow) {
            dealRow = {
              status: "running",
              payload: null,
              fetched_at: values[3],
              expires_at: values[4],
            };
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE restaurant_deals"))
            dealRow = {
              status: values[0],
              payload: values[1],
              fetched_at: values[2],
              expires_at: values[3],
            };
          return {
            success: true,
            meta: {
              changes: sql.startsWith("UPDATE restaurant_deals") ? 1 : 0,
            },
          };
        },
      };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/robots.txt"))
      return new Response("User-agent: *\nAllow: /", {
        headers: { "content-type": "text/plain" },
      });
    if (url === "https://cloudcafe.sg/")
      return new Response("<p>General restaurant information.</p>", {
        headers: { "content-type": "text/html" },
      });
    if (url === "https://api.fetch.tinyfish.ai")
      return Response.json({
        results: [
          {
            final_url: "https://cloudcafe.sg/",
            text: "<p>Singapore diners enjoy 20% off dinner.</p>",
            links: [],
          },
        ],
      });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const response = await worker.fetch(
    new Request("https://amble.example/api/restaurant-deals?id=osm-node-42"),
    { RUNTIME_DB: runtimeDb, TINYFISH_API_KEY: "test-key" },
    { waitUntil() {} },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, "success");
  assert.equal(payload.result.provider.id, "tinyfish-fetch");
  assert.match(payload.result.deals[0].evidence, /20% off dinner/);
  assert.equal(dealRow.status, "complete");
});

const voiceSessionRequest = ({
  origin = "https://amble.example",
  contentType = "application/json",
  body = JSON.stringify({
    protocolVersion: "1.0",
    disclosureAccepted: true,
    capabilities: { audioInput: true, audioOutput: true, text: true },
  }),
} = {}) =>
  new Request("https://amble.example/api/voice/sessions", {
    method: "POST",
    headers: { origin, "content-type": contentType },
    body,
  });

test("cloud security headers allow only self microphone and same-origin voice relay", async () => {
  const response = await worker.fetch(
    new Request("https://amble.example/"),
    {
      ASSETS: {
        async fetch() {
          return new Response("app");
        },
      },
    },
    {},
  );

  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), microphone=(self), geolocation=(self)",
  );
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /(?:^|;)\s*connect-src\s[^;]*'self'/);
  assert.doesNotMatch(csp, /api\.openai\.com|wss:\/\/[^;]*openai/i);
});

test("disabled cloud voice admission fails closed without disclosing server secrets", async () => {
  const secret = "fixture-openai-secret-must-not-leak";
  const response = await worker.fetch(
    voiceSessionRequest(),
    {
      REALTIME_ENABLED: "false",
      OPENAI_API_KEY: secret,
    },
    {},
  );
  const responseText = await response.text();
  const payload = JSON.parse(responseText);

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "voice_disabled");
  assert.doesNotMatch(responseText, new RegExp(secret));
  assert.doesNotMatch(
    JSON.stringify([...response.headers]),
    new RegExp(secret),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("cloud voice admission rejects cross-origin, non-JSON, and oversized requests", async () => {
  const enabledEnv = {
    REALTIME_ENABLED: "true",
    OPENAI_API_KEY: "fixture-server-only-key",
  };
  const cases = [
    {
      id: "cross-origin",
      request: voiceSessionRequest({ origin: "https://attacker.example" }),
      status: 403,
      code: "origin_rejected",
    },
    {
      id: "non-json",
      request: voiceSessionRequest({
        contentType: "text/plain",
        body: "not-json",
      }),
      status: 415,
      code: "invalid_request",
    },
    {
      id: "oversized",
      request: voiceSessionRequest({
        body: JSON.stringify({ padding: "x".repeat(64 * 1024) }),
      }),
      status: 413,
      code: "invalid_request",
    },
  ];

  for (const fixture of cases) {
    const response = await worker.fetch(fixture.request, enabledEnv, {});
    const payload = await response.json();
    assert.equal(response.status, fixture.status, fixture.id);
    assert.equal(payload.error.code, fixture.code, fixture.id);
  }
});
