import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { verifyCloudflareDeployment } from "../scripts/verify-cloudflare-deployment.mjs";

function responseFor(url, body, init) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url.href });
  return response;
}

test("production smoke accepts the canonical homepage identity", async (context) => {
  const originalFetch = globalThis.fetch;
  const html = fs
    .readFileSync("index.html", "utf8")
    .replace("/app-entry.js", "/assets/main-current.js");

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/")
      return responseFor(url, html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (url.pathname === "/assets/main-current.js")
      return responseFor(url, "export {};", {
        headers: { "content-type": "application/javascript" },
      });
    return responseFor(url, "missing", { status: 404 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  assert.deepEqual(await verifyCloudflareDeployment("https://amblefinds.com"), {
    homepage: "https://amblefinds.com/",
    entry: "https://amblefinds.com/assets/main-current.js",
  });
});

test("production smoke rejects the retired homepage identity", async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    return responseFor(
      url,
      '<title>Amble - Singapore Events Map</title><script type="module" src="/assets/main.js"></script>',
      { headers: { "content-type": "text/html" } },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    verifyCloudflareDeployment("https://amblefinds.com"),
    /homepage identity is missing or incorrect/,
  );
});
