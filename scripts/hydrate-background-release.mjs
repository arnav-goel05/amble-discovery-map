#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import release from "../data/background-geometry-release.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "optimized-tiles");
const origin = new URL(
  process.env.BACKGROUND_TILE_ORIGIN ?? "https://amblefinds.com",
);
const concurrency = Number(process.env.BACKGROUND_TILE_CONCURRENCY ?? "12");

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  throw new Error(
    "BACKGROUND_TILE_CONCURRENCY must be an integer from 1 to 32",
  );
}

function releaseUrl(relativeUrl) {
  return new URL(relativeUrl, origin);
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  if (response.headers.get("x-amble-tile-source") !== "r2") {
    throw new Error(`Release object was not served by R2: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function contentEntries(tileset) {
  const entries = [];
  const visit = (tile) => {
    const rawUri = tile?.content?.uri ?? tile?.content?.url;
    if (typeof rawUri === "string") {
      const parsed = new URL(rawUri, "https://tiles.invalid/optimized-tiles/");
      const pathname = decodeURIComponent(parsed.pathname)
        .replace(/^\/+/u, "")
        .replace(/^optimized-tiles\//u, "");
      if (
        !pathname ||
        pathname.includes("..") ||
        path.isAbsolute(pathname) ||
        !pathname.endsWith(".b3dm")
      ) {
        throw new Error(`Unsafe background release content URI: ${rawUri}`);
      }
      const sha256 = parsed.searchParams.get("backgroundObject");
      if (sha256 && !/^[a-f0-9]{64}$/u.test(sha256)) {
        throw new Error(
          `Unversioned background release content URI: ${rawUri}`,
        );
      }
      if (sha256) {
        entries.push({
          pathname,
          sha256,
          url: releaseUrl(
            `optimized-tiles/${pathname}?backgroundObject=${sha256}`,
          ),
        });
      }
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(tileset.root);
  return [...new Map(entries.map((entry) => [entry.pathname, entry])).values()];
}

async function sourceFragmentPaths() {
  const poiRoot = path.join(root, "public/poi-tiles");
  const directories = await readdir(poiRoot, { withFileTypes: true });
  const fragments = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.sourceTile === "string") {
      const pathname = value.sourceTile
        .replace(/^tiles\//u, "")
        .replace(/^optimized-tiles\//u, "");
      if (
        !pathname ||
        pathname.includes("..") ||
        path.isAbsolute(pathname) ||
        !pathname.endsWith(".b3dm")
      ) {
        throw new Error(
          `Unsafe extraction-manifest source tile: ${value.sourceTile}`,
        );
      }
      fragments.add(pathname);
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const manifestPath = path.join(
      poiRoot,
      directory.name,
      "extraction-manifest.json",
    );
    try {
      visit(JSON.parse(await readFile(manifestPath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return [...fragments].sort();
}

async function persist(basePath, relativePath, bytes) {
  const destination = path.join(basePath, relativePath);
  if (!destination.startsWith(`${basePath}${path.sep}`)) {
    throw new Error(`Unsafe release output path: ${relativePath}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.hydrate-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
}

function localTileset(tileset) {
  const copy = structuredClone(tileset);
  const visit = (tile) => {
    for (const field of ["uri", "url"]) {
      const rawUri = tile?.content?.[field];
      if (typeof rawUri === "string") {
        tile.content[field] = rawUri.split("?")[0];
      }
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(copy.root);
  return copy;
}

async function hydratePoiFragments() {
  const poiRoot = path.join(root, "public/poi-tiles");
  const directories = await readdir(poiRoot, { withFileTypes: true });
  const entries = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const directoryPath = path.join(poiRoot, directory.name);
    let tileset;
    try {
      await readFile(path.join(directoryPath, "extraction-manifest.json"));
      tileset = JSON.parse(
        await readFile(path.join(directoryPath, "tileset.json"), "utf8"),
      );
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const visit = (tile) => {
      const rawUri = tile?.content?.uri ?? tile?.content?.url;
      if (typeof rawUri === "string") {
        const pathname = decodeURIComponent(rawUri.split("?")[0]);
        if (
          !pathname ||
          pathname.includes("..") ||
          path.isAbsolute(pathname) ||
          !pathname.endsWith(".b3dm")
        ) {
          throw new Error(
            `Unsafe POI release content URI for ${directory.name}: ${rawUri}`,
          );
        }
        entries.push({
          basePath: directoryPath,
          pathname,
          url: releaseUrl(`poi-tiles/${directory.name}/${pathname}`),
        });
      }
      for (const child of tile?.children ?? []) visit(child);
    };
    visit(tileset.root);
  }
  const unique = [
    ...new Map(
      entries.map((entry) => [`${entry.basePath}\0${entry.pathname}`, entry]),
    ).values(),
  ];
  await mapLimit(unique, async (entry) => {
    const existingPath = path.join(entry.basePath, entry.pathname);
    try {
      const existing = await readFile(existingPath);
      if (existing.toString("ascii", 0, 4) === "b3dm") return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const bytes = await fetchBytes(entry.url);
    if (bytes.toString("ascii", 0, 4) !== "b3dm") {
      throw new Error(`Invalid POI B3DM release object: ${entry.pathname}`);
    }
    await persist(entry.basePath, entry.pathname, bytes);
  });
  return unique.length;
}

async function mapLimit(items, operation) {
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await operation(item);
      completed += 1;
      if (completed % 100 === 0 || completed === items.length) {
        console.error(
          `Hydrated ${completed}/${items.length} background release objects.`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

const tilesetBytes = await fetchBytes(releaseUrl(release.tilesetUrl));
const tileset = JSON.parse(tilesetBytes.toString("utf8"));
const releaseEntries = contentEntries(tileset);

if (releaseEntries.length !== release.objectCount) {
  throw new Error(
    `Background release object count mismatch: expected ${release.objectCount}, received ${releaseEntries.length}`,
  );
}

const entriesByPath = new Map(
  releaseEntries.map((entry) => [entry.pathname, entry]),
);
for (const pathname of await sourceFragmentPaths()) {
  if (entriesByPath.has(pathname)) continue;
  entriesByPath.set(pathname, {
    pathname,
    sha256: null,
    url: releaseUrl(
      `optimized-tiles/${pathname}?backgroundRelease=${release.releaseId}`,
    ),
  });
}
const entries = [...entriesByPath.values()];

await mapLimit(entries, async (entry) => {
  const existingPath = path.join(outputRoot, entry.pathname);
  try {
    const existing = await readFile(existingPath);
    const existingHash = entry.sha256
      ? createHash("sha256").update(existing).digest("hex")
      : null;
    if (
      existing.toString("ascii", 0, 4) === "b3dm" &&
      (!entry.sha256 || existingHash === entry.sha256)
    ) {
      return;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const bytes = await fetchBytes(entry.url);
  if (bytes.toString("ascii", 0, 4) !== "b3dm") {
    throw new Error(`Invalid B3DM release object: ${entry.pathname}`);
  }
  if (entry.sha256) {
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== entry.sha256) {
      throw new Error(
        `Background release hash mismatch for ${entry.pathname}: expected ${entry.sha256}, received ${actualSha256}`,
      );
    }
  }
  await persist(outputRoot, entry.pathname, bytes);
});

const normalizedTilesetBytes = Buffer.from(
  `${JSON.stringify(localTileset(tileset), null, 2)}\n`,
);
await persist(outputRoot, "tileset.json", normalizedTilesetBytes);
const poiFragmentCount = await hydratePoiFragments();
console.log(
  `Hydrated immutable release ${release.releaseId} with ${releaseEntries.length} verified background objects, ${entries.length} required source fragments, and ${poiFragmentCount} POI fragments.`,
);
