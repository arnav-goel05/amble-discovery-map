import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectSource, requestWithRetry, sourceRecordProvenance, validateOfficialReference, validateSourcePolicy } from "../scripts/event-source-collector.mjs";
import { readPipelineConfig, singaporeWindow } from "../scripts/event-pipeline.mjs";
import { temporaryState } from "./helpers/baseline-fixtures.mjs";

test("the weekly source window contains the run date and seven following dates", () => {
  assert.deepEqual(singaporeWindow("2026-07-14"), {
    start: "2026-07-14T00:00:00+08:00", end: "2026-07-21T23:59:59+08:00", inclusive: true,
  });
  assert.equal(readPipelineConfig().windowDaysAfterStart, 7);
});

test("source record provenance repeats adapter, retrieval, window, and immutable pointers", () => {
  const source = readPipelineConfig().sources[0];
  const provenance = sourceRecordProvenance({
    run: { runId: "run-a", window: singaporeWindow("2026-07-14") }, source,
    retrievedAt: "2026-07-14T00:00:00.000Z", listingRef: "raw/catch/listings/page-0001.json#/data/Items/0",
    responseRef: "raw/catch/details/fixture.response.json", detailUrl: "https://www.catch.sg/Event/example",
  });
  assert.equal(provenance.adapterId, "catch-official-listing-v1");
  assert.equal(provenance.providerId, "catch-sg");
  assert.equal(provenance.providerCostClass, "free");
  assert.match(provenance.adapterDefinitionHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(provenance.requestedWindow, { ...singaporeWindow("2026-07-14"), timezone: "Asia/Singapore" });
  assert.equal(provenance.provenance.parentListingRef, "raw/catch/listings/page-0001.json#/data/Items/0");
  assert.equal(provenance.provenance.responseRef, "raw/catch/details/fixture.response.json");
});

test("event sources fail closed when their free/open policy no longer matches", () => {
  const source = readPipelineConfig().sources[0];
  assert.doesNotThrow(() => validateSourcePolicy(source));
  assert.throws(() => validateSourcePolicy({ ...source, costClass: "paid" }), /cost classification/i);
  assert.throws(() => validateSourcePolicy({ ...source, listing: { ...source.listing, url: "https://example.com/events" } }), /not approved/i);
});

test("requests retry transient failures with bounded exponential backoff", async () => {
  const statuses = [503, 429, 200];
  const delays = [];
  const result = await requestWithRetry(async () => {
    const status = statuses.shift();
    return { status, ok: status === 200, body: status === 200 ? { ok: true } : null, text: "" };
  }, { url: "https://example.test", method: "GET" }, {
    maxAttempts: 3, timeoutMs: 100, initialBackoffMs: 10, maximumBackoffMs: 20,
    sleep: async (delay) => { delays.push(delay); },
  });
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(result.response.status, 200);
});

test("requests time out and stop after the configured attempt bound", async () => {
  let calls = 0;
  await assert.rejects(requestWithRetry(async () => {
    calls += 1;
    return new Promise(() => {});
  }, { url: "https://example.test", method: "GET" }, {
    maxAttempts: 2, timeoutMs: 5, initialBackoffMs: 0, maximumBackoffMs: 0, sleep: async () => {},
  }), (error) => error.code === "request_timeout" && error.attempts === 2);
  assert.equal(calls, 2);
});

test("official event references require successful approved-domain destinations", () => {
  const source = readPipelineConfig().sources.find(({ providerId }) => providerId === "sistic");
  assert.doesNotThrow(() => validateOfficialReference(source, "https://www.sistic.com.sg/event-details/show", { ok: true, status: 200, url: "https://www.sistic.com.sg/event-details/show" }));
  assert.throws(() => validateOfficialReference(source, "https://www.sistic.com.sg/event-details/show", { ok: true, status: 200, url: "https://redirect.example/show" }), /redirect.*unapproved domain/i);
  assert.throws(() => validateOfficialReference(source, "https://www.sistic.com.sg/event-details/show", { ok: false, status: 404 }), /status 404/i);
});

test("duplicate captured detail URLs remain one immutable artifact", async () => {
  const state = temporaryState();
  try {
    const source = readPipelineConfig().sources.find(({ providerId }) => providerId === "catch-sg");
    const responses = [
      { status: 200, ok: true, body: { data: { Items: [{ Url: "/Event/one" }, { Url: "/Event/one#duplicate" }], ItemTotal: 2, PageTotal: 1 } }, text: "" },
      { status: 200, ok: true, url: "https://www.catch.sg/Event/one", body: null, text: '<div event-detail-page-id="42"></div>' },
      { status: 200, ok: true, body: { data: { DisplayEventTitle: "One", Location: "Hall", EventStartDate: "2026-07-16", EventEndDate: "2026-07-16" } }, text: "" },
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
    assert.deepEqual(Object.values(result.invalidReasonCodes), ["duplicate_detail_url"]);
    assert.equal(result.artifactRefs.filter((ref) => ref.endsWith(".official.json")).length, 1);
  } finally { state.cleanup(); }
});
