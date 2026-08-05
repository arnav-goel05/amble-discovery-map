import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditRemoteTilesetObjects,
  buildTilesetIntegrityInventory,
  collectTilesetContentReferences,
  compareR2BindingInventory,
  removeTilesetContentReferences,
} from "../scripts/lib/tileset-integrity.mjs";
import {
  buildIntegrityReleaseId,
  createIntegrityVerificationId,
  createR2ControlPlane,
  fetchR2BindingInventory,
  inventoryObjectMap,
  r2MetadataState,
} from "../scripts/lib/r2-binding-inventory.mjs";

test("integrity release identity covers ordered highlighted object metadata", () => {
  const objects = [
    {
      pathname: "/poi-tiles/venue/two.b3dm",
      byteLength: 20,
      md5: "b".repeat(32),
    },
    {
      pathname: "/poi-tiles/venue/one.b3dm",
      byteLength: 10,
      md5: "a".repeat(32),
    },
  ];
  const first = buildIntegrityReleaseId({
    backgroundReleaseId: "1".repeat(16),
    objects,
  });
  const reordered = buildIntegrityReleaseId({
    backgroundReleaseId: "1".repeat(16),
    objects: [...objects].reverse(),
  });
  const changed = buildIntegrityReleaseId({
    backgroundReleaseId: "1".repeat(16),
    objects: objects.map((item, index) =>
      index === 0 ? { ...item, md5: "c".repeat(32) } : item,
    ),
  });

  assert.match(first, /^[a-f0-9]{16}$/u);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(createIntegrityVerificationId(), /^[a-f0-9]{16}$/u);
});

test("collects every content and contents reference in the hierarchy", () => {
  const references = collectTilesetContentReferences({
    root: {
      content: { uri: "root.b3dm" },
      contents: [{ uri: "root-a.b3dm" }, { url: "root-b.b3dm" }],
      children: [
        { content: { url: "child.b3dm" } },
        { children: [{ content: { uri: "nested/tileset.json" } }] },
      ],
    },
  });
  assert.deepEqual(references, [
    "root.b3dm",
    "root-a.b3dm",
    "root-b.b3dm",
    "child.b3dm",
    "nested/tileset.json",
  ]);
});

test("removes rejected content while preserving hierarchy and drawable siblings", () => {
  const source = {
    root: {
      content: { uri: "3/5/1_0.b3dm" },
      children: [
        {
          contents: [
            { uri: "3/5/1_1.b3dm?cache=old" },
            { url: "3/5/1_2.b3dm" },
          ],
          children: [{ content: { uri: "3/5/1_3.b3dm" } }],
        },
      ],
    },
  };
  const result = removeTilesetContentReferences(source, [
    "/optimized-tiles/3/5/1_0.b3dm",
    "/optimized-tiles/3/5/1_1.b3dm",
    "/optimized-tiles/3/5/1_3.b3dm",
  ]);
  assert.equal(result.removed, 3);
  assert.equal(result.tileset.root.content, undefined);
  assert.deepEqual(result.tileset.root.extras.omittedContentUris, [
    "3/5/1_0.b3dm",
  ]);
  assert.deepEqual(result.tileset.root.children[0].contents, [
    { url: "3/5/1_2.b3dm" },
  ]);
  assert.deepEqual(result.tileset.root.children[0].extras.omittedContentUris, [
    "3/5/1_1.b3dm?cache=old",
  ]);
  assert.equal(result.tileset.root.children[0].children[0].content, undefined);
  assert.equal(source.root.content.uri, "3/5/1_0.b3dm");
});

test("inventory accounts for every reference and rejects non-drawable B3DM", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tileset-integrity-"));
  try {
    await mkdir(path.join(directory, "nested"));
    await writeFile(
      path.join(directory, "tileset.json"),
      JSON.stringify({
        root: {
          content: { uri: "empty.b3dm" },
          children: [{ content: { uri: "nested/tileset.json" } }],
        },
      }),
    );
    await writeFile(
      path.join(directory, "nested/tileset.json"),
      JSON.stringify({ root: { content: { uri: "missing.b3dm" } } }),
    );
    const empty = Buffer.alloc(28);
    empty.write("b3dm", 0);
    empty.writeUInt32LE(1, 4);
    empty.writeUInt32LE(empty.length, 8);
    await writeFile(path.join(directory, "empty.b3dm"), empty);

    const result = await buildTilesetIntegrityInventory({
      manifestPath: path.join(directory, "tileset.json"),
      manifestUrl: "https://inventory.invalid/tileset.json",
      publicRoot: directory,
    });
    assert.equal(result.manifestCount, 2);
    assert.equal(result.referenceCount, 3);
    assert.equal(result.complete, false);
    assert.deepEqual(result.errors.map(({ kind }) => kind).sort(), [
      "invalid-local-b3dm",
      "invalid-local-b3dm",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inventory can validate only the active release subset while accounting for all references", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tileset-integrity-"));
  try {
    await writeFile(
      path.join(directory, "tileset.json"),
      JSON.stringify({
        root: {
          content: { uri: "active.b3dm" },
          children: [{ content: { uri: "legacy.b3dm" } }],
        },
      }),
    );

    const result = await buildTilesetIntegrityInventory({
      manifestPath: path.join(directory, "tileset.json"),
      manifestUrl: "https://inventory.invalid/tileset.json",
      publicRoot: directory,
      validateLocalContent: ({ pathname }) => pathname === "/active.b3dm",
    });

    assert.equal(result.referenceCount, 2);
    assert.equal(result.objectCount, 1);
    assert.equal(result.complete, false);
    assert.deepEqual(
      result.errors.map(({ path, kind }) => ({ path, kind })),
      [{ path: "/active.b3dm", kind: "invalid-local-b3dm" }],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inventory reference digest uses the Worker's canonical code-unit ordering", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tileset-integrity-"));
  try {
    await writeFile(
      path.join(directory, "tileset.json"),
      JSON.stringify({
        root: {
          contents: [
            { uri: "5/1_0.b3dm" },
            { uri: "5/10_0.b3dm" },
            { uri: "5/1_5.b3dm" },
          ],
        },
      }),
    );

    const result = await buildTilesetIntegrityInventory({
      manifestPath: path.join(directory, "tileset.json"),
      manifestUrl: "https://inventory.invalid/optimized-tiles/tileset.json",
      publicRoot: directory,
      validateLocalContent: false,
    });
    const canonical = [
      "optimized-tiles/5/10_0.b3dm",
      "optimized-tiles/5/1_0.b3dm",
      "optimized-tiles/5/1_5.b3dm",
    ].join("\n");

    assert.equal(
      result.referenceSha256,
      createHash("sha256").update(canonical).digest("hex"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("published audit checks every object and reports length and digest drift", async () => {
  const calls = [];
  const objects = [
    {
      pathname: "/one.b3dm",
      url: "https://inventory.invalid/one.b3dm",
      byteLength: 2_000,
      md5: "a".repeat(32),
    },
    {
      pathname: "/two.b3dm",
      url: "https://inventory.invalid/two.b3dm",
      byteLength: 3_000,
      md5: "b".repeat(32),
    },
  ];
  const result = await auditRemoteTilesetObjects({
    objects,
    origin: "https://example.test",
    concurrency: 2,
    fetchImpl: async (url) => {
      calls.push(url.pathname);
      const first = url.pathname === "/one.b3dm";
      return new Response(null, {
        status: 200,
        headers: {
          "content-length": first ? "2000" : "2999",
          etag: `\"${first ? "a".repeat(32) : "c".repeat(32)}\"`,
          "x-amble-tile-source": "r2",
        },
      });
    },
  });
  assert.deepEqual(calls.sort(), ["/one.b3dm", "/two.b3dm"]);
  assert.equal(result.checkedObjects, 2);
  assert.equal(result.complete, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /byte length 2999; expected 3000/);
});

test("legacy public object audit stops immediately when rate limited", async () => {
  let calls = 0;
  const result = await auditRemoteTilesetObjects({
    objects: Array.from({ length: 20 }, (_, index) => ({
      pathname: `/${index}.b3dm`,
      url: `https://inventory.invalid/${index}.b3dm`,
    })),
    origin: "https://example.test",
    concurrency: 1,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 429 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.checkedObjects, 1);
  assert.equal(result.complete, false);
  assert.equal(result.errors[0].kind, "public-rate-limited");
});

test("compares the local manifest inventory with the R2 binding report", () => {
  const matched = compareR2BindingInventory({
    id: "background",
    inventory: { objectCount: 2, referenceSha256: "expected" },
    published: {
      complete: true,
      referenceCount: 2,
      referenceSha256: "expected",
    },
  });
  assert.equal(matched.complete, true);

  const drifted = compareR2BindingInventory({
    id: "background",
    inventory: { objectCount: 2, referenceSha256: "expected" },
    published: {
      complete: true,
      referenceCount: 1,
      referenceSha256: "different",
    },
  });
  assert.equal(drifted.complete, false);
  assert.deepEqual(
    drifted.errors.map(({ kind }) => kind),
    ["reference-count-mismatch", "reference-digest-mismatch"],
  );
});

test("pre-deploy comparison requires published health without requiring candidate parity", () => {
  const result = compareR2BindingInventory({
    id: "highlighted",
    inventory: { objectCount: 143, referenceSha256: "candidate" },
    published: {
      complete: true,
      referenceCount: 366,
      referenceSha256: "current-production",
    },
    requireObjectMetadata: true,
    requireReferenceParity: false,
  });

  assert.deepEqual(result, { complete: true, errors: [] });
});

test("routine highlighted inventory rejects same-size stale and unverifiable objects", () => {
  const inventory = {
    objectCount: 2,
    referenceSha256: "expected",
    objects: [
      {
        pathname: "/poi-tiles/venue/one.b3dm",
        byteLength: 2_000,
        md5: "a".repeat(32),
      },
      {
        pathname: "/poi-tiles/venue/two.b3dm",
        byteLength: 3_000,
        md5: "b".repeat(32),
      },
    ],
  };
  const published = {
    complete: true,
    referenceCount: 2,
    referenceSha256: "expected",
    inventoryObjects: [
      {
        key: "poi-tiles/venue/one.b3dm",
        size: 2_000,
        md5: "c".repeat(32),
      },
      {
        key: "poi-tiles/venue/two.b3dm",
        size: 3_000,
        etag: "multipart-2",
      },
    ],
  };

  const result = compareR2BindingInventory({
    id: "highlighted",
    inventory,
    published,
    requireObjectMetadata: true,
  });

  assert.equal(result.complete, false);
  assert.deepEqual(
    result.errors.map(({ kind }) => kind),
    ["object-validator-mismatch", "object-validator-unverifiable"],
  );
});

test("binding inventory uses one public request and exposes reliable object states", async () => {
  let calls = 0;
  const report = await fetchR2BindingInventory({
    origin: "https://integrity.example.test",
    releaseId: "1".repeat(16),
    verificationId: "2".repeat(16),
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url.searchParams.get("release"), "1".repeat(16));
      assert.equal(url.searchParams.get("verification"), "2".repeat(16));
      return Response.json({
        tilesets: [
          {
            id: "background",
            versionedObjects: [
              { key: "one.b3dm", size: 2_000, etag: "a".repeat(32) },
            ],
          },
        ],
      });
    },
  });
  assert.equal(calls, 1);
  const objects = inventoryObjectMap(report, {
    id: "background",
    detail: "versionedObjects",
  });
  assert.equal(
    r2MetadataState(
      { md5: "a".repeat(32), byteLength: 2_000 },
      objects.get("one.b3dm"),
    ),
    "matched",
  );
  assert.equal(
    r2MetadataState(
      { md5: "b".repeat(32), byteLength: 2_000 },
      objects.get("one.b3dm"),
    ),
    "mismatched",
  );
  assert.equal(
    r2MetadataState(
      { md5: "a".repeat(32), byteLength: 2_000 },
      { key: "one.b3dm", size: 2_000, etag: "multipart-2" },
    ),
    "unverifiable",
  );
});

test("binding inventory stops immediately on a public rate limit", async () => {
  let calls = 0;
  await assert.rejects(
    fetchR2BindingInventory({
      origin: "https://integrity.example.test",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 429 });
      },
    }),
    /verification stopped/,
  );
  assert.equal(calls, 1);
});

test("binding inventory makes one attempt for a server failure", async () => {
  let calls = 0;
  await assert.rejects(
    fetchR2BindingInventory({
      origin: "https://integrity.example.test",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 503 });
      },
    }),
    /503/,
  );
  assert.equal(calls, 1);
});

test("synchronizers can consume an incomplete inventory without accepting it as success", async () => {
  const report = await fetchR2BindingInventory({
    origin: "https://integrity.example.test",
    allowIncomplete: true,
    fetchImpl: async () =>
      Response.json(
        { complete: false, tilesets: [], summary: { errorCount: 1 } },
        { status: 503 },
      ),
  });
  assert.equal(report.complete, false);

  await assert.rejects(
    fetchR2BindingInventory({
      origin: "https://integrity.example.test",
      retryAttempts: 1,
      fetchImpl: async () =>
        Response.json({ complete: false }, { status: 503 }),
    }),
    /503/,
  );
});

test("R2 control plane transfers only explicitly requested objects", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "r2-control-test-"));
  const commands = [];
  try {
    const control = createR2ControlPlane({
      temporaryRoot: directory,
      runCommand: async (args) => {
        commands.push(args);
        if (args[2] === "get")
          await writeFile(args[args.indexOf("--file") + 1], "verified-bytes");
      },
    });
    assert.equal(
      (await control.getObjectBytes("optimized-tiles/one.b3dm")).toString(),
      "verified-bytes",
    );
    await control.putObject({
      key: "optimized-tiles/one.b3dm",
      filePath: "/tmp/one.b3dm",
      contentType: "application/octet-stream",
    });
    assert.equal(commands.length, 2);
    assert.deepEqual(
      commands.map((args) => args[2]),
      ["get", "put"],
    );
    assert.ok(
      commands.every((args) =>
        args.includes("amble-3d-tiles/optimized-tiles/one.b3dm"),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("routine geometry synchronizers contain no visitor-facing object fetch loop", async () => {
  for (const file of [
    "scripts/sync-r2-background-tiles.mjs",
    "scripts/sync-r2-poi-tiles.mjs",
  ]) {
    const source = await readFile(
      new URL(`../${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /\bfetch\s*\(/u, file);
    assert.match(source, /fetchR2BindingInventory/u, file);
    assert.match(source, /createR2ControlPlane/u, file);
    assert.match(source, /createIntegrityVerificationId/u, file);
  }

  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const deploy = packageJson.scripts["cloudflare:cloud:deploy"];
  assert.match(deploy, /cloudflare:r2:verify -- --deployment/u);
  assert.doesNotMatch(deploy, /cloudflare:tile-integrity:deploy/u);
  assert.doesNotMatch(deploy, /geometry:(?:background|poi):sync/u);
  assert.doesNotMatch(deploy, /geometry:background:hydrate/u);

  const verifier = await readFile(
    new URL("../scripts/verify-r2-tile-delivery.mjs", import.meta.url),
    "utf8",
  );
  assert.match(verifier, /scope:\s*"poi"/u);
  assert.match(verifier, /buildIntegrityReleaseId/u);
  assert.match(verifier, /createIntegrityVerificationId/u);
  assert.match(
    verifier,
    /requireObjectMetadata:\s*definition\.id === "highlighted"/u,
  );

  const poiSynchronizer = await readFile(
    new URL("../scripts/sync-r2-poi-tiles.mjs", import.meta.url),
    "utf8",
  );
  assert.match(poiSynchronizer, /buildIntegrityReleaseId/u);
});
