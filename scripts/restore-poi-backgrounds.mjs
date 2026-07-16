#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APPROVED_POIS } from '../data/approved-pois.js';

const sourceRoot = path.join('public', 'poi-tiles', 'source');
const tilesetRoot = 'https://www.onemap.gov.sg/omapi/tilesets/sg_noterrain_tiles/';
const headers = { Referer: 'https://www.onemap.gov.sg/3d', Origin: 'https://www.onemap.gov.sg', 'User-Agent': 'Mozilla/5.0' };
const legacyExtractedTilesByPoi = new Map([
  ['esplanade', Array.from({ length: 6 }, (_, index) => `7/78/12_${index}.b3dm`)],
]);

function previousPois() {
  if (APPROVED_POIS.length) return APPROVED_POIS;
  try {
    const source = execFileSync('git', ['show', 'HEAD:data/approved-pois.js'], { encoding: 'utf8' });
    return Function(source.replace('export const APPROVED_POIS =', 'return '))();
  } catch {
    return [];
  }
}

export function restorationTiles(pois, poiIds = []) {
  const files = pois.flatMap((poi) => Object.keys(poi.tiles || {}));
  for (const id of poiIds) files.push(...(legacyExtractedTilesByPoi.get(id) || []));
  return [...new Set(files.map((tile) => tile.replace(/^(tiles|optimized-tiles)\//, '')))];
}

export async function restorePoiBackgrounds({ pois, poiIds = [], outputRoot = '.' }) {
  const sourceTiles = restorationTiles(pois, poiIds);
  let restored = 0;
  let downloaded = 0;
  for (const file of sourceTiles) {
    const source = path.join(sourceRoot, file);
    if (!fs.existsSync(source)) {
      const response = await fetch(new URL(file, tilesetRoot), { headers });
      if (!response.ok) throw new Error(`Failed ${response.status} while restoring ${file}`);
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, Buffer.from(await response.arrayBuffer()));
      downloaded += 1;
    }
    const destination = path.join(outputRoot, 'optimized-tiles', file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    restored += 1;
  }
  return { restored, downloaded, sourceTiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pois = previousPois();
  const result = await restorePoiBackgrounds({ pois, poiIds: [...legacyExtractedTilesByPoi.keys()] });
  console.log(`Restored ${result.restored} pristine background tiles (${result.downloaded} downloaded).`);
}
