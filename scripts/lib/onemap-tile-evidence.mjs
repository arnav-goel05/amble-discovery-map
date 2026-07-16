import fs from 'node:fs';
import path from 'node:path';

function batchTable(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.toString('utf8', 0, 4) !== 'b3dm') throw new Error(`${filePath} is not a b3dm tile`);
  const featureJson = bytes.readUInt32LE(12);
  const featureBinary = bytes.readUInt32LE(16);
  const batchJsonLength = bytes.readUInt32LE(20);
  const start = 28 + featureJson + featureBinary;
  return JSON.parse(bytes.subarray(start, start + batchJsonLength).toString('utf8').trim());
}

export function pristineTilePath(root, tilePath) {
  const relative = String(tilePath).replace(/^(?:optimized-tiles|tiles)\//, '');
  const candidates = [
    path.join(root, 'public/poi-tiles/source', relative),
    path.join(root, tilePath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function validateOneMapTileEvidence(root, resolution) {
  const acceptedNames = new Set(resolution.acceptedGmlNames ?? []);
  const acceptedIds = new Set(resolution.gmlIds?.length ? resolution.gmlIds : [resolution.gmlId].filter(Boolean));
  const observedIds = new Set();
  for (const tile of resolution.sourceTiles ?? []) {
    const tilePath = tile.path ?? tile.tilePath;
    const source = pristineTilePath(root, tilePath);
    if (!fs.existsSync(source)) throw new Error(`Approved resolution source tile does not exist: ${tilePath}`);
    const table = batchTable(source);
    const names = table['gml:name'] ?? [];
    const identities = table['gml:id'] ?? [];
    for (const batchId of tile.batchIds ?? []) {
      if (!acceptedNames.has(names[batchId])) {
        throw new Error(`Approved resolution ${tilePath} batch ${batchId} is \"${names[batchId] ?? ''}\", not an accepted GML name`);
      }
      if (!acceptedIds.has(identities[batchId])) {
        throw new Error(`Approved resolution ${tilePath} batch ${batchId} has GML identity \"${identities[batchId] ?? ''}\", expected one of \"${[...acceptedIds].join(', ')}\"`);
      }
      observedIds.add(identities[batchId]);
    }
  }
  if ([...acceptedIds].some((gmlId) => !observedIds.has(gmlId))) throw new Error('Approved resolution source tiles do not cover every selected GML identity');
}
