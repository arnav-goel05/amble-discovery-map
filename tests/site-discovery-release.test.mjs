import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createReleaseRecord,
  sanitizeEvidence,
  verifyHttpOrigin,
  verifyHttpOrigins,
} from "../scripts/verify-site-discovery.mjs";
import { renderRobots, renderSitemap } from "../cloudflare/site-discovery.mjs";

test("release records fail closed on mandatory checks", () => {
  const record = createReleaseRecord({
    candidateCommit: "abc123",
    rollbackVersion: "worker-v1",
    checks: [{ id: "canonical", required: true, status: "failed" }],
  });
  assert.equal(record.overallStatus, "failed");
  assert.equal(record.rollbackVersion, "worker-v1");
});

test("external providers are distinct from mandatory failures", () => {
  const record = createReleaseRecord({
    checks: [
      { id: "static", required: true, status: "passed" },
      { id: "webmaster", required: false, status: "external-blocker" },
    ],
  });
  assert.equal(record.overallStatus, "external-blocker");
});

test("release evidence removes credential-shaped fields and values", () => {
  assert.deepEqual(
    sanitizeEvidence({
      authorization: "Bearer exposed",
      nested: { cookie: "private", note: "token exposed" },
    }),
    { nested: { note: "[redacted]" } },
  );
});

test("HTTP verification reports mandatory redirect and 404 failures", async () => {
  const fetchImpl = async (input, { method }) => {
    const pathname = new URL(input).pathname;
    if (pathname === "/")
      return new Response(
        "<title>Amble: See What’s Happening in Singapore</title>",
        { headers: { "content-type": "text/html" } },
      );
    if (pathname === "/robots.txt")
      return new Response(method === "HEAD" ? null : renderRobots(), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    if (pathname === "/sitemap.xml")
      return new Response(method === "HEAD" ? null : renderSitemap(), {
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    if (pathname === "/index.html")
      return new Response(null, {
        status: 308,
        headers: { location: "https://amblefinds.com/" },
      });
    return new Response("missing", { status: 200 });
  };
  const checks = await verifyHttpOrigin("https://amblefinds.com", {
    fetchImpl,
  });
  assert.equal(
    checks.find(({ id }) => id === "redirect-and-404-http").status,
    "failed",
  );
});

test("preview verification does not require a canonical-host index redirect", async () => {
  const fetchImpl = async (input, { method }) => {
    const pathname = new URL(input).pathname;
    if (pathname === "/" || pathname === "/index.html")
      return new Response(
        method === "HEAD"
          ? null
          : "<title>Amble: See What’s Happening in Singapore</title>",
        { headers: { "content-type": "text/html" } },
      );
    if (pathname === "/robots.txt")
      return new Response(method === "HEAD" ? null : renderRobots(), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    if (pathname === "/sitemap.xml")
      return new Response(method === "HEAD" ? null : renderSitemap(), {
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    if (pathname.startsWith("/api/") && !pathname.startsWith("/api/admin/"))
      return Response.json({ error: "route_not_found" }, { status: 404 });
    return new Response("missing", { status: 404 });
  };
  const checks = await verifyHttpOrigin("https://preview.example", {
    fetchImpl,
    expectedIndexRedirect: false,
  });
  assert.equal(
    checks.find(({ id }) => id === "redirect-and-404-http").status,
    "passed",
  );
});

test("live verification retries bounded propagation failures", async () => {
  let ready = false;
  const socialCard = fs.readFileSync("public/brand/amble-social-card.png");
  const fetchImpl = async (input, { method }) => {
    if (!ready) return new Response("propagating", { status: 503 });
    const pathname = new URL(input).pathname;
    if (pathname === "/")
      return new Response(
        method === "HEAD"
          ? null
          : "<title>Amble: See What’s Happening in Singapore</title>",
        { headers: { "content-type": "text/html" } },
      );
    if (pathname === "/robots.txt")
      return new Response(method === "HEAD" ? null : renderRobots(), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    if (pathname === "/sitemap.xml")
      return new Response(method === "HEAD" ? null : renderSitemap(), {
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    if (pathname === "/index.html")
      return new Response(null, {
        status: 308,
        headers: { location: "https://amblefinds.com/" },
      });
    if (pathname === "/brand/amble-social-card.png")
      return new Response(method === "HEAD" ? null : socialCard, {
        headers: { "content-type": "image/png" },
      });
    if (pathname.startsWith("/api/") && !pathname.startsWith("/api/admin/"))
      return Response.json({ error: "route_not_found" }, { status: 404 });
    return new Response("missing", { status: 404 });
  };
  const result = await verifyHttpOrigins(["https://amblefinds.com"], {
    mode: "live",
    fetchImpl,
    attempts: 2,
    retryDelayMs: 0,
    sleepImpl: async () => {
      ready = true;
    },
  });
  assert.equal(result.attemptsUsed, 2);
  assert.equal(
    result.checks.every(({ status }) => status === "passed"),
    true,
  );
});
