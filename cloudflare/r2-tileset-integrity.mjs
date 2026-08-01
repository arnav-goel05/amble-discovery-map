const DEFINITIONS = [
  {
    id: "background",
    manifestKey: "optimized-tiles/tileset.json",
    prefix: "optimized-tiles/",
  },
  {
    id: "highlighted",
    manifestKey: "poi-tiles/event-venues/tileset.json",
    prefix: "poi-tiles/",
  },
];

const bytesToHex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

export async function referenceDigest(keys) {
  const canonical = [...new Set(keys)].sort().join("\n");
  return bytesToHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
}

function contentReferences(tileset) {
  const references = [];
  const visit = (tile) => {
    for (const content of [tile?.content, ...(tile?.contents ?? [])]) {
      const uri = content?.uri ?? content?.url;
      if (typeof uri === "string")
        references.push({
          uri,
          omitted: false,
          expectedSha256:
            content?.extras?.backgroundObjectSha256 ??
            tile?.extras?.backgroundObjectSha256 ??
            null,
          expectedMd5:
            content?.extras?.backgroundObjectMd5 ??
            tile?.extras?.backgroundObjectMd5 ??
            null,
        });
    }
    const richOmitted = tile?.extras?.backgroundOmittedObjects ?? [];
    for (const omitted of richOmitted) {
      if (typeof omitted?.uri !== "string") continue;
      references.push({
        uri: omitted.uri,
        omitted: true,
        expectedSha256: omitted.sha256 ?? null,
        expectedMd5: omitted.md5 ?? null,
      });
    }
    const richUris = new Set(richOmitted.map(({ uri }) => uri));
    for (const uri of tile?.extras?.omittedContentUris ?? []) {
      if (typeof uri !== "string" || richUris.has(uri)) continue;
      references.push({
        uri,
        omitted: true,
        expectedSha256: null,
        expectedMd5: null,
      });
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(tileset?.root);
  return references;
}

async function readManifest(
  bucket,
  manifestKey,
  manifests,
  objectReferences,
  versionedReferences,
  errors,
) {
  if (manifests.has(manifestKey)) return;
  manifests.add(manifestKey);
  const object = await bucket.get(manifestKey);
  if (!object) {
    errors.push({ kind: "manifest-missing", path: `/${manifestKey}` });
    return;
  }
  let tileset;
  try {
    tileset = JSON.parse(await object.text());
  } catch (error) {
    errors.push({
      kind: "manifest-unreadable",
      path: `/${manifestKey}`,
      message: String(error?.message ?? error).slice(0, 300),
    });
    return;
  }
  for (const reference of contentReferences(tileset)) {
    const url = new URL(reference.uri, `https://r2.invalid/${manifestKey}`);
    if (url.origin !== "https://r2.invalid") {
      errors.push({ kind: "external-content-uri", path: reference.uri });
      continue;
    }
    const key = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (key.endsWith(".json")) {
      await readManifest(
        bucket,
        key,
        manifests,
        objectReferences,
        versionedReferences,
        errors,
      );
    } else if (key.endsWith(".b3dm")) {
      const target = reference.omitted ? versionedReferences : objectReferences;
      const existing = target.get(key);
      if (
        existing &&
        (existing.expectedSha256 !== reference.expectedSha256 ||
          existing.expectedMd5 !== reference.expectedMd5)
      )
        errors.push({ kind: "conflicting-object-metadata", path: `/${key}` });
      else target.set(key, { key, ...reference });
      if (
        !reference.omitted &&
        (reference.expectedSha256 || reference.expectedMd5)
      )
        versionedReferences.set(key, { key, ...reference });
    } else {
      errors.push({ kind: "unsupported-content", path: `/${key}` });
    }
  }
}

const normalizedEtag = (value) =>
  typeof value === "string"
    ? value.replace(/^W\//u, "").replace(/^"|"$/gu, "").toLowerCase()
    : null;

function checksumHex(value) {
  if (typeof value === "string") return value.toLowerCase();
  if (value instanceof ArrayBuffer) return bytesToHex(value);
  if (ArrayBuffer.isView(value))
    return bytesToHex(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  return null;
}

function inventoryObject(object) {
  const etag = normalizedEtag(object?.etag);
  const checksumMd5 = checksumHex(object?.checksums?.md5);
  const md5 = checksumMd5 ?? (/^[a-f0-9]{32}$/u.test(etag ?? "") ? etag : null);
  return {
    key: object.key,
    size: object.size,
    etag,
    md5,
    version: typeof object.version === "string" ? object.version : null,
  };
}

async function objectMetadataDigest(records) {
  return referenceDigest(
    records.map(
      ({ key, size, etag, md5 }) =>
        `${key}\0${size}\0${md5 ?? etag ?? "unverifiable"}`,
    ),
  );
}

async function listPrefix(bucket, prefix) {
  const objects = new Map();
  let cursor;
  do {
    const page = await bucket.list({ prefix, limit: 1_000, cursor });
    for (const object of page.objects ?? []) objects.set(object.key, object);
    cursor = page.truncated ? page.cursor : undefined;
    if (page.truncated && !cursor)
      throw new Error(
        `R2 inventory for ${prefix} was truncated without a cursor`,
      );
  } while (cursor);
  return objects;
}

export async function buildR2TilesetIntegrityReport(
  bucket,
  { scope = null, releaseId = null, verificationId = null } = {},
) {
  if (!bucket?.get || !bucket?.list)
    throw new TypeError("An R2 bucket binding with get and list is required");
  const report = [];
  for (const definition of DEFINITIONS) {
    const manifests = new Set();
    const objectReferences = new Map();
    const versionedReferences = new Map();
    const errors = [];
    await readManifest(
      bucket,
      definition.manifestKey,
      manifests,
      objectReferences,
      versionedReferences,
      errors,
    );
    const inventory = await listPrefix(bucket, definition.prefix);
    const versionedObjects = [];
    let unverifiableObjectCount = 0;
    const referencedInventory = [];
    for (const [key] of objectReferences) {
      const object = inventory.get(key);
      if (!object) errors.push({ kind: "object-missing", path: `/${key}` });
      else if (!Number.isFinite(object.size) || object.size <= 1_024)
        errors.push({
          kind: "non-drawable-b3dm",
          path: `/${key}`,
          message: `R2 object size is ${object.size ?? "unknown"} bytes`,
        });
      if (!object) continue;
      referencedInventory.push(inventoryObject(object));
    }
    for (const [key, reference] of versionedReferences) {
      const object = inventory.get(key);
      if (!object) {
        versionedObjects.push({
          key,
          size: null,
          etag: null,
          md5: null,
          version: null,
          missing: true,
          omitted: reference.omitted,
          expectedSha256: reference.expectedSha256,
          expectedMd5: reference.expectedMd5,
        });
        if (!objectReferences.has(key))
          errors.push({ kind: "object-missing", path: `/${key}` });
        continue;
      }
      const metadata = inventoryObject(object);
      versionedObjects.push({
        ...metadata,
        omitted: reference.omitted,
        expectedSha256: reference.expectedSha256,
        expectedMd5: reference.expectedMd5,
      });
      if (!reference.expectedMd5) {
        unverifiableObjectCount += 1;
        errors.push({
          kind: "object-expected-validator-missing",
          path: `/${key}`,
        });
      } else if (!metadata.md5) {
        unverifiableObjectCount += 1;
        errors.push({
          kind: "object-validator-unverifiable",
          path: `/${key}`,
        });
      } else if (metadata.md5 !== reference.expectedMd5)
        errors.push({
          kind: "object-validator-mismatch",
          path: `/${key}`,
          message: `stored=${metadata.md5}, expected=${reference.expectedMd5}`,
        });
    }
    versionedObjects.sort((left, right) => left.key.localeCompare(right.key));
    const item = {
      id: definition.id,
      complete: errors.length === 0,
      manifestCount: manifests.size,
      referenceCount: objectReferences.size,
      objectCount: objectReferences.size,
      referenceSha256: await referenceDigest(objectReferences.keys()),
      objectMetadataSha256: await objectMetadataDigest(referencedInventory),
      unverifiableObjectCount,
      versionedObjects,
      errors: errors.slice(0, 100),
      errorCount: errors.length,
    };
    if (scope === "poi" && definition.id === "highlighted") {
      const inventoryObjects = [...inventory.values()]
        .filter(({ key }) => key.endsWith(".b3dm"))
        .map(inventoryObject)
        .sort((left, right) => left.key.localeCompare(right.key));
      if (inventoryObjects.length > 5_000)
        throw new Error("POI inventory detail exceeds the 5000-object bound");
      item.inventoryObjects = inventoryObjects;
    }
    report.push(item);
  }
  return {
    schemaVersion: 1,
    complete: report.every(({ complete }) => complete),
    mode: "r2-binding-inventory",
    scope,
    releaseId,
    verificationId,
    checkedAt: new Date().toISOString(),
    summary: {
      manifestCount: report.reduce((sum, item) => sum + item.manifestCount, 0),
      referenceCount: report.reduce(
        (sum, item) => sum + item.referenceCount,
        0,
      ),
      objectCount: report.reduce((sum, item) => sum + item.objectCount, 0),
      errorCount: report.reduce((sum, item) => sum + item.errorCount, 0),
    },
    tilesets: report,
  };
}

export async function r2TilesetIntegrityResponse(request, bucket) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/tile-integrity" || request.method !== "GET")
    return null;
  const scope = url.searchParams.get("scope");
  const releaseId = url.searchParams.get("release");
  const verificationId = url.searchParams.get("verification");
  if (scope && scope !== "poi")
    return new Response(
      `${JSON.stringify({ complete: false, error: "Invalid integrity scope" })}\n`,
      { status: 400, headers: { "content-type": "application/json" } },
    );
  if (releaseId && !/^[a-f0-9]{16}$/u.test(releaseId))
    return new Response(
      `${JSON.stringify({ complete: false, error: "Invalid release identity" })}\n`,
      { status: 400, headers: { "content-type": "application/json" } },
    );
  if (verificationId && !/^[a-f0-9]{16}$/u.test(verificationId))
    return new Response(
      `${JSON.stringify({ complete: false, error: "Invalid verification identity" })}\n`,
      { status: 400, headers: { "content-type": "application/json" } },
    );
  try {
    const report = await buildR2TilesetIntegrityReport(bucket, {
      scope,
      releaseId,
      verificationId,
    });
    return new Response(`${JSON.stringify(report)}\n`, {
      status: report.complete ? 200 : 503,
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return new Response(
      `${JSON.stringify({
        schemaVersion: 1,
        complete: false,
        mode: "r2-binding-inventory",
        error: String(error?.message ?? error).slice(0, 500),
      })}\n`,
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }
}
