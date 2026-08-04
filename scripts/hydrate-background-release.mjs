#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import release from "../data/background-geometry-release.json" with { type: "json" };
import {
  collectApprovedBackgroundEntries,
  collectTilesetReleaseEntries,
  reconcileReleaseEntries,
} from "./lib/background-release-hydration.mjs";
import { loadApprovedSnapshot } from "./lib/approved-snapshot.mjs";

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

async function hydratePoiFragments(pois) {
  const directories = new Map(
    pois.map((poi) => {
      const dataDirectory = path.dirname(poi.data);
      if (
        !dataDirectory.startsWith("poi-tiles/") ||
        dataDirectory.includes("..") ||
        path.isAbsolute(dataDirectory)
      )
        throw new Error(`Unsafe active POI data path for ${poi.id}`);
      return [dataDirectory, path.join(root, "public", dataDirectory)];
    }),
  );
  const entries = [];
  for (const [dataDirectory, directoryPath] of directories) {
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
            `Unsafe POI release content URI for ${dataDirectory}: ${rawUri}`,
          );
        }
        entries.push({
          basePath: directoryPath,
          pathname,
          url: releaseUrl(`${dataDirectory}/${pathname}`),
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
const tilesetSha256 = createHash("sha256").update(tilesetBytes).digest("hex");
if (tilesetSha256 !== release.manifestSha256)
  throw new Error(
    `Background release manifest hash mismatch: expected ${release.manifestSha256}, received ${tilesetSha256}`,
  );
const tileset = JSON.parse(tilesetBytes.toString("utf8"));
const active = loadApprovedSnapshot({ root });
if (active.snapshotId !== release.snapshotId) {
  throw new Error(
    `Background release snapshot mismatch: expected ${release.snapshotId}, received ${active.snapshotId}`,
  );
}
const pois = JSON.parse(
  await readFile(path.join(active.directory, active.poisRef), "utf8"),
);
const extractionManifests = new Map();
for (const poi of pois) {
  const manifestPath = path.join(
    root,
    "public",
    path.dirname(poi.data),
    "extraction-manifest.json",
  );
  extractionManifests.set(
    poi.id,
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
}
const approvedEntries = collectApprovedBackgroundEntries({
  pois,
  origin,
  readExtractionManifest: (poi) => extractionManifests.get(poi.id),
});
const releaseEntries = reconcileReleaseEntries({
  servedEntries: collectTilesetReleaseEntries({ tileset, origin }),
  approvedEntries,
  expectedCount: release.objectCount,
});
const entries = releaseEntries;

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
const poiFragmentCount = await hydratePoiFragments(pois);
console.log(
  `Hydrated immutable release ${release.releaseId} with ${releaseEntries.length} verified background objects, ${entries.length} required source fragments, and ${poiFragmentCount} POI fragments.`,
);
