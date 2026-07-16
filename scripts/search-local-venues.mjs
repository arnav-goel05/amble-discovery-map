#!/usr/bin/env node

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = (name, fallback = null) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; };
const query = value('query');
if (!query) throw new Error('Usage: node scripts/search-local-venues.mjs --query "Venue" [--lat n --lng n --radius 250]');
const db = new Database(path.resolve(ROOT, value('db', 'outputs/local-venue-index/venues.sqlite')), { readonly: true });
const normalize = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = normalize(query).split(/\s+/).filter(Boolean);
const fts = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' OR ');
const latValue = value('lat');
const lngValue = value('lng');
const lat = latValue === null ? Number.NaN : Number(latValue);
const lng = lngValue === null ? Number.NaN : Number(lngValue);
const radius = Number(value('radius', '250'));
let rows;
if (Number.isFinite(lat) && Number.isFinite(lng)) {
  const latDelta = radius / 111320;
  const lngDelta = radius / (111320 * Math.cos(lat * Math.PI / 180));
  rows = db.prepare(`SELECT p.* FROM place_spatial s JOIN places p ON p.id=s.id WHERE s.min_lat BETWEEN ? AND ? AND s.min_lng BETWEEN ? AND ? LIMIT 200`).all(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta);
} else {
  rows = db.prepare(`SELECT p.*, bm25(place_fts) AS text_rank FROM place_fts JOIN places p ON p.id=place_fts.rowid WHERE place_fts MATCH ? ORDER BY text_rank LIMIT 50`).all(fts);
}
const distance = (row) => Number.isFinite(lat) && Number.isFinite(lng) ? 6371000 * 2 * Math.asin(Math.sqrt(Math.sin((row.latitude-lat)*Math.PI/360)**2 + Math.cos(lat*Math.PI/180)*Math.cos(row.latitude*Math.PI/180)*Math.sin((row.longitude-lng)*Math.PI/360)**2)) : null;
const scored = rows.map((row) => ({ ...row, distanceMeters: distance(row), exactName: normalize(row.name) === normalize(query) })).sort((a,b) => Number(b.exactName)-Number(a.exactName) || (a.distanceMeters ?? Infinity)-(b.distanceMeters ?? Infinity) || (a.text_rank ?? 0)-(b.text_rank ?? 0)).slice(0, 20);
console.log(JSON.stringify({ query, count: scored.length, results: scored }, null, 2));
db.close();
