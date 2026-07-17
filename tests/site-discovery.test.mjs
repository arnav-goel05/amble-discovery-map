import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  SITE_IDENTITY,
  canonicalRedirect,
  discoveryResponse,
  renderRobots,
  renderSitemap,
  validateSiteIdentity,
} from "../cloudflare/site-discovery.mjs";

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve("tests/fixtures/site-discovery/identity.json"),
    "utf8",
  ),
);

test("site identity matches the schema-versioned fixture", () => {
  assert.deepEqual(validateSiteIdentity(fixture), fixture);
  assert.equal(SITE_IDENTITY.canonicalHomepage, fixture.canonicalHomepage);
  assert.equal(SITE_IDENTITY.workerAliasHost, "amble.amble-sg.workers.dev");
});

test("site identity rejects duplicate crawlers and unsupported access", () => {
  assert.throws(
    () =>
      validateSiteIdentity({
        ...fixture,
        crawlers: [...fixture.crawlers, fixture.crawlers[0]],
      }),
    /duplicate crawler/i,
  );
  assert.throws(
    () =>
      validateSiteIdentity({
        ...fixture,
        crawlers: [{ ...fixture.crawlers[0], access: "review" }],
      }),
    /access/i,
  );
});

test("canonical redirect matches only configured aliases", () => {
  assert.equal(
    canonicalRedirect(new URL("http://amblefinds.com/path?q=1")),
    "https://amblefinds.com/path?q=1",
  );
  assert.equal(
    canonicalRedirect(new URL("https://www.amblefinds.com/path?q=1")),
    "https://amblefinds.com/path?q=1",
  );
  assert.equal(
    canonicalRedirect(new URL("https://amble.amble-sg.workers.dev/path?q=1")),
    "https://amblefinds.com/path?q=1",
  );
  assert.equal(
    canonicalRedirect(new URL("https://other.workers.dev/path")),
    null,
  );
  assert.equal(
    canonicalRedirect(new URL("https://amblefinds.com/index.html")),
    "https://amblefinds.com/",
  );
  assert.equal(canonicalRedirect(new URL("https://amblefinds.com/")), null);
});

test("robots separates retrieval from training and names the canonical sitemap", () => {
  const robots = renderRobots();
  assert.match(robots, /User-agent: OAI-SearchBot\nAllow: \//);
  assert.match(robots, /User-agent: GPTBot\nDisallow: \//);
  assert.match(robots, /User-agent: Googlebot\nAllow: \//);
  assert.match(robots, /User-agent: Google-Extended\nDisallow: \//);
  assert.match(robots, /Content-signal: search=yes, ai-input=yes, ai-train=no/);
  assert.match(robots, /Sitemap: https:\/\/amblefinds\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /<html/i);
});

test("robots uses separate RFC 9309 groups so specific agents override wildcard", () => {
  const robots = renderRobots();
  assert.match(
    robots,
    /^User-agent: \*\nContent-signal: search=yes, ai-input=yes, ai-train=no\nAllow: \/\nDisallow: \/admin\.html\nDisallow: \/api\/admin\//,
  );
  for (const policy of fixture.crawlers) {
    const directive = policy.access === "allow" ? "Allow" : "Disallow";
    assert.match(
      robots,
      new RegExp(
        `User-agent: ${policy.agent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n${directive}: /`,
      ),
    );
  }
  assert.match(robots, /User-agent: Googlebot\nAllow: \//);
  assert.match(robots, /User-agent: Google-Extended\nDisallow: \//);
  assert.doesNotMatch(robots, /Crawl-delay|Noindex|<[^>]+>/i);
});

test("sitemap contains exactly one canonical homepage and no lastmod", () => {
  const sitemap = renderSitemap();
  assert.match(sitemap, /<loc>https:\/\/amblefinds\.com\/<\/loc>/);
  assert.equal((sitemap.match(/<url>/g) || []).length, 1);
  assert.doesNotMatch(sitemap, /lastmod|workers\.dev|https:\/\/www\./);
});

test("discovery files implement GET, HEAD, 405, content type, and cache contracts", async () => {
  for (const [pathname, contentType] of [
    ["/robots.txt", "text/plain; charset=utf-8"],
    ["/sitemap.xml", "application/xml; charset=utf-8"],
  ]) {
    const get = discoveryResponse(
      new Request(`https://amblefinds.com${pathname}`),
    );
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), contentType);
    assert.equal(
      get.headers.get("cache-control"),
      fixture.discovery.cacheControl,
    );
    assert.ok((await get.text()).length > 0);

    const head = discoveryResponse(
      new Request(`https://amblefinds.com${pathname}`, { method: "HEAD" }),
    );
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const post = discoveryResponse(
      new Request(`https://amblefinds.com${pathname}`, { method: "POST" }),
    );
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
  }
});

test("sitemap membership excludes aliases, private paths, and speculative dates", () => {
  const sitemap = renderSitemap();
  assert.equal((sitemap.match(/<loc>/g) || []).length, 1);
  assert.doesNotMatch(
    sitemap,
    /<loc>https?:\/\/(?:www\.|[^<]*workers\.dev)|<loc>[^<]*(?:admin|api)|lastmod/i,
  );
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
});
