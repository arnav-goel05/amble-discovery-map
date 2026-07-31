import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { normalizeRun } from "../scripts/event-normalizer.mjs";
import {
  recoverMissingEventVenues,
  recoverMissingVenueOccurrence,
  recoveryCacheExpiry,
} from "../scripts/lib/event-sources/tinyfish-venue-recovery.mjs";

const config = {
  enabled: true,
  maxCandidates: 3,
  search: {
    providerId: "tinyfish-search",
    endpoint: "https://api.search.tinyfish.ai",
    location: "SG",
    language: "en",
    timeoutMs: 20_000,
    maximumResponseBytes: 524_288,
  },
};

const record = {
  sourceId: "event-1",
  title: "Lanterns After Dark",
  organizer: "National Gallery Singapore",
  detailUrl: "https://editorial.example/events/lanterns-after-dark",
  mode: "physical",
  dateText: "27 Jul 2026",
  performances: [],
};

test("missing venue recovery searches once, fetches at most three candidates, and accepts one authoritative event page", async () => {
  let searches = 0;
  const fetched = [];
  const traces = [];
  const result = await recoverMissingVenueOccurrence({
    sourceName: "Visit Singapore All Happenings",
    recordRef: "raw/visit/details/event.json#/records/0",
    record,
    occurrence: record,
    occurrenceIndex: 0,
    config,
    searchClient: async ({ query, location, language }) => {
      searches += 1;
      assert.match(query, /Lanterns After Dark/);
      assert.equal(location, "SG");
      assert.equal(language, "en");
      return {
        results: [
          {
            url: "https://www.nationalgallery.sg/events/lanterns-after-dark",
            title: "Lanterns After Dark",
          },
          {
            url: "https://directory.example/lanterns",
            title: "Lanterns After Dark listings",
          },
          {
            url: "https://social.example/lanterns",
            title: "Lanterns After Dark",
          },
          {
            url: "https://ignored.example/fourth",
            title: "Lanterns After Dark",
          },
        ],
      };
    },
    renderedClient: {
      async fetchBatch(urls) {
        fetched.push(...urls);
        return {
          results: urls.map((url) => ({
            url,
            document: url.includes("nationalgallery")
              ? {
                  title: "Lanterns After Dark | National Gallery Singapore",
                  text: "Lanterns After Dark\nVenue: Supreme Court Terrace\nAddress: 1 St Andrew's Road, Singapore 178957",
                  fields: {
                    Venue: "Supreme Court Terrace",
                    Address: "1 St Andrew's Road, Singapore 178957",
                  },
                }
              : { title: "Directory", text: "Lanterns After Dark", fields: {} },
          })),
          errors: [],
        };
      },
    },
    logger: (entry) => traces.push(entry),
    now: () => "2026-07-21T00:00:00.000Z",
  });

  assert.equal(searches, 1);
  assert.equal(fetched.length, 1);
  assert.ok(fetched.length <= 3);
  assert.equal(result.outcome, "recovered");
  assert.equal(result.venue, "Supreme Court Terrace");
  assert.equal(result.address, "1 St Andrew's Road, Singapore 178957");
  assert.deepEqual(result.evidenceUrls, [
    "https://www.nationalgallery.sg/events/lanterns-after-dark",
  ]);
  assert.ok(
    traces.some(({ action }) => action === "missing_venue_search_started"),
  );
  assert.ok(traces.some(({ action }) => action === "missing_venue_recovered"));
  assert.equal(JSON.stringify(traces).includes("api-key"), false);
});

test("missing venue recovery rejects conflicting authoritative candidates and non-authoritative pages", async () => {
  const candidates = [
    "https://venue-a.sg/events/lanterns",
    "https://venue-b.sg/events/lanterns",
    "https://www.facebook.com/lanterns",
  ];
  const result = await recoverMissingVenueOccurrence({
    sourceName: "Time Out Singapore",
    recordRef: "raw/honey/details/event.json#/records/0",
    record,
    occurrence: record,
    occurrenceIndex: 0,
    config,
    searchClient: async () => ({
      results: candidates.map((url) => ({ url, title: record.title })),
    }),
    renderedClient: {
      async fetchBatch(urls) {
        return {
          results: urls.map((url, index) => ({
            url,
            document: {
              title: record.title,
              text: `${record.title}\nVenue: Hall ${index + 1}\nAddress: ${index + 1} Example Road, Singapore 12345${index + 6}`,
              fields: {
                Venue: `Hall ${index + 1}`,
                Address: `${index + 1} Example Road, Singapore 12345${index + 6}`,
              },
            },
          })),
          errors: [],
        };
      },
    },
  });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.venue, undefined);
  assert.equal(result.address, undefined);
});

test("an editorial source domain cannot establish building authority by itself", async () => {
  const result = await recoverMissingVenueOccurrence({
    sourceName: "Time Out Singapore",
    recordRef: "raw/honey/details/event.json#/records/0",
    record,
    occurrence: record,
    occurrenceIndex: 0,
    config,
    sourceDefinition: {
      name: "Time Out Singapore",
      evidenceRole: "editorial",
      officialDomains: ["timeout.com"],
    },
    searchClient: async () => ({
      results: [
        {
          url: "https://www.timeout.com/singapore/things-to-do/lanterns-after-dark",
          title: record.title,
        },
      ],
    }),
    renderedClient: {
      fetchBatch: async () =>
        assert.fail("editorial-only candidate must not be fetched"),
    },
  });
  assert.equal(result.outcome, "not_found");
  assert.equal(result.reasonCode, "no_authoritative_candidate");
});

test("recovery overlay is reusable, applies before normalization, and failures remain isolated", async () => {
  const runDir = join(
    tmpdir(),
    `event-venue-recovery-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "raw/visit/details"), { recursive: true });
  const recordRef = "raw/visit/details/event.json#/records/0";
  writeFileSync(
    join(runDir, "raw/visit/details/event.json"),
    `${JSON.stringify({ schemaVersion: "1.0", records: [record] }, null, 2)}\n`,
  );
  const state = {
    sources: {
      "Visit Singapore All Happenings": {
        status: "success",
        operatingMode: "required",
        processedSourceRecordRefs: [recordRef],
        invalidSourceRecordRefs: [],
      },
    },
  };
  const run = {
    runId: "venue-recovery-fixture",
    window: {
      start: "2026-07-21T00:00:00+08:00",
      end: "2026-07-28T23:59:59+08:00",
    },
  };
  let searches = 0;
  try {
    const first = await recoverMissingEventVenues({
      runDir,
      state,
      run,
      config,
      sourceDefinitions: [
        {
          name: "Visit Singapore All Happenings",
          domains: ["visitsingapore.com"],
        },
      ],
      searchClient: async () => {
        searches += 1;
        return {
          results: [
            {
              url: "https://www.nationalgallery.sg/events/lanterns-after-dark",
              title: record.title,
            },
          ],
        };
      },
      renderedClient: {
        async fetchBatch(urls) {
          return {
            results: [
              {
                url: urls[0],
                document: {
                  title: record.title,
                  text: `${record.title}\nVenue: Supreme Court Terrace\nAddress: 1 St Andrew's Road, Singapore 178957`,
                  fields: {
                    Venue: "Supreme Court Terrace",
                    Address: "1 St Andrew's Road, Singapore 178957",
                  },
                },
              },
            ],
            errors: [],
          };
        },
      },
    });
    assert.deepEqual(first.counts, {
      candidates: 1,
      attempted: 1,
      recovered: 1,
      ambiguous: 0,
      notFound: 0,
      skipped: 0,
      failed: 0,
      reused: 0,
    });

    const second = await recoverMissingEventVenues({
      runDir,
      state,
      run,
      config,
      sourceDefinitions: [
        {
          name: "Visit Singapore All Happenings",
          domains: ["visitsingapore.com"],
        },
      ],
      searchClient: async () => {
        throw new Error("saved overlay should avoid another search");
      },
      renderedClient: {
        fetchBatch: async () => {
          throw new Error("saved overlay should avoid another fetch");
        },
      },
    });
    assert.equal(searches, 1);
    assert.equal(second.counts.reused, 1);

    const normalized = normalizeRun({ runDir, state, run });
    assert.equal(normalized.counts.acceptedPostDedup, 1);
    assert.equal(normalized.venueBranches[0].venue, "Supreme Court Terrace");
    const event = JSON.parse(
      readFileSync(join(runDir, "normalized/events.json"), "utf8"),
    ).records[0];
    assert.equal(event.address, "1 St Andrew's Road, Singapore 178957");
    assert.ok(
      event.provenanceRefs.some((ref) =>
        ref.includes("missing-venue-recovery.json"),
      ),
    );
    const overlayPath = join(runDir, "normalized/missing-venue-recovery.json");
    const tampered = JSON.parse(readFileSync(overlayPath, "utf8"));
    tampered.records[0].evidenceUrls = ["http://unsafe.example/event"];
    writeFileSync(overlayPath, `${JSON.stringify(tampered, null, 2)}\n`);
    assert.throws(
      () => normalizeRun({ runDir, state, run }),
      /HTTPS authoritative evidence/,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("persistent recovery cache reuses cross-run negatives until the 7-day near-event expiry", async () => {
  const root = join(
    tmpdir(),
    `event-venue-persistent-negative-${process.pid}-${Date.now()}`,
  );
  const cacheDir = join(root, "cache");
  const recordRef = "raw/visit/details/event.json#/records/0";
  const state = {
    sources: {
      "Visit Singapore All Happenings": {
        status: "success",
        operatingMode: "required",
        processedSourceRecordRefs: [recordRef],
        invalidSourceRecordRefs: [],
      },
    },
  };
  const sourceDefinitions = [
    {
      name: "Visit Singapore All Happenings",
      evidenceRole: "direct",
      officialDomains: ["visitsingapore.com"],
    },
  ];
  let searches = 0;
  const execute = async (runId, nowIso) => {
    const runDir = join(root, runId);
    mkdirSync(join(runDir, "raw/visit/details"), { recursive: true });
    writeFileSync(
      join(runDir, "raw/visit/details/event.json"),
      `${JSON.stringify({ schemaVersion: "1.0", records: [record] }, null, 2)}\n`,
    );
    return recoverMissingEventVenues({
      runDir,
      cacheDir,
      state,
      run: {
        runId,
        window: {
          start: "2026-07-21T00:00:00+08:00",
          end: "2026-07-28T23:59:59+08:00",
        },
      },
      config,
      sourceDefinitions,
      searchClient: async () => {
        searches += 1;
        return { results: [] };
      },
      renderedClient: {
        fetchBatch: async () => assert.fail("no candidate should be fetched"),
      },
      now: () => nowIso,
    });
  };
  try {
    const first = await execute("run-one", "2026-07-21T00:00:00.000Z");
    assert.equal(first.counts.attempted, 1);
    assert.equal(first.counts.notFound, 1);
    const second = await execute("run-two", "2026-07-27T00:00:00.000Z");
    assert.equal(second.counts.attempted, 0);
    assert.equal(second.counts.reused, 1);
    assert.equal(second.perSource["Visit Singapore All Happenings"].reused, 1);
    const expired = await execute("run-three", "2026-07-29T00:00:00.000Z");
    assert.equal(expired.counts.attempted, 1);
    assert.equal(searches, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistent recovery cache reuses positive outcomes and invalidates adapter inputs", async () => {
  const root = join(
    tmpdir(),
    `event-venue-persistent-positive-${process.pid}-${Date.now()}`,
  );
  const cacheDir = join(root, "cache");
  const recordRef = "raw/visit/details/event.json#/records/0";
  const state = {
    sources: {
      "Visit Singapore All Happenings": {
        status: "success",
        operatingMode: "required",
        processedSourceRecordRefs: [recordRef],
        invalidSourceRecordRefs: [],
      },
    },
  };
  let searches = 0;
  const execute = async (runId, language = "en") => {
    const runDir = join(root, runId);
    mkdirSync(join(runDir, "raw/visit/details"), { recursive: true });
    writeFileSync(
      join(runDir, "raw/visit/details/event.json"),
      `${JSON.stringify({ schemaVersion: "1.0", records: [record] }, null, 2)}\n`,
    );
    return recoverMissingEventVenues({
      runDir,
      cacheDir,
      state,
      run: {
        runId,
        window: {
          start: "2026-07-21T00:00:00+08:00",
          end: "2026-07-28T23:59:59+08:00",
        },
      },
      config: {
        ...config,
        search: { ...config.search, language },
      },
      sourceDefinitions: [
        {
          name: "Visit Singapore All Happenings",
          evidenceRole: "direct",
          officialDomains: ["visitsingapore.com"],
        },
      ],
      searchClient: async () => {
        searches += 1;
        return {
          results: [
            {
              url: "https://www.nationalgallery.sg/events/lanterns-after-dark",
              title: record.title,
            },
          ],
        };
      },
      renderedClient: {
        fetchBatch: async ([url]) => ({
          results: [
            {
              url,
              document: {
                title: record.title,
                text: `${record.title}\nVenue: Supreme Court Terrace\nAddress: 1 St Andrew's Road, Singapore 178957`,
                fields: {
                  Venue: "Supreme Court Terrace",
                  Address: "1 St Andrew's Road, Singapore 178957",
                },
              },
            },
          ],
          errors: [],
        }),
      },
      now: () => "2026-07-21T00:00:00.000Z",
    });
  };
  try {
    assert.equal((await execute("run-one")).counts.attempted, 1);
    assert.equal((await execute("run-two")).counts.reused, 1);
    assert.equal(
      (await execute("run-three", "fr")).counts.attempted,
      1,
      "adapter-language change must invalidate",
    );
    assert.equal(searches, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("negative recovery freshness is 7 days near an event and 30 days when undated", () => {
  assert.equal(
    recoveryCacheExpiry({
      record,
      occurrence: record,
      outcome: "not_found",
      createdAt: "2026-07-21T00:00:00.000Z",
    }),
    "2026-07-28T00:00:00.000Z",
  );
  assert.equal(
    recoveryCacheExpiry({
      record: { ...record, dateText: null },
      occurrence: { ...record, dateText: null },
      outcome: "ambiguous",
      createdAt: "2026-07-21T00:00:00.000Z",
    }),
    "2026-08-20T00:00:00.000Z",
  );
  assert.equal(
    recoveryCacheExpiry({
      record,
      occurrence: record,
      outcome: "recovered",
      createdAt: "2026-07-21T00:00:00.000Z",
    }),
    null,
  );
});

test("a provider failure is recorded for only the affected occurrence", async () => {
  const result = await recoverMissingVenueOccurrence({
    sourceName: "Fever Singapore",
    recordRef: "raw/fever/details/event.json#/records/0",
    record,
    occurrence: record,
    occurrenceIndex: 0,
    config,
    searchClient: async () => {
      throw Object.assign(new Error("TinyFish Search HTTP 503"), {
        code: "source_unavailable",
        status: 503,
      });
    },
    renderedClient: { fetchBatch: async () => assert.fail("must not fetch") },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reasonCode, "source_unavailable");
  assert.equal(result.httpStatus, 503);
  assert.equal(JSON.stringify(result).includes("response"), false);
});

test("a per-URL candidate fetch error remains a recovery failure with bounded HTTP evidence", async () => {
  const traces = [];
  const result = await recoverMissingVenueOccurrence({
    sourceName: "Visit Singapore All Happenings",
    recordRef: "raw/visit/details/ticket.json#/records/0",
    record,
    occurrence: record,
    occurrenceIndex: 0,
    config,
    searchClient: async () => ({
      results: [
        {
          url: "https://ticketmaster.sg/activity/detail/fixture",
          title: record.title,
        },
      ],
    }),
    renderedClient: {
      fetchBatch: async ([url]) => ({
        results: [],
        errors: [{ url, error: "target_http_error", status: 401 }],
      }),
    },
    logger: (entry) => traces.push(entry),
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reasonCode, "target_http_error");
  assert.equal(result.httpStatus, 401);
  assert.ok(
    traces.some(
      ({ action }) => action === "missing_venue_candidate_fetch_failed",
    ),
  );
});

test("a verified exact organizer page can recover a venue when the sibling ticket page returns 401", async () => {
  const ticketmaster = "https://ticketmaster.sg/activity/detail/26sg_desbishop";
  const liveNation =
    "https://www.livenation.sg/event/des-bishop-live-in-singapore-singapore-tickets-edp1679880";
  const desBishop = {
    ...record,
    title: "Des Bishop Live in Singapore",
    dateText: "26 Oct 2026",
    detailUrl: ticketmaster,
  };
  const result = await recoverMissingVenueOccurrence({
    sourceName: "Visit Singapore All Happenings",
    recordRef: "raw/visit/details/des-bishop.json#/records/0",
    record: desBishop,
    occurrence: desBishop,
    occurrenceIndex: 0,
    config,
    sourceDefinition: {
      name: "Visit Singapore All Happenings",
      evidenceRole: "direct",
      venueRecovery: {
        partnerDomainsByHost: { "ticketmaster.sg": ["livenation.sg"] },
      },
    },
    searchClient: async ({ query }) => {
      assert.match(query, /site:livenation\.sg/);
      assert.doesNotMatch(query, /26 Oct 2026/);
      return { results: [{ url: ticketmaster }, { url: liveNation }] };
    },
    renderedClient: {
      fetchBatch: async () => ({
        results: [
          {
            url: liveNation,
            document: {
              title: "Des Bishop Live in Singapore, Singapore",
              text: [
                "Des Bishop Live in Singapore",
                "Date: 26 October 2026",
                "Venue: Victoria Theatre",
              ].join("\n"),
              fields: { Venue: "Victoria Theatre" },
            },
          },
        ],
        errors: [
          { url: ticketmaster, error: "target_http_error", status: 401 },
        ],
      }),
    },
  });
  assert.equal(result.outcome, "recovered");
  assert.equal(result.venue, "Victoria Theatre");
  assert.deepEqual(result.evidenceUrls, [liveNation]);
});

test("Singapore-looking social subdomains cannot become recovery authority", async () => {
  const result = await recoverMissingVenueOccurrence({
    sourceName: "Time Out Singapore",
    recordRef: "raw/honey/details/social.json#/records/0",
    record,
    occurrence: record,
    occurrenceIndex: 0,
    config,
    searchClient: async () => ({
      results: [
        {
          url: "https://sg.linkedin.com/posts/example-event",
          title: record.title,
        },
      ],
    }),
    renderedClient: {
      fetchBatch: async () =>
        assert.fail("social candidate must not be fetched"),
    },
  });
  assert.equal(result.outcome, "not_found");
  assert.equal(result.reasonCode, "no_authoritative_candidate");
});
