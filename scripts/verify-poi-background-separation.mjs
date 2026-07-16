#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APPROVED_POIS } from '../data/approved-pois.js';

const argument = (name, fallback = null) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; };
const root = path.resolve(argument('root', '.'));
const registryPath = argument('registry');
const pristineRoot = path.resolve(argument('source-cache', path.join('public', 'poi-tiles', 'source')));

const onlyIdsArg = process.argv.indexOf('--ids');
const onlyIds = onlyIdsArg >= 0 ? new Set((process.argv[onlyIdsArg + 1] || '').split(',').filter(Boolean)) : null;
const configuredPois = registryPath ? JSON.parse(fs.readFileSync(path.resolve(registryPath), 'utf8')).records : APPROVED_POIS;
if (!Array.isArray(configuredPois)) throw new Error('--registry must contain { "records": [...] }');
const pois = onlyIds ? configuredPois.filter((poi) => onlyIds.has(poi.id)) : configuredPois;
if (onlyIds && pois.length !== onlyIds.size) throw new Error('One or more --ids values are not present in APPROVED_POIS');

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sorted = (values) => [...values].sort();
const sameValues = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const sourcePath = (sourceTile) => path.join(pristineRoot, sourceTile.replace(/^(tiles|optimized-tiles)\//, ''));
const backgroundPath = (sourceTile) => path.join(root, sourceTile.replace(/^tiles\//, 'optimized-tiles/'));

function batchTable(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.toString('utf8', 0, 4) !== 'b3dm') throw new Error(`${filePath} is not a b3dm tile`);
  const featureJsonLength = bytes.readUInt32LE(12);
  const featureBinaryLength = bytes.readUInt32LE(16);
  const batchJsonLength = bytes.readUInt32LE(20);
  const start = 28 + featureJsonLength + featureBinaryLength;
  return JSON.parse(bytes.subarray(start, start + batchJsonLength).toString('utf8').trim());
}

const failures = [];
let inspected = 0;
for (const poi of pois) {
  const outputDir = path.join(root, 'public', 'poi-tiles', poi.id);
  const manifestPath = path.join(outputDir, 'extraction-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    failures.push(`${poi.id}: missing extraction manifest ${manifestPath}`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.poiId !== poi.id || !Array.isArray(manifest.tiles) || !manifest.tiles.length) {
    failures.push(`${poi.id}: invalid or empty extraction manifest`);
    continue;
  }
  for (const entry of manifest.tiles) {
    const pristine = sourcePath(entry.sourceTile);
    const background = backgroundPath(entry.sourceTile);
    const poiTile = path.join(outputDir, entry.poiFile);
    for (const [kind, file] of [['pristine source', pristine], ['background', background], ['POI', poiTile]]) {
      if (!fs.existsSync(file)) failures.push(`${poi.id}: missing ${kind} tile ${file}`);
    }
    if (![pristine, background, poiTile].every((file) => fs.existsSync(file))) continue;
    if (sha256(pristine) !== entry.sourceSha256) failures.push(`${poi.id}: pristine source hash changed for ${entry.sourceTile}`);
    if (sha256(poiTile) !== entry.poiSha256) failures.push(`${poi.id}: POI output hash changed for ${entry.sourceTile}`);
    if (sha256(background) !== entry.backgroundSha256) failures.push(`${poi.id}: background output hash changed for ${entry.sourceTile}`);
    if (!(entry.poiTriangles > 0)) failures.push(`${poi.id}: non-positive POI geometry count for ${entry.sourceTile}`);

    const sourceTable = batchTable(pristine);
    const poiIds = batchTable(poiTile)['gml:id'] || [];
    const backgroundIds = batchTable(background)['gml:id'] || [];
    const selectedIds = entry.originalBatchIds.map((batchId) => sourceTable['gml:id']?.[batchId]);
    if (selectedIds.some((id) => !id) || !sameValues(selectedIds, entry.gmlIds)) failures.push(`${poi.id}: manifest identity does not match pristine batch selection for ${entry.sourceTile}`);
    if (!sameValues(poiIds, selectedIds)) failures.push(`${poi.id}: POI tile identity set differs from selected pristine batches for ${entry.sourceTile}`);
    if (selectedIds.some((id) => backgroundIds.includes(id))) failures.push(`${poi.id}: selected GML identity remains in background ${background}`);
    const sourceIds = sourceTable['gml:id'] || [];
    const removedIds = entry.backgroundRemovedGmlIds || [];
    const expectedBackgroundIds = sourceIds.filter((id) => !removedIds.includes(id));
    if (expectedBackgroundIds.length > 0 && !(entry.backgroundTriangles > 0)) failures.push(`${poi.id}: unrelated identities have no background geometry for ${entry.sourceTile}`);
    if (expectedBackgroundIds.length === 0 && entry.backgroundTriangles !== 0) failures.push(`${poi.id}: fully selected source tile reports unexpected background geometry for ${entry.sourceTile}`);
    if (!sameValues(backgroundIds, expectedBackgroundIds)) failures.push(`${poi.id}: unrelated source identities were lost or unexpected identities remain in ${background}`);
    inspected += 1;
  }
}

if (failures.length) {
  console.error(`POI/background identity separation failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`POI/background identity separation passed for ${pois.length} POIs across ${inspected} tiles.`);
}
