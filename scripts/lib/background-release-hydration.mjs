import path from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function fail(message) {
  throw new Error(`Background release hydration: ${message}`);
}

function normalizedObjectPath(value, context) {
  if (typeof value !== "string") fail(`${context} is missing`);
  const unprefixed = value.replace(/^\/+/, "");
  const pathname = unprefixed.startsWith("optimized-tiles/")
    ? unprefixed.slice("optimized-tiles/".length)
    : unprefixed.startsWith("tiles/")
      ? unprefixed.slice("tiles/".length)
      : unprefixed;
  if (
    !pathname ||
    pathname.includes("..") ||
    path.isAbsolute(pathname) ||
    !pathname.endsWith(".b3dm")
  )
    fail(`${context} is unsafe: ${value}`);
  return pathname;
}

function objectUrl(origin, pathname, sha256) {
  return new URL(
    `optimized-tiles/${pathname}?backgroundObject=${sha256}`,
    origin,
  );
}

export function collectTilesetReleaseEntries({ tileset, origin }) {
  const entries = new Map();
  const visit = (tile) => {
    const rawUri = tile?.content?.uri ?? tile?.content?.url;
    if (typeof rawUri === "string") {
      const parsed = new URL(rawUri, new URL("optimized-tiles/", origin));
      const pathname = normalizedObjectPath(
        decodeURIComponent(parsed.pathname),
        "served tileset content URI",
      );
      const sha256 =
        tile?.extras?.backgroundObjectSha256 ??
        parsed.searchParams.get("backgroundObject");
      if (sha256 !== null && sha256 !== undefined) {
        if (!SHA256_PATTERN.test(sha256))
          fail(`served object ${pathname} has an invalid hash`);
        const existing = entries.get(pathname);
        if (existing && existing.sha256 !== sha256)
          fail(`served object ${pathname} has conflicting hashes`);
        entries.set(pathname, {
          pathname,
          sha256,
          url: objectUrl(origin, pathname, sha256),
        });
      }
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  if (!tileset?.root) fail("served tileset has no root");
  visit(tileset.root);
  return [...entries.values()].sort((a, b) =>
    a.pathname.localeCompare(b.pathname),
  );
}

export function collectApprovedBackgroundEntries({
  pois,
  readExtractionManifest,
  origin,
}) {
  if (!Array.isArray(pois)) fail("active POI catalogue is not an array");
  const entries = new Map();
  for (const poi of pois) {
    if (
      !poi ||
      typeof poi.id !== "string" ||
      typeof poi.data !== "string" ||
      !poi.tiles ||
      typeof poi.tiles !== "object"
    )
      fail("active POI record is malformed");
    if (!/^poi-tiles\/[a-z0-9]+(?:-[a-z0-9]+)*\/tileset\.json$/u.test(poi.data))
      fail(`${poi.id} has an unsafe POI data path`);
    const extraction = readExtractionManifest(poi);
    const bySource = new Map(
      (extraction?.tiles ?? []).map((tile) => [tile.sourceTile, tile]),
    );
    for (const sourceTile of Object.keys(poi.tiles)) {
      const evidence = bySource.get(sourceTile);
      if (!evidence)
        fail(`${poi.id} has no extraction evidence for ${sourceTile}`);
      const objectKey =
        evidence.backgroundFile ??
        sourceTile.replace(/^tiles\//u, "optimized-tiles/");
      const pathname = normalizedObjectPath(
        objectKey,
        `${poi.id} background object`,
      );
      const sha256 = evidence.backgroundSha256;
      if (!SHA256_PATTERN.test(sha256 ?? ""))
        fail(`${poi.id} background object ${pathname} has an invalid hash`);
      const existing = entries.get(pathname);
      if (existing && existing.sha256 !== sha256)
        fail(`approved object ${pathname} has conflicting hashes`);
      entries.set(pathname, {
        pathname,
        sha256,
        url: objectUrl(origin, pathname, sha256),
      });
    }
  }
  return [...entries.values()].sort((a, b) =>
    a.pathname.localeCompare(b.pathname),
  );
}

export function reconcileReleaseEntries({
  servedEntries,
  approvedEntries,
  expectedCount,
}) {
  if (approvedEntries.length !== expectedCount)
    fail(
      `approved object count mismatch: expected ${expectedCount}, received ${approvedEntries.length}`,
    );
  const approved = new Map(
    approvedEntries.map((entry) => [entry.pathname, entry]),
  );
  for (const served of servedEntries) {
    const expected = approved.get(served.pathname);
    if (!expected)
      fail(`served versioned object is not active: ${served.pathname}`);
    if (expected.sha256 !== served.sha256)
      fail(`served object hash differs from approval: ${served.pathname}`);
  }
  return approvedEntries;
}
