#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const parseOsm = require('osm-pbf-parser');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]?.startsWith('--') ? true : all[index + 1]]] : pairs, []));
const output = path.resolve(ROOT, args.output || 'outputs/local-venue-index/venues.sqlite');
const oneMapDirs = String(args.onemap || 'tiles,public/poi-tiles').split(',').map((dir) => path.resolve(ROOT, dir.trim())).filter(Boolean);
const osmPbf = args.osm ? path.resolve(ROOT, args.osm) : null;
const SG = { minLat: 1.13, maxLat: 1.48, minLng: 103.60, maxLng: 104.10 };

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function files(dir, outputFiles = []) {
  if (!fs.existsSync(dir)) return outputFiles;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files(target, outputFiles);
    else if (entry.name.endsWith('.b3dm')) outputFiles.push(target);
  }
  return outputFiles;
}

function batchTable(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(28);
    fs.readSync(fd, header, 0, 28, 0);
    if (header.toString('utf8', 0, 4) !== 'b3dm') return null;
    const featureJson = header.readUInt32LE(12);
    const featureBinary = header.readUInt32LE(16);
    const batchJsonLength = header.readUInt32LE(20);
    if (!batchJsonLength) return null;
    const buffer = Buffer.alloc(batchJsonLength);
    fs.readSync(fd, buffer, 0, batchJsonLength, 28 + featureJson + featureBinary);
    return JSON.parse(buffer.toString('utf8').trim());
  } finally { fs.closeSync(fd); }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.rmSync(output, { force: true });
const db = new Database(output);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE places (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
    name TEXT NOT NULL, normalized_name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '',
    address TEXT, postal_code TEXT, latitude REAL NOT NULL, longitude REAL NOT NULL,
    kind TEXT, gml_id TEXT, tile_path TEXT, batch_id INTEGER, tags_json TEXT
  );
  CREATE VIRTUAL TABLE place_fts USING fts5(name, normalized_name, aliases, address, content='places', content_rowid='id');
  CREATE VIRTUAL TABLE place_spatial USING rtree(id, min_lng, max_lng, min_lat, max_lat);
  CREATE TABLE osm_footprints (id INTEGER PRIMARY KEY, osm_id TEXT NOT NULL, name TEXT, address TEXT, postal_code TEXT, centroid_lat REAL NOT NULL, centroid_lng REAL NOT NULL, coordinates_json TEXT NOT NULL, tags_json TEXT NOT NULL);
  CREATE VIRTUAL TABLE footprint_spatial USING rtree(id, min_lng, max_lng, min_lat, max_lat);
  CREATE INDEX places_source_id ON places(source, source_id);
  CREATE INDEX places_postal_code ON places(postal_code);
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const insert = db.prepare(`INSERT INTO places(source,source_id,name,normalized_name,aliases,address,postal_code,latitude,longitude,kind,gml_id,tile_path,batch_id,tags_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertFts = db.prepare('INSERT INTO place_fts(rowid,name,normalized_name,aliases,address) VALUES(?,?,?,?,?)');
const insertSpatial = db.prepare('INSERT INTO place_spatial(id,min_lng,max_lng,min_lat,max_lat) VALUES(?,?,?,?,?)');
const insertFootprint = db.prepare('INSERT INTO osm_footprints(osm_id,name,address,postal_code,centroid_lat,centroid_lng,coordinates_json,tags_json) VALUES(?,?,?,?,?,?,?,?)');
const insertFootprintSpatial = db.prepare('INSERT INTO footprint_spatial(id,min_lng,max_lng,min_lat,max_lat) VALUES(?,?,?,?,?)');
const add = (row) => {
  if (!row.name || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return;
  const result = insert.run(row.source, row.sourceId, row.name, normalize(row.name), row.aliases || '', row.address || null, row.postalCode || null, row.latitude, row.longitude, row.kind || null, row.gmlId || null, row.tilePath || null, row.batchId ?? null, JSON.stringify(row.tags || {}));
  insertFts.run(result.lastInsertRowid, row.name, normalize(row.name), row.aliases || '', row.address || '');
  insertSpatial.run(result.lastInsertRowid, row.longitude, row.longitude, row.latitude, row.latitude);
};

let oneMapCount = 0;
const insertOneMap = db.transaction((tileFiles) => {
  for (let index = 0; index < tileFiles.length; index += 1) {
    let table;
    try { table = batchTable(tileFiles[index]); } catch { continue; }
    if (!table) continue;
    const names = table['gml:name'] || [];
    const ids = table['gml:id'] || [];
    const latitudes = table.Latitude || table.latitude || [];
    const longitudes = table.Longitude || table.longitude || [];
    for (let batchId = 0; batchId < names.length; batchId += 1) {
      const latitude = Number(latitudes[batchId]);
      const longitude = Number(longitudes[batchId]);
      if (!names[batchId] || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      add({ source: 'onemap-3d', sourceId: ids[batchId] || `${path.relative(ROOT, tileFiles[index])}:${batchId}`, name: names[batchId], latitude, longitude, kind: 'building', gmlId: ids[batchId] || null, tilePath: path.relative(ROOT, tileFiles[index]), batchId });
      oneMapCount += 1;
    }
    if ((index + 1) % 1000 === 0) console.log(`OneMap ${index + 1}/${tileFiles.length}`);
  }
});
const tileFiles = [...new Set(oneMapDirs.flatMap((dir) => files(dir)))];
insertOneMap(tileFiles);

let osmCount = 0;
if (osmPbf) {
  const nodes = new Map();
  const relevant = (tags = {}) => tags.name || tags['addr:housenumber'] || tags['addr:postcode'] || tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.office || tags.craft || tags.club;
  const aliases = (tags) => [tags.alt_name, tags.short_name, tags.old_name, tags['name:en'], tags.brand].filter(Boolean).join(' | ');
  const osmAddress = (tags) => [tags['addr:housenumber'],tags['addr:street']].filter(Boolean).join(' ');
  const osmName = (tags) => tags.name || osmAddress(tags) || tags['addr:postcode'] || '';
  const addOsm = db.transaction((rows) => rows.forEach(add));
  const addFootprints = db.transaction((footprints) => {
    for (const footprint of footprints) {
      const lngs=footprint.coordinates.map((pair)=>pair[1]), lats=footprint.coordinates.map((pair)=>pair[0]);
      const result=insertFootprint.run(footprint.osmId,footprint.name||null,footprint.address||null,footprint.postalCode||null,footprint.coordinates.reduce((sum,pair)=>sum+pair[0],0)/footprint.coordinates.length,footprint.coordinates.reduce((sum,pair)=>sum+pair[1],0)/footprint.coordinates.length,JSON.stringify(footprint.coordinates),JSON.stringify(footprint.tags));
      insertFootprintSpatial.run(result.lastInsertRowid,Math.min(...lngs),Math.max(...lngs),Math.min(...lats),Math.max(...lats));
    }
  });
  await new Promise((resolvePromise, reject) => {
    const parser = parseOsm();
    fs.createReadStream(osmPbf).pipe(parser);
    parser.on('data', (items) => {
      const rows = [];
      const footprints=[];
      for (const item of items) {
        if (item.type === 'node' && item.lat >= SG.minLat && item.lat <= SG.maxLat && item.lon >= SG.minLng && item.lon <= SG.maxLng) {
          nodes.set(item.id, [item.lat, item.lon]);
          if (relevant(item.tags) && osmName(item.tags)) rows.push({ source: 'osm', sourceId: `node/${item.id}`, name: osmName(item.tags), aliases: aliases(item.tags), address: osmAddress(item.tags), postalCode: item.tags['addr:postcode'], latitude: item.lat, longitude: item.lon, kind: item.tags.amenity || item.tags.shop || item.tags.tourism || item.tags.leisure || item.tags.building || 'address', tags: item.tags });
        } else if (item.type === 'way') {
          const coordinates = item.refs.map((id) => nodes.get(id)).filter(Boolean);
          if (coordinates.length && relevant(item.tags) && osmName(item.tags)) rows.push({ source: 'osm', sourceId: `way/${item.id}`, name: osmName(item.tags), aliases: aliases(item.tags), address: osmAddress(item.tags), postalCode: item.tags['addr:postcode'], latitude: coordinates.reduce((sum, pair) => sum + pair[0], 0) / coordinates.length, longitude: coordinates.reduce((sum, pair) => sum + pair[1], 0) / coordinates.length, kind: item.tags.amenity || item.tags.shop || item.tags.tourism || item.tags.leisure || item.tags.building || 'address', tags: item.tags });
          if(coordinates.length>=3 && (item.tags.building || item.tags['building:part'] || item.tags['addr:housenumber'])) footprints.push({osmId:`way/${item.id}`,name:item.tags.name,address:osmAddress(item.tags),postalCode:item.tags['addr:postcode'],coordinates,tags:item.tags});
        }
      }
      if (rows.length) { addOsm(rows); osmCount += rows.length; }
      if(footprints.length) addFootprints(footprints);
    });
    parser.on('end', resolvePromise);
    parser.on('error', reject);
  });
}
db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('built_at', new Date().toISOString());
db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('onemap_rows', String(oneMapCount));
db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('osm_rows', String(osmCount));
db.pragma('optimize');
db.close();
console.log(JSON.stringify({ output: path.relative(ROOT, output), oneMapFiles: tileFiles.length, oneMapRows: oneMapCount, osmRows: osmCount }, null, 2));
