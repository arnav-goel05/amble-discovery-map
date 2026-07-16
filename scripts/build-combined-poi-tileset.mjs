#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_POIS } from "../data/approved-pois.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function combinedRegion(regions) {
  if (!regions.length) return [0, 0, 0, 0, 0, 0];
  return [
    Math.min(...regions.map((region) => region[0])),
    Math.min(...regions.map((region) => region[1])),
    Math.max(...regions.map((region) => region[2])),
    Math.max(...regions.map((region) => region[3])),
    Math.min(...regions.map((region) => region[4])),
    Math.max(...regions.map((region) => region[5])),
  ];
}

export function buildCombinedPoiTileset({
  pois,
  outputPath,
  resolveContentUri = (poi) => `../${poi.id}/tileset.json`,
  resolveTilesetPath = (poi) => path.join(ROOT, "public", poi.data),
}) {
  const children = pois.map((poi) => {
    const sourcePath = resolveTilesetPath(poi);
    if (!fs.existsSync(sourcePath)) throw new Error(`${poi.id}: missing POI tileset ${sourcePath}`);
    const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    const region = source.root?.boundingVolume?.region;
    if (!Array.isArray(region) || region.length !== 6 || !region.every(Number.isFinite)) {
      throw new Error(`${poi.id}: root bounding volume must be a six-number region`);
    }
    return {
      boundingVolume: { region },
      geometricError: Number(source.root.geometricError || 0),
      refine: source.root.refine || "REPLACE",
      content: { uri: resolveContentUri(poi) },
      extras: { poiId: poi.id, label: poi.label },
    };
  });
  const regions = children.map((child) => child.boundingVolume.region);
  const tileset = {
    asset: { version: "1.0", generator: "whats-here-combined-event-venues" },
    geometricError: Math.max(0, ...children.map((child) => child.geometricError)),
    root: {
      boundingVolume: { region: combinedRegion(regions) },
      geometricError: Math.max(0, ...children.map((child) => child.geometricError)),
      refine: "REPLACE",
      children,
    },
    extras: { venueCount: children.length, venueIds: pois.map((poi) => poi.id) },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(tileset, null, 2)}\n`);
  return tileset;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : path.join(ROOT, "public/poi-tiles/event-venues/tileset.json"));
  const tileset = buildCombinedPoiTileset({ pois: APPROVED_POIS, outputPath });
  console.log(`Combined ${tileset.extras.venueCount} POI tilesets into ${path.relative(ROOT, outputPath)}.`);
}
