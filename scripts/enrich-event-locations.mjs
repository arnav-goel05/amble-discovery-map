#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLocationStrings, extractAddressEvidence } from './lib/location-evidence.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const value=(name)=>{const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:null;};
const runId=value('run');
if(!runId) throw new Error('Usage: node scripts/enrich-event-locations.mjs --run <run-id>');
const runDir=path.join(ROOT,'outputs/event-pipeline',runId);
const state=JSON.parse(fs.readFileSync(path.join(runDir,'orchestrator-state.json'),'utf8'));
const events=JSON.parse(fs.readFileSync(path.join(runDir,'normalized/events.json'),'utf8')).records;
// Enrichment runs before a resolve result is recorded, so pending branches must
// be included. Unresolved branches are included to support focused retries.
const unresolvedIds=new Set(Object.values(state.venues).filter((branch)=>['pending','unresolved'].includes(branch.stages.resolve.status)).flatMap((branch)=>branch.eventIds));
const clean=(html='')=>String(html).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>|<\/li>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&#x[0-9a-f]+;|&#\d+;/gi,' ').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').trim();
const finiteCoordinates=(value)=>{
  const lat=Number(value?.lat ?? value?.latitude),lng=Number(value?.lng ?? value?.longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0)?{lat,lng}:null;
};
const sourceCoordinateCandidates=(event)=>{
  const candidates=[];
  for(const source of event.sources??[]){
    const recordRef=source?.recordRef;
    const fixtureRef=typeof recordRef==='string'?recordRef.split('#')[0]:null;
    if(!fixtureRef||!/^raw\/[^/]+\/details\/[^/]+\.json$/.test(fixtureRef)) continue;
    const fixturePath=path.join(runDir,fixtureRef);
    if(!fs.existsSync(fixturePath)) continue;
    const envelope=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
    const index=Number(recordRef.match(/#\/records\/(\d+)$/)?.[1]);
    const fixture=Number.isInteger(index)?envelope.records?.[index]:null;
    let coordinates=finiteCoordinates(fixture?.sourceCoordinates);
    let evidenceField='detail fixture sourceCoordinates';
    if(!coordinates){
      const responsePath=fixturePath.replace(/\.json$/,'.response.json');
      if(fs.existsSync(responsePath)){
        const response=JSON.parse(fs.readFileSync(responsePath,'utf8'));
        coordinates=finiteCoordinates(response?.venue_name);
        evidenceField='official detail response venue_name latitude/longitude';
      }
    }
    if(coordinates) candidates.push({...coordinates,source:source.source,recordRef,evidenceField});
  }
  return [...new Map(candidates.map((candidate)=>[`${candidate.lat.toFixed(7)},${candidate.lng.toFixed(7)}`,candidate])).values()];
};
const sourceLocationStrings=(event)=>{
  const values=[];
  for(const source of event.sources??[]){
    const recordRef=source?.recordRef,fixtureRef=typeof recordRef==='string'?recordRef.split('#')[0]:null;
    if(!fixtureRef||!/^raw\/[^/]+\/details\/[^/]+\.json$/.test(fixtureRef)) continue;
    for(const ref of [fixtureRef,fixtureRef.replace(/\.json$/,'.response.json')]){
      const artifact=path.join(runDir,ref);
      if(!fs.existsSync(artifact)) continue;
      try{collectLocationStrings(JSON.parse(fs.readFileSync(artifact,'utf8')),values);}catch{}
    }
  }
  return values;
};
const records=[];
for(const event of events.filter((item)=>unresolvedIds.has(item.id))){
  const extracted=extractAddressEvidence([event.venue,event.address,event.description,...sourceLocationStrings(event)]);
  const postalCodes=extracted.postalCodes,addressLines=extracted.addressCandidates,units=extracted.units;
  const coordinateCandidates=sourceCoordinateCandidates(event);
  const record={eventId:event.id,venue:event.venue,postalCodes,addressCandidates:addressLines,units,coordinateCandidates,evidence:[]};
  if(postalCodes.length) record.evidence.push('six-digit Singapore postal code in saved event text');
  if(addressLines.length) record.evidence.push('address line surrounding postal code in saved event text');
  if(units.length) record.evidence.push('unit number in saved event text');
  if(coordinateCandidates.length) record.evidence.push('coordinates in saved official source detail response');
  records.push(record);
}
const result={schemaVersion:'1.0',runId,generatedAt:new Date().toISOString(),counts:{eventsInspected:records.length,withPostalCode:records.filter((row)=>row.postalCodes.length).length,withAddressCandidate:records.filter((row)=>row.addressCandidates.length).length,withUnit:records.filter((row)=>row.units.length).length,withSourceCoordinates:records.filter((row)=>row.coordinateCandidates.length).length},records};
fs.writeFileSync(path.join(runDir,'normalized/location-enrichment.json'),`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result.counts,null,2));
