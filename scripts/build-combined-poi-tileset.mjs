#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadApprovedSnapshot } from "./lib/approved-snapshot.mjs";
import {
  buildSpatialHighlightTileset,
  validateSpatialHighlightTileset,
} from "./lib/spatial-highlight-tileset.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function defaultSpatialHierarchyPath() {
  const optimized = path.join(ROOT, "optimized-tiles", "tileset.json");
  return fs.existsSync(optimized)
    ? optimized
    : path.join(ROOT, "tiles", "tileset.json");
}

function collectLegacyPoiIds(tile, ids = []) {
  if (tile?.extras?.poiId) ids.push(tile.extras.poiId);
  for (const child of tile?.children ?? []) collectLegacyPoiIds(child, ids);
  return ids;
}

export function validatePoiTilesetParity(
  pois,
  tileset,
  context = "Combined POI tileset",
) {
  if (tileset?.extras?.schemaVersion === "spatial-highlight-v1")
    return validateSpatialHighlightTileset(pois, tileset);
  if (!Array.isArray(pois)) throw new TypeError("POIs must be an array");
  const expectedIds = pois.map(({ id }) => id);
  const actualIds = collectLegacyPoiIds(tileset?.root);
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  const duplicateExpected = expectedIds.filter(
    (id, index) => expectedIds.indexOf(id) !== index,
  );
  const duplicateActual = actualIds.filter(
    (id, index) => actualIds.indexOf(id) !== index,
  );
  const missing = expectedIds.filter((id) => !actual.has(id));
  const extra = actualIds.filter((id) => !expected.has(id));
  const declaredCount = tileset?.extras?.venueCount;
  const declaredIds = tileset?.extras?.venueIds;
  const declaredIdSet = new Set(declaredIds ?? []);
  const declaredMismatch =
    !Array.isArray(declaredIds) ||
    declaredIds.length !== expectedIds.length ||
    expectedIds.some((id) => !declaredIdSet.has(id));

  if (
    expectedIds.some((id) => typeof id !== "string" || !id) ||
    actualIds.some((id) => typeof id !== "string" || !id) ||
    duplicateExpected.length ||
    duplicateActual.length ||
    missing.length ||
    extra.length ||
    actualIds.length !== expectedIds.length ||
    declaredCount !== expectedIds.length ||
    declaredMismatch
  )
    throw new Error(
      `${context} does not match the active POI catalogue ` +
        `(expected ${expectedIds.length}, actual ${actualIds.length}, ` +
        `missing: ${missing.join(", ") || "none"}, ` +
        `extra: ${extra.join(", ") || "none"})`,
    );
  return tileset;
}

function readJson(filePath, context) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function publishAtomically(outputPath, serialized) {
  const current = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf8")
    : null;
  if (current === serialized) return "noop";
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, serialized);
    fs.renameSync(temporaryPath, outputPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return current === null ? "create" : "update";
}

export function buildCombinedPoiTileset({
  pois,
  outputPath,
  sourceTilesetPath = defaultSpatialHierarchyPath(),
  resolveContentUri = (poi, fragment) => `../${poi.id}/${fragment.poiFile}`,
  resolveTilesetPath = (poi) => path.join(ROOT, "public", poi.data),
}) {
  if (!Array.isArray(pois)) throw new TypeError("POIs must be an array");
  const sourceTileset = readJson(
    sourceTilesetPath,
    `Unable to read source spatial hierarchy ${sourceTilesetPath}`,
  );
  const venues = pois.map((poi) => {
    const tilesetPath = resolveTilesetPath(poi);
    if (!fs.existsSync(tilesetPath))
      throw new Error(`${poi.id}: missing POI tileset ${tilesetPath}`);
    const manifestPath = path.join(
      path.dirname(tilesetPath),
      "extraction-manifest.json",
    );
    const manifest = readJson(
      manifestPath,
      `${poi.id}: unable to read extraction manifest ${manifestPath}`,
    );
    if (manifest.poiId !== poi.id)
      throw new Error(
        `${poi.id}: extraction manifest belongs to ${manifest.poiId ?? "(missing)"}`,
      );
    if (!Array.isArray(manifest.tiles) || manifest.tiles.length === 0)
      throw new Error(`${poi.id}: extraction manifest contains no fragments`);
    for (const fragment of manifest.tiles) {
      const assetPath = path.join(path.dirname(manifestPath), fragment.poiFile);
      if (!fs.existsSync(assetPath))
        throw new Error(
          `${poi.id}: missing highlight fragment ${fragment.poiFile}`,
        );
    }
    return {
      poi,
      fragments: manifest.tiles,
      resolveContentUri: ({ fragment, source }) =>
        resolveContentUri(poi, fragment, {
          manifestPath,
          outputPath,
          source,
        }),
    };
  });
  const tileset = buildSpatialHighlightTileset({ sourceTileset, venues });
  validatePoiTilesetParity(pois, tileset);
  const serialized = `${JSON.stringify(tileset)}\n`;
  const writeOperation = publishAtomically(outputPath, serialized);
  Object.defineProperty(tileset, "writeOperation", {
    value: writeOperation,
    enumerable: false,
  });
  return tileset;
}

export function loadActivePoiCatalogue(root = ROOT) {
  const active = loadApprovedSnapshot({ root });
  const pois = readJson(
    path.join(active.directory, active.poisRef),
    `Unable to read ${active.snapshotId} POIs`,
  );
  const tileset = readJson(
    path.join(active.directory, active.tilesetRef),
    `Unable to read ${active.snapshotId} tileset`,
  );
  validatePoiTilesetParity(
    pois,
    tileset,
    `Active snapshot ${active.snapshotId} POI tileset`,
  );
  return { active, pois };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = path.resolve(
    outputIndex >= 0
      ? process.argv[outputIndex + 1]
      : path.join(ROOT, "public/poi-tiles/event-venues/tileset.json"),
  );
  const { active, pois } = loadActivePoiCatalogue();
  const tileset = buildCombinedPoiTileset({ pois, outputPath });
  console.log(
    `${tileset.writeOperation}: spatial-highlight-v1 for ` +
      `${tileset.extras.venueCount} venues, ${tileset.extras.fragmentCount} ` +
      `finest fragments from ${tileset.extras.sourceFragmentCount} validated ` +
      `source fragments, ${tileset.extras.venueBranchCount} venue branches, ` +
      `${tileset.extras.spatialNodeCount} spatial nodes, and ` +
      `${tileset.extras.externalTilesetCount} external venue manifests from ` +
      `${active.snapshotId}.`,
  );
}
