import assert from "node:assert/strict";
import test from "node:test";

import {
  EVENT_FIELD_CONTRACT_VERSION,
  applyEventFieldCompleteness,
  extractEventPageEvidence,
} from "../scripts/lib/event-sources/event-field-extraction.mjs";
import { createDirectHtmlFetchClient } from "../scripts/lib/event-sources/direct-html-fetch.mjs";
import { createLayeredDetailFetchClient } from "../scripts/lib/event-sources/layered-detail-fetch.mjs";

const resolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("JSON-LD supplies the complete event contract with nested location and offers", () => {
  const html = `<!doctype html><html><head>
    <link rel="canonical" href="https://events.example.sg/event/one">
    <script type="application/ld+json">{
      "@context":"https://schema.org","@type":"Event","name":"Night Garden",
      "startDate":"2026-08-01T19:30:00+08:00","endDate":"2026-08-01T22:00:00+08:00",
      "description":"A limited-run light installation.","eventStatus":"https://schema.org/EventScheduled",
      "eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode",
      "location":{"@type":"Place","name":"Example Hall","address":{"@type":"PostalAddress","streetAddress":"1 Example Road","addressLocality":"Singapore","postalCode":"123456"}},
      "organizer":{"@type":"Organization","name":"Example Arts"},
      "offers":{"@type":"Offer","price":"28","priceCurrency":"SGD","availability":"https://schema.org/InStock","url":"https://events.example.sg/tickets"},
      "keywords":["Art","Nightlife"],"url":"https://events.example.sg/event/one"
    }</script></head><body><h1>Ignored lower-priority heading</h1></body></html>`;
  const extracted = extractEventPageEvidence({
    html,
    finalUrl: "https://events.example.sg/event/one",
  });
  assert.equal(extracted.fields.title, "Night Garden");
  assert.equal(extracted.fields.venue, "Example Hall");
  assert.match(extracted.fields.address, /123456/);
  assert.equal(extracted.fields.organizer, "Example Arts");
  assert.equal(extracted.fields.price, "SGD 28");
  assert.equal(extracted.fields.availability, "available");
  assert.deepEqual(extracted.fields.category, ["Art", "Nightlife"]);
  assert.equal(extracted.methods.title, "json_ld");
});

test("supported event microdata is used when JSON-LD is absent", () => {
  const html = `<article itemscope itemtype="https://schema.org/Event">
    <h1 itemprop="name">Microdata Film</h1>
    <meta itemprop="startDate" content="2026-09-02T20:00:00+08:00">
    <div itemprop="location" itemscope itemtype="https://schema.org/Place">
      <span itemprop="name">Cinema One</span>
      <span itemprop="address">10 Screen Street, Singapore 654321</span>
    </div>
    <div itemprop="organizer" itemscope><span itemprop="name">Film Club</span></div>
  </article>`;
  const extracted = extractEventPageEvidence({
    html,
    finalUrl: "https://example.sg/film",
  });
  assert.equal(extracted.fields.title, "Microdata Film");
  assert.equal(extracted.fields.venue, "Cinema One");
  assert.equal(extracted.fields.organizer, "Film Club");
  assert.equal(extracted.methods.schedule, "microdata");
});

test("JSON-LD wins over conflicting microdata and the conflict remains auditable", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Event","name":"Official JSON-LD title","startDate":"2026-10-01"
  }</script><article itemscope itemtype="https://schema.org/Event">
    <h1 itemprop="name">Stale microdata title</h1>
    <meta itemprop="startDate" content="2026-09-01">
  </article>`;
  const extracted = extractEventPageEvidence({
    html,
    finalUrl: "https://example.sg/conflict",
  });
  assert.equal(extracted.fields.title, "Official JSON-LD title");
  assert.equal(extracted.methods.title, "json_ld");
  assert.ok(extracted.conflicts.some(({ field }) => field === "title"));
  assert.ok(extracted.warnings.includes("structured_conflict:title"));
});

test("multiple structured locations remain off-map instead of choosing one building", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Event","name":"Two Hall Festival","startDate":"2026-10-01",
    "location":[
      {"@type":"Place","name":"Hall A","address":"1 A Street"},
      {"@type":"Place","name":"Hall B","address":"2 B Street"}
    ]
  }</script>`;
  const extracted = extractEventPageEvidence({
    html,
    finalUrl: "https://example.sg/two",
  });
  assert.equal(extracted.fields.venue, "Multiple locations");
  assert.equal(extracted.fields.address, null);
  assert.equal(extracted.locations.length, 2);
});

test("completeness distinguishes source omission from extraction failure", () => {
  const complete = applyEventFieldCompleteness(
    { title: "One", detailUrl: "https://example.sg/one", venue: null },
    {
      evidenceHash: "a".repeat(64),
      methods: { title: "json_ld", url: "canonical" },
    },
  );
  assert.equal(complete.fieldCompleteness.title.status, "present");
  assert.equal(
    complete.fieldCompleteness.venue.status,
    "not_published_by_source",
  );
  assert.equal(
    complete.fieldCompleteness.venue.reasonCode,
    "field_not_published",
  );
  assert.equal(
    complete.fieldCompleteness.title.contractVersion,
    EVENT_FIELD_CONTRACT_VERSION,
  );

  const failed = applyEventFieldCompleteness(
    { title: null, detailUrl: "https://example.sg/one" },
    { evidenceHash: "b".repeat(64), extractionFailed: true },
  );
  assert.equal(failed.fieldCompleteness.title.status, "extraction_failed");
  assert.equal(failed.fieldCompleteness.url.status, "present");
});

test("completeness cache reuses stable evidence, invalidates versions and retries failures", () => {
  const base = {
    title: "One",
    detailUrl: "https://example.sg/one",
    venue: null,
  };
  const first = applyEventFieldCompleteness(base, {
    evidenceHash: "c".repeat(64),
  });
  const reused = applyEventFieldCompleteness(first, {
    evidenceHash: "c".repeat(64),
  });
  assert.strictEqual(
    reused.fieldCompleteness.venue,
    first.fieldCompleteness.venue,
  );

  const invalidated = applyEventFieldCompleteness(first, {
    evidenceHash: "c".repeat(64),
    contractVersion: "2.0",
  });
  assert.notStrictEqual(
    invalidated.fieldCompleteness.venue,
    first.fieldCompleteness.venue,
  );
  assert.equal(invalidated.fieldCompleteness.venue.contractVersion, "2.0");

  const failed = applyEventFieldCompleteness(base, {
    evidenceHash: "d".repeat(64),
    extractionFailed: true,
  });
  const recovered = applyEventFieldCompleteness(
    { ...failed, venue: "Example Hall" },
    { evidenceHash: "d".repeat(64) },
  );
  assert.equal(failed.fieldCompleteness.venue.status, "extraction_failed");
  assert.equal(recovered.fieldCompleteness.venue.status, "present");
  assert.notStrictEqual(
    recovered.fieldCompleteness.venue,
    failed.fieldCompleteness.venue,
  );
});

test("direct HTML fetch validates redirects, size and official domains", async () => {
  const calls = [];
  const client = createDirectHtmlFetchClient({
    officialDomains: ["example.sg"],
    resolver,
    maximumResponseBytes: 1024,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response("<html><head><title>Direct</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });
  const batch = await client.fetchBatch(["https://events.example.sg/one"], {
    stage: "detail",
  });
  assert.equal(batch.results.length, 1);
  assert.equal(batch.results[0].retrievalMethod, "direct_html");
  assert.equal(calls.length, 1);
  const rejected = await client.fetchBatch(["https://unapproved.test/one"]);
  assert.equal(rejected.results.length, 0);
  assert.equal(rejected.errors[0].code, "official_domain_rejected");
});

test("direct HTML fetch follows bounded redirects and rejects oversized or non-HTML bodies", async () => {
  let mode = "redirect";
  const client = createDirectHtmlFetchClient({
    officialDomains: ["example.sg"],
    resolver,
    maximumResponseBytes: 16,
    fetchImpl: async (url) => {
      if (mode === "redirect" && url.endsWith("/start"))
        return new Response(null, {
          status: 302,
          headers: { location: "/final" },
        });
      if (mode === "non-html")
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(mode === "large" ? "x".repeat(17) : "<p>ok</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });
  const redirected = await client.fetchBatch(["https://example.sg/start"]);
  assert.equal(redirected.results[0].final_url, "https://example.sg/final");

  mode = "large";
  const large = await client.fetchBatch(["https://example.sg/large"]);
  assert.equal(large.errors[0].code, "response_too_large");

  mode = "non-html";
  const nonHtml = await client.fetchBatch(["https://example.sg/json"]);
  assert.equal(nonHtml.errors[0].code, "unsupported_content_type");
});

test("direct HTML fetch honors robots rules and logs hashes without page URLs", async () => {
  const logs = [];
  const client = createDirectHtmlFetchClient({
    officialDomains: ["example.sg"],
    resolver,
    respectRobots: true,
    logger: (entry) => logs.push(entry),
    fetchImpl: async (url) =>
      url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow: /private", { status: 200 })
        : new Response("<p>secret</p>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
  });
  const batch = await client.fetchBatch(["https://example.sg/private/event"]);
  assert.equal(batch.errors[0].code, "robots_disallowed");
  assert.ok(
    logs.every(
      (entry) =>
        !JSON.stringify(entry).includes("https://example.sg/private/event"),
    ),
  );
});

test("layered detail retrieval falls back only for failed direct pages", async () => {
  const fallbackCalls = [];
  const client = createLayeredDetailFetchClient({
    directClient: {
      fetchBatch: async (urls) => ({
        results: urls
          .filter((url) => url.endsWith("/ok"))
          .map((url) => ({ url, final_url: url, text: "ok" })),
        errors: urls
          .filter((url) => url.endsWith("/blocked"))
          .map((url) => ({ url, code: "bot_blocked" })),
        payloadHash: "direct",
      }),
    },
    fallbackClient: {
      fetchBatch: async (urls) => {
        fallbackCalls.push(...urls);
        return {
          results: urls.map((url) => ({
            url,
            final_url: url,
            text: "fallback",
          })),
          errors: [],
          payloadHash: "fallback",
        };
      },
    },
  });
  const detail = await client.fetchBatch(
    ["https://example.sg/ok", "https://example.sg/blocked"],
    { stage: "detail" },
  );
  assert.equal(detail.results.length, 2);
  assert.deepEqual(fallbackCalls, ["https://example.sg/blocked"]);
  await client.fetchBatch(["https://example.sg/listing"], { stage: "listing" });
  assert.equal(fallbackCalls.at(-1), "https://example.sg/listing");
});
