#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import { readPipelineConfig } from "./event-pipeline.mjs";
import { createDirectHtmlFetchClient } from "./lib/event-sources/direct-html-fetch.mjs";
import { createLayeredDetailFetchClient } from "./lib/event-sources/layered-detail-fetch.mjs";
import { createTinyfishFetchClient } from "./lib/event-sources/tinyfish-fetch.mjs";
import {
  applyEventFieldCompleteness,
  extractEventPageEvidence,
} from "./lib/event-sources/event-field-extraction.mjs";
import { renderedAdapterFor } from "./lib/event-sources/index.mjs";
import {
  renderedDocument,
  sha,
} from "./lib/event-sources/rendered-adapter-utils.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const pointer = JSON.parse(
  readFileSync(join(root, "data/approved-snapshot.json"), "utf8"),
);
const activeManifest = JSON.parse(
  readFileSync(
    join(root, "data/snapshots", pointer.snapshotId, "manifest.json"),
    "utf8",
  ),
);
const internalEventsRef =
  activeManifest.internalEventsRef ?? activeManifest.eventsRef;
const activeEvents = JSON.parse(
  readFileSync(
    join(root, "data/snapshots", pointer.snapshotId, internalEventsRef),
    "utf8",
  ),
);
const allEvents = [...activeEvents.mapped, ...activeEvents.offMap];
const overrides = {
  "Catch.sg": "https://www.catch.sg/Event/Chinatown-Art-Trail-20260626043212",
  "Visit Singapore All Happenings":
    "https://www.visitsingapore.com/whats-happening/all-happenings/",
};

function sampleUrl(source) {
  if (overrides[source.name]) return overrides[source.name];
  return (
    allEvents.find(
      ({ sourceName, officialUrl }) =>
        sourceName === source.name && officialUrl,
    )?.officialUrl ??
    source.listing?.url ??
    null
  );
}

function recordFromResult(source, url, result) {
  const adapter = renderedAdapterFor(source.adapterId);
  if (source.name === "Visit Singapore All Happenings" && adapter?.listing) {
    try {
      const listing = adapter.listing(result, source, url);
      const listingRecord =
        listing.records?.[0] ?? listing.detailItems?.[0]?.record;
      if (listingRecord)
        return applyEventFieldCompleteness(
          {
            ...listingRecord,
            detailUrl: listingRecord.outboundUrl ?? url,
            schedule: listingRecord.dateText
              ? { displayText: listingRecord.dateText }
              : null,
          },
          {
            evidenceHash:
              result.contentHash ?? sha(result.text ?? JSON.stringify(result)),
            evidenceRef: url,
          },
        );
    } catch {
      // Continue through the detail and generic structured contracts.
    }
  }
  if (adapter?.details) {
    try {
      const records = adapter.details(result, source, url, {});
      if (records.length) return records[0];
    } catch {
      // Continue through the single-record and generic structured contracts.
    }
  }
  if (adapter?.detail) {
    try {
      return adapter.detail(result, source, url, {});
    } catch {
      // The generic structured contract still reports evidence when a source adapter rejects layout.
    }
  }
  const document = renderedDocument(result);
  const evidence = extractEventPageEvidence({
    html: result.text ?? "",
    jsonLd: document.jsonLd,
    finalUrl: result.final_url ?? url,
  });
  const record = {
    title: evidence.fields.title ?? document.title,
    dateText: evidence.fields.schedule?.start ?? null,
    schedule: evidence.fields.schedule,
    venue: evidence.fields.venue,
    address: evidence.fields.address,
    description: evidence.fields.description,
    category: evidence.fields.category,
    price: evidence.fields.price,
    organizer: evidence.fields.organizer,
    availability: evidence.fields.availability ?? "unknown",
    detailUrl: evidence.fields.url ?? result.final_url ?? url,
  };
  return applyEventFieldCompleteness(record, {
    evidenceHash:
      result.contentHash ?? sha(result.text ?? JSON.stringify(result)),
    methods: evidence.methods,
  });
}

const config = readPipelineConfig();
const records = [];
for (const source of config.sources.filter(({ enabled }) => enabled)) {
  const url = sampleUrl(source);
  if (!url) {
    records.push({
      source: source.name,
      status: "blocked",
      reasonCode: "sample_url_unavailable",
    });
    continue;
  }
  try {
    const direct = createDirectHtmlFetchClient({
      ...(source.directHtml ?? {}),
      officialDomains: source.officialDomains,
      respectRobots: true,
    });
    let client = direct;
    if (process.env.TINYFISH_API_KEY) {
      const fallback = createTinyfishFetchClient({
        ...(source.retrieval ?? {}),
        format: "html",
        ttl: 0,
      });
      client = createLayeredDetailFetchClient({
        directClient: direct,
        fallbackClient: fallback,
      });
    }
    const batch = await client.fetchBatch([url], {
      sourceName: source.name,
      stage: "detail",
      entityId: `validation:${source.adapterId}`,
    });
    const result = batch.results[0];
    if (!result) {
      records.push({
        source: source.name,
        url,
        status: "blocked",
        reasonCode: batch.errors[0]?.code ?? "retrieval_failed",
        httpStatus: batch.errors[0]?.status ?? null,
      });
      continue;
    }
    const record = recordFromResult(source, result.final_url ?? url, result);
    records.push({
      source: source.name,
      url,
      finalUrl: result.final_url ?? url,
      status: "validated",
      retrievalMethod: result.retrievalMethod ?? "tinyfish_fetch",
      evidenceHash: result.contentHash ?? batch.payloadHash,
      fields: Object.fromEntries(
        Object.entries(record.fieldCompleteness ?? {}).map(([field, value]) => [
          field,
          value.status,
        ]),
      ),
    });
  } catch (error) {
    records.push({
      source: source.name,
      url,
      status: "blocked",
      reasonCode: error.code ?? "validation_failed",
      httpStatus: error.status ?? null,
    });
  }
}

const report = {
  schemaVersion: "1.0",
  extractionContractVersion: "1.0",
  createdAt: new Date().toISOString(),
  activeBaselineSnapshotId: pointer.snapshotId,
  counts: {
    sources: records.length,
    validated: records.filter(({ status }) => status === "validated").length,
    blocked: records.filter(({ status }) => status === "blocked").length,
  },
  records,
};
const outputFlag = process.argv.indexOf("--output");
if (outputFlag >= 0 && process.argv[outputFlag + 1]) {
  const output = resolve(process.argv[outputFlag + 1]);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
