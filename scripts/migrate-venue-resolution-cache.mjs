#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const legacyPath = join(root, 'data/venue-resolution-cache.json');
const runtimePath = join(root, 'outputs/event-pipeline/venue-resolution-cache.json');
const empty = { schemaVersion: '1.0', entries: [] };
const read = (file) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty;
const legacy = read(legacyPath);
const runtime = read(runtimePath);
if (legacy.schemaVersion !== '1.0' || !Array.isArray(legacy.entries) || runtime.schemaVersion !== '1.0' || !Array.isArray(runtime.entries)) {
  throw new Error('Venue resolution cache migration requires schemaVersion 1.0 entry arrays');
}
const byIdentity = new Map(runtime.entries.map((entry) => [`${entry.cacheKey}\0${entry.evidenceHash}`, entry]));
for (const entry of legacy.entries) byIdentity.set(`${entry.cacheKey}\0${entry.evidenceHash}`, entry);
mkdirSync(dirname(runtimePath), { recursive: true });
const temporary = `${runtimePath}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify({ schemaVersion: '1.0', entries: [...byIdentity.values()] }, null, 2)}\n`);
renameSync(temporary, runtimePath);
rmSync(legacyPath, { force: true });
process.stdout.write(`${JSON.stringify({ migrated: legacy.entries.length, runtimeEntries: byIdentity.size, runtimePath }, null, 2)}\n`);
