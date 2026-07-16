#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVED_POIS } from '../data/approved-pois.js';
import { restorePoiBackgrounds } from './restore-poi-backgrounds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleText = (name) => `export const ${name} = [];\n`;

export async function clearPipelineEventData({ root = ROOT, pois = APPROVED_POIS, restore = true } = {}) {
  const managed = [...new Set((pois ?? []).map((poi) => poi?.id).filter(Boolean))];
  const restoration = restore
    ? await restorePoiBackgrounds({ pois, outputRoot: root })
    : { restored: 0, downloaded: 0, sourceTiles: [] };
  for (const id of managed) fs.rmSync(path.join(root, 'public/poi-tiles', id), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'public/poi-tiles/event-venues'), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'outputs/data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/approved-pois.js'), moduleText('APPROVED_POIS'));
  fs.writeFileSync(path.join(root, 'data/approved-landmarks.js'), moduleText('APPROVED_LANDMARKS'));
  fs.writeFileSync(path.join(root, 'outputs/data/events.json'), '[]\n');
  return { removedPoiIds: managed, ...restoration };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await clearPipelineEventData();
  console.log(JSON.stringify(result, null, 2));
}
