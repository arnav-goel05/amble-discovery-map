#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { consolidateCoordinateCandidates, coordinateBuildingChoice, groupExactOneMapRows, preferPristineOneMapRows, selectAddressNamedBuilding } from './lib/venue-resolution-evidence.mjs';
import { preferAuthoritativeRecovery } from './lib/location-evidence.mjs';
import { computeVenueEvidenceHash } from './lib/event-pipeline/evidence-hash.mjs';
import { revalidateAdminApprovedCandidate } from './lib/admin-approved-resolution.mjs';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { AdminRepository } = require('./lib/admin-repository.cjs');
const { AdminService } = require('./lib/admin-service.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = (name, fallback = null) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; };
const runId = value('run');
if (!runId) throw new Error('Usage: node scripts/resolve-venues-locally.mjs --run <run-id>');
const onlyIds = new Set(String(value('ids', '')).split(',').filter(Boolean));
const includeUnresolved = process.argv.includes('--include-unresolved');
const outputRoot = process.env.EVENT_PIPELINE_OUTPUT_ROOT ? path.resolve(process.env.EVENT_PIPELINE_OUTPUT_ROOT) : path.join(ROOT, 'outputs/event-pipeline');
const runDir = path.join(outputRoot, runId);
const db = new Database(path.resolve(ROOT, value('db', 'outputs/local-venue-index/venues.sqlite')), { readonly: true });
const state = JSON.parse(fs.readFileSync(path.join(runDir, 'orchestrator-state.json'), 'utf8'));
const enrichmentPath=path.join(runDir,'normalized/location-enrichment.json');
const enrichmentByEvent=new Map((fs.existsSync(enrichmentPath)?JSON.parse(fs.readFileSync(enrichmentPath,'utf8')).records:[]).map((row)=>[row.eventId,row]));
const recoveryPath=path.join(runDir,'normalized/venue-recovery-evidence.json');
const recoveryByVenue=new Map((fs.existsSync(recoveryPath)?JSON.parse(fs.readFileSync(recoveryPath,'utf8')).records:[]).map((row)=>[row.venueId,row]));
const deterministicRecoveryPath=path.join(runDir,'normalized/deterministic-location-recovery.json');
const deterministicRecoveryByVenue=new Map((fs.existsSync(deterministicRecoveryPath)?JSON.parse(fs.readFileSync(deterministicRecoveryPath,'utf8')).records:[]).map((row)=>[row.venueId,row]));
const normalizedEvents=JSON.parse(fs.readFileSync(path.join(runDir,'normalized/events.json'),'utf8')).records??[];
const enrichmentRecords=[...enrichmentByEvent.values()];
const recoveryRecords=[...recoveryByVenue.values()];
const deterministicRecoveryRecords=[...deterministicRecoveryByVenue.values()];
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/venue-alias-registry.json'), 'utf8')).entries;
const aliasMap = new Map(aliases.filter((entry) => entry.status === 'approved').map((entry) => [normalize(entry.rawVenue), entry]));
const adminDatabasePath = process.env.ADMIN_DATABASE_PATH ? path.resolve(process.env.ADMIN_DATABASE_PATH)
  : process.env.EVENT_PIPELINE_OUTPUT_ROOT ? path.join(outputRoot, 'admin.sqlite') : path.join(ROOT, 'outputs/admin/admin.sqlite');
let adminProposals=[];
if(fs.existsSync(adminDatabasePath)){
  const repository=new AdminRepository({databasePath:adminDatabasePath});
  try{adminProposals=new AdminService({repository}).approvedMappingProposals();}finally{repository.close();}
}
const ignored = new Set(['the','at','and','of','in','on','near','level','room','studio','centre','center','theatre','theater','hall','singapore','sg','venue','venues']);

function cleanTilePath(tilePath) {
  return String(tilePath).replace(/^public\/poi-tiles\/source\//, 'tiles/');
}

const indexCounts = Object.fromEntries(db.prepare('SELECT source, count(*) AS count FROM places GROUP BY source').all().map((row) => [row.source, row.count]));
if (!(indexCounts['onemap-3d'] > 0)) throw new Error('Local venue index contains no OneMap 3D rows; run npm run venue-index:build before resolution');

function normalize(text = '') { return String(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function inSingapore({ latitude, longitude }) { return latitude >= 1.13 && latitude <= 1.49 && longitude >= 103.55 && longitude <= 104.15; }
function tokens(text) { return [...new Set(normalize(text).split(' ').filter((token) => token.length > 1 && !ignored.has(token) && !/^\d+$/.test(token)))]; }
function similarity(a, b) {
  const left = tokens(a), right = tokens(b);
  if (!left.length || !right.length) return 0;
  const overlap = left.filter((token) => right.includes(token)).length;
  const dice = 2 * overlap / (left.length + right.length);
  const na = normalize(a), nb = normalize(b);
  return Math.max(dice, na === nb ? 1 : 0, na.length > 3 && (na.includes(nb) || nb.includes(na)) ? Math.min(left.length, right.length) / Math.max(left.length, right.length) : 0);
}
function distance(aLat, aLng, bLat, bLng) {
  const rad = (v) => v * Math.PI / 180, dLat = rad(bLat-aLat), dLng = rad(bLng-aLng);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
function pointInPolygon(latitude,longitude,coordinates){
  let inside=false;
  for(let i=0,j=coordinates.length-1;i<coordinates.length;j=i++){
    const yi=coordinates[i][0],xi=coordinates[i][1],yj=coordinates[j][0],xj=coordinates[j][1];
    if(((yi>latitude)!==(yj>latitude)) && longitude < (xj-xi)*(latitude-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
function containingFootprint(place){
  const candidates=db.prepare(`SELECT f.* FROM footprint_spatial s JOIN osm_footprints f ON f.id=s.id WHERE s.min_lat<=? AND s.max_lat>=? AND s.min_lng<=? AND s.max_lng>=?`).all(place.latitude,place.latitude,place.longitude,place.longitude);
  return candidates.map((row)=>({...row,coordinates:JSON.parse(row.coordinates_json)})).filter((row)=>pointInPolygon(place.latitude,place.longitude,row.coordinates)).sort((a,b)=>{
    const area=(row)=>{const lats=row.coordinates.map((pair)=>pair[0]),lngs=row.coordinates.map((pair)=>pair[1]);return (Math.max(...lats)-Math.min(...lats))*(Math.max(...lngs)-Math.min(...lngs));};
    return area(a)-area(b);
  })[0]||null;
}
function textCandidates(venue, locationEvidence = {}) {
  const searchText=[venue,...(locationEvidence.addressCandidates||[])].join(' ');
  const queryTokens = tokens(searchText);
  if (!queryTokens.length) return [];
  const fts = queryTokens.map((token) => `"${token.replaceAll('"','""')}"*`).join(' OR ');
  const postal = locationEvidence.postalCodes?.[0] || normalize(searchText).match(/\b\d{6}\b/)?.[0];
  const rows = db.prepare(`SELECT p.* FROM place_fts f JOIN places p ON p.id=f.rowid WHERE place_fts MATCH ? AND p.source='osm' LIMIT 250`).all(fts);
  if (postal) rows.push(...db.prepare(`SELECT * FROM places WHERE source='osm' AND postal_code=?`).all(postal));
  for(const candidate of locationEvidence.addressCandidates||[]){
    const street=normalize(candidate).match(/\b\d+\s+[a-z]+(?:\s+(?:road|street|avenue|drive|lane|walk|east|west|north|south|place|crescent|close|link|way|boulevard|terrace))\b/)?.[0];
    if(street) rows.push(...db.prepare(`SELECT * FROM places WHERE source='osm' AND (normalized_name=? OR lower(address)=?)`).all(street,street));
  }
  return [...new Map(rows.map((row)=>[row.id,row])).values()]
    .map((row) => {const addressMatch=(locationEvidence.addressCandidates||[]).some((candidate)=>{const value=normalize(candidate),name=normalize(row.name),address=normalize(row.address);return (address.length>=5&&value.includes(address)) || (/^\d/.test(name)&&value.includes(name));});return { ...row, exactName:normalize(row.name)===normalize(venue), addressMatch, postalMatch:Boolean(postal&&row.postal_code===postal), placeScore: Math.max(similarity(venue, [row.name,row.aliases,row.address,row.postal_code].filter(Boolean).join(' ')),similarity(searchText,[row.name,row.aliases,row.address,row.postal_code].filter(Boolean).join(' '))) };})
    .sort((a,b) => Number(b.postalMatch)-Number(a.postalMatch) || Number(b.addressMatch)-Number(a.addressMatch) || Number(b.exactName)-Number(a.exactName) || b.placeScore-a.placeScore).slice(0,10);
}
function buildingsNear(place, radius = 200) {
  const footprint=containingFootprint(place);
  const latDelta = radius/111320, lngDelta = radius/(111320*Math.cos(place.latitude*Math.PI/180));
  let rows = preferPristineOneMapRows(db.prepare(`SELECT p.* FROM place_spatial s JOIN places p ON p.id=s.id WHERE p.source='onemap-3d' AND length(trim(p.normalized_name))>1 AND s.min_lat BETWEEN ? AND ? AND s.min_lng BETWEEN ? AND ?`).all(place.latitude-latDelta,place.latitude+latDelta,place.longitude-lngDelta,place.longitude+lngDelta), cleanTilePath);
  const contained=footprint?rows.filter((row)=>pointInPolygon(row.latitude,row.longitude,footprint.coordinates)):[];
  if(contained.length) rows=contained;
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.name}::${row.gml_id || row.source_id}`;
    const group = groups.get(key) || { key, name: row.name, gmlIds: new Set(), latitude: row.latitude, longitude: row.longitude, distanceMeters: distance(place.latitude,place.longitude,row.latitude,row.longitude), footprintMatch:Boolean(contained.length), osmFootprint:footprint?{osmId:footprint.osm_id,name:footprint.name,address:footprint.address,postalCode:footprint.postal_code}:null, sourceTiles: new Map() };
    if (row.gml_id) group.gmlIds.add(row.gml_id);
    if (row.tile_path) group.sourceTiles.set(cleanTilePath(row.tile_path), [...new Set([...(group.sourceTiles.get(cleanTilePath(row.tile_path))||[]),row.batch_id])]);
    group.distanceMeters = Math.min(group.distanceMeters, distance(place.latitude,place.longitude,row.latitude,row.longitude));
    groups.set(key,group);
  }
  return [...groups.values()].map((group) => ({ ...group, gmlIds:[...group.gmlIds], sourceTiles:[...group.sourceTiles].map(([tilePath,batchIds])=>({tilePath,batchIds})) })).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,20);
}
function buildingForAlias(alias) {
  const approvedIds = alias.gmlIds?.length ? alias.gmlIds : [alias.gmlId].filter(Boolean);
  const rows = preferPristineOneMapRows(approvedIds.length
    ? db.prepare(`SELECT * FROM places WHERE source='onemap-3d' AND gml_id IN (${approvedIds.map(()=>'?').join(',')})`).all(...approvedIds)
    : db.prepare(`SELECT * FROM places WHERE source='onemap-3d' AND name IN (${alias.acceptedGmlNames.map(()=>'?').join(',')})`).all(...alias.acceptedGmlNames), cleanTilePath);
  if (!rows.length) return null;
  const tiles = new Map();
  for (const row of rows) if (row.tile_path) tiles.set(cleanTilePath(row.tile_path),[...new Set([...(tiles.get(cleanTilePath(row.tile_path))||[]),row.batch_id])]);
  const uniqueLocations = [...new Map(rows.map((row)=>[row.gml_id||row.source_id,row])).values()];
  return { key:`alias:${normalize(alias.rawVenue)}`, name:alias.canonicalVenue, acceptedGmlNames:alias.acceptedGmlNames, gmlIds:[...new Set(rows.map((row)=>row.gml_id).filter(Boolean))], latitude:uniqueLocations.reduce((sum,row)=>sum+row.latitude,0)/uniqueLocations.length, longitude:uniqueLocations.reduce((sum,row)=>sum+row.longitude,0)/uniqueLocations.length, distanceMeters:0, identityScore:1, score:100, sourceTiles:[...tiles].map(([tilePath,batchIds])=>({tilePath,batchIds})) };
}

function exactOneMapCandidates(venue) {
  const rows = preferPristineOneMapRows(db.prepare(`SELECT * FROM places WHERE source='onemap-3d' AND normalized_name=?`).all(normalize(venue)), cleanTilePath);
  return groupExactOneMapRows(rows, cleanTilePath);
}

const results = [];
for (const [venueId, branch] of Object.entries(state.venues)) {
  if (!(branch.stages.resolve.status === 'pending' || (includeUnresolved && branch.stages.resolve.status === 'unresolved')) || (onlyIds.size && !onlyIds.has(venueId))) continue;
  const alias = aliasMap.get(normalize(branch.venue));
  const exactCandidates = exactOneMapCandidates(branch.venue);
  const exactBuilding = exactCandidates.length===1?exactCandidates[0]:null;
  const recovery=recoveryByVenue.get(venueId);
  const deterministicRecovery=deterministicRecoveryByVenue.get(venueId);
  const sourceCoordinates=branch.eventIds.flatMap((id)=>enrichmentByEvent.get(id)?.coordinateCandidates||[]);
  const sourcePostalCodes=branch.eventIds.flatMap((id)=>enrichmentByEvent.get(id)?.postalCodes||[]);
  const sourceAddresses=branch.eventIds.flatMap((id)=>enrichmentByEvent.get(id)?.addressCandidates||[]);
  const coordinateCandidates=consolidateCoordinateCandidates(preferAuthoritativeRecovery(sourceCoordinates,deterministicRecovery?.coordinateCandidates,recovery?.coordinateCandidates));
  const locationEvidence={postalCodes:[...new Set(preferAuthoritativeRecovery(sourcePostalCodes,deterministicRecovery?.postalCodes,recovery?.postalCodes))],addressCandidates:[...new Set(preferAuthoritativeRecovery(sourceAddresses,deterministicRecovery?.addressCandidates,recovery?.addressCandidates))],units:[...new Set(branch.eventIds.flatMap((id)=>enrichmentByEvent.get(id)?.units||[]))],coordinateCandidates,recoveryEvidence:recovery?.evidenceInspected||[]};
  const sourceCoordinate=coordinateCandidates.length===1?coordinateCandidates[0]:null;
  const sourcePlace=sourceCoordinate&&inSingapore({latitude:Number(sourceCoordinate.lat),longitude:Number(sourceCoordinate.lng)})?{
    source_id:sourceCoordinate.recordRef,name:branch.venue,address:locationEvidence.addressCandidates[0]??null,postal_code:locationEvidence.postalCodes[0]??null,
    latitude:Number(sourceCoordinate.lat),longitude:Number(sourceCoordinate.lng),kind:'official-provider-coordinate',placeScore:1,exactName:true,addressMatch:Boolean(locationEvidence.addressCandidates.length),postalMatch:Boolean(locationEvidence.postalCodes.length),sourceCoordinate:true
  }:null;
  const places = sourcePlace?[sourcePlace]:textCandidates(branch.venue,locationEvidence);
  const place = places[0] || null;
  const buildings = place ? buildingsNear(place) : exactCandidates;
  const ranked = buildings.map((building) => {
    const identityScore = Math.max(similarity(branch.venue,building.name), similarity(place?.name??'',building.name));
    const score = Math.round((place?.placeScore??0.5)*35 + identityScore*35 + Math.max(0,1-building.distanceMeters/200)*30);
    return { ...building, identityScore:Number(identityScore.toFixed(3)), score };
  }).sort((a,b)=>b.score-a.score || a.distanceMeters-b.distanceMeters);
  const best = ranked[0] || null, second = ranked[1] || null;
  const evidenceHash=computeVenueEvidenceHash({venue:branch.venue,eventIds:branch.eventIds,events:normalizedEvents,enrichmentRecords,recoveryRecords,deterministicRecoveryRecords});
  const currentCandidates=[...new Map([...ranked,...exactCandidates].map((candidate)=>[(candidate.gmlIds??[]).join('|')||candidate.key,candidate])).values()];
  const adminBuilding=revalidateAdminApprovedCandidate({venueId,evidenceHash,proposals:adminProposals,currentCandidates});
  const coordinateChoice = coordinateBuildingChoice(place, ranked);
  const aliasBuilding = alias ? buildingForAlias(alias) : null;
  const authoritativeBuildingText = [
    ...locationEvidence.addressCandidates,
    ...(recovery?.evidenceInspected ?? []).map((evidence) => evidence.outcome).filter(Boolean)
  ];
  const addressNamedBuilding = selectAddressNamedBuilding(authoritativeBuildingText, ranked);
  const addressConsistent=place?.addressMatch && (!locationEvidence.postalCodes.length || !place.postal_code || locationEvidence.postalCodes.includes(place.postal_code));
  const strongPlace = place && (place.sourceCoordinate || place.postalMatch || addressConsistent || place.exactName || place.placeScore >= 0.75);
  const preciseProviderPin = coordinateChoice.precise;
  const selectedBest = preciseProviderPin ? coordinateChoice.building : best;
  const strongBuilding = selectedBest && selectedBest.name.trim().length>1 && selectedBest.distanceMeters<=100 && (selectedBest.identityScore>=0.2 || preciseProviderPin || (selectedBest.footprintMatch && (place.sourceCoordinate || place.addressMatch || place.postalMatch)));
  const unambiguous = !second || best.score-second.score>=8 || best.name===second.name || preciseProviderPin;
  const exactBuildingAtPin = exactBuilding && (!place?.sourceCoordinate || distance(place.latitude,place.longitude,exactBuilding.latitude,exactBuilding.longitude)<=100) ? exactBuilding : null;
  const accepted = Boolean(adminBuilding || aliasBuilding || exactBuildingAtPin || addressNamedBuilding || preciseProviderPin)
    || Boolean(!place?.sourceCoordinate && strongPlace && strongBuilding && unambiguous);
  const status = accepted ? 'candidate_matched' : (place || exactCandidates.length) ? 'needs_review' : 'not_found';
  const publicPlacement = accepted ? 'mapped' : 'off_map';
  const mappingStatus = accepted ? 'approved' : status === 'needs_review' ? 'pending_review' : 'not_required';
  results.push({ venueId, venue:branch.venue, eventIds:branch.eventIds, locationEvidence, status, publicPlacement, mappingStatus,
    lifecycleState:'active', offMapSubtype:accepted?null:'geometry_unavailable', alias:alias||null,
    place:place?{sourceId:place.source_id,name:place.name,address:place.address,postalCode:place.postal_code,latitude:place.latitude,longitude:place.longitude,kind:place.kind,score:Number(place.placeScore.toFixed(3)),exactName:place.exactName,addressMatch:place.addressMatch,postalMatch:place.postalMatch,sourceCoordinate:Boolean(place.sourceCoordinate)}:null,
    building:accepted?(adminBuilding||aliasBuilding||exactBuildingAtPin||addressNamedBuilding||(preciseProviderPin?coordinateChoice.building:selectedBest)):null, alternatives:ranked.slice(0,5), reason:adminBuilding?'Admin-selected candidate passed current evidence-hash, OneMap GML, coordinate, and tile revalidation':aliasBuilding?'Approved alias registry entry backed by local OneMap metadata':exactBuildingAtPin?'Exact venue name resolves to one unique OneMap GML identity across its LOD tiles':addressNamedBuilding?'Verified authoritative venue evidence names one unique nearby OneMap 3D building':preciseProviderPin?'Official provider pin has one clearly nearest named OneMap 3D building':exactCandidates.length>1?'Exact venue name resolves to multiple OneMap GML identities that require explicit part selection':accepted?'Local OSM identity and coordinate agree with a nearby OneMap 3D building':alias?'Approved alias references no local OneMap building':coordinateCandidates.length>1?'Official source records disagree on venue coordinates':place?.sourceCoordinate?'The official coordinate is not precise enough to select one exact OneMap GML identity':place?'A local place was found but the nearby building evidence is ambiguous':'Local lookup missed; authoritative address recovery and candidate search are required' });
}
const existingPath=path.join(runDir,'local-venue-resolution.json');
const mergedResults=onlyIds.size&&fs.existsSync(existingPath)?[
  ...JSON.parse(fs.readFileSync(existingPath,'utf8')).results.filter((row)=>!onlyIds.has(row.venueId)),
  ...results
]:results;
const summary = { total:mergedResults.length, candidateMatched:mergedResults.filter((row)=>row.status==='candidate_matched').length, needsReview:mergedResults.filter((row)=>row.status==='needs_review').length, notFound:mergedResults.filter((row)=>row.status==='not_found').length };
const output = { schemaVersion:'1.0', runId, generatedAt:new Date().toISOString(), summary, results:mergedResults };
fs.writeFileSync(path.join(runDir,'local-venue-resolution.json'),`${JSON.stringify(output,null,2)}\n`);
const lines = ['# Local Venue Resolution','','| Venue | Events | Result | Local place | Nearby OneMap building | Distance |','|---|---:|---|---|---|---:|',...mergedResults.map((row)=>`| ${row.venue.replaceAll('|','\\|')} | ${row.eventIds.length} | ${row.status} | ${(row.place?.name||'-').replaceAll('|','\\|')} | ${(row.building?.name||'-').replaceAll('|','\\|')} | ${row.building?`${Math.round(row.building.distanceMeters)} m`:'-'} |`),'',`Matched: ${summary.candidateMatched}; review: ${summary.needsReview}; not found: ${summary.notFound}.`];
fs.writeFileSync(path.join(runDir,'local-venue-resolution.md'),`${lines.join('\n')}\n`);
console.log(JSON.stringify(summary,null,2));
db.close();
