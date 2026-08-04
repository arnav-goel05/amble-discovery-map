import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditBackgroundObjects,
  buildReleaseIdentity,
  classifyRemoteObject,
  deriveActiveBackgroundObjects,
  parseB3dmGmlIds,
  rewriteTilesetForRelease,
  synchronizeBackgroundRelease,
} from "../scripts/lib/background-geometry-release.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root =
  process.env.PLAYWRIGHT_GEOMETRY_FIXTURE === "1"
    ? path.join(repositoryRoot, "outputs/ci-geometry")
    : repositoryRoot;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

function b3dm(gmlIds) {
  const feature = Buffer.from(
    `${JSON.stringify({ BATCH_LENGTH: gmlIds.length })} `,
  );
  const batch = Buffer.from(`${JSON.stringify({ "gml:id": gmlIds })} `);
  const bytes = Buffer.alloc(28 + feature.length + batch.length);
  bytes.write("b3dm", 0);
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(feature.length, 12);
  bytes.writeUInt32LE(0, 16);
  bytes.writeUInt32LE(batch.length, 20);
  bytes.writeUInt32LE(0, 24);
  feature.copy(bytes, 28);
  batch.copy(bytes, 28 + feature.length);
  return bytes;
}

const object = (overrides = {}) => {
  const localBytes = overrides.localBytes ?? b3dm([]);
  return {
    objectKey: "optimized-tiles/3/5/1_0.b3dm",
    localPath: "/tmp/1_0.b3dm",
    localBytes,
    sha256: sha256(localBytes),
    md5: md5(localBytes),
    byteLength: localBytes.length,
    level: 0,
    selectedGmlIds: ["stadium-gml"],
    owners: ["national-stadium"],
    sourceSha256: sha256(b3dm(["stadium-gml"])),
    ...overrides,
  };
};

test("parses selected GML identities from B3DM batch tables", () => {
  assert.deepEqual(parseB3dmGmlIds(b3dm(["one", "two", "one"])), [
    "one",
    "two",
  ]);
  assert.throws(() => parseB3dmGmlIds(Buffer.from("bad")), /B3DM/);
});

test("derives the complete active object set and National Stadium levels", () => {
  const release = deriveActiveBackgroundObjects({ root });
  if (process.env.PLAYWRIGHT_GEOMETRY_FIXTURE === "1") {
    assert.equal(release.snapshotId, "ci-geometry-fixture-v1");
    assert.equal(release.pois.length, 1);
    assert.equal(release.objects.length, 2);
    assert.deepEqual(
      release.objects.map(({ objectKey }) => objectKey),
      ["optimized-tiles/nested.b3dm", "optimized-tiles/root.b3dm"],
    );
    assert.deepEqual(
      release.objects.flatMap(({ selectedGmlIds }) => selectedGmlIds).sort(),
      ["fixture-building-nested", "fixture-building-root"],
    );
    return;
  }
  assert.equal(release.pois.length, 136);
  assert.equal(release.objects.length, 665);
  assert.equal(
    new Set(release.objects.map(({ objectKey }) => objectKey)).size,
    665,
  );
  const stadium = release.objects.filter(({ owners }) =>
    owners.includes("national-stadium"),
  );
  assert.equal(stadium.length, 5);
  assert.deepEqual(
    stadium.map(({ level }) => level),
    [0, 1, 2, 3, 4],
  );
  for (const item of stadium)
    assert.ok(
      item.selectedGmlIds.includes(
        "SLA_BLDG2_31cf6c75-b8fc-4b33-af89-e789837f57e9",
      ),
    );
});

test("classifies current, pristine, and intermediate remote objects", () => {
  const current = object();
  assert.equal(
    classifyRemoteObject(current, current.localBytes).remoteState,
    "current",
  );

  const pristineBytes = b3dm(["stadium-gml"]);
  const pristine = object({ sourceSha256: sha256(pristineBytes) });
  const stale = classifyRemoteObject(pristine, pristineBytes);
  assert.equal(stale.status, "stale");
  assert.equal(stale.remoteState, "pristine");
  assert.deepEqual(stale.retainedGmlIds, ["stadium-gml"]);
  assert.deepEqual(stale.affectedVenueIds, ["national-stadium"]);

  const intermediate = classifyRemoteObject(
    object({
      selectedGmlIds: ["shared", "other"],
      ownersByGmlId: {
        shared: ["venue-a", "venue-b"],
        other: ["venue-c"],
      },
    }),
    b3dm(["shared"]),
  );
  assert.equal(intermediate.remoteState, "intermediate");
  assert.deepEqual(intermediate.affectedVenueIds, ["venue-a", "venue-b"]);
});

test("builds deterministic release identity and records digests without changing B3DM types", () => {
  const first = object();
  const second = object({
    objectKey: "optimized-tiles/3/5/1_1.b3dm",
    sha256: "a".repeat(64),
  });
  const a = buildReleaseIdentity("snapshot-a", [first, second]);
  const b = buildReleaseIdentity("snapshot-a", [second, first]);
  assert.equal(a.releaseId, b.releaseId);
  assert.match(a.releaseId, /^[a-f0-9]{16}$/);
  assert.notEqual(
    buildReleaseIdentity("snapshot-a", [first, second], Buffer.from("a"))
      .releaseId,
    buildReleaseIdentity("snapshot-a", [first, second], Buffer.from("b"))
      .releaseId,
  );

  const tileset = {
    root: {
      content: { uri: "3/5/1_0.b3dm" },
      children: [
        { content: { url: "3/5/1_1.b3dm?old=1" } },
        {
          content: { uri: "unrelated.b3dm" },
          extras: { omittedContentUris: ["3/5/1_0.b3dm"] },
        },
      ],
    },
  };
  const rewritten = rewriteTilesetForRelease(tileset, [first, second]);
  assert.equal(rewritten.root.content.uri, "3/5/1_0.b3dm");
  assert.equal(rewritten.root.extras.backgroundObjectSha256, first.sha256);
  assert.equal(rewritten.root.extras.backgroundObjectMd5, first.md5);
  assert.equal(rewritten.root.children[0].content.url, "3/5/1_1.b3dm");
  assert.equal(
    rewritten.root.children[0].extras.backgroundObjectSha256,
    second.sha256,
  );
  assert.equal(
    rewritten.root.children[0].extras.backgroundObjectMd5,
    second.md5,
  );
  assert.equal(rewritten.root.children[1].content.uri, "unrelated.b3dm");
  assert.deepEqual(rewritten.root.children[1].extras.backgroundOmittedObjects, [
    { uri: "3/5/1_0.b3dm", sha256: first.sha256, md5: first.md5 },
  ]);
});

test("audit reconciles shared ownership, malformed responses, and totals", async () => {
  const shared = object({
    selectedGmlIds: ["shared"],
    owners: ["venue-a", "venue-b"],
    ownersByGmlId: { shared: ["venue-a", "venue-b"] },
  });
  const malformed = object({
    objectKey: "optimized-tiles/3/5/1_1.b3dm",
    selectedGmlIds: ["broken"],
    owners: ["venue-c"],
  });
  const report = await auditBackgroundObjects({
    snapshotId: "snapshot-a",
    objects: [shared, malformed],
    origin: "https://example.test",
    fetchObject: async (item) =>
      item === shared ? b3dm(["shared"]) : Buffer.from("not-b3dm"),
  });
  assert.equal(report.summary.checkedObjects, 2);
  assert.equal(report.summary.staleObjects, 1);
  assert.equal(report.summary.failedObjects, 1);
  assert.equal(report.summary.retainedIdentityCount, 1);
  assert.equal(report.summary.affectedVenueCount, 2);
  assert.equal(report.complete, false);
});

test("synchronization uploads stale objects, verifies all, and publishes manifest last", async () => {
  const stale = object();
  const current = object({
    objectKey: "optimized-tiles/3/5/1_1.b3dm",
    localBytes: b3dm([]),
  });
  current.sha256 = sha256(current.localBytes);
  current.byteLength = current.localBytes.length;
  const remote = new Map([
    [stale.objectKey, b3dm(["stadium-gml"])],
    [current.objectKey, current.localBytes],
  ]);
  const actions = [];
  const result = await synchronizeBackgroundRelease({
    snapshotId: "snapshot-a",
    objects: [stale, current],
    sourceTileset: {
      root: {
        content: { uri: "3/5/1_0.b3dm" },
        children: [{ content: { uri: "3/5/1_1.b3dm" } }],
      },
    },
    origin: "https://example.test",
    fetchObject: async (item) => remote.get(item.objectKey),
    uploadObject: async (item) => {
      actions.push(`object:${item.objectKey}`);
      remote.set(item.objectKey, item.localBytes);
    },
    publishManifest: async () => actions.push("manifest"),
  });
  assert.equal(result.complete, true);
  assert.equal(result.summary.uploadedObjects, 1);
  assert.equal(result.summary.skippedObjects, 1);
  assert.equal(actions.at(-1), "manifest");
});

test("synchronization never publishes on upload failure and resumes as a no-op", async () => {
  const stale = object();
  let remoteBytes = b3dm(["stadium-gml"]);
  let published = 0;
  await assert.rejects(
    synchronizeBackgroundRelease({
      snapshotId: "snapshot-a",
      objects: [stale],
      sourceTileset: { root: { content: { uri: "3/5/1_0.b3dm" } } },
      origin: "https://example.test",
      fetchObject: async () => remoteBytes,
      uploadObject: async () => {
        throw new Error("upload unavailable");
      },
      publishManifest: async () => {
        published += 1;
      },
      retryAttempts: 2,
    }),
    /upload unavailable/,
  );
  assert.equal(published, 0);

  remoteBytes = stale.localBytes;
  const resumed = await synchronizeBackgroundRelease({
    snapshotId: "snapshot-a",
    objects: [stale],
    sourceTileset: { root: { content: { uri: "3/5/1_0.b3dm" } } },
    origin: "https://example.test",
    fetchObject: async () => remoteBytes,
    uploadObject: async () => assert.fail("no upload expected"),
    publishManifest: async () => {
      published += 1;
    },
  });
  assert.equal(resumed.summary.uploadedObjects, 0);
  assert.equal(resumed.summary.skippedObjects, 1);
  assert.equal(published, 1);
});

test("release descriptor contract is internally consistent", () => {
  const descriptor = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "data/background-geometry-release.json"),
      "utf8",
    ),
  );
  assert.equal(descriptor.schemaVersion, "background-geometry-release-v1");
  assert.match(descriptor.releaseId, /^[a-f0-9]{16}$/);
  assert.match(
    descriptor.tilesetUrl,
    new RegExp(`backgroundRelease=${descriptor.releaseId}$`),
  );
});
