import assert from "node:assert/strict";
import test from "node:test";

import {
  buildR2TilesetIntegrityReport,
  r2TilesetIntegrityResponse,
  referenceDigest,
} from "../cloudflare/r2-tileset-integrity.mjs";
import tileIntegrityWorker, {
  integrityCacheKey,
} from "../cloudflare/tile-integrity-worker.mjs";

const EXPECTED_MD5 = "a".repeat(32);
const manifest = (uri, extras = {}) => ({
  asset: { version: "1.0" },
  root: { content: { uri }, extras },
});

function bucketFixture({
  missing = false,
  empty = false,
  stale = false,
  absentValidator = false,
  absentExpectedValidator = false,
} = {}) {
  const objects = new Map([
    [
      "optimized-tiles/tileset.json",
      JSON.stringify(
        manifest("1/2/3_0.b3dm", {
          backgroundObjectSha256: "1".repeat(64),
          ...(absentExpectedValidator
            ? {}
            : { backgroundObjectMd5: EXPECTED_MD5 }),
        }),
      ),
    ],
    [
      "poi-tiles/event-venues/tileset.json",
      JSON.stringify(manifest("../venue/venue.b3dm")),
    ],
  ]);
  const listed = [
    {
      key: "optimized-tiles/1/2/3_0.b3dm",
      size: empty ? 464 : 4_096,
      ...(absentValidator
        ? {}
        : { etag: stale ? "b".repeat(32) : EXPECTED_MD5 }),
    },
    { key: "poi-tiles/venue/venue.b3dm", size: 2_048, etag: "c".repeat(32) },
    {
      key: "poi-tiles/venue/unreferenced.b3dm",
      size: 3_072,
      etag: "d".repeat(32),
    },
  ];
  if (missing)
    listed.splice(
      listed.findIndex(({ key }) => key === "poi-tiles/venue/venue.b3dm"),
      1,
    );
  return {
    listCalls: [],
    async get(key) {
      const body = objects.get(key);
      return body == null ? null : { text: async () => body };
    },
    async list(options) {
      this.listCalls.push(options);
      return {
        objects: listed.filter(({ key }) => key.startsWith(options.prefix)),
        truncated: false,
      };
    },
  };
}

test("builds an exhaustive manifest-to-R2 inventory in bounded list calls", async () => {
  const bucket = bucketFixture();
  const report = await buildR2TilesetIntegrityReport(bucket);
  assert.equal(report.complete, true);
  assert.equal(report.summary.referenceCount, 2);
  assert.equal(report.summary.errorCount, 0);
  assert.equal(report.tilesets[0].versionedObjects.length, 1);
  assert.equal(report.tilesets[0].versionedObjects[0].etag, EXPECTED_MD5);
  assert.equal(bucket.listCalls.length, 2);
  assert.deepEqual(
    report.tilesets.map(({ referenceSha256 }) => referenceSha256),
    [
      await referenceDigest(["optimized-tiles/1/2/3_0.b3dm"]),
      await referenceDigest(["poi-tiles/venue/venue.b3dm"]),
    ],
  );
});

test("fails closed for missing and non-drawable referenced objects", async () => {
  const missing = await buildR2TilesetIntegrityReport(
    bucketFixture({ missing: true }),
  );
  assert.equal(missing.complete, false);
  assert.equal(missing.summary.errorCount, 1);
  assert.equal(missing.tilesets[1].errors[0].kind, "object-missing");

  const empty = await buildR2TilesetIntegrityReport(
    bucketFixture({ empty: true }),
  );
  assert.equal(empty.complete, false);
  assert.equal(empty.tilesets[0].errors[0].kind, "non-drawable-b3dm");
});

test("fails closed for stale stored validators while permitting SHA-only release evidence", async () => {
  const stale = await buildR2TilesetIntegrityReport(
    bucketFixture({ stale: true }),
  );
  assert.equal(stale.complete, false);
  assert.equal(stale.tilesets[0].errors[0].kind, "object-validator-mismatch");

  const absent = await buildR2TilesetIntegrityReport(
    bucketFixture({ absentValidator: true }),
  );
  assert.equal(absent.complete, false);
  assert.equal(absent.tilesets[0].unverifiableObjectCount, 1);
  assert.equal(
    absent.tilesets[0].errors[0].kind,
    "object-validator-unverifiable",
  );

  const absentExpected = await buildR2TilesetIntegrityReport(
    bucketFixture({ absentExpectedValidator: true }),
  );
  assert.equal(absentExpected.complete, true);
  assert.equal(absentExpected.tilesets[0].unverifiableObjectCount, 1);
  assert.deepEqual(absentExpected.tilesets[0].errors, []);
});

test("returns bounded POI inventory detail only when explicitly requested", async () => {
  const summary = await buildR2TilesetIntegrityReport(bucketFixture());
  assert.equal(summary.tilesets[1].inventoryObjects, undefined);

  const detailed = await buildR2TilesetIntegrityReport(bucketFixture(), {
    scope: "poi",
  });
  assert.deepEqual(
    detailed.tilesets[1].inventoryObjects.map(({ key }) => key),
    ["poi-tiles/venue/unreferenced.b3dm", "poi-tiles/venue/venue.b3dm"],
  );
});

test("verifies omitted empty background objects without treating them as drawable references", async () => {
  const bucket = bucketFixture();
  const source = JSON.parse(
    await (await bucket.get("optimized-tiles/tileset.json")).text(),
  );
  source.root.extras.omittedContentUris = ["1/2/3_1.b3dm"];
  source.root.extras.backgroundOmittedObjects = [
    {
      uri: "1/2/3_1.b3dm",
      sha256: "2".repeat(64),
      md5: "e".repeat(32),
    },
  ];
  const originalGet = bucket.get.bind(bucket);
  bucket.get = async (key) =>
    key === "optimized-tiles/tileset.json"
      ? { text: async () => JSON.stringify(source) }
      : originalGet(key);
  const originalList = bucket.list.bind(bucket);
  bucket.list = async (options) => {
    const page = await originalList(options);
    if (options.prefix === "optimized-tiles/")
      page.objects.push({
        key: "optimized-tiles/1/2/3_1.b3dm",
        size: 464,
        etag: "e".repeat(32),
      });
    return page;
  };

  const report = await buildR2TilesetIntegrityReport(bucket);
  assert.equal(report.complete, true);
  assert.equal(report.tilesets[0].referenceCount, 1);
  assert.equal(report.tilesets[0].versionedObjects.length, 2);
  assert.equal(
    report.tilesets[0].versionedObjects.find(({ omitted }) => omitted).size,
    464,
  );
});

test("serves only the bounded integrity endpoint", async () => {
  const bucket = bucketFixture();
  assert.equal(
    await r2TilesetIntegrityResponse(
      new Request("https://example.test/not-integrity"),
      bucket,
    ),
    null,
  );
  const response = await r2TilesetIntegrityResponse(
    new Request("https://example.test/api/tile-integrity"),
    bucket,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).complete, true);
});

test("isolated Worker exposes only the read-only integrity report", async () => {
  const context = { waitUntil() {} };
  const missing = await tileIntegrityWorker.fetch(
    new Request("https://integrity.example.test/"),
    { TILES_BUCKET: bucketFixture() },
    context,
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-frame-options"), "DENY");

  const report = await tileIntegrityWorker.fetch(
    new Request("https://integrity.example.test/api/tile-integrity"),
    { TILES_BUCKET: bucketFixture() },
    context,
  );
  assert.equal(report.status, 200);
  assert.equal(report.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await report.json()).summary.referenceCount, 2);

  const invalidScope = await tileIntegrityWorker.fetch(
    new Request("https://integrity.example.test/api/tile-integrity?scope=all"),
    { TILES_BUCKET: bucketFixture() },
    context,
  );
  assert.equal(invalidScope.status, 400);

  const invalidVerification = await tileIntegrityWorker.fetch(
    new Request(
      "https://integrity.example.test/api/tile-integrity?verification=not-valid",
    ),
    { TILES_BUCKET: bucketFixture() },
    context,
  );
  assert.equal(invalidVerification.status, 400);
});

test("integrity cache keys are separated by release and bounded scope", () => {
  const first = integrityCacheKey(
    new Request(
      "https://integrity.example.test/api/tile-integrity?release=1111111111111111",
    ),
  );
  const second = integrityCacheKey(
    new Request(
      "https://integrity.example.test/api/tile-integrity?release=2222222222222222&scope=poi&verification=3333333333333333",
    ),
  );
  const fresh = integrityCacheKey(
    new Request(
      "https://integrity.example.test/api/tile-integrity?release=2222222222222222&scope=poi&verification=4444444444444444",
    ),
  );
  assert.notEqual(first.url, second.url);
  assert.notEqual(second.url, fresh.url);
  assert.match(first.url, /scope=summary/);
  assert.match(second.url, /scope=poi/);
  assert.match(second.url, /verification=3333333333333333/);
});
