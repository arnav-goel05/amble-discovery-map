import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { SITE_IDENTITY } from "../cloudflare/site-discovery.mjs";

const html = fs.readFileSync(path.resolve("index.html"), "utf8");

function values(attribute, key) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) =>
      Object.fromEntries(
        [...tag.matchAll(/([:\w-]+)=["']([^"']*)["']/g)].map(
          ([, name, value]) => [name, value],
        ),
      ),
    )
    .filter((entry) => entry[attribute] === key)
    .map((entry) => entry.content);
}

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("Open Graph metadata is complete, canonical, and unique", () => {
  const expected = {
    "og:type": "website",
    "og:site_name": SITE_IDENTITY.siteName,
    "og:locale": SITE_IDENTITY.locale,
    "og:title": SITE_IDENTITY.title,
    "og:description": SITE_IDENTITY.description,
    "og:url": SITE_IDENTITY.canonicalHomepage,
    "og:image": SITE_IDENTITY.socialImage.url,
    "og:image:type": "image/png",
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:image:alt": SITE_IDENTITY.socialImage.alt,
  };
  for (const [key, value] of Object.entries(expected))
    assert.deepEqual(values("property", key), [value], key);
  assert.equal(
    new URL(expected["og:image"]).origin,
    SITE_IDENTITY.canonicalOrigin,
  );
});

test("large-image social metadata matches Open Graph", () => {
  assert.deepEqual(values("name", "twitter:card"), ["summary_large_image"]);
  assert.deepEqual(values("name", "twitter:title"), [SITE_IDENTITY.title]);
  assert.deepEqual(values("name", "twitter:description"), [
    SITE_IDENTITY.description,
  ]);
  assert.deepEqual(values("name", "twitter:image"), [
    SITE_IDENTITY.socialImage.url,
  ]);
  assert.deepEqual(values("name", "twitter:image:alt"), [
    SITE_IDENTITY.socialImage.alt,
  ]);
});

test("social card is a 1200 by 630 PNG within the byte limit", () => {
  const asset = path.resolve("public/brand/amble-social-card.png");
  assert.deepEqual(pngDimensions(asset), [1200, 630]);
  assert.ok(fs.statSync(asset).size <= SITE_IDENTITY.socialImage.maxBytes);
});
