import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  collectRenderedSource,
  collectSource,
  mapCatchDetail,
  mapSisticDetail,
  requestWithRetry,
  sourceRecordProvenance,
  validateOfficialReference,
  validateSourcePolicy,
} from "../scripts/event-source-collector.mjs";
import {
  readPipelineConfig,
  singaporeWindow,
  validateSourceSemantics,
} from "../scripts/event-pipeline.mjs";
import { temporaryState } from "./helpers/baseline-fixtures.mjs";
import {
  createTinyfishFetchClient,
  canonicalRenderedUrl,
} from "../scripts/lib/event-sources/tinyfish-fetch.mjs";
import { createAuthorityCaptureIndex } from "../scripts/lib/event-sources/authority-capture.mjs";
import {
  migrateSourceDefinition,
  validateEventSourceDefinitions,
} from "../scripts/verify-event-source-adapters.mjs";
import { renderedAdapterFor } from "../scripts/lib/event-sources/index.mjs";

test("the weekly source window contains the run date and seven following dates", () => {
  assert.deepEqual(singaporeWindow("2026-07-14"), {
    start: "2026-07-14T00:00:00+08:00",
    end: "2026-07-21T23:59:59+08:00",
    inclusive: true,
  });
  assert.equal(readPipelineConfig().windowDaysAfterStart, 7);
});

test("source record provenance repeats adapter, retrieval, window, and immutable pointers", () => {
  const source = readPipelineConfig().sources[0];
  const provenance = sourceRecordProvenance({
    run: { runId: "run-a", window: singaporeWindow("2026-07-14") },
    source,
    retrievedAt: "2026-07-14T00:00:00.000Z",
    listingRef: "raw/catch/listings/page-0001.json#/data/Items/0",
    responseRef: "raw/catch/details/fixture.response.json",
    detailUrl: "https://www.catch.sg/Event/example",
  });
  assert.equal(provenance.adapterId, "catch-official-listing-v1");
  assert.equal(provenance.providerId, "catch-sg");
  assert.equal(provenance.providerCostClass, "free");
  assert.match(provenance.adapterDefinitionHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(provenance.requestedWindow, {
    ...singaporeWindow("2026-07-14"),
    timezone: "Asia/Singapore",
  });
  assert.equal(
    provenance.provenance.parentListingRef,
    "raw/catch/listings/page-0001.json#/data/Items/0",
  );
  assert.equal(
    provenance.provenance.responseRef,
    "raw/catch/details/fixture.response.json",
  );
});

test("event sources fail closed when their free/open policy no longer matches", () => {
  const source = readPipelineConfig().sources[0];
  assert.doesNotThrow(() => validateSourcePolicy(source));
  assert.throws(
    () => validateSourcePolicy({ ...source, costClass: "paid" }),
    /cost classification/i,
  );
  assert.throws(
    () =>
      validateSourcePolicy({
        ...source,
        listing: { ...source.listing, url: "https://example.com/events" },
      }),
    /not approved/i,
  );
  assert.throws(
    () =>
      validateSourcePolicy({
        ...source,
        listing: { ...source.listing, urls: ["https://example.com/events"] },
      }),
    /not approved/i,
  );
});

test("requests retry transient failures with bounded exponential backoff", async () => {
  const statuses = [503, 429, 200];
  const delays = [];
  const result = await requestWithRetry(
    async () => {
      const status = statuses.shift();
      return {
        status,
        ok: status === 200,
        body: status === 200 ? { ok: true } : null,
        text: "",
      };
    },
    { url: "https://example.test", method: "GET" },
    {
      maxAttempts: 3,
      timeoutMs: 100,
      initialBackoffMs: 10,
      maximumBackoffMs: 20,
      sleep: async (delay) => {
        delays.push(delay);
      },
    },
  );
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(result.response.status, 200);
});

test("requests time out and stop after the configured attempt bound", async () => {
  let calls = 0;
  await assert.rejects(
    requestWithRetry(
      async () => {
        calls += 1;
        return new Promise(() => {});
      },
      { url: "https://example.test", method: "GET" },
      {
        maxAttempts: 2,
        timeoutMs: 5,
        initialBackoffMs: 0,
        maximumBackoffMs: 0,
        sleep: async () => {},
      },
    ),
    (error) => error.code === "request_timeout" && error.attempts === 2,
  );
  assert.equal(calls, 2);
});

test("official event references require successful approved-domain destinations", () => {
  const source = readPipelineConfig().sources.find(
    ({ providerId }) => providerId === "sistic",
  );
  assert.doesNotThrow(() =>
    validateOfficialReference(
      source,
      "https://www.sistic.com.sg/event-details/show",
      {
        ok: true,
        status: 200,
        url: "https://www.sistic.com.sg/event-details/show",
      },
    ),
  );
  assert.throws(
    () =>
      validateOfficialReference(
        source,
        "https://www.sistic.com.sg/event-details/show",
        { ok: true, status: 200, url: "https://redirect.example/show" },
      ),
    /redirect.*unapproved domain/i,
  );
  assert.throws(
    () =>
      validateOfficialReference(
        source,
        "https://www.sistic.com.sg/event-details/show",
        { ok: false, status: 404 },
      ),
    /status 404/i,
  );
});

test("duplicate captured detail URLs remain one immutable artifact", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ providerId }) => providerId === "catch-sg",
    );
    const responses = [
      {
        status: 200,
        ok: true,
        body: {
          data: {
            Items: [{ Url: "/Event/one" }, { Url: "/Event/one#duplicate" }],
            ItemTotal: 2,
            PageTotal: 1,
          },
        },
        text: "",
      },
      {
        status: 200,
        ok: true,
        url: "https://www.catch.sg/Event/one",
        body: null,
        text: '<div event-detail-page-id="42"></div>',
      },
      {
        status: 200,
        ok: true,
        body: {
          data: {
            DisplayEventTitle: "One",
            Location: "Hall",
            EventStartDate: "2026-07-16",
            EventEndDate: "2026-07-16",
          },
        },
        text: "",
      },
    ];
    const result = await collectSource({
      runDir: state.root,
      run: { runId: "run-a", window: singaporeWindow("2026-07-14") },
      source,
      transport: async () => responses.shift(),
      now: () => "2026-07-14T00:00:00.000Z",
      requestPolicy: { maxAttempts: 1, timeoutMs: 100 },
    });
    assert.equal(result.status, "success");
    assert.equal(result.counts.processedSourceRecords, 1);
    assert.equal(result.counts.invalidSourceRecords, 1);
    assert.deepEqual(Object.values(result.invalidReasonCodes), [
      "duplicate_detail_url",
    ]);
    assert.equal(
      result.artifactRefs.filter((ref) => ref.endsWith(".official.json"))
        .length,
      1,
    );
  } finally {
    state.cleanup();
  }
});

test("all nine definitions have deterministic evidence role, operating state, collection order, and direct precedence", () => {
  const report = validateEventSourceDefinitions();
  assert.equal(report.sources.length, 9);
  assert.deepEqual(
    report.sources
      .filter(({ evidenceRole }) => evidenceRole === "editorial")
      .map(({ operatingState, precedence }) => [operatingState, precedence]),
    [
      ["enabled", null],
      ["enabled", null],
      ["enabled", null],
    ],
  );
  assert.deepEqual(
    report.sources.map(({ collectionOrder }) => collectionOrder),
    [10, 20, 30, 40, 50, 60, 70, 80, 90],
  );
});

test("v3 source definitions migrate legacy roles and validate direct, editorial, and unavailable states", () => {
  const direct = migrateSourceDefinition({
    sourceRole: "authoritative",
    operatingMode: "required",
    enabled: true,
  });
  const editorial = migrateSourceDefinition({
    sourceRole: "discovery",
    operatingMode: "pilot",
    enabled: true,
    confirmation: { policyVersion: "1.0" },
  });
  const unavailable = migrateSourceDefinition({
    sourceRole: "authoritative",
    operatingMode: "disabled",
    enabled: false,
    unavailableReason: "layout_contract_changed",
  });
  assert.deepEqual(
    [direct.evidenceRole, direct.operatingState],
    ["direct", "enabled"],
  );
  assert.deepEqual(
    [editorial.evidenceRole, editorial.operatingState],
    ["editorial", "enabled"],
  );
  assert.deepEqual(editorial.editorialPolicy, {
    version: "2.0",
    corroborateFirst: true,
    allowSufficientEditorialOnly: true,
  });
  assert.deepEqual(
    [unavailable.evidenceRole, unavailable.operatingState],
    ["unavailable", "disabled"],
  );

  const report = validateEventSourceDefinitions();
  assert.equal(report.schemaVersion, "2.0");
  assert.deepEqual(
    report.sources.map(({ evidenceRole }) => evidenceRole),
    [
      "direct",
      "direct",
      "direct",
      "direct",
      "direct",
      "unavailable",
      "editorial",
      "editorial",
      "editorial",
    ],
  );
  assert.deepEqual(
    report.sources.map(({ operatingState }) => operatingState),
    [
      "enabled",
      "enabled",
      "enabled",
      "enabled",
      "enabled",
      "disabled",
      "enabled",
      "enabled",
      "enabled",
    ],
  );
});

test("TinyFish transport canonicalizes, batches, reports per-URL errors, and never leaks its credential to logs", async () => {
  const logs = [];
  let requestHeaders;
  let requestBody;
  const client = createTinyfishFetchClient({
    apiKey: "secret-key",
    now: () => 100_000,
    sleep: async () => {},
    resolver: async () => [{ address: "103.1.2.3", family: 4 }],
    logger: (record) => logs.push(record),
    fetchImpl: async (_url, request) => {
      requestHeaders = request.headers;
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            results: [{ url: "https://example.com/event" }],
            errors: [{ url: "https://example.com/bad", code: "fetch_failed" }],
          }),
      };
    },
  });
  const result = await client.fetchBatch([
    "https://EXAMPLE.com/event?utm_source=x",
    "https://example.com/bad",
  ]);
  assert.equal(result.results.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(requestHeaders["X-API-Key"], "secret-key");
  assert.equal(requestHeaders.authorization, undefined);
  assert.deepEqual(requestBody, {
    urls: ["https://example.com/bad", "https://example.com/event"],
    format: "markdown",
    links: true,
    image_links: false,
    per_url_timeout_ms: 110_000,
  });
  assert.doesNotMatch(JSON.stringify(logs), /secret-key/);
  assert.equal(
    canonicalRenderedUrl("https://EXAMPLE.com/event/?utm_source=x#part"),
    "https://example.com/event",
  );
  await assert.rejects(
    client.fetchBatch(
      Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`),
    ),
    (error) => error.code === "batch_limit_exceeded",
  );
});

test("TinyFish transport applies checked-in freshness and selector-scoping options", async () => {
  let requestBody;
  const client = createTinyfishFetchClient({
    apiKey: "secret-key",
    format: "html",
    ttl: 0,
    includeSelectors: ["stb-event-and-festivals"],
    now: () => 100_000,
    sleep: async () => {},
    resolver: async () => [{ address: "103.1.2.3", family: 4 }],
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            results: [
              {
                url: "https://example.com/events",
                text: "<main>Events</main>",
              },
            ],
            errors: [],
          }),
      };
    },
  });
  await client.fetchBatch(["https://example.com/events"]);
  assert.equal(requestBody.format, "html");
  assert.equal(requestBody.ttl, 0);
  assert.deepEqual(requestBody.include_selectors, ["stb-event-and-festivals"]);
});

test("TinyFish listing request options do not narrow subsequent detail retrieval", async () => {
  const requests = [];
  const client = createTinyfishFetchClient({
    apiKey: "secret-key",
    format: "markdown",
    now: () => 100_000,
    sleep: async () => {},
    resolver: async () => [{ address: "103.1.2.3", family: 4 }],
    fetchImpl: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            results: [{ url: "https://example.com/events", text: "ok" }],
            errors: [],
          }),
      };
    },
  });
  await client.fetchBatch(["https://example.com/events"], {
    requestOptions: {
      format: "html",
      ttl: 0,
      includeSelectors: ["main a[href*='/m/']"],
    },
  });
  await client.fetchBatch(["https://example.com/event-detail"]);
  assert.equal(requests[0].format, "html");
  assert.equal(requests[0].ttl, 0);
  assert.deepEqual(requests[0].include_selectors, ["main a[href*='/m/']"]);
  assert.equal(requests[1].format, "markdown");
  assert.equal(requests[1].ttl, undefined);
  assert.equal(requests[1].include_selectors, undefined);
});

test("TinyFish retries a transient per-URL failure when a batch produced no results", async () => {
  let attempts = 0;
  const client = createTinyfishFetchClient({
    apiKey: "secret-key",
    maxAttempts: 2,
    now: () => 100_000,
    sleep: async () => {},
    resolver: async () => [{ address: "103.1.2.3", family: 4 }],
    fetchImpl: async () => {
      attempts += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            attempts === 1
              ? {
                  results: [],
                  errors: [
                    {
                      url: "https://example.com/events",
                      error: "target_unreachable",
                    },
                  ],
                }
              : {
                  results: [
                    { url: "https://example.com/events", text: "Events" },
                  ],
                  errors: [],
                },
          ),
      };
    },
  });
  const result = await client.fetchBatch(["https://example.com/events"]);
  assert.equal(attempts, 2);
  assert.equal(result.results.length, 1);
});

test("TinyFish stops reading oversized responses at the configured byte boundary", async () => {
  let pulls = 0;
  const client = createTinyfishFetchClient({
    apiKey: "secret-key",
    maximumResponseBytes: 32,
    maxAttempts: 1,
    now: () => 100_000,
    sleep: async () => {},
    resolver: async () => [{ address: "103.1.2.3", family: 4 }],
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulls += 1;
            controller.enqueue(new TextEncoder().encode("x".repeat(20)));
            if (pulls === 10) controller.close();
          },
        }),
        { status: 200 },
      ),
  });
  await assert.rejects(
    client.fetchBatch(["https://example.com/event"]),
    (error) => error.code === "response_too_large",
  );
  assert.ok(pulls < 10, `expected an early bounded stop, read ${pulls} chunks`);
});

test("authority capture index reuses raw captures separately from parser fixtures", () => {
  const state = temporaryState();
  try {
    const index = createAuthorityCaptureIndex({
      runDir: state.root,
      runId: "run-a",
      window: singaporeWindow("2026-07-14"),
      retrievalDefinitionHash: "transport-v1",
    });
    index.reserve("https://peatix.com/event/example?utm_source=x");
    index.complete("https://peatix.com/event/example?utm_source=x", {
      payload: { document: "event" },
      finalUrl: "https://peatix.com/event/example",
    });
    assert.ok(index.reusable("https://peatix.com/event/example"));
    assert.equal(
      index.reusable("https://peatix.com/event/example", "parser-v1"),
      null,
    );
    const fixtureRef = index.parsed(
      "https://peatix.com/event/example",
      "parser-v1",
      { title: "Example" },
    );
    assert.equal(
      index.reusable("https://peatix.com/event/example", "parser-v1").parsed[
        "parser-v1"
      ],
      fixtureRef,
    );
  } finally {
    state.cleanup();
  }
});

test("four authoritative rendered adapters map source semantics into the universal fixture", () => {
  const sources = readPipelineConfig().sources.filter(
    ({ sourceRole, retrieval }) => sourceRole === "authoritative" && retrieval,
  );
  for (const source of sources) {
    const adapter = renderedAdapterFor(source.adapterId);
    const detailUrl =
      source.name === "Roots HAN"
        ? "https://www.roots.gov.sg/han/Neighborhoods/Punggol/HAN-Programme-Folder/example"
        : source.name === "Singapore Film Society"
          ? "https://events.singaporefilmsociety.com/events/example"
          : new URL(
              source.listing.detailPathPattern.includes("[0-9]")
                ? "/m/123"
                : "/whats-happening/example",
              source.listing.url,
            ).href;
    const fixture = adapter.detail(
      {
        url: detailUrl,
        document: {
          title: "Distinctive Event",
          fields: {
            Date: "2026-07-17",
            Time: "19:00",
            Venue: "National Gallery Singapore",
            Organizer: "Example Org",
          },
          links: [],
        },
      },
      source,
      detailUrl,
    );
    assert.equal(fixture.title, "Distinctive Event", source.name);
    assert.equal(fixture.mode, "physical", source.name);
    assert.equal(fixture.dateText, "2026-07-17", source.name);
    assert.ok(fixture.sourceId, source.name);
  }
});

test("rendered adapters parse TinyFish markdown fields and labelled links", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const result = {
    url: "https://feverup.com/m/123",
    title: "Night at the Gallery | Fever",
    text: "# Night at the Gallery\n\n📅 Date & Time: 18 Jul - 31 Aug\n📍 Location: National Gallery Singapore\n[Event website](https://example.org/night)",
    links: ["https://example.org/night"],
  };
  const fixture = adapter.detail(result, source, result.url);
  assert.equal(fixture.dateText, "18 Jul - 31 Aug");
  assert.equal(fixture.venue, "National Gallery Singapore");
  assert.equal(fixture.mode, "physical");
  assert.equal(fixture.reasonCode, null);
});

test("Fever parses selected plan cards and collapses repeated carousel appearances by plan identity", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const card = (href, venue = "Chamber, The Arts House") =>
    `<a href="${href}" data-plan-id="102768" data-plan-name="Candlelight: Vivaldi" data-plan-date="2026-08-02T11:00:00.000Z" data-plan-price="From S$42"><span class="venue">${venue}</span><h3>Candlelight: Vivaldi</h3><span>2 Aug - 28 Nov</span></a>`;
  const listing = adapter.listing(
    {
      url: source.listing.url,
      text: `${card("/m/102768?utm_source=hero")}${card("/m/102768?utm_source=popular")}`,
      links: [],
    },
    source,
    source.listing.url,
  );
  assert.equal(listing.detailUrls.length, 1);
  assert.equal(listing.detailItems.length, 1);
  assert.equal(listing.detailItems[0].url, "https://feverup.com/m/102768");
  assert.equal(listing.detailItems[0].record.sourceId, "102768");
  assert.equal(listing.detailItems[0].record.title, "Candlelight: Vivaldi");
  assert.equal(listing.detailItems[0].record.venue, "Chamber, The Arts House");
  assert.equal(listing.detailItems[0].record.dateText, "2 Aug - 28 Nov");
  assert.equal(listing.detailItems[0].record.price, "From S$42");
  assert.equal(listing.appearances, 2);
});

test("Fever detail parsing recognizes Date and time and uses listing evidence only for missing fields", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const url = "https://feverup.com/m/102768";
  const labelled = adapter.detail(
    {
      url,
      title: "Detail title",
      text: "Date and time: various dates at 7 p.m. and 9 p.m.\nVenue: Detail Hall",
      links: [],
    },
    source,
    url,
  );
  assert.equal(labelled.dateText, "various dates at 7 p.m. and 9 p.m.");
  const fallback = {
    sourceId: "102768",
    title: "Listing title",
    dateText: "2 Aug - 28 Nov",
    venue: "Listing Hall",
    price: "From S$42",
  };
  const merged = adapter.detail(
    { url, title: "Detail title", text: "Book this experience", links: [] },
    source,
    url,
    { listingRecord: fallback },
  );
  assert.equal(merged.title, "Detail title");
  assert.equal(merged.dateText, "2 Aug - 28 Nov");
  assert.equal(merged.venue, "Listing Hall");
  assert.equal(merged.price, "From S$42");
  assert.equal(merged.sourceId, "/m/102768");
  assert.deepEqual(merged.listingFallbackFields, [
    "dateText",
    "price",
    "venue",
  ]);
  const formattedLocation = adapter.detail(
    {
      url,
      title: "Immersive Rescue",
      text: "Date and time: select during purchase\n📍 **Location**: Green Canvas, Mandai Wildlife Reserve",
      links: [],
    },
    source,
    url,
  );
  assert.equal(
    formattedLocation.venue,
    "Green Canvas, Mandai Wildlife Reserve",
  );
  const multiple = adapter.detail(
    {
      url,
      title: "Disappearing Trades",
      text: "Date and time: select during purchase\nLocations\n* Chinatown\n* National Gallery Singapore",
      links: [],
    },
    source,
    url,
  );
  assert.equal(multiple.venue, "Multiple locations");
});

test("rendered Fever collection carries card evidence into detail parsing and logs fallback accounting", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
    );
    const logs = [];
    const renderedClient = {
      fetchBatch: async ([url]) => {
        const result =
          url === source.listing.url
            ? {
                url,
                text: '<a href="/m/102768" data-plan-id="102768" data-plan-name="Candlelight: Vivaldi" data-plan-date="2026-08-02T11:00:00.000Z" data-plan-price="From S$42"><span class="venue">Chamber, The Arts House</span><h3>Candlelight: Vivaldi</h3><span>2 Aug - 28 Nov</span></a>',
                links: [],
              }
            : {
                url,
                title: "Candlelight: Vivaldi",
                text: "Book this experience",
                links: [],
              };
        return {
          results: [result],
          errors: [],
          payloadHash: "fever-hash",
          payload: { results: [result] },
        };
      },
    };
    const collected = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "fever-run", window: singaporeWindow("2026-07-20") },
      source,
      renderedClient,
      logger: (entry) => logs.push(entry),
      now: () => "2026-07-20T00:00:00.000Z",
    });
    assert.equal(collected.status, "success");
    assert.equal(collected.counts.sourceRecordsReceived, 1);
    const fixtureRef = collected.sourceRecordRefs[0].split("#")[0];
    const fixture = JSON.parse(
      fs.readFileSync(path.join(state.root, fixtureRef), "utf8"),
    ).records[0];
    assert.equal(fixture.venue, "Chamber, The Arts House");
    assert.equal(fixture.dateText, "2 Aug - 28 Nov");
    assert.ok(
      logs.some(
        ({ action, fields }) =>
          action === "detail_listing_fallback_applied" &&
          fields.includes("venue") &&
          fields.includes("dateText"),
      ),
    );
  } finally {
    state.cleanup();
  }
});

test("Fever uses detail evidence to retain selectable, anytime, and waitlist activities while excluding ordinary admission behaviorally", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const url = "https://feverup.com/m/123";
  const selectable = adapter.detail(
    {
      url,
      title: "Perfume Making Workshop",
      text: "Date: select your dates directly in the ticket selector\nLocation: Scent Studio",
      links: [],
    },
    source,
    url,
  );
  assert.equal(selectable.reasonCode, null);
  assert.equal(selectable.schedule.kind, "selectable");
  const anytime = adapter.detail(
    {
      url,
      title: "Kayak Fishing Experience",
      text: "Available by appointment\nLocation: Pasir Ris",
      links: [],
    },
    source,
    url,
  );
  assert.equal(anytime.reasonCode, null);
  assert.equal(anytime.schedule.kind, "anytime");
  const waitlist = adapter.detail(
    {
      url,
      title: "Candlelight Concert",
      text: "Join the waitlist\nDate: 20 September 2026\nLocation: CHIJMES",
      links: [],
    },
    source,
    url,
  );
  assert.equal(waitlist.reasonCode, null);
  assert.equal(waitlist.availability, "waitlist");
  const ordinary = adapter.detail(
    {
      url,
      title: "Observation Deck Admission",
      text: "Standard general admission. Open daily during normal opening hours. Permanent attraction. Location: Marina Bay",
      links: [],
    },
    source,
    url,
  );
  assert.equal(ordinary.reasonCode, "ordinary_attraction_admission");
  const special = adapter.detail(
    {
      url,
      title: "Observation Deck Lunar Eclipse Programme",
      text: "Special limited-run guided programme. Select a date. Location: Marina Bay",
      links: [],
    },
    source,
    url,
  );
  assert.equal(special.reasonCode, null);
});

test("ordinary attraction admission is a behavioral rule and never a hardcoded attraction-title list", () => {
  const direct = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(direct.adapterId);
  const fixture = (title, text) =>
    adapter.detail(
      {
        url: "https://feverup.com/m/999",
        title,
        text: `${text}\nLocation: Singapore`,
        links: [],
      },
      direct,
      "https://feverup.com/m/999",
    );
  assert.equal(
    fixture(
      "Completely Invented Wonder Dome",
      "Standard general admission to a permanent fixed attraction. Open daily during normal operations",
    ).reasonCode,
    "ordinary_attraction_admission",
  );
  assert.equal(
    fixture(
      "Bird Paradise Photography Walk",
      "Special facilitated photography workshop available on selected dates",
    ).reasonCode,
    null,
  );
  assert.equal(
    fixture(
      "Universal Studios Seasonal Night",
      "Named seasonal programme with live performances",
    ).reasonCode,
    null,
  );
  assert.equal(
    fixture(
      "Universal Studios Singapore Admission",
      "Standard admission ticket to the theme park. Choose your date; open Monday to Sunday.",
    ).reasonCode,
    "ordinary_attraction_admission",
  );
  assert.equal(
    fixture(
      "Bird Paradise Admission",
      "General admission to the bird park. Various dates are available during regular opening hours.",
    ).reasonCode,
    "ordinary_attraction_admission",
  );
});

test("unreliable schedule phrases stay held instead of becoming exact dates", () => {
  const direct = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
  );
  const editorial = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "honeycombers-discovery-v1",
  );
  for (const phrase of ["TBA", "To be confirmed", "Coming soon"]) {
    const directRecord = renderedAdapterFor(direct.adapterId).detail(
      {
        url: "https://feverup.com/m/998",
        title: "Future Programme",
        text: `Date: ${phrase}\nLocation: The Arts House`,
        links: [],
      },
      direct,
      "https://feverup.com/m/998",
    );
    assert.equal(directRecord.schedule.kind, "unverified", phrase);
    const editorialRecord = renderedAdapterFor(editorial.adapterId).detail(
      {
        url: "https://thehoneycombers.com/singapore/event/future",
        title: "Future Programme",
        text: `Date: ${phrase}\nVenue: The Arts House`,
        links: [],
      },
      editorial,
      "https://thehoneycombers.com/singapore/event/future",
    );
    assert.equal(editorialRecord.claims.dateText, phrase);
  }
});

test("ordinary fixed-attraction tickets are excluded under real provider wording without requiring synthetic policy phrases", () => {
  const direct = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(direct.adapterId);
  const fixture = (title, text) =>
    adapter.detail(
      {
        url: "https://feverup.com/m/standard",
        title,
        text: `${text}\nLocation: Singapore`,
        links: [],
      },
      direct,
      "https://feverup.com/m/standard",
    );

  assert.equal(
    fixture(
      "Invented Discovery Studio",
      "Tickets include admission to the interactive experience studio. Opening hours: Monday to Sunday, 11 a.m. to 8 p.m.",
    ).reasonCode,
    "ordinary_attraction_admission",
  );
  assert.equal(
    fixture(
      "Children's Science Centre",
      "Standard Admission for one child. Various dates at 10 a.m. or 2 p.m. Explore the permanent science centre exhibits.",
    ).reasonCode,
    "ordinary_attraction_admission",
  );
  assert.equal(
    fixture(
      "Digital Dome Theatre",
      "Various dates and time slots are available. The planetarium theatre offers a regular range of digital movies and live shows.",
    ).reasonCode,
    "ordinary_attraction_admission",
  );
  assert.equal(
    fixture(
      "Heritage Centre Admission",
      "Admission for one adult. Opening hours: Monday to Sunday. Explore the permanent gallery and collection.",
    ).reasonCode,
    "ordinary_attraction_admission",
  );

  assert.equal(
    fixture(
      "Heritage Centre Seasonal Night",
      "Limited-run seasonal programme with a live commissioned performance at the heritage centre.",
    ).reasonCode,
    null,
  );
  assert.equal(
    fixture(
      "Digital Dome Astronomy Masterclass",
      "Facilitated masterclass on one selected evening at the planetarium theatre.",
    ).reasonCode,
    null,
  );
});

test("Visit Singapore guide entries and SFS restricted screenings retain future schedules and access metadata", () => {
  const visitSource = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "visit-singapore-rendered-v1",
  );
  const visit = renderedAdapterFor(visitSource.adapterId).detail(
    {
      url: "https://www.visitsingapore.com/whats-happening/guide",
      title: "Guide: Future Art Trail",
      text: "Festival guide\nDate: 20 December 2027\nLocation: Civic District",
      links: [],
    },
    visitSource,
    "https://www.visitsingapore.com/whats-happening/guide",
  );
  assert.equal(visit.reasonCode, null);
  assert.equal(visit.schedule.kind, "exact");
  const sfsSource = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "singapore-film-society-rendered-v1",
  );
  const sfs = renderedAdapterFor(sfsSource.adapterId).detail(
    {
      url: "https://events.singaporefilmsociety.com/schedule/future",
      title: "Members Preview",
      text: "Members only\nDate: 2 January 2027\nLocation: GV Cineleisure",
      links: [],
    },
    sfsSource,
    "https://events.singaporefilmsociety.com/schedule/future",
  );
  assert.equal(sfs.reasonCode, null);
  assert.equal(sfs.accessRestriction, "members_only");
});

test("Visit Singapore reliably bounded guide entries become distinct source records", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "visit-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const url =
    "https://www.visitsingapore.com/whats-happening/all-happenings/weekend-guide";
  const records = adapter.details(
    {
      url,
      title: "Weekend Guide",
      text: "## Light Trail\nDate: 20 December 2027\nLocation: Civic District\n\n## Clay Lab\nDate: 21 December 2027\nLocation: Bras Basah",
      links: [],
    },
    source,
    url,
  );
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map(({ title }) => title),
    ["Light Trail", "Clay Lab"],
  );
  assert.equal(new Set(records.map(({ sourceId }) => sourceId)).size, 2);
});

test("Visit Singapore does not turn generic guide headings into events without schedule and venue evidence", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "visit-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const url =
    "https://www.visitsingapore.com/whats-happening/all-happenings/national-day";
  const records = adapter.details(
    {
      url,
      title: "National Day Guide",
      text: "## How We Celebrate\nFlags and fireworks.\n\n## Symbols of Singapore\nThe Merlion and orchid.",
      links: [],
    },
    source,
    url,
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "National Day Guide");
  assert.equal(records[0].dateText, null);
  assert.equal(records[0].venue, null);
});

test("Visit Singapore turns safe embedded event CTAs into detail work and retains unsafe cards inline", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "visit-singapore-rendered-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const cards = [
    {
      cardTitle_t: "Night Garden at Gardens by the Bay",
      cardDescription_t: "<p>A limited-run light trail.</p>",
      cardPillCategory: ["Arts", "Festivals"],
      ctaUrl: "https://www.gardensbythebay.com.sg/night-garden",
      eventFormattedDate: "20 JUL ’26 - 31 JUL ’26",
      eventStartDate: "07-20-2026",
      eventEndDate: "07-31-2026",
    },
    {
      cardTitle_t: "Secret Cinema",
      cardDescription_t: "<p>Venue to be announced.</p>",
      cardPillCategory: ["Entertainment"],
      ctaUrl: "http://example.test/secret",
      eventFormattedDate: "01 AUG ’26",
      eventStartDate: "08-01-2026",
      eventEndDate: "08-01-2026",
    },
  ];
  const result = {
    url: source.listing.url,
    text: `<stb-event-and-festivals aem-data='${JSON.stringify({ cardmultifield: cards }).replaceAll("'", "&#39;")}'></stb-event-and-festivals>`,
    links: [],
  };
  const listing = adapter.listing(result, source, source.listing.url);
  assert.equal(listing.complete, true);
  assert.equal(listing.evidence, "embedded_event_cards");
  assert.equal(listing.detailItems.length, 1);
  assert.equal(
    listing.detailItems[0].url,
    "https://www.gardensbythebay.com.sg/night-garden",
  );
  assert.equal(
    listing.detailItems[0].referenceKind,
    "authoritative_listing_outbound",
  );
  assert.equal(listing.detailItems[0].record.venue, "Gardens by the Bay");
  assert.equal(listing.detailItems[0].record.schedule.kind, "range");
  assert.equal(listing.records.length, 1);
  assert.equal(listing.records[0].title, "Secret Cinema");
  assert.equal(listing.records[0].venue, "Venue to be announced");
  assert.equal(listing.detailUrls.length, 0);
});

test("Visit Singapore scopes its component selector to listing retrieval and leaves organizer details unrestricted", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "visit-singapore-rendered-v1",
  );
  assert.deepEqual(source.listing.retrieval.includeSelectors, [
    "stb-event-and-festivals",
  ]);
  assert.equal(source.listing.retrieval.format, "html");
  assert.equal(source.retrieval.includeSelectors, undefined);
  assert.equal(source.retrieval.format, "markdown");
});

test("Visit Singapore collects authoritative card CTAs and preserves listing evidence behind detail evidence", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "visit-singapore-rendered-v1",
    );
    const card = {
      cardTitle_t: "Night Garden at Gardens by the Bay",
      cardDescription_t: "<p>A limited-run light trail.</p>",
      cardPillCategory: ["Arts"],
      ctaUrl: "https://www.gardensbythebay.com.sg/night-garden",
      eventFormattedDate: "20 JUL ’26",
      eventStartDate: "07-20-2026",
      eventEndDate: "07-20-2026",
    };
    const calls = [];
    const listingResult = {
      url: source.listing.url,
      final_url: source.listing.url,
      text: `<stb-event-and-festivals aem-data='${JSON.stringify({ cardmultifield: [card] })}'></stb-event-and-festivals>`,
      links: [],
    };
    const detailUrl = "https://www.gardensbythebay.com.sg/night-garden";
    const detailResult = {
      url: detailUrl,
      final_url: detailUrl,
      title: "Night Garden",
      text: "A special evening programme.",
      links: [],
    };
    const renderedClient = {
      fetchBatch: async ([url]) => {
        calls.push(url);
        throw new Error(`Unexpected retrieval for ${url}`);
      },
    };
    const logs = [];
    const collected = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "visit-run", window: singaporeWindow("2026-07-19") },
      source,
      renderedClient,
      listingCapture: {
        payloadHash: "saved-listing-hash",
        result: listingResult,
      },
      detailCaptures: new Map([
        [detailUrl, { payloadHash: "saved-detail-hash", result: detailResult }],
      ]),
      logger: (entry) => logs.push(entry),
      now: () => "2026-07-19T00:00:00.000Z",
    });
    assert.equal(collected.status, "success");
    assert.equal(collected.counts.sourceRecordsReceived, 1);
    assert.equal(collected.counts.processedSourceRecords, 1);
    assert.equal(collected.counts.occurrencesEmitted, 1);
    assert.equal(collected.completion.detailUrlsDiscovered, 1);
    assert.equal(collected.completion.detailPagesCaptured, 1);
    assert.match(
      collected.sourceRecordRefs[0],
      /^raw\/visit-singapore-rendered\/details\/.+\.json#\/records\/0$/,
    );
    assert.deepEqual(calls, []);
    assert.ok(logs.some(({ action }) => action === "listing_capture_reused"));
    assert.ok(logs.some(({ action }) => action === "detail_capture_reused"));
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(state.root, collected.sourceRecordRefs[0].split("#")[0]),
        "utf8",
      ),
    ).records[0];
    assert.equal(
      fixture.detailUrl,
      "https://www.gardensbythebay.com.sg/night-garden",
    );
    assert.match(fixture.sourceId, /^visit-singapore-card:/);
    assert.equal(fixture.venue, "Gardens by the Bay");
    assert.ok(fixture.listingFallbackFields.includes("venue"));
  } finally {
    state.cleanup();
  }
});

test("authoritative listing outbound redirects stay within the listed organizer domain family and unsafe redirects fall back to listing evidence", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "visit-singapore-rendered-v1",
    );
    const card = {
      cardTitle_t: "Night Garden",
      cardDescription_t: "Special programme",
      ctaUrl: "https://organizer.example/night",
      eventFormattedDate: "20 JUL ’26",
      eventStartDate: "07-20-2026",
      eventEndDate: "07-20-2026",
    };
    const renderedClient = {
      fetchBatch: async ([url]) => {
        const result =
          url === source.listing.url
            ? {
                url,
                final_url: url,
                text: `<stb-event-and-festivals aem-data='${JSON.stringify({ cardmultifield: [card] })}'></stb-event-and-festivals>`,
                links: [],
              }
            : {
                url,
                final_url: "https://attacker.example/night",
                title: "Night Garden",
                text: "Date: 20 July 2026",
                links: [],
              };
        return { results: [result], errors: [], payloadHash: "visit-hash" };
      },
    };
    const logs = [];
    const collected = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "visit-run", window: singaporeWindow("2026-07-19") },
      source,
      renderedClient,
      logger: (entry) => logs.push(entry),
    });
    assert.equal(collected.status, "success");
    assert.equal(collected.counts.processedSourceRecords, 1);
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(state.root, collected.sourceRecordRefs[0].split("#")[0]),
        "utf8",
      ),
    ).records[0];
    assert.equal(fixture.detailUrl, "https://organizer.example/night");
    assert.equal(
      fixture.provenance.officialReference.finalUrl,
      source.listing.url.replace(/\/$/, ""),
    );
    assert.ok(
      logs.some(
        ({ action, reasonCode }) =>
          action === "detail_outbound_fallback_applied" &&
          reasonCode === "official_reference_invalid",
      ),
    );
  } finally {
    state.cleanup();
  }
});

test("Catch.sg and SISTIC mappers retain future-horizon records outside the minimum weekly window", () => {
  const catchEvent = mapCatchDetail(
    {
      DisplayEventTitle: "Future Catch Programme",
      Location: "Esplanade",
      EventStartDate: "2027-02-01",
      EventEndDate: "2027-02-02",
    },
    {},
    "https://www.catch.sg/event/future",
    1,
  );
  const sisticEvent = mapSisticDetail(
    {
      alias: "future",
      title: "Future SISTIC Programme",
      start_date: "2027-03-01T20:00:00+08:00",
      end_date: "2027-03-01T22:00:00+08:00",
      venue_name: { name: "Theatre" },
    },
    {},
    "https://www.sistic.com.sg/event-details/future",
    1,
  );
  assert.equal(
    catchEvent.performances[0].startDateTime,
    "2027-02-01T00:00:00+08:00",
  );
  assert.equal(
    sisticEvent.performances[0].startDateTime,
    "2027-03-01T20:00:00+08:00",
  );
});

test("rendered collection proves terminal listing completion and captures each canonical detail once", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
    );
    const calls = [];
    const renderedClient = {
      fetchBatch: async ([url]) => {
        calls.push(url);
        const result =
          url === source.listing.url
            ? {
                url,
                document: {
                  links: [
                    { url: "/m/123?utm_source=one", text: "Event" },
                    { url: "/m/123?utm_source=two", text: "Duplicate" },
                  ],
                },
              }
            : {
                url,
                document: {
                  title: "Fever Show",
                  fields: {
                    Date: "2026-07-17",
                    Time: "19:00",
                    Venue: "The Arts House",
                  },
                  links: [],
                },
              };
        return {
          results: [result],
          errors: [],
          payloadHash: "hash",
          payload: { results: [result] },
        };
      },
    };
    const result = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "run-a", window: singaporeWindow("2026-07-14") },
      source,
      renderedClient,
      now: () => "2026-07-14T00:00:00.000Z",
    });
    assert.equal(result.status, "success");
    assert.equal(result.completion.providerReportedTotal, null);
    assert.equal(result.completion.derivedTotal, 1);
    assert.equal(result.counts.processedSourceRecords, 1);
    assert.equal(calls.length, 2);
  } finally {
    state.cleanup();
  }
});

test("rendered collection rejects off-domain pagination and rendered redirects", async () => {
  for (const mode of ["pagination", "redirect"]) {
    const state = temporaryState();
    try {
      const source = readPipelineConfig().sources.find(
        ({ adapterId }) => adapterId === "fever-singapore-rendered-v1",
      );
      const renderedClient = {
        fetchBatch: async ([url]) => ({
          results: [
            mode === "redirect"
              ? {
                  url,
                  final_url: "https://attacker.example/list",
                  document: { links: [] },
                }
              : {
                  url,
                  document: {
                    links: [
                      { url: "https://attacker.example/page/2", text: "Next" },
                    ],
                  },
                },
          ],
          errors: [],
          payloadHash: "hash",
        }),
      };
      const result = await collectRenderedSource({
        runDir: state.root,
        run: { runId: `run-${mode}`, window: singaporeWindow("2026-07-14") },
        source,
        renderedClient,
      });
      assert.equal(result.status, "blocked");
      assert.equal(result.blockerReasonCode, "official_reference_invalid");
    } finally {
      state.cleanup();
    }
  }
});

test("editorial collection reuses compatible records already collected in the run", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "honeycombers-discovery-v1",
    );
    const detailUrl =
      "https://thehoneycombers.com/singapore/event/night-museum";
    const calls = [];
    const renderedClient = {
      fetchBatch: async ([url]) => {
        calls.push(url);
        const result =
          url === source.listing.url
            ? {
                url,
                document: {
                  links: [{ url: detailUrl, text: "Night at the Museum" }],
                },
              }
            : {
                url,
                document: {
                  title: "Night at the Museum",
                  fields: {
                    Date: "17 July 2026",
                    Venue: "National Gallery Singapore",
                  },
                  links: [
                    {
                      url: "https://peatix.com/event/night-museum",
                      text: "Visit website",
                    },
                  ],
                },
              };
        return { results: [result], errors: [], payloadHash: "hash" };
      },
    };
    const result = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "run-reuse", window: singaporeWindow("2026-07-14") },
      source,
      renderedClient,
      corroborationRecords: [
        {
          sourceRecordId: "catch:night-museum",
          sourceRole: "authoritative",
          title: "Night at the Museum",
          dateText: "17 July 2026",
          venue: "National Gallery Singapore",
        },
      ],
    });
    assert.equal(result.counts.confirmationOutcomeCounts.direct_reused, 1);
    assert.deepEqual(calls, [source.listing.url, detailUrl]);
  } finally {
    state.cleanup();
  }
});

test("Singapore Film Society expands film seeds into screening occurrences and audits stale siblings", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "singapore-film-society-rendered-v1",
    );
    const listing = source.listing.url;
    const goodFilm = "https://events.singaporefilmsociety.com/films/good";
    const staleFilm = "https://events.singaporefilmsociety.com/films/stale";
    const screening =
      "https://events.singaporefilmsociety.com/schedule/showing";
    const renderedClient = {
      fetchBatch: async ([url]) => {
        if (url === listing)
          return {
            results: [{ url, text: "Films", links: [goodFilm, staleFilm] }],
            errors: [],
            payloadHash: "listing",
          };
        if (url === staleFilm)
          return {
            results: [],
            errors: [{ url, code: "page_not_found" }],
            payloadHash: "stale",
          };
        if (url === goodFilm)
          return {
            results: [
              { url, title: "Film", text: "Showings", links: [screening] },
            ],
            errors: [],
            payloadHash: "film",
          };
        return {
          results: [
            {
              url,
              title: "SFS Somerset: Film",
              text: "Wednesday, July 22, 2026 7:30 PM +08\nGV Cineleisure Hall 6 (SFS Somerset)",
              links: [],
            },
          ],
          errors: [],
          payloadHash: "screening",
        };
      },
    };
    const result = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "run-a", window: singaporeWindow("2026-07-17") },
      source,
      renderedClient,
      now: () => "2026-07-17T00:00:00.000Z",
    });
    assert.equal(result.status, "success");
    assert.equal(result.counts.sourceRecordsReceived, 2);
    assert.equal(result.counts.invalidSourceRecords, 1);
    assert.equal(result.counts.processedSourceRecords, 1);
    assert.equal(result.counts.eligiblePreDedup, 1);
    assert.deepEqual(Object.values(result.invalidReasonCodes), [
      "detail_index_unavailable",
    ]);
  } finally {
    state.cleanup();
  }
});

test("three editorial adapters produce accounted discovery records under the enabled source contract", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "honeycombers-discovery-v1",
    );
    const renderedClient = {
      fetchBatch: async ([url]) => {
        let result;
        if (url === source.listing.url)
          result = {
            url,
            document: {
              links: [
                {
                  url: "/singapore/event/night-museum",
                  text: "Night at the Museum",
                },
              ],
            },
          };
        else if (url.includes("night-museum"))
          result = {
            url,
            document: {
              title: "Night at the Museum",
              fields: {
                Date: "17 July 2026",
                Time: "19:00",
                Venue: "National Gallery Singapore",
              },
              links: [
                {
                  url: "https://peatix.com/event/night-museum",
                  text: "Visit Website",
                },
              ],
            },
          };
        else
          result = {
            url,
            document: {
              title: "Night at the Museum",
              fields: {
                Date: "17 July 2026",
                Time: "19:00",
                Venue: "National Gallery Singapore",
              },
              links: [],
            },
          };
        return {
          results: [result],
          errors: [],
          payloadHash: `hash-${url}`,
          payload: { results: [result] },
        };
      },
    };
    const result = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "run-a", window: singaporeWindow("2026-07-14") },
      source,
      renderedClient,
      now: () => "2026-07-14T00:00:00.000Z",
    });
    assert.equal(result.status, "success");
    assert.equal(result.operatingMode, "required");
    assert.equal(result.sourceRole, "discovery");
    assert.equal(
      result.counts.confirmationOutcomeCounts.authority_confirmed,
      1,
    );
    assert.equal(result.counts.occurrencesEmitted, 1);
    assert.equal(result.counts.eligiblePreDedup, 1);
    assert.equal(result.processedSourceRecordRefs.length, 1);
    assert.doesNotThrow(() => validateSourceSemantics(state.root, {}, result));
  } finally {
    state.cleanup();
  }
});

test("editorial detail and roundup containers retain attendable activities while rejecting pure promotions", () => {
  const sources = readPipelineConfig().sources.filter(
    ({ evidenceRole }) => evidenceRole === "editorial",
  );
  for (const source of sources) {
    const adapter = renderedAdapterFor(source.adapterId);
    const detailUrl = new URL(
      source.name === "ArtsEquator"
        ? "/event/art-night"
        : "/singapore/things-to-do/art-night",
      source.listing.url,
    ).href;
    const retained = adapter.detail(
      {
        url: detailUrl,
        document: {
          title: "Future Art Night",
          text: "Best things to do roundup with performances and exhibitions across multiple venues",
          fields: {
            Date: "20 December 2027",
            Venue: "Various venues",
            City: "Singapore",
          },
          links: [],
        },
      },
      source,
      detailUrl,
    );
    assert.equal(retained.reasonCode, null, source.name);
    const promotional = adapter.detail(
      {
        url: `${detailUrl}?promo=1`,
        document: {
          title: "Win tickets",
          text: "Giveaway promo code",
          fields: { Date: "20 December 2027", Venue: "Gallery" },
          links: [],
        },
      },
      source,
      `${detailUrl}?promo=1`,
    );
    assert.ok(
      ["pure_promotion", "non_attendable_opportunity"].includes(
        promotional.reasonCode,
      ),
      source.name,
    );
  }
});

test("Time Out ignores empty markdown address fields and derives conservative venue clues", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "time-out-singapore-discovery-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const cases = [
    [
      "i-light",
      "The festival transforms Marina Bay and Raffles Place Park.\n### Details\n**Address** **Price:** Free",
      "Multiple locations",
    ],
    [
      "pink-dot",
      "The gathering takes place at Hong Lim Park each year.\n### Details\n**Address** **Opening hours:** 4pm",
      "Hong Lim Park",
    ],
    [
      "portals",
      "The experience is at Fever Exhibition Hall.\n### Details\n**Address** **Price:** From $17",
      "Fever Exhibition Hall",
    ],
  ];
  for (const [slug, text, expectedVenue] of cases) {
    const detailUrl = `https://www.timeout.com/singapore/things-to-do/${slug}`;
    const parsed = adapter.detail(
      { url: detailUrl, document: { title: slug, markdown: text, links: [] } },
      source,
      detailUrl,
    );
    assert.equal(parsed.claims.venue, expectedVenue);
  }
});

test("Time Out extracts only a complete numbered hotlist HTML zone and excludes recommendation cards", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "time-out-singapore-discovery-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const card = (ordinal, href, title, tags = "") =>
    `<article data-testid="tile-zone-large-list_testID"><div><a href="${href}" data-testid="tile-link_testID"><h3 data-testid="tile-title_testID"><span>${ordinal}.</span>&nbsp;${title}</h3></a><ul>${tags}</ul></div></article>`;
  const result = {
    url: source.listing.url,
    text: `<h2 data-testid="zone-title_testID"><span>Best events in Singapore this week</span></h2>${card(1, "/singapore/news/event-one", "Event One")}${card(2, "/singapore/things-to-do/event-two", "Event Two", "<li><span>Until 26 Jul 2026</span></li>")}<h2 data-testid="zone-title_testID"><span>Explore Singapore</span></h2>${card(1, "/singapore/things-to-do/evergreen", "Evergreen guide")}`,
  };
  const parsed = adapter.listing(result, source);
  assert.equal(parsed.evidence, "bounded_numbered_hotlist_cards");
  assert.deepEqual(
    parsed.detailItems.map(({ url, record }) => [
      url,
      record.title,
      record.dateText,
    ]),
    [
      ["https://www.timeout.com/singapore/news/event-one", "Event One", null],
      [
        "https://www.timeout.com/singapore/things-to-do/event-two",
        "Event Two",
        "Until 26 Jul 2026",
      ],
    ],
  );
  const gap = adapter.listing(
    {
      ...result,
      text: result.text.replace("<span>2.</span>", "<span>3.</span>"),
    },
    source,
  );
  assert.equal(gap.evidence, "numbered_hotlist_gap");
  assert.equal(gap.detailItems.length, 0);
  const semantic = adapter.listing(
    {
      url: source.listing.url,
      text: "<main><h2>Best events in Singapore this week</h2><article><ul><li>Until 26 Jul 2026</li></ul><p>First summary</p></article><article><p>Second summary</p></article><h2>Explore Singapore</h2><article>Evergreen</article></main>",
      links: [
        "https://www.timeout.com/singapore/things-to-do/recommended-once",
        "https://www.timeout.com/singapore/news/event-one",
        "https://www.timeout.com/singapore/news/event-one",
        "https://www.timeout.com/singapore/news/inline-related",
        "https://www.timeout.com/singapore/news/event-one",
        "https://www.timeout.com/singapore/things-to-do/event-two",
        "https://www.timeout.com/singapore/things-to-do/event-two",
        "https://www.timeout.com/singapore/things-to-do/event-two",
        "https://www.timeout.com/singapore/things-to-do/evergreen",
        "https://www.timeout.com/singapore/things-to-do/evergreen",
      ],
    },
    source,
  );
  assert.equal(semantic.evidence, "bounded_numbered_hotlist_cards");
  assert.deepEqual(
    semantic.detailItems.map(({ url, record }) => [
      url,
      record.hotlistOrdinal,
      record.dateText,
    ]),
    [
      [
        "https://www.timeout.com/singapore/news/event-one",
        1,
        "Until 26 Jul 2026",
      ],
      ["https://www.timeout.com/singapore/things-to-do/event-two", 2, null],
    ],
  );
  assert.deepEqual(source.listing.retrieval, { format: "html", ttl: 0 });
});

test("Time Out parses real schedules and venues without confusing publication dates or headings for dates", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "time-out-singapore-discovery-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const scheduled = adapter.detail(
    {
      url: "https://www.timeout.com/singapore/things-to-do/show",
      title: "Gallery Show",
      text: "* Until 30 Aug 2026\n\nMonday 5 January 2026\n\n### Details\n\n**Address**: National Gallery Singapore\n: 1 St Andrew’s Rd\n: Singapore\n: 178957\n\n### Dates and times\n\nFri, 17 Jul 2026\n\nGallery Show 10:00\n\nSat, 18 Jul 2026\n\nGallery Show 10:00",
    },
    source,
    "https://www.timeout.com/singapore/things-to-do/show",
  );
  assert.equal(scheduled.claims.dateText, "17 Jul 2026 to 18 Jul 2026");
  assert.notEqual(scheduled.claims.dateText, "and times");
  assert.equal(
    scheduled.claims.venue,
    "National Gallery Singapore, 1 St Andrew’s Rd, Singapore, 178957",
  );
  const titleDated = adapter.detail(
    {
      url: "https://www.timeout.com/singapore/things-to-do/cat-expo",
      title: "Asia Cat Expo returns on 27 & 28 June, 2026",
      text: "Monday 22 June 2026\n\nAsia Cat Expo returns to the Suntec Convention Centre for a weekend.\n\n### Details\n\n**Address**\n\n**Opening hours:** 10am-8pm",
    },
    source,
    "https://www.timeout.com/singapore/things-to-do/cat-expo",
  );
  assert.equal(titleDated.claims.dateText, "27 June 2026 to 28 June 2026");
  assert.equal(titleDated.claims.venue, "the Suntec Convention Centre");
  const emptyAddress = adapter.detail(
    {
      url: "https://www.timeout.com/singapore/things-to-do/unknown",
      title: "Undated event",
      text: "Monday 22 June 2026\n\n### Details\n\n**Address**\n\n**Opening hours:** 4pm to 7pm\n\nAdvertising\n\nLatest news",
    },
    source,
    "https://www.timeout.com/singapore/things-to-do/unknown",
  );
  assert.equal(emptyAddress.claims.dateText, null);
  assert.equal(emptyAddress.claims.venue, null);
});

test("Time Out carries bounded listing evidence into discovery confirmation", async () => {
  const state = temporaryState();
  try {
    const configured = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "time-out-singapore-discovery-v1",
    );
    const source = {
      ...configured,
      listing: { ...configured.listing, urls: [], paginationCeiling: 1 },
    };
    const detailUrl =
      "https://www.timeout.com/singapore/things-to-do/event-one";
    const contexts = [];
    const renderedClient = {
      fetchBatch: async ([url], context) => {
        contexts.push(context);
        const result =
          url === source.listing.url
            ? {
                url,
                text: "<main><h2>Best events in Singapore this week</h2><article><ul><li>Until 26 Jul 2026</li></ul><p>Event summary</p></article><h2>Explore Singapore</h2></main>",
                links: [detailUrl, detailUrl, detailUrl],
              }
            : {
                url,
                title: "Event One",
                text: "### Details\n\n**Address**: National Gallery Singapore\n: 1 St Andrew’s Rd\n: Singapore\n: 178957",
              };
        return { results: [result], errors: [], payloadHash: `hash-${url}` };
      },
    };
    const result = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "run-a", window: singaporeWindow("2026-07-20") },
      source,
      renderedClient,
      now: () => "2026-07-20T00:00:00.000Z",
    });
    assert.equal(result.status, "success");
    assert.equal(result.counts.eligiblePreDedup, 1);
    assert.equal(
      result.counts.confirmationOutcomeCounts.editorial_sufficient,
      1,
    );
    assert.deepEqual(contexts[0].requestOptions, { format: "html", ttl: 0 });
    const discovery = JSON.parse(
      fs.readFileSync(
        path.join(
          state.root,
          result.processedSourceRecordRefs[0].split("#")[0],
        ),
        "utf8",
      ),
    ).records[0];
    assert.equal(discovery.dateText, "Until 26 Jul 2026");
    assert.equal(
      discovery.venue,
      "National Gallery Singapore, 1 St Andrew’s Rd, Singapore, 178957",
    );
  } finally {
    state.cleanup();
  }
});

test("Time Out extracts each approved roundup surface only inside its bounded numbered section", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "time-out-singapore-discovery-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const card = (ordinal, href, title, date = null) =>
    `<article data-testid="tile-zone-large-list_testID"><a href="${href}" data-testid="tile-link_testID"><h3 data-testid="tile-title_testID">${ordinal}. ${title}</h3></a>${date ? `<span>${date}</span>` : ""}</article>`;
  const cases = [
    [
      source.listing.urls.find((url) => url.includes("this-weekend")),
      "What’s on in Singapore this weekend",
      "Explore Singapore",
      "/singapore/news/weekend-event",
      "weekend",
    ],
    [
      "https://www.timeout.com/singapore/things-to-do/the-best-things-to-do-in-singapore-in-july",
      "July's best activities",
      "More things to do",
      "/singapore/things-to-do/month-event",
      "month",
    ],
    [
      source.listing.urls.find((url) => url.includes("art-exhibitions")),
      "Best art exhibitions in Singapore",
      "More to explore",
      "/singapore/art/art-event",
      "art",
    ],
    [
      source.listing.urls.find((url) => url.includes("upcoming-concerts")),
      "What's in 2026",
      "More performances to catch on stage",
      "/singapore/music/concert-event",
      "concerts",
    ],
  ];
  for (const [url, heading, trailingHeading, href, surface] of cases) {
    const result = {
      url,
      text: `<h2 data-testid="zone-title_testID">${heading}</h2>${card(1, href, `${surface} event`, "Until 31 Jul 2026")}<h2 data-testid="zone-title_testID">${trailingHeading}</h2>${card(1, "/singapore/things-to-do/evergreen", "Evergreen guide")}`,
    };
    const parsed = adapter.listing(result, source, url);
    assert.equal(parsed.evidence, `bounded_numbered_${surface}_cards`);
    assert.deepEqual(
      parsed.detailItems.map(({ url: detailUrl, record }) => [
        detailUrl,
        record.surface,
        record.surfaceOrdinal,
        record.dateText,
      ]),
      [[new URL(href, url).href, surface, 1, "Until 31 Jul 2026"]],
    );
    assert.equal(parsed.listingUrls.length, 0);
  }
});

test("Time Out homepage discovers only the current approved monthly roundup route", () => {
  const source = readPipelineConfig().sources.find(
    ({ adapterId }) => adapterId === "time-out-singapore-discovery-v1",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const homepage = source.listing.urls.find(
    (url) => new URL(url).pathname === "/singapore",
  );
  const parsed = adapter.listing(
    {
      url: homepage,
      text: "## Things to do in Singapore",
      links: [
        {
          url: "/singapore/things-to-do/things-to-do-in-singapore-today",
          text: "TODAY",
        },
        {
          url: "/singapore/things-to-do/the-best-things-to-do-in-singapore-in-august",
          text: "THIS MONTH",
        },
        {
          url: "https://example.com/singapore/things-to-do/the-best-things-to-do-in-singapore-in-september",
          text: "THIS MONTH",
        },
        { url: "/singapore/restaurants/best-restaurants", text: "THIS MONTH" },
      ],
    },
    source,
    homepage,
  );
  assert.deepEqual(parsed.listingUrls, [
    "https://www.timeout.com/singapore/things-to-do/the-best-things-to-do-in-singapore-in-august",
  ]);
  assert.equal(parsed.evidence, "current_month_route_discovered");
  assert.equal(parsed.detailItems.length, 0);
});

test("rendered collection traverses bounded Time Out surfaces and fetches overlapping details once", async () => {
  const state = temporaryState();
  try {
    const configured = readPipelineConfig().sources.find(
      ({ adapterId }) => adapterId === "time-out-singapore-discovery-v1",
    );
    const homepage = configured.listing.urls.find(
      (url) => new URL(url).pathname === "/singapore",
    );
    const weekend = configured.listing.urls.find((url) =>
      url.includes("this-weekend"),
    );
    const month =
      "https://www.timeout.com/singapore/things-to-do/the-best-things-to-do-in-singapore-in-august";
    const source = {
      ...configured,
      listing: {
        ...configured.listing,
        urls: [homepage, weekend],
        paginationCeiling: 4,
      },
    };
    const shared = "https://www.timeout.com/singapore/news/shared-event";
    const monthly =
      "https://www.timeout.com/singapore/things-to-do/monthly-event";
    const card = (href, title) =>
      `<article data-testid="tile-zone-large-list_testID"><a href="${href}" data-testid="tile-link_testID"><h3 data-testid="tile-title_testID">1. ${title}</h3></a><span>Until 31 Aug 2026</span></article>`;
    const calls = [],
      logs = [];
    const renderedClient = {
      fetchBatch: async ([url]) => {
        calls.push(url);
        let result;
        if (url === source.listing.url)
          result = {
            url,
            text: `<h2>Best events in Singapore this week</h2>${card(shared, "Shared event")}<h2>Explore Singapore</h2>`,
          };
        else if (url === homepage)
          result = {
            url,
            text: "Things to do in Singapore",
            links: [{ url: month, text: "THIS MONTH" }],
          };
        else if (url === weekend)
          result = {
            url,
            text: `<h2>What’s on in Singapore this weekend</h2>${card(shared, "Shared event")}<h2>Explore Singapore</h2>`,
          };
        else if (url === month)
          result = {
            url,
            text: `<h2>August's best activities</h2>${card(monthly, "Monthly event")}<h2>More things to do</h2>`,
          };
        else
          result = {
            url,
            title: url === shared ? "Shared event" : "Monthly event",
            text: "Until 31 Aug 2026\n\n### Details\n\n**Address**: National Gallery Singapore\n: 1 St Andrew’s Rd\n: Singapore\n: 178957",
          };
        return { results: [result], errors: [], payloadHash: `hash-${url}` };
      },
    };
    const collected = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "timeout-surfaces", window: singaporeWindow("2026-07-20") },
      source,
      renderedClient,
      logger: (entry) => logs.push(entry),
      now: () => "2026-07-20T00:00:00.000Z",
    });
    assert.equal(collected.status, "success");
    assert.equal(collected.counts.pages, 4);
    assert.equal(collected.counts.discoveryRecordsReceived, 2);
    assert.equal(calls.filter((url) => url === shared).length, 1);
    assert.deepEqual(calls.slice(0, 4), [
      source.listing.url,
      homepage,
      weekend,
      month,
    ]);
    assert.equal(
      logs.filter(({ action }) => action === "listing_surface_started").length,
      4,
    );
    assert.ok(
      logs.some(
        ({ action, listingSurface }) =>
          action === "listing_surface_queued" && listingSurface === month,
      ),
    );
  } finally {
    state.cleanup();
  }
});

test("ArtsEquator retains attendable programmes mentioned beside opportunities", () => {
  const source = readPipelineConfig().sources.find(
    ({ name }) => name === "ArtsEquator",
  );
  const adapter = renderedAdapterFor(source.adapterId);
  const detailUrl = "https://artsequator.com/event/residency-showcase";
  const record = adapter.detail(
    {
      url: detailUrl,
      document: {
        title: "Residency Showcase",
        text: "Open call followed by a public performance and workshop",
        fields: {
          Date: "18 August 2026",
          Venue: "The Arts House",
          City: "Singapore",
        },
        links: [],
      },
    },
    source,
    detailUrl,
  );
  assert.equal(record.reasonCode, null);
});

test("ArtsEquator parses The Events Calendar headings and venue blocks as sufficient editorial evidence", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(
      ({ name }) => name === "ArtsEquator",
    );
    const detailUrl = "https://artsequator.com/event/benchmarks";
    const logs = [];
    const renderedClient = {
      fetchBatch: async ([url]) => ({
        results: [
          url === source.listing.url
            ? { url, text: "### Benchmarks", links: [detailUrl] }
            : {
                url,
                final_url: `${detailUrl}/`,
                title: "Benchmarks",
                text: "# Benchmarks\n\n## August 2, 2023 - July 31, 2026\n\nA public art trail.\n\nWebsite: https://artshouselimited.sg/civic-district\n\n## Details\n\n**Start:** : August 2, 2023\n **End:** : July 31\n\n## Venue\n\n: The Arts House\n: 1 Old Parliament Lane\nSingapore,\nSingapore\n+ Google Map",
                links: [],
              },
        ],
        errors: [],
        payloadHash: `hash-${url}`,
      }),
    };
    const result = await collectRenderedSource({
      runDir: state.root,
      run: { runId: "run-a", window: singaporeWindow("2026-07-20") },
      source,
      renderedClient,
      logger: (entry) => logs.push(entry),
      now: () => "2026-07-20T00:00:00.000Z",
    });
    assert.equal(result.status, "success");
    assert.equal(result.counts.eligiblePreDedup, 1);
    assert.equal(
      result.counts.confirmationOutcomeCounts.editorial_sufficient,
      1,
    );
    const discovery = JSON.parse(
      fs.readFileSync(
        path.join(
          state.root,
          result.processedSourceRecordRefs[0].split("#")[0],
        ),
        "utf8",
      ),
    ).records[0];
    assert.equal(discovery.dateText, "August 2, 2023 - July 31, 2026");
    assert.equal(
      discovery.venue,
      "The Arts House, 1 Old Parliament Lane, Singapore, Singapore",
    );
    assert.ok(
      discovery.outboundLinks.some(
        ({ url, text }) =>
          url === "https://artshouselimited.sg/civic-district" &&
          text === "Event Website",
      ),
    );
    assert.ok(
      logs.some(
        ({ action, hasSchedule, hasVenue }) =>
          action === "discovery_detail_parsed" && hasSchedule && hasVenue,
      ),
    );
    assert.ok(
      logs.some(
        ({ action, decision }) =>
          action === "discovery_confirmation_decided" &&
          decision === "editorial_sufficient",
      ),
    );
  } finally {
    state.cleanup();
  }
});
