import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { SITE_IDENTITY } from "../cloudflare/site-discovery.mjs";

const html = fs.readFileSync(path.resolve("index.html"), "utf8");

test("initial HTML exposes one minimal, linked identity graph", () => {
  const blocks = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  assert.equal(blocks.length, 1);
  const document = JSON.parse(blocks[0][1]);
  assert.equal(document["@context"], "https://schema.org");
  assert.equal(document["@graph"].length, 2);
  const byType = Object.fromEntries(
    document["@graph"].map((entity) => [entity["@type"], entity]),
  );
  assert.deepEqual(Object.keys(byType).sort(), ["Organization", "WebSite"]);
  assert.equal(byType.WebSite["@id"], SITE_IDENTITY.websiteId);
  assert.equal(byType.WebSite.publisher["@id"], SITE_IDENTITY.organizationId);
  assert.equal(byType.WebSite.inLanguage, SITE_IDENTITY.language);
  assert.equal(byType.Organization["@id"], SITE_IDENTITY.organizationId);
  assert.equal(byType.Organization.logo.url, SITE_IDENTITY.logoUrl);
});

test("favicon, touch icon, and identity logo use same-origin assets", () => {
  for (const url of [
    "/brand/favicon-32.png",
    "/brand/apple-touch-icon.png",
    SITE_IDENTITY.logoUrl,
  ]) {
    const parsed = new URL(url, SITE_IDENTITY.canonicalOrigin);
    assert.equal(parsed.origin, SITE_IDENTITY.canonicalOrigin);
    assert.ok(fs.existsSync(path.resolve("public", parsed.pathname.slice(1))));
  }
  assert.match(html, /rel="icon"[^>]+sizes="32x32"[^>]+favicon-32\.png/);
  assert.match(html, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png/);
});
