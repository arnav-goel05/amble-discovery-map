#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { validateOneMapTileEvidence } from './lib/onemap-tile-evidence.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { normalizeRun, normalizeText } from './event-normalizer.mjs';
import { collectSource, validateSourcePolicy } from './event-source-collector.mjs';
import { commitFrontendSnapshot, loadCurrentApprovedData, prepareFrontendSnapshot, writeVerifiedStageHandoffs } from './event-frontend-snapshot.mjs';
import { extractCoordinates } from './extract-web-evidence.mjs';
import { queryOneMap } from './query-onemap-location.mjs';
import { collectLocationStrings, extractAddressEvidence } from './lib/location-evidence.mjs';
import { consolidateCoordinateCandidates } from './lib/venue-resolution-evidence.mjs';
import { buildCombinedPoiTileset } from './build-combined-poi-tileset.mjs';
import {
  canCommitFrontendSnapshot as stateCanCommitFrontendSnapshot,
  deriveTerminalStatus,
  evaluateCommitEligibility,
  loadRunState,
  nextPipelineAction,
  runStatePath,
  saveRunState,
  terminalProblems as stateTerminalProblems,
} from './lib/event-pipeline/run-state.mjs';
import { progressResponse as stateProgressResponse, renderStatus as renderPipelineStatus, statusSummary, summarizeEvidenceLevels } from './lib/event-pipeline/reporting.mjs';
import { computeVenueEvidenceHash } from './lib/event-pipeline/evidence-hash.mjs';
import { finalizeDeduplication, generateDedupCandidates } from './lib/event-sources/deduplicate.mjs';
import { assessActivityInclusion } from './lib/event-sources/activity-policy.mjs';
import { stableEventKey } from './reconcile-event-content.mjs';
import { createTraceWriter, redactTraceValue } from './lib/event-sources/trace.mjs';
import { parseArgs, parseManifest, singaporeWindowForDays } from './lib/event-pipeline/cli-contract.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { AdminRepository } = require('./lib/admin-repository.cjs');
const { AdminService } = require('./lib/admin-service.cjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = process.env.EVENT_PIPELINE_OUTPUT_ROOT ? resolve(process.env.EVENT_PIPELINE_OUTPUT_ROOT) : join(ROOT, 'outputs/event-pipeline');
const LOCK_PATH = join(OUTPUT_ROOT, '.lock');
const MANIFEST_PATH = join(ROOT, 'pull_data.md');
const CONFIG_PATH = join(ROOT, 'data/event-pipeline-config.json');
const resolutionCachePath = () => process.env.EVENT_PIPELINE_RESOLUTION_CACHE ? resolve(process.env.EVENT_PIPELINE_RESOLUTION_CACHE) : join(OUTPUT_ROOT, 'venue-resolution-cache.json');
const aliasRegistryPath = () => process.env.EVENT_PIPELINE_ALIAS_REGISTRY ? resolve(process.env.EVENT_PIPELINE_ALIAS_REGISTRY) : join(ROOT, 'data/venue-alias-registry.json');
const venueRecoveryPath = (runDir) => join(runDir, 'normalized/venue-recovery-evidence.json');
const deterministicRecoveryPath = (runDir) => join(runDir, 'normalized/deterministic-location-recovery.json');
const STAGES = ['resolve', 'highlight', 'pill', 'panel'];
const TERMINAL_SOURCE = new Set(['success', 'blocked', 'failed', 'pilot_failed', 'disabled']);
const TERMINAL_STAGE = new Set(['success', 'blocked', 'failed', 'skipped', 'unresolved']);
const EXTERNAL_BLOCKER_CODES = new Set([
  'authentication_or_captcha',
  'layout_contract_changed',
  'pagination_inaccessible',
  'persistent_rate_limit',
  'source_unavailable',
  'provider_policy_invalid',
  'retrieval_credential_missing',
  'official_reference_invalid',
  'adapter_missing'
]);
const CONTINUE_EXIT_CODE = 3;
const adminDatabasePath = () => process.env.ADMIN_DATABASE_PATH ? resolve(process.env.ADMIN_DATABASE_PATH)
  : process.env.EVENT_PIPELINE_OUTPUT_ROOT ? join(OUTPUT_ROOT, 'admin.sqlite') : join(ROOT, 'outputs/admin/admin.sqlite');

function pipelineTrace(runDir, record) {
  const run = readJson(join(runDir, 'run.json'));
  return createTraceWriter({ path: join(runDir, 'logs/trace.jsonl'), runId: run.runId, window: run.window }).write({ outcome: 'recorded', ...record });
}

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readResolutionCache() {
  const path = resolutionCachePath();
  if (!existsSync(path)) writeJson(path, { schemaVersion: '1.0', entries: [] });
  const cache = readJson(path);
  if (cache.schemaVersion !== '1.0' || !Array.isArray(cache.entries)) fail('Invalid runtime venue resolution cache');
  return cache;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function recoveryRecords(runDir) {
  const path = venueRecoveryPath(runDir);
  return existsSync(path) ? readJson(path).records ?? [] : [];
}

function recoveryEvidenceRef(runDir, venueId) {
  const index = recoveryRecords(runDir).findIndex((record) => record.venueId === venueId);
  return index < 0 ? null : `normalized/venue-recovery-evidence.json#/records/${index}`;
}

function deterministicRecoveryRecords(runDir) {
  const path = deterministicRecoveryPath(runDir);
  return existsSync(path) ? readJson(path).records ?? [] : [];
}

function selectDeterministicOneMapAddress(address, response) {
  const exact = (response?.results ?? []).filter((row) => normalizeText(row.address) === normalizeText(address)
    || normalizeText(row.searchValue) === normalizeText(address));
  if (exact.length === 1) return exact[0];
  const normalizedAddress = normalizeText(address);
  const namedMatches = (response?.results ?? []).filter((row) => {
    const name = normalizeText(row.searchValue);
    return name.length >= 6 && (normalizedAddress.includes(name) || name.includes(normalizedAddress));
  });
  if (namedMatches.length === 1) return namedMatches[0];
  const postalCode = String(address).match(/\b\d{6}\b/)?.[0] ?? null;
  const postalMatches = postalCode ? (response?.results ?? []).filter((row) => row.postalCode === postalCode) : [];
  const equivalentPins = consolidateCoordinateCandidates(postalMatches.map((row) => ({ lat: row.latitude, lng: row.longitude, row })), 2);
  if (postalMatches.length > 1 && equivalentPins.length === 1) return equivalentPins[0].row;
  return postalMatches.length === 1 ? postalMatches[0] : null;
}

async function enrichRecoveryCoordinates(normalized, geocode = queryOneMap) {
  if (normalized.notMappableEvidence || !normalized.addressCandidates.length) return normalized;
  for (const address of normalized.addressCandidates) {
    let response;
    try { response = await geocode(address); } catch { continue; }
    const selected = selectDeterministicOneMapAddress(address, response);
    if (!selected || !Number.isFinite(selected.latitude) || !Number.isFinite(selected.longitude)) continue;
    return { ...normalized, coordinateCandidates: [{
      lat: selected.latitude, lng: selected.longitude, source: 'onemap_public_exact_address',
      recordRef: response.requestUrl ?? null, evidenceField: response.selectedQuery ?? address
    }] };
  }
  return normalized;
}

function classifyNonBuildingRecovery(normalized) {
  const location = normalized.addressCandidates.join(' ');
  const isNonBuilding = /\bmrt(?: station)? exit\s*[a-z0-9-]*\b|\b(?:mrt )?(?:platform|gantry|passage)\b/i.test(location);
  if (!isNonBuilding || normalized.notMappableEvidence) return normalized;
  const sourceUrls = [...new Set([...(normalized.evidenceInspected ?? []), ...(normalized.supplementalEvidence ?? [])]
    .map((item) => item.url).filter((url) => typeof url === 'string' && /^https?:\/\//.test(url)))];
  return { ...normalized, coordinateCandidates: [], notMappableEvidence: { reasonCode: 'no_target_building', sourceUrls } };
}

function explicitMultiVenueSourceUrls(events) {
  if (!events.length) return [];
  const explicit = events.every((event) => {
    const description = String(event.description ?? '').replace(/<br\s*\/?>/gi, '\n');
    const locations = description.match(/(?:^|\n)\s*locations?\s*:\s*([^\n]+)/i)?.[1] ?? '';
    return locations.split(',').map((item) => normalizeText(item)).filter(Boolean).length >= 2;
  });
  if (!explicit) return [];
  return [...new Set(events.flatMap((event) => [event.eventUrl, ...(event.sources ?? []).map((source) => source.sourceUrl)]))]
    .filter((url) => typeof url === 'string' && /^https?:\/\//.test(url));
}

function applyDeterministicEventClassification(runId, venueId, venue, localRow) {
  const runDir = runDirectory(runId);
  const events = readJson(join(runDir, 'normalized/events.json')).records.filter((event) => venue.eventIds.includes(event.id));
  const sourceUrls = explicitMultiVenueSourceUrls(events);
  if (!sourceUrls.length) return false;
  const path = venueRecoveryPath(runDir);
  const envelope = existsSync(path) ? readJson(path) : { schemaVersion: '1.0', runId, generatedAt: new Date().toISOString(), records: [] };
  const record = {
    venueId, venue: venue.venue, addressCandidates: [], postalCodes: [], coordinateCandidates: [],
    evidenceInspected: sourceUrls.map((url) => ({ sourceType: 'host_or_authority', label: 'Normalized source event with explicit Locations list', url })),
    notMappableEvidence: { reasonCode: 'multi_venue', sourceUrls }, recordedAt: new Date().toISOString()
  };
  const previousIndex = (envelope.records ?? []).findIndex((item) => item.venueId === venueId);
  if (previousIndex >= 0) envelope.records[previousIndex] = record;
  else envelope.records.push(record);
  envelope.updatedAt = new Date().toISOString();
  writeJson(path, envelope);
  registerArtifacts(runDir, ['normalized/venue-recovery-evidence.json']);
  recordRecoveredUnresolved(runId, venueId, venue, record, localRow);
  return true;
}

function validateVenueRecoveryEvidence(value, expectedVenue = null) {
  if (!value || typeof value !== 'object') fail('Venue recovery evidence must be a JSON object');
  const allowedFields = new Set(['schemaVersion', 'venue', 'addressCandidates', 'postalCodes', 'coordinateCandidates', 'evidenceInspected', 'notMappableEvidence']);
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) fail(`Venue recovery evidence contains unsupported fields: ${unknownFields.join(', ')}; use the supplied template fields exactly`);
  if (value.schemaVersion !== '1.0') fail('Venue recovery evidence requires schemaVersion 1.0');
  if (expectedVenue && value.venue && normalizeText(value.venue) !== normalizeText(expectedVenue)) fail('Venue recovery evidence does not match the requested venue');
  const submittedNotMappableEvidence = value.notMappableEvidence ?? null;
  const notMappableEvidence = submittedNotMappableEvidence ? {
    reasonCode: submittedNotMappableEvidence.reasonCode,
    sourceUrls: [...new Set((submittedNotMappableEvidence.sourceUrls ?? []).map((item) =>
      typeof item === 'string' ? item.trim() : item && typeof item.url === 'string' ? item.url.trim() : ''
    ).filter(Boolean))]
  } : null;
  if (notMappableEvidence) {
    if (!['outside_singapore', 'mobile_venue', 'multi_venue', 'no_target_building'].includes(notMappableEvidence.reasonCode)) fail('Invalid venue recovery notMappableEvidence reasonCode');
    if (!Array.isArray(submittedNotMappableEvidence.sourceUrls) || notMappableEvidence.sourceUrls.length === 0) fail('Venue recovery notMappableEvidence requires authoritative sourceUrls');
  }
  const outsideSingapore = notMappableEvidence?.reasonCode === 'outside_singapore';
  const addressCandidates = [...new Set((value.addressCandidates ?? []).map((item) => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object' && typeof item.address === 'string') return item.address.trim();
    return '';
  }).filter(Boolean))];
  const postalCodes = [...new Set((value.postalCodes ?? []).map((item) => String(item).trim()).filter(Boolean))];
  if (postalCodes.some((item) => outsideSingapore ? !/^[a-z0-9][a-z0-9 -]{1,11}$/i.test(item) : !/^\d{6}$/.test(item))) {
    fail(outsideSingapore ? 'Outside-Singapore recovery postalCodes must contain valid postal text' : 'Venue recovery postalCodes must contain six-digit Singapore postal codes');
  }
  const coordinateCandidates = (value.coordinateCandidates ?? []).map((item) => {
    const urlCoordinate = item?.url ? extractCoordinates(item.url)[0] : null;
    return {
      lat: Number(item?.lat ?? item?.latitude ?? urlCoordinate?.lat), lng: Number(item?.lng ?? item?.longitude ?? urlCoordinate?.lng),
      source: item?.source ?? item?.sourceType ?? 'authoritative_web_recovery', recordRef: item?.recordRef ?? item?.url ?? null,
      evidenceField: item?.evidenceField ?? item?.label ?? 'authoritative venue recovery evidence'
    };
  });
  const isRealWorldCoordinate = (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)
    && Math.abs(item.lat) <= 90 && Math.abs(item.lng) <= 180 && !(item.lat === 0 && item.lng === 0);
  const isSingaporeCoordinate = (item) => item.lat >= 1.13 && item.lat <= 1.49 && item.lng >= 103.55 && item.lng <= 104.15;
  if (coordinateCandidates.some((item) => !isRealWorldCoordinate(item) || (!outsideSingapore && !isSingaporeCoordinate(item)))) {
    fail(outsideSingapore ? 'Outside-Singapore recovery coordinates must be valid non-sentinel world coordinates' : 'Venue recovery coordinates must be finite and within Singapore');
  }
  const submittedEvidence = value.evidenceInspected ?? [];
  if (!Array.isArray(submittedEvidence) || submittedEvidence.length < 2) fail('Venue recovery requires both venue-official and host/authority pages');
  const isSearchHost = (hostname) => /(?:^|\.)(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/i.test(hostname);
  const sourceTypes = new Set(), evidenceInspected = [], supplementalEvidence = [];
  const coordinateRefs = new Set(coordinateCandidates.map((item) => item.recordRef).filter(Boolean));
  for (const evidence of submittedEvidence) {
    if (!evidence?.label || !evidence?.url) fail('Every venue recovery evidence item requires a label and inspected URL');
    if (!evidence?.query || !evidence?.outcome || !evidence?.checkedAt || !Number.isFinite(Date.parse(evidence.checkedAt))) fail('Every venue recovery evidence item requires its actual query, outcome, and checkedAt timestamp');
    let parsed;
    try { parsed = new URL(evidence.url); } catch { fail(`Invalid venue recovery evidence URL: ${evidence.url}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) fail('Venue recovery evidence URL must use HTTP or HTTPS');
    const listingProvider = /(?:^|\.)(?:catch\.sg|sistic\.com\.sg|sgculturepass\.gov\.sg)$/i.test(parsed.hostname);
    if (evidence.sourceType === 'venue_official' && listingProvider) {
      fail('Catch.sg, SISTIC, and SG Culture Pass listing pages must use sourceType host_or_authority; open the actual venue or operator website for venue_official evidence');
    }
    const isOneMap = parsed.hostname === 'www.onemap.gov.sg';
    const coreType = ['venue_official', 'host_or_authority'].includes(evidence.sourceType) && !isSearchHost(parsed.hostname) && !isOneMap;
    if (coreType) {
      sourceTypes.add(evidence.sourceType);
      evidenceInspected.push(evidence);
    } else if (coordinateRefs.has(evidence.url) || isOneMap || (['address_authority', 'coordinate_authority'].includes(evidence.sourceType) && !isSearchHost(parsed.hostname))) {
      supplementalEvidence.push(evidence);
    } else {
      fail('Venue recovery evidence must be an inspected authoritative page, not a search-result URL');
    }
  }
  if (!sourceTypes.has('venue_official') || !sourceTypes.has('host_or_authority')) fail('Venue recovery must cover venue_official and host_or_authority paths');
  const officialPostalCodes = [...new Set(evidenceInspected
    .filter((evidence) => evidence.sourceType === 'venue_official')
    .flatMap((evidence) => String(evidence.outcome ?? '').match(/\b\d{6}\b/g) ?? []))];
  if (officialPostalCodes.length === 1 && postalCodes.length && !postalCodes.includes(officialPostalCodes[0])) {
    fail(`Venue recovery postalCodes conflict with the venue-official evidence (${officialPostalCodes[0]}); remove contaminated source-page location clues`);
  }
  if (officialPostalCodes.length === 1 && addressCandidates.some((address) => {
    const submittedPostal = String(address).match(/\b\d{6}\b/)?.[0];
    return submittedPostal && submittedPostal !== officialPostalCodes[0];
  })) {
    fail(`Venue recovery addressCandidates conflict with the venue-official evidence (${officialPostalCodes[0]}); replace contaminated source-page location clues`);
  }
  for (const candidate of coordinateCandidates) {
    const matchedEvidence = submittedEvidence.find((evidence) => evidence.url === candidate.recordRef);
    if (matchedEvidence && /\b(?:no|without)\s+(?:visible\s+|usable\s+|published\s+)?(?:map\s+)?(?:pin|coordinates?|map location)\b|\b(?:pin|coordinates?|map location)\s+(?:is\s+|are\s+)?(?:not\s+)?(?:shown|available|provided|present|exposed|found)\b/i.test(matchedEvidence.outcome)) {
      fail('A page recorded as exposing no map pin or coordinate cannot be used as the coordinate recordRef');
    }
    if (/onemap/i.test(candidate.evidenceField) && candidate.recordRef) {
      let hostname = '';
      try { hostname = new URL(candidate.recordRef).hostname; } catch {}
      if (hostname !== 'www.onemap.gov.sg') fail('OneMap-derived coordinates must use the onemap-geocode requestUrl as recordRef');
    }
  }
  return { addressCandidates, postalCodes, coordinateCandidates, evidenceInspected, ...(supplementalEvidence.length ? { supplementalEvidence } : {}), notMappableEvidence };
}

function validateNotMappableAgainstLocalCandidates(recovery, venueName, localRow) {
  const reasonCode = recovery?.notMappableEvidence?.reasonCode;
  if (!['mobile_venue', 'no_target_building'].includes(reasonCode)) return;
  const stableVenueName = normalizeText(venueName)
    .replace(/\b(?:meeting|meet up|pickup|pick up|starting|start) point\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (stableVenueName.length < 6) return;
  const exactCandidate = (localRow?.alternatives ?? []).find((candidate) => {
    const candidateName = normalizeText(candidate?.name);
    return candidateName.length >= 6 && (candidateName === stableVenueName || stableVenueName.includes(candidateName))
      && Array.isArray(candidate?.gmlIds) && candidate.gmlIds.length === 1;
  });
  if (exactCandidate) {
    fail(`Venue recovery cannot classify ${venueName} as ${reasonCode}: local OneMap evidence contains exact building candidate ${exactCandidate.name} (${exactCandidate.gmlIds[0]})`);
  }
}

function readPipelineConfig() {
  const stored = readJson(CONFIG_PATH);
  if (!['1.0', '2.0'].includes(stored.schemaVersion) || stored.timezone !== 'Asia/Singapore') fail('Invalid event pipeline configuration');
  const config = {
    ...stored,
    sources: (stored.sources ?? []).map((source) => {
      const evidenceRole = source.evidenceRole
        ?? (source.operatingMode === 'disabled' ? 'unavailable' : source.sourceRole === 'discovery' ? 'editorial' : 'direct');
      const operatingState = source.operatingState ?? (source.enabled === false || source.operatingMode === 'disabled' ? 'disabled' : 'enabled');
      const editorialPolicy = evidenceRole === 'editorial' ? source.editorialPolicy ?? {
        version: '2.0', corroborateFirst: true, allowSufficientEditorialOnly: true,
        outboundLabels: source.confirmation?.outboundLabels ?? [],
      } : null;
      return {
        ...source, evidenceRole, operatingState, editorialPolicy,
        enabled: operatingState === 'enabled',
        sourceRole: evidenceRole === 'editorial' ? 'discovery' : 'authoritative',
        operatingMode: operatingState === 'disabled' ? 'disabled' : 'required',
        confirmation: editorialPolicy ? { policyVersion: editorialPolicy.version, outboundLabels: editorialPolicy.outboundLabels ?? [] } : source.confirmation,
      };
    }),
  };
  if (!Number.isInteger(config.windowDaysAfterStart) || config.windowDaysAfterStart < 0) fail('Invalid windowDaysAfterStart');
  const requestPolicy = config.requestPolicy ?? {};
  if (!Number.isInteger(requestPolicy.timeoutMs) || requestPolicy.timeoutMs < 100 || requestPolicy.timeoutMs > 60_000
    || !Number.isInteger(requestPolicy.maxAttempts) || requestPolicy.maxAttempts < 1 || requestPolicy.maxAttempts > 5
    || !Number.isInteger(requestPolicy.initialBackoffMs) || requestPolicy.initialBackoffMs < 0
    || !Number.isInteger(requestPolicy.maximumBackoffMs) || requestPolicy.maximumBackoffMs < requestPolicy.initialBackoffMs) {
    fail('Invalid bounded requestPolicy');
  }
  const ids = new Set(), collectionOrders = new Set(), precedences = new Set();
  for (const source of config.sources ?? []) {
    if (!source.name || !source.adapterId || !source.version || ids.has(source.adapterId)) fail('Each source requires a unique name, adapterId, and version');
    ids.add(source.adapterId);
    if (!['direct', 'editorial', 'unavailable'].includes(source.evidenceRole) || !['enabled', 'disabled'].includes(source.operatingState)
      || !['authoritative', 'discovery'].includes(source.sourceRole) || !['required', 'disabled'].includes(source.operatingMode)
      || source.enabled !== (source.operatingMode !== 'disabled') || !Number.isInteger(source.collectionOrder) || collectionOrders.has(source.collectionOrder)) {
      fail(`Invalid role, mode, enabled state, or collection order for ${source.name}`);
    }
    collectionOrders.add(source.collectionOrder);
    if (source.evidenceRole !== 'editorial') {
      if (!Number.isInteger(source.precedence) || precedences.has(source.precedence)) fail(`Invalid authoritative precedence for ${source.name}`);
      precedences.add(source.precedence);
    } else if (source.precedence !== null || source.editorialPolicy?.version !== '2.0') fail(`Invalid editorial policy/precedence for ${source.name}`);
    for (const endpoint of [source.listing, source.detail]) {
      if (!endpoint?.url || !['GET', 'POST'].includes(endpoint.method)) fail(`Invalid endpoint configuration for ${source.name}`);
      try { if (new URL(endpoint.url).protocol !== 'https:') throw new Error(); } catch { fail(`Source endpoints must use HTTPS: ${source.name}`); }
    }
    try { validateSourcePolicy(source); } catch (error) { fail(`Invalid provider policy for ${source.name}: ${error.message}`); }
  }
  return config;
}

function singaporeWindow(dateText, daysAfterStart = readPipelineConfig().windowDaysAfterStart) {
  return singaporeWindowForDays(dateText, daysAfterStart);
}

function compactWindow(value) {
  return value.replaceAll('-', '').replaceAll(':', '');
}

function acquireLock(runId) {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  let fd;
  try {
    fd = openSync(LOCK_PATH, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      let lock;
      try { lock = readJson(LOCK_PATH); } catch { fail(`Unreadable pipeline lock requires manual review: ${LOCK_PATH}`); }
      const age = Date.now() - new Date(lock.startedAt).valueOf();
      let alive = true;
      if (lock.owner?.host === hostname() && Number.isInteger(lock.owner?.pid)) {
        try { process.kill(lock.owner.pid, 0); } catch (signalError) { if (signalError.code === 'ESRCH') alive = false; }
      }
      if (!alive && age > 2 * 60 * 60 * 1000) {
        rmSync(LOCK_PATH);
        return acquireLock(runId);
      }
      fail(`Pipeline lock already exists for run ${lock.runId ?? 'unknown'} at ${LOCK_PATH}`);
    }
    throw error;
  }
  writeFileSync(fd, `${JSON.stringify({ runId, startedAt: new Date().toISOString(), owner: { host: hostname(), pid: process.pid } }, null, 2)}\n`);
  closeSync(fd);
}

function releaseLock() {
  rmSync(LOCK_PATH, { force: true });
}

function runDirectory(runId) {
  if (!runId || basename(runId) !== runId) fail('A valid --run ID is required');
  const path = join(OUTPUT_ROOT, runId);
  if (!existsSync(path)) fail(`Unknown run: ${runId}`);
  return path;
}

function statePath(runDir) {
  return runStatePath(runDir);
}

function loadState(runId) {
  return loadRunState(runDirectory(runId));
}

function saveState(runDir, state) {
  saveRunState(runDir, state);
}

function invalidateResumeArtifacts(runDir, state, run) {
  const invalidated = new Set();
  const oldHashes = new Set();
  for (const [reference, metadata] of Object.entries(run.artifacts)) {
    const path = artifactPath(runDir, reference);
    const actual = existsSync(path) ? sha(readFileSync(path)) : null;
    if (actual !== metadata.sha256) {
      metadata.status = 'invalidated';
      invalidated.add(reference);
      oldHashes.add(metadata.sha256);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [reference, metadata] of Object.entries(run.artifacts)) {
      if (metadata.status === 'invalidated' || !(metadata.inputSha256 ?? []).some((hash) => oldHashes.has(hash))) continue;
      metadata.status = 'invalidated'; invalidated.add(reference); oldHashes.add(metadata.sha256); changed = true;
    }
  }
  for (const source of Object.values(state.sources)) {
    if ((source.artifactRefs ?? []).some((reference) => invalidated.has(reference))) Object.assign(source, { status: 'pending', counts: null, artifactRefs: [], error: null, completion: null, sourceRecordRefs: [], invalidSourceRecordRefs: [], processedSourceRecordRefs: [] });
  }
  if ((state.normalization.artifactRefs ?? []).some((reference) => invalidated.has(reference)) || Object.values(state.sources).some((source) => source.status === 'pending')) {
    state.normalization = { status: 'pending', counts: null, artifactRefs: [], venueBranches: [], error: null };
    state.resolutionPreparation = { status: 'pending', artifactRefs: [], error: null };
    state.venues = {};
    state.verification = { status: 'pending', build: null, eventUi: null, error: null };
  } else {
    for (const venue of Object.values(state.venues)) for (const stage of STAGES) {
      if (venue.stages[stage].outputRef && invalidated.has(venue.stages[stage].outputRef)) {
        const index = STAGES.indexOf(stage);
        for (const downstream of STAGES.slice(index)) venue.stages[downstream] = { status: 'pending', outputRef: null, error: null };
        state.verification = { status: 'pending', build: null, eventUi: null, error: null };
        break;
      }
    }
  }
  return [...invalidated];
}

function resume(options) {
  const runDir = runDirectory(options.run);
  const runPath = join(runDir, 'run.json');
  const run = existsSync(runPath) ? readJson(runPath) : null;
  const state = loadState(options.run);
  const manifestSnapshot = readFileSync(join(runDir, run.manifestSnapshot.path));
  const configSnapshot = readFileSync(join(runDir, run.adapterDefinitionsSnapshot.path));
  if (sha(manifestSnapshot) !== run.manifestSnapshot.sha256) fail('Resume rejected: manifest snapshot hash mismatch');
  if (sha(configSnapshot) !== run.adapterDefinitionsSnapshot.sha256) fail('Resume rejected: pipeline configuration snapshot hash mismatch');
  if (sha(readFileSync(CONFIG_PATH)) !== run.adapterDefinitionsSnapshot.sha256) fail('Resume rejected: current executable pipeline configuration differs from the run snapshot');
  run.resume.requestedRunId = options.run;
  const invalidatedArtifacts = invalidateResumeArtifacts(runDir, state, run);
  writeJson(join(runDir, 'run.json'), run);
  saveState(runDir, state);
  process.stdout.write(`${JSON.stringify({ ...progressResponse(state), resumed: true, invalidatedArtifacts }, null, 2)}\n`);
  if (!state.finalizedAt) process.exitCode = CONTINUE_EXIT_CODE;
}

function artifactPath(runDir, reference) {
  if (typeof reference !== 'string' || !reference || reference.startsWith('/') || reference.split('/').includes('..')) fail(`Invalid artifact reference: ${reference}`);
  return join(runDir, reference);
}

function registerArtifacts(runDir, references, inputSha256 = []) {
  const runPath = join(runDir, 'run.json');
  const run = readJson(runPath);
  for (const reference of references) {
    const path = artifactPath(runDir, reference);
    if (!existsSync(path)) fail(`Referenced artifact does not exist: ${reference}`);
    run.artifacts[reference] = { sha256: sha(readFileSync(path)), status: 'success', inputSha256 };
  }
  run.updatedAt = new Date().toISOString();
  writeJson(runPath, run);
}

function start(options) {
  const manifestBytes = readFileSync(MANIFEST_PATH);
  const configBytes = readFileSync(CONFIG_PATH);
  const config = readPipelineConfig();
  const manifest = { timezone: config.timezone, sources: config.sources };
  if (!manifest.sources.some((source) => source.enabled)) fail('Pipeline configuration contains no enabled sources');
  const window = singaporeWindow(options.date, config.windowDaysAfterStart);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const runId = `${timestamp}-${compactWindow(window.start)}-${compactWindow(window.end)}`;
  acquireLock(runId);
  try {
    const runDir = join(OUTPUT_ROOT, runId);
    mkdirSync(runDir, { recursive: false });
    copyFileSync(MANIFEST_PATH, join(runDir, 'manifest.snapshot.md'));
    copyFileSync(CONFIG_PATH, join(runDir, 'pipeline-config.snapshot.json'));
    const manifestSha256 = sha(manifestBytes);
    const definitionSha256 = sha(configBytes);
    const adapters = manifest.sources.filter((source) => source.enabled).map(({ adapterId, version }) => ({
      id: adapterId, version, definitionSha256
    })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const configSha256 = sha(JSON.stringify({ manifestSha256, adapters }));
    const now = new Date().toISOString();
    writeJson(join(runDir, 'run.json'), {
      schemaVersion: '1.0', runId, createdAt: now, updatedAt: now, status: 'pending',
      timezone: manifest.timezone, window,
      manifestSnapshot: { path: 'manifest.snapshot.md', sha256: manifestSha256 },
      adapterDefinitionsSnapshot: { path: 'pipeline-config.snapshot.json', sha256: definitionSha256 },
      configSha256, adapters, resume: { requestedRunId: null, parentRunId: null }, artifacts: {}
    });
    writeJson(statePath(runDir), {
      schemaVersion: '1.0', runId, createdAt: now, updatedAt: now, overallStatus: 'pending',
      sources: Object.fromEntries(manifest.sources.map((source) => [source.name, {
        adapterId: source.adapterId, sourceRole: source.sourceRole, operatingMode: source.operatingMode,
        collectionOrder: source.collectionOrder, precedence: source.precedence,
        status: source.operatingMode === 'disabled' ? 'disabled' : 'pending', counts: null, artifactRefs: [],
        error: source.operatingMode === 'disabled' ? `Source unavailable: ${source.unavailableReason ?? 'operator_disabled'}` : null,
        blockerReasonCode: source.operatingMode === 'disabled' ? (source.unavailableReason ?? 'operator_disabled') : null
      }])),
      normalization: { status: 'pending', counts: null, artifactRefs: [], venueBranches: [], error: null },
      deduplication: { status: 'pending', counts: null, artifactRefs: [], blockingReviews: [], error: null },
      resolutionPreparation: { status: 'pending', artifactRefs: [], error: null },
      venues: {}, verification: { status: 'pending', build: null, eventUi: null, browser: null, error: null },
      publication: { decision: 'none', reasonCodes: [], candidateSnapshotId: runId, activeSnapshotId: loadCurrentApprovedData(ROOT).snapshot?.snapshotId ?? null },
      finalizedAt: null
    });
    pipelineTrace(runDir, { stage: 'run', action: 'run_started', outcome: 'started', entityType: 'run', entityId: runId, counts: { sources: manifest.sources.length }, resumeDisposition: 'new' });
    for (const source of manifest.sources) pipelineTrace(runDir, { stage: 'configuration', action: 'source_configured', outcome: source.operatingMode === 'disabled' ? 'disabled' : 'success', sourceName: source.name, sourceRole: source.sourceRole, operatingMode: source.operatingMode, adapterId: source.adapterId, adapterVersion: source.version, entityType: 'source', entityId: source.name, reasonCode: source.operatingMode === 'disabled' ? (source.unavailableReason ?? 'operator_disabled') : null });
    if (!options.quiet) {
      process.stdout.write(`${JSON.stringify({ runDir, ...progressResponse(loadState(runId)) }, null, 2)}\n`);
      process.exitCode = CONTINUE_EXIT_CODE;
    }
    return { runId, runDir };
  } finally {
    releaseLock();
  }
}

function runAll(options) {
  const created = start({ ...options, quiet: true });
  process.exitCode = 0;
  return advance({ run: created.runId });
}

function readResult(path) {
  if (!path) fail('--result must point to a JSON result file');
  return readJson(resolve(ROOT, path));
}

function validateSourceResult(result) {
  if (![...TERMINAL_SOURCE, 'pending', 'pilot_failed'].includes(result.status)) fail('Source status must be pending, success, pilot_failed, blocked, or failed');
  if (result.status === 'success') {
    const required = ['pages', 'sourceRecordsReceived', 'invalidSourceRecords', 'processedSourceRecords', 'occurrencesEmitted', 'excludedOccurrences', 'eligiblePreDedup'];
    for (const key of required) if (!Number.isInteger(result.counts?.[key]) || result.counts[key] < 0) fail(`Invalid source count: ${key}`);
    const c = result.counts;
    if (c.sourceRecordsReceived !== c.invalidSourceRecords + c.processedSourceRecords) fail('Source record accounting does not reconcile');
    if (c.occurrencesEmitted !== c.excludedOccurrences + c.eligiblePreDedup) fail('Occurrence accounting does not reconcile');
    if (!Array.isArray(result.artifactRefs) || result.artifactRefs.length === 0) fail('A successful source requires artifactRefs');
    if (result.completion?.paginationComplete !== true) fail('A successful source requires completion.paginationComplete');
    if (!Array.isArray(result.completion.pagesVisited) || result.completion.pagesVisited.length !== c.pages) fail('completion.pagesVisited must account for every page');
    if (result.completion.sourceRecordsDiscovered !== c.sourceRecordsReceived) fail('completion.sourceRecordsDiscovered must match sourceRecordsReceived');
    const rendered = result.completion.providerReportedTotal === null;
    if (rendered && result.completion.derivedTotal !== c.sourceRecordsReceived) fail('completion.derivedTotal must match sourceRecordsReceived');
    if (!rendered && (!Number.isInteger(result.completion.providerReportedTotal) || result.completion.providerReportedTotal !== c.sourceRecordsReceived)) fail('completion.providerReportedTotal must match sourceRecordsReceived');
    if (!Array.isArray(result.completion.pageRecordCounts) || result.completion.pageRecordCounts.length !== c.pages || result.completion.pageRecordCounts.some((count) => !Number.isInteger(count) || count < 0)) fail('completion.pageRecordCounts must provide a non-negative count for every page');
    if (!rendered && result.completion.pageRecordCounts.reduce((sum, count) => sum + count, 0) !== c.sourceRecordsReceived) fail('completion.pageRecordCounts must sum to sourceRecordsReceived');
    if (c.sourceRecordsReceived === 0 && result.completion.zeroResultConfirmed !== true) fail('A zero-record success requires completion.zeroResultConfirmed');
    if (!Array.isArray(result.sourceRecordRefs) || result.sourceRecordRefs.length !== c.sourceRecordsReceived) fail('sourceRecordRefs must account for every received source record');
    if (!Array.isArray(result.invalidSourceRecordRefs) || result.invalidSourceRecordRefs.length !== c.invalidSourceRecords) fail('invalidSourceRecordRefs must account for every invalid source record');
    if (!Array.isArray(result.processedSourceRecordRefs) || result.processedSourceRecordRefs.length !== c.processedSourceRecords) fail('processedSourceRecordRefs must account for every processed source record');
    const received = new Set(result.sourceRecordRefs);
    const partition = [...result.invalidSourceRecordRefs, ...result.processedSourceRecordRefs];
    if (received.size !== result.sourceRecordRefs.length || new Set(partition).size !== partition.length || partition.length !== received.size || partition.some((ref) => !received.has(ref))) {
      fail('Invalid and processed source record refs must exactly partition unique sourceRecordRefs');
    }
  } else if (result.status === 'pending') {
    if (typeof result.message !== 'string' || !result.message.trim()) fail('Pending source requires a progress message');
  } else if (result.status === 'blocked') {
    if (!EXTERNAL_BLOCKER_CODES.has(result.blockerReasonCode)) {
      fail(`Blocked source requires a genuine external blockerReasonCode: ${[...EXTERNAL_BLOCKER_CODES].join(', ')}`);
    }
    if (!result.error) fail('Blocked source requires an error');
  } else if (result.status === 'pilot_failed') {
    if (!result.error) fail('Pilot failure requires an error');
  } else if (!result.error) fail('Failed source requires an error');
}

function baseArtifactRef(recordRef) {
  if (typeof recordRef !== 'string' || !recordRef.includes('#/')) fail(`Invalid source record pointer: ${recordRef}`);
  return recordRef.slice(0, recordRef.indexOf('#'));
}

function pointerFromArtifactRef(recordRef) {
  return recordRef.slice(recordRef.indexOf('#') + 1);
}

function jsonPointer(value, pointer) {
  if (pointer === '') return value;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) fail(`Invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split('/').reduce((current, token) => {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || current === undefined || !(key in Object(current))) fail(`JSON pointer does not resolve: ${pointer}`);
    return current[key];
  }, value);
}

function parseEventBoundary(value, endOfDay = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const dayMonthYear = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  const timestamp = dayMonthYear
    ? Date.parse(`${dayMonthYear[1]} ${dayMonthYear[2]} ${dayMonthYear[3]} ${endOfDay ? '23:59:59' : '00:00:00'} +0800`)
    : Date.parse(trimmed);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function eventInterval(event) {
  let start = parseEventBoundary(event.startDateTime);
  let end = parseEventBoundary(event.endDateTime, true);
  if (start === null && typeof event.dateText === 'string') {
    const parts = event.dateText.split(/\s+to\s+/i);
    start = parseEventBoundary(parts[0]);
    end = parseEventBoundary(parts.at(-1), true);
  }
  if (start === null) return null;
  return { start, end: end ?? start };
}

function eventFinalBoundary(event) {
  for (const value of [event.schedule?.finalKnownOccurrence, event.schedule?.end, event.endDateTime]) {
    const boundary = parseEventBoundary(value, true);
    if (boundary !== null) return boundary;
  }
  if (['selectable', 'recurring', 'anytime', 'unverified'].includes(event.schedule?.kind)) return null;
  return eventInterval(event)?.end ?? null;
}

function validateNormalizedSemantics(runDir, normalizedEvents, result, runWindow) {
  const events = normalizedEvents.records;
  if (result.counts.acceptedPrimary !== events.length) fail('acceptedPrimary must equal normalized event records');
  const ids = new Set();
  const byId = new Map();
  for (const event of events) {
    if (typeof event.id !== 'string' || !event.id || ids.has(event.id)) fail('Normalized events require unique non-empty ids');
    ids.add(event.id);
    byId.set(event.id, event);
    if (event.isOnline !== true && (typeof event.venue !== 'string' || !event.venue.trim())) fail(`Physical event ${event.id} requires a venue`);
    const finalBoundary = eventFinalBoundary(event);
    if (finalBoundary !== null && finalBoundary < Date.parse(runWindow.start) && event.lifecycleState !== 'archived') fail(`Normalized event ${event.id} ended before the run and was not archived`);
  }
  const branched = new Set();
  for (const branch of result.venueBranches) {
    if (!branch.id || typeof branch.venue !== 'string' || !branch.venue.trim() || !Array.isArray(branch.eventIds) || branch.eventIds.length === 0) fail('Each venue branch needs id, venue, and eventIds');
    for (const eventId of branch.eventIds) {
      const event = byId.get(eventId);
      if (!event) fail(`Venue branch references unknown event: ${eventId}`);
      if (branched.has(eventId)) fail(`Event appears in multiple venue branches: ${eventId}`);
      if (event.isOnline === true) fail(`Online event must not enter a venue branch: ${eventId}`);
      if (normalizeText(event.venue) !== normalizeText(branch.venue)) fail(`Venue branch ${branch.id} mixes events from different venues`);
      branched.add(eventId);
    }
  }
  const expectedBranched = events.filter((event) => event.isOnline !== true && (event.lifecycleState ?? 'active') === 'active' && (event.publicPlacement !== 'off_map' || event.mappingStatus === 'pending_review')).map((event) => event.id);
  if (branched.size !== expectedBranched.length || expectedBranched.some((id) => !branched.has(id))) fail('Venue branches must exactly partition physical normalized events');
}

function reconcileNormalizedVenueBranches(previousVenues, branches) {
  let changedBranch = false;
  const venues = Object.fromEntries(branches.map((branch) => {
    const previous = previousVenues[branch.id];
    const unchanged = previous && normalizeText(previous.venue) === normalizeText(branch.venue)
      && previous.eventIds.length === branch.eventIds.length
      && previous.eventIds.every((id) => branch.eventIds.includes(id));
    if (!unchanged) changedBranch = true;
    return [branch.id, unchanged ? previous : {
      venue: branch.venue, eventIds: branch.eventIds,
      stages: Object.fromEntries(STAGES.map((stage) => [stage, { status: 'pending', outputRef: null, error: null }]))
    }];
  }));
  return { venues, changedBranch };
}

function validateStageEventIds(stage, expectedEventIds, result) {
  const inputEventIds = result.result?.inputEventIds;
  if (!Array.isArray(inputEventIds) || inputEventIds.length !== expectedEventIds.length || new Set(inputEventIds).size !== inputEventIds.length || expectedEventIds.some((id) => !inputEventIds.includes(id))) {
    fail(`Successful ${stage} must preserve every event in its venue branch`);
  }
}

function validateHighlightArtifacts(result, root = ROOT) {
  if (result.stage !== 'highlight' || result.status !== 'success') return;
  const tilesetRef = result.result?.poiTilesetUrl;
  if (typeof tilesetRef !== 'string' || !tilesetRef.trim()) fail('Successful highlight requires poiTilesetUrl');
  const tilesetPath = resolve(root, tilesetRef.replace(/^\//, ''));
  if (!tilesetPath.startsWith(`${resolve(root)}${process.platform === 'win32' ? '\\' : '/'}`) || !existsSync(tilesetPath)) fail(`Successful highlight tileset does not exist: ${tilesetRef}`);
  const tileset = readJson(tilesetPath);
  const extractionManifestPath = join(dirname(tilesetPath), 'extraction-manifest.json');
  const declaredManifestRef = result.result?.extractionManifestUrl;
  if (typeof declaredManifestRef !== 'string' || resolve(root, declaredManifestRef.replace(/^\//, '')) !== extractionManifestPath) fail('Successful highlight requires extractionManifestUrl beside its POI tileset');
  if (!existsSync(extractionManifestPath)) fail(`Successful highlight extraction manifest does not exist: ${relative(root, extractionManifestPath)}`);
  const extractionManifest = readJson(extractionManifestPath);
  if (extractionManifest.poiId !== result.result?.poiId || !Array.isArray(extractionManifest.tiles) || !extractionManifest.tiles.length) fail('Successful highlight requires a non-empty extraction manifest for the same poiId');
  const contentRefs = [];
  const visit = (tile) => {
    const uri = tile?.content?.uri ?? tile?.content?.url;
    if (uri) contentRefs.push(uri);
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(tileset.root);
  if (!contentRefs.length) fail(`Successful highlight tileset contains no tile content: ${tilesetRef}`);
  for (const contentRef of contentRefs) {
    if (typeof contentRef !== 'string' || /^(?:https?:|data:)/i.test(contentRef)) fail(`Highlight tileset must reference local tile content: ${contentRef}`);
    const contentPath = resolve(dirname(tilesetPath), contentRef);
    if (!contentPath.startsWith(`${dirname(tilesetPath)}${process.platform === 'win32' ? '\\' : '/'}`) || !existsSync(contentPath)) fail(`Successful highlight tile does not exist: ${relative(root, contentPath)}`);
  }
  const manifestedFiles = new Set(extractionManifest.tiles.map((tile) => tile.poiFile));
  if (contentRefs.some((contentRef) => !manifestedFiles.has(basename(contentRef)))) fail('Highlight tileset content is not fully covered by its extraction manifest');
  for (const backgroundRef of result.result?.backgroundTileRefs ?? []) {
    if (!existsSync(resolve(root, String(backgroundRef).replace(/^\//, '')))) fail(`Successful highlight background reference does not exist: ${backgroundRef}`);
  }
}

function validateResolveRecoveryEvidence(runDir, runId, venueId, expectedEventIds, result) {
  if (result.stage !== 'resolve' || result.status !== 'unresolved') return;
  const domain = result.result ?? {};
  if (!['needs_review', 'not_mappable'].includes(domain.resolutionStatus)) fail('Unresolved stage requires resolutionStatus needs_review or not_mappable');
  if (!Array.isArray(domain.inputEventIds) || expectedEventIds.some((id) => !domain.inputEventIds.includes(id))) fail('Resolution outcome must cover every venue-branch event');
  if (!domain.finalReason || !Array.isArray(domain.evidenceInspected) || domain.evidenceInspected.length === 0) fail('Resolution outcome requires evidence and a final reason');
  const isSearchHost = (hostname) => /(?:^|\.)(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/i.test(hostname);
  for (const evidence of domain.evidenceInspected) {
    if (!evidence?.url) continue;
    let parsed;
    try { parsed = new URL(evidence.url); } catch { fail(`Invalid resolution evidence URL: ${evidence.url}`); }
    if (isSearchHost(parsed.hostname)) fail('Search-result URLs are discovery aids, not inspected venue evidence');
  }
  if (!domain.cacheKey || !domain.evidenceHash) fail('Resolution outcome requires reusable cacheKey and evidenceHash');
  if (domain.resolutionStatus === 'not_mappable') {
    const classification = domain.notMappableEvidence;
    const allowedReasons = new Set(['outside_singapore', 'mobile_venue', 'multi_venue', 'no_target_building']);
    if (!classification || !allowedReasons.has(classification.reasonCode)) fail('not_mappable requires affirmative classification evidence; a local lookup miss is not sufficient');
    if (!Array.isArray(classification.sourceUrls) || classification.sourceUrls.length === 0) fail('not_mappable requires at least one evidence URL');
    for (const url of classification.sourceUrls) {
      try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
      catch { fail(`Invalid not_mappable evidence URL: ${url}`); }
    }
    return;
  }

  const webResearch = domain.webResearch;
  if (!Array.isArray(webResearch) || webResearch.length < 2) fail('needs_review requires at least two documented web research attempts');
  const researchTypes = new Set();
  for (const attempt of webResearch) {
    if (!['venue_official', 'host_or_authority'].includes(attempt?.sourceType)) fail('Web research must cover venue_official and host_or_authority sources');
    researchTypes.add(attempt.sourceType);
    if (typeof attempt.query !== 'string' || !attempt.query.trim()) fail('Each web research attempt requires its query');
    if (!attempt.checkedAt || !Number.isFinite(Date.parse(attempt.checkedAt))) fail('Each web research attempt requires a valid checkedAt timestamp');
    if (typeof attempt.outcome !== 'string' || !attempt.outcome.trim()) fail('Each web research attempt requires an outcome');
    if (!Array.isArray(attempt.resultUrls)) fail('Each web research attempt requires resultUrls, including an empty array when nothing was found');
    for (const url of attempt.resultUrls) {
      let parsed;
      try {
        parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        fail(`Invalid web research URL: ${url}`);
      }
      if (isSearchHost(parsed.hostname)) fail('Web research resultUrls must be pages actually inspected, not search-result URLs');
    }
  }
  if (!researchTypes.has('venue_official') || !researchTypes.has('host_or_authority')) fail('Web research must cover venue official and host/authority recovery paths');

  const localLookups = domain.localLookupEvidence;
  if (!Array.isArray(localLookups) || localLookups.length < 2) fail('needs_review requires address enrichment and OneMap candidate lookup evidence');
  const lookupTools = new Set(localLookups.map((lookup) => lookup?.tool));
  if (![...lookupTools].some((tool) => ['venue-index:enrich', 'venue-index:resolve', 'search-local-venues'].includes(tool))) fail('needs_review requires a local address or coordinate lookup');
  if (!lookupTools.has('find-poi-tile-candidates')) fail('needs_review requires a clean OneMap candidate lookup');
  for (const lookup of localLookups) {
    if (typeof lookup.query !== 'string' || !lookup.query.trim() || typeof lookup.outcome !== 'string' || !lookup.outcome.trim()) fail('Each local lookup requires a query and outcome');
  }

  if (!Array.isArray(domain.recoveryAttempts) || domain.recoveryAttempts.length < 2) fail('needs_review requires two distinct recovery attempts');
  const attemptNumbers = new Set();
  for (const attempt of domain.recoveryAttempts) {
    if (!Number.isInteger(attempt?.attempt) || attempt.attempt < 1 || typeof attempt.approach !== 'string' || !attempt.approach.trim() || typeof attempt.outcome !== 'string' || !attempt.outcome.trim()) fail('Each recovery attempt requires an attempt number, approach, and outcome');
    attemptNumbers.add(attempt.attempt);
  }
  if (!attemptNumbers.has(1) || !attemptNumbers.has(2)) fail('needs_review requires recovery attempts 1 and 2');
  if (!Array.isArray(domain.competingCandidates)) fail('needs_review requires competingCandidates, including an empty array when no candidate exists');
  const localResolutionPath = join(runDir, 'local-venue-resolution.json');
  const localRow = existsSync(localResolutionPath) ? readJson(localResolutionPath).results?.find((row) => row.venueId === venueId) : null;
  const expectedGmlIds = [...new Set((localRow?.alternatives ?? []).flatMap((candidate) => candidate.gmlIds ?? []))];
  if (expectedGmlIds.length) {
    const submittedGmlIds = new Set(domain.competingCandidates.flatMap((candidate) => candidate?.gmlIds ?? (candidate?.gmlId ? [candidate.gmlId] : [])));
    if (expectedGmlIds.some((gmlId) => !submittedGmlIds.has(gmlId))) fail('needs_review must explicitly carry every local OneMap alternative into competingCandidates');
  }
}

function validateApprovedResolution(result, root = ROOT) {
  if (result.stage !== 'resolve' || result.status !== 'success') return;
  const value = result.result ?? {};
  if (value.resolutionStatus !== 'approved') fail('Successful resolve requires resolutionStatus approved');
  if (typeof value.poiId !== 'string' || !value.poiId || typeof value.canonicalVenue !== 'string' || !value.canonicalVenue) fail('Approved resolution requires poiId and canonicalVenue');
  const gmlIds = value.gmlIds?.length ? value.gmlIds : [value.gmlId].filter(Boolean);
  if (!gmlIds.length || gmlIds.some((gmlId) => typeof gmlId !== 'string' || !gmlId) || !Array.isArray(value.acceptedGmlNames) || value.acceptedGmlNames.length === 0) fail('Approved resolution requires exact GML identities and accepted names');
  if (!Number.isFinite(value.coordinates?.lng) || !Number.isFinite(value.coordinates?.lat)) fail('Approved resolution requires verified coordinates');
  if (!Array.isArray(value.sourceTiles) || value.sourceTiles.length === 0) fail('Approved resolution requires clean source tiles and batch IDs');
  for (const tile of value.sourceTiles) {
    const path = tile.path ?? tile.tilePath;
    if (typeof path !== 'string' || !/^(?:tiles|optimized-tiles)\/.+\.b3dm$/.test(path)) fail('Approved resolution source tiles must reference clean tiles or optimized-tiles b3dm files');
    if (!Array.isArray(tile.batchIds) || tile.batchIds.length === 0 || tile.batchIds.some((id) => !Number.isInteger(id) || id < 0)) fail('Approved resolution source tiles require exact non-negative batch IDs');
  }
  validateOneMapTileEvidence(root, value);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) fail('Approved resolution requires executable or authoritative evidence');
}

function validateSourceEvidence(runDir, state, result) {
  if (result.status !== 'success') return;
  const runPath = join(runDir, 'run.json');
  const run = existsSync(runPath) ? readJson(runPath) : null;
  const declared = new Set(result.artifactRefs);
  if (result.sourceRole === 'discovery') {
    for (const ref of result.artifactRefs) if (!existsSync(artifactPath(runDir, ref))) fail(`Discovery evidence does not exist: ${ref}`);
    for (const recordRef of result.processedSourceRecordRefs) {
      const base = baseArtifactRef(recordRef), envelope = readJson(artifactPath(runDir, base));
      const index = Number(recordRef.match(/#\/records\/(\d+)$/)?.[1]);
      if (envelope.records?.[index]?.recordType !== 'discovery') fail(`Discovery record pointer does not resolve: ${recordRef}`);
    }
    return;
  }
  const totalEvidence = result.completion.providerTotalEvidence;
  if (result.completion.providerReportedTotal !== null) {
    if (!totalEvidence?.artifactRef || !totalEvidence?.jsonPointer) fail('A successful API source requires providerTotalEvidence artifactRef and jsonPointer');
    if (!/^raw\/[^/]+\/listings\/page-\d{4}\.json$/.test(totalEvidence.artifactRef)) fail('providerTotalEvidence must target a raw listing JSON response');
    if (!declared.has(totalEvidence.artifactRef)) fail('providerTotalEvidence artifact is not declared in artifactRefs');
    const providerTotal = jsonPointer(readJson(artifactPath(runDir, totalEvidence.artifactRef)), totalEvidence.jsonPointer);
    if (providerTotal !== result.completion.providerReportedTotal) fail('providerReportedTotal does not match the raw provider response');
  }
  for (const pageRef of result.completion.pagesVisited) {
    if (!/^raw\/[^/]+\/listings\/page-\d{4}\.json$/.test(pageRef)) fail(`API pagination evidence must be an untouched listing JSON response: ${pageRef}`);
    if (!declared.has(pageRef)) fail(`Pagination evidence is not declared in artifactRefs: ${pageRef}`);
    const pagePath = artifactPath(runDir, pageRef);
    if (!existsSync(pagePath)) fail(`Pagination evidence does not exist: ${pageRef}`);
    const pageEvidence = readJson(pagePath);
    if (!pageEvidence || typeof pageEvidence !== 'object') fail(`Pagination evidence is not a JSON object: ${pageRef}`);
  }
  const processedRefs = result.processedSourceRecordRefs ?? result.sourceRecordRefs;
  const invalidRefs = result.invalidSourceRecordRefs ?? [];
  const detailBases = new Set(processedRefs.map(baseArtifactRef));
  if (result.completion.detailPagesCaptured !== detailBases.size) fail('completion.detailPagesCaptured must match unique detail artifacts');
  if (!Number.isInteger(result.completion.detailUrlsDiscovered) || result.completion.detailUrlsDiscovered < detailBases.size) fail('completion.detailUrlsDiscovered must account for captured detail pages');
  for (const recordRef of processedRefs) {
    const base = baseArtifactRef(recordRef);
    if (!/^raw\/[^/]+\/details\/[^/]+\.json$/.test(base)) fail(`Source record pointer must target a detail fixture under raw/<source>/details/: ${recordRef}`);
    if (!declared.has(base)) fail(`Source record artifact is not declared in artifactRefs: ${base}`);
    const envelope = readJson(artifactPath(runDir, base));
    const index = Number(recordRef.match(/#\/records\/(\d+)$/)?.[1]);
    if (!Number.isInteger(index) || !Array.isArray(envelope.records) || !envelope.records[index]) fail(`Source record pointer does not resolve: ${recordRef}`);
    if (envelope.schemaVersion !== '1.0' || envelope.runId !== state.runId || !envelope.createdAt) fail(`Detail fixture envelope is not bound to the current run: ${base}`);
    const record = envelope.records[index];
    let detailUrl;
    try { detailUrl = new URL(record.detailUrl); } catch { fail(`Detail fixture has an invalid detailUrl: ${recordRef}`); }
    if (!['http:', 'https:'].includes(detailUrl.protocol)) fail(`Detail fixture has a non-web detailUrl: ${recordRef}`);
    const expectedFixtureName = `${sha(detailUrl.href)}.json`;
    if (basename(base) !== expectedFixtureName) fail(`Detail fixture filename mismatch for ${detailUrl.href}: expected ${expectedFixtureName}, received ${basename(base)}`);
    if (!record.adapterId || !record.adapterVersion || !record.adapterDefinitionHash || !record.providerId
      || !record.providerOwner || !['free', 'open'].includes(record.providerCostClass)
      || !record.retrievedAt || !Number.isFinite(Date.parse(record.retrievedAt))
      || !Number.isInteger(record.listingPage) || !record.sourceId) {
      fail(`Detail fixture lacks required adapter/provider/retrieval identity: ${recordRef}`);
    }
    if (run && (record.requestedWindow?.start !== run.window.start || record.requestedWindow?.end !== run.window.end
      || record.requestedWindow?.timezone !== run.timezone)) fail(`Detail fixture requestedWindow does not match the run: ${recordRef}`);
    const provenance = record.provenance;
    if (!provenance?.parentListingRef || !provenance?.responseRef || !provenance?.officialReferenceRef || !provenance?.officialReference) {
      fail(`Detail fixture lacks listing/detail/official provenance pointers: ${recordRef}`);
    }
    for (const evidenceRef of [provenance.responseRef, provenance.officialReferenceRef]) {
      if (!declared.has(evidenceRef) || !existsSync(artifactPath(runDir, evidenceRef))) fail(`Detail fixture provenance is missing declared evidence: ${evidenceRef}`);
    }
    const official = readJson(artifactPath(runDir, provenance.officialReferenceRef));
    if (official.status < 200 || official.status >= 400 || official.status !== provenance.officialReference.status
      || official.finalUrl !== provenance.officialReference.finalUrl) fail(`Official event reference evidence is invalid: ${recordRef}`);
  }
  for (const recordRef of invalidRefs) {
    const base = baseArtifactRef(recordRef);
    if (!declared.has(base)) fail(`Invalid source record artifact is not declared in artifactRefs: ${base}`);
    if (/^raw\/[^/]+\/listings\/page-\d{4}\.json$/.test(base)) {
      jsonPointer(readJson(artifactPath(runDir, base)), pointerFromArtifactRef(recordRef));
    } else if (!/^raw\/[^/]+\/details\/[^/]+\.json$/.test(base)) {
      fail(`Invalid source record must target raw listing evidence or a detail fixture: ${recordRef}`);
    }
  }
}

function validateSourceSemantics(runDir, state, result) {
  if (result.status !== 'success') return;
  if (result.sourceRole === 'discovery') {
    const publishableDecisions = new Set(['authority_confirmed', 'already_collected_authority', 'direct_reused', 'editorial_sufficient']);
    const outcomes = Object.entries(result.counts.confirmationOutcomeCounts ?? {});
    if (outcomes.some(([, count]) => !Number.isInteger(count) || count < 0)) fail('Discovery confirmation outcome counts are invalid');
    const occurrencesEmitted = outcomes.reduce((sum, [, count]) => sum + count, 0);
    const eligiblePreDedup = outcomes.reduce((sum, [decision, count]) => sum + (publishableDecisions.has(decision) ? count : 0), 0);
    const excludedOccurrences = occurrencesEmitted - eligiblePreDedup;
    if (result.counts.discoveryRecordsReceived !== result.counts.sourceRecordsReceived
      || result.counts.processedSourceRecords !== result.processedSourceRecordRefs.length
      || result.counts.occurrencesEmitted !== occurrencesEmitted
      || result.counts.eligiblePreDedup !== eligiblePreDedup
      || result.counts.excludedOccurrences !== excludedOccurrences) {
      fail('Discovery source accounting does not match authority-confirmation outcomes');
    }
    return;
  }
  const run = readJson(join(runDir, 'run.json'));
  let occurrencesEmitted = 0;
  let excludedOccurrences = 0;
  let eligiblePreDedup = 0;
  for (const recordRef of result.processedSourceRecordRefs) {
    const base = baseArtifactRef(recordRef);
    const envelope = readJson(artifactPath(runDir, base));
    const index = Number(recordRef.match(/#\/records\/(\d+)$/)?.[1]);
    const record = envelope.records?.[index];
    if (!record) fail(`Processed source record does not resolve: ${recordRef}`);
    if (!['physical', 'online', 'hybrid', 'unknown'].includes(record.mode)) fail(`Processed source record has unsupported mode: ${recordRef}`);
    const occurrences = Array.isArray(record.performances) && record.performances.length ? record.performances : [record];
    for (const performance of occurrences) {
      occurrencesEmitted += 1;
      const policy = assessActivityInclusion({ ...record, ...performance }, { asOf: run.window.start });
      const mapEligible = !record.reasonCode && policy.eligible && record.mode !== 'online'
        && typeof record.venue === 'string' && record.venue.trim();
      if (mapEligible) eligiblePreDedup += 1;
      else excludedOccurrences += 1;
    }
  }
  if (result.counts.occurrencesEmitted !== occurrencesEmitted) fail(`occurrencesEmitted must equal ${occurrencesEmitted} from detail fixtures`);
  if (result.counts.excludedOccurrences !== excludedOccurrences) fail(`excludedOccurrences must equal ${excludedOccurrences} from the run window and mode contract`);
  if (result.counts.eligiblePreDedup !== eligiblePreDedup) fail(`eligiblePreDedup must equal ${eligiblePreDedup} from the run window and mode contract`);
}

function recordSource(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  if (!(options.source in state.sources)) fail(`Unknown source: ${options.source}`);
  const result = readResult(options.result);
  validateSourceResult(result);
  validateSourceEvidence(runDir, state, result);
  validateSourceSemantics(runDir, state, result);
  if (result.status === 'success') registerArtifacts(runDir, result.artifactRefs);
  state.sources[options.source] = {
    ...state.sources[options.source], status: result.status, counts: result.counts ?? null,
    artifactRefs: result.artifactRefs ?? [], error: result.error ?? null,
    message: result.message ?? null, blockerReasonCode: result.blockerReasonCode ?? null,
    completion: result.completion ?? null,
    sourceRole: result.sourceRole ?? state.sources[options.source].sourceRole,
    operatingMode: result.operatingMode ?? state.sources[options.source].operatingMode,
    confirmationRefs: result.confirmationRefs ?? [], authorityRefs: result.authorityRefs ?? [],
    sourceRecordRefs: result.sourceRecordRefs ?? [],
    invalidSourceRecordRefs: result.invalidSourceRecordRefs ?? [],
    processedSourceRecordRefs: result.processedSourceRecordRefs ?? []
    , invalidReasonCodes: result.invalidReasonCodes ?? {}, completedAt: new Date().toISOString()
  };
  saveState(runDir, state);
  printNext(state);
}

function replaceLastSuccessfulUse(markdown, sourceName, timestamp) {
  const lines = markdown.split(/\r?\n/);
  let updated = false;
  const next = lines.map((line) => {
    const cells = line.split('|');
    if (cells.length < 7 || cells[1]?.trim() !== sourceName) return line;
    const previous = cells[5] ?? ' ';
    const leading = previous.match(/^\s*/)?.[0] || ' ';
    const trailing = previous.match(/\s*$/)?.[0] || ' ';
    cells[5] = `${leading}\`${timestamp}\`${trailing}`;
    updated = true;
    return cells.join('|');
  });
  return { markdown: next.join('\n'), updated };
}

function updateLastSuccessfulUse(sourceName, timestamp) {
  const result = replaceLastSuccessfulUse(readFileSync(MANIFEST_PATH, 'utf8'), sourceName, timestamp);
  const { updated } = result;
  if (!updated) fail(`Cannot update Last successful use for ${sourceName}`);
  atomicWrite(MANIFEST_PATH, result.markdown);
}

async function collectSourceCommand(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  if (!(options.source in state.sources)) fail(`Unknown source: ${options.source}`);
  const config = readPipelineConfig();
  const source = config.sources.find((item) => item.enabled && item.name === options.source);
  if (!source) fail(`No enabled executable adapter for source: ${options.source}`);
  const resultPath = join(runDir, `${source.adapterId}.result.json`);
  const corroborationRecords = Object.entries(state.sources).flatMap(([sourceName, collected]) => {
    if (sourceName === options.source || collected.status !== 'success') return [];
    return (collected.processedSourceRecordRefs ?? []).flatMap((recordRef) => {
      try {
        const envelope = readJson(artifactPath(runDir, baseArtifactRef(recordRef)));
        const index = Number(recordRef.match(/#\/records\/(\d+)$/)?.[1]);
        const record = envelope.records?.[index];
        return record ? [{ ...record, sourceRecordId: record.sourceRecordId ?? record.sourceId ?? record.discoveryRecordId, sourceRole: collected.sourceRole }] : [];
      } catch { return []; }
    });
  });
  const result = await collectSource({
    runDir,
    run: readJson(join(runDir, 'run.json')),
    source,
    paginationCeiling: config.paginationCeiling,
    requestPolicy: config.requestPolicy,
    corroborationRecords,
    logger: (record) => pipelineTrace(runDir, { stage: record.stage ?? 'retrieval', action: record.action ?? 'retrieval', outcome: record.action?.includes('complete') ? 'success' : 'started', sourceName: options.source, entityType: 'request', entityId: record.entityId ?? `${options.source}:${record.pageIndex ?? 'batch'}`, attempt: record.attempt, durationMs: record.durationMs, counts: { urls: record.urls, results: record.results, errors: record.errors } }),
  });
  writeJson(resultPath, result);
  recordSource({ run: options.run, source: options.source, result: resultPath });
  pipelineTrace(runDir, { stage: 'collection', action: 'source_terminal', outcome: result.status, sourceName: options.source, sourceRole: source.sourceRole, operatingMode: source.operatingMode, adapterId: source.adapterId, adapterVersion: source.version, entityType: 'source', entityId: options.source, counts: result.counts, reasonCode: result.blockerReasonCode ?? null, blocker: result.error ?? null, nextAction: `npm run event-pipeline -- advance --run ${options.run}` });
  if (result.status === 'success') updateLastSuccessfulUse(options.source, new Date().toISOString());
}

function recordNormalization(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  let normalizationChangedBranch = true;
  if (Object.values(state.sources).some((source) => !TERMINAL_SOURCE.has(source.status))) fail('Cannot normalize until every source is terminally accounted for');
  const result = readResult(options.result);
  if (result.status !== 'success' && result.status !== 'failed') fail('Normalization status must be success or failed');
  if (result.status === 'success') {
    const requiredArtifacts = ['normalized/events.json', 'normalized/excluded.json', 'normalized/invalid.json', 'normalized/dedup-decisions.json'];
    for (const path of requiredArtifacts) if (!existsSync(join(runDir, path))) fail(`Missing normalization artifact: ${path}`);
    const normalizedEvents = readJson(join(runDir, 'normalized/events.json'));
    const normalizedExcluded = readJson(join(runDir, 'normalized/excluded.json'));
    const normalizedInvalid = readJson(join(runDir, 'normalized/invalid.json'));
    for (const [name, envelope] of [['events', normalizedEvents], ['excluded', normalizedExcluded], ['invalid', normalizedInvalid]]) {
      if (!Array.isArray(envelope.records) || envelope.counts?.records !== envelope.records.length) fail(`normalized/${name}.json record count does not match its records`);
    }
    const successfulSources = Object.values(state.sources).filter((source) => source.status === 'success' && source.operatingMode !== 'pilot');
    for (const [sourceName, recordRefs] of Object.entries(result.sourceReclassifications ?? {})) {
      const source = state.sources[sourceName];
      if (!source || source.status !== 'success' || !Array.isArray(recordRefs)) fail(`Invalid source reclassification: ${sourceName}`);
      for (const recordRef of recordRefs) {
        const reason = source.invalidReasonCodes?.[recordRef];
        if (!['invalid_date', 'invalid_mode'].includes(reason) || !source.invalidSourceRecordRefs.includes(recordRef)) {
          fail(`Source reclassification is not an optional-field record: ${sourceName}/${recordRef}`);
        }
        source.invalidSourceRecordRefs = source.invalidSourceRecordRefs.filter((ref) => ref !== recordRef);
        if (!source.processedSourceRecordRefs.includes(recordRef)) source.processedSourceRecordRefs.push(recordRef);
        delete source.invalidReasonCodes[recordRef];
      }
      source.counts.invalidSourceRecords = source.invalidSourceRecordRefs.length;
      source.counts.processedSourceRecords = source.processedSourceRecordRefs.length;
      if (source.counts.sourceRecordsReceived !== source.counts.invalidSourceRecords + source.counts.processedSourceRecords) {
        fail(`Source reclassification does not reconcile: ${sourceName}`);
      }
    }
    const expectedInvalidRefs = new Set(successfulSources.flatMap((source) => source.invalidSourceRecordRefs));
    if (normalizedInvalid.records.some((record) => typeof record.reasonCode !== 'string' || !record.reasonCode)) fail('Every normalized invalid record requires a stable reasonCode');
    const actualInvalidRefs = new Set(normalizedInvalid.records.map((record) => record.sourceRecordRef));
    if (actualInvalidRefs.size !== normalizedInvalid.records.length || expectedInvalidRefs.size !== actualInvalidRefs.size || [...expectedInvalidRefs].some((ref) => !actualInvalidRefs.has(ref))) {
      fail('normalized/invalid.json does not exactly account for invalid source record refs');
    }
    const processedEvidenceRefs = new Set([
      ...normalizedEvents.records.flatMap((event) => Array.isArray(event.sources) ? event.sources.map((source) => source.recordRef) : []),
      ...normalizedExcluded.records.map((record) => record.sourceRecordRef)
    ]);
    const expectedProcessedRefs = new Set(successfulSources.flatMap((source) => source.processedSourceRecordRefs));
    if ([...expectedProcessedRefs].some((ref) => !processedEvidenceRefs.has(ref)) || [...processedEvidenceRefs].some((ref) => !expectedProcessedRefs.has(ref))) {
      fail('Normalized events and exclusions do not account for processed source record refs');
    }
    for (const [sourceName, accounting] of Object.entries(result.sourceAccounting ?? {})) {
      const source = state.sources[sourceName];
      if (!source?.counts) continue;
      for (const key of ['occurrencesEmitted', 'excludedOccurrences', 'eligiblePreDedup']) {
        if (!Number.isInteger(accounting[key]) || accounting[key] < 0) fail(`Invalid normalization source accounting: ${sourceName}/${key}`);
      }
      if (accounting.excludedOccurrences + accounting.eligiblePreDedup !== accounting.occurrencesEmitted) fail(`Normalization source accounting does not reconcile for ${sourceName}`);
      Object.assign(source.counts, accounting);
    }
    const eligiblePreDedup = successfulSources.reduce((total, source) => total + source.counts.eligiblePreDedup, 0);
    for (const key of ['eligiblePreDedup', 'duplicateCollapsed', 'acceptedPostDedup', 'acceptedPrimary']) {
      if (!Number.isInteger(result.counts?.[key]) || result.counts[key] < 0) fail(`Invalid normalization count: ${key}`);
    }
    if (result.counts.eligiblePreDedup !== eligiblePreDedup) fail('Normalization eligiblePreDedup does not match successful source totals');
    if (result.counts.acceptedPostDedup !== eligiblePreDedup - result.counts.duplicateCollapsed) fail('Deduplication accounting does not reconcile');
    if (result.counts.acceptedPrimary !== result.counts.acceptedPostDedup) fail('Primary attribution accounting does not reconcile');
    if (!Array.isArray(result.venueBranches)) fail('Successful normalization requires venueBranches');
    validateNormalizedSemantics(runDir, normalizedEvents, result, readJson(join(runDir, 'run.json')).window);
    const previousVenues = state.venues;
    const reconciled = reconcileNormalizedVenueBranches(previousVenues, result.venueBranches);
    state.venues = reconciled.venues;
    normalizationChangedBranch = reconciled.changedBranch;
    registerArtifacts(runDir, requiredArtifacts, successfulSources.flatMap((source) => source.artifactRefs.map((reference) => readJson(join(runDir, 'run.json')).artifacts[reference]?.sha256).filter(Boolean)));
  } else if (!result.error) fail('Failed normalization requires an error');
  state.normalization = {
    status: result.status, counts: result.counts ?? null, artifactRefs: result.artifactRefs ?? [],
    venueBranches: result.venueBranches ?? [], sourceAccounting: result.sourceAccounting ?? {}, evidence: result.evidence ?? null, sourceReconciliation: result.sourceReconciliation ?? null, error: result.error ?? null
  };
  state.deduplication = { status: 'pending', counts: null, artifactRefs: [], blockingReviews: [], error: null };
  if (result.status === 'success' && result.venueBranches?.length === 0) state.resolutionPreparation = { status: 'success', artifactRefs: [], error: null };
  else if (normalizationChangedBranch) state.resolutionPreparation = { status: 'pending', artifactRefs: [], error: null };
  state.verification = { status: 'pending', build: null, eventUi: null, browser: null, error: null };
  saveState(runDir, state);
  pipelineTrace(runDir, { stage: 'normalization', action: 'normalization_terminal', outcome: result.status, entityType: 'run', entityId: options.run, counts: result.counts, blocker: result.error ?? null, nextAction: `npm run event-pipeline -- advance --run ${options.run}` });
  printNext(state);
}

function normalize(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  if (Object.values(state.sources).some((source) => !TERMINAL_SOURCE.has(source.status))) fail('Cannot normalize until every source is terminally accounted for');
  const resultPath = join(runDir, 'normalization-result.json');
  writeJson(resultPath, normalizeRun({ runDir, state, run: readJson(join(runDir, 'run.json')) }));
  recordNormalization({ run: options.run, result: resultPath });
}

function finalizeDedupCommand(options) {
  const runDir = runDirectory(options.run), state = loadState(options.run);
  if (state.normalization?.status !== 'success') fail('Cannot finalize duplicates before successful normalization');
  if (Object.values(state.venues).some((venue) => !TERMINAL_STAGE.has(venue.stages.resolve.status))) fail('Cannot finalize duplicates before every venue resolution is terminal');
  const eventsPath = join(runDir, 'normalized/events.json'), envelope = readJson(eventsPath), originalEvents = envelope.records;
  const resolutions = {};
  for (const [venueId, venue] of Object.entries(state.venues)) {
    const resolveStage = venue.stages.resolve;
    resolutions[venueId] = resolveStage.status === 'success' && resolveStage.outputRef
      ? readJson(join(runDir, resolveStage.outputRef)).result
      : { resolutionStatus: resolveStage.resolutionStatus ?? 'needs_review' };
  }
  const currentLandmarks = environmentRecords('EVENT_PIPELINE_CURRENT_LANDMARKS') ?? loadCurrentApprovedData(process.env.EVENT_PIPELINE_FRONTEND_ROOT ? resolve(process.env.EVENT_PIPELINE_FRONTEND_ROOT) : ROOT).landmarks;
  const priorClusters = currentLandmarks.flatMap((landmark) => (landmark.events ?? []).map((event) => ({
    identityAnchor: event.identityAnchor ?? stableEventKey(event),
    memberIds: event.sourceOccurrenceIds ?? (event.sources ?? []).map(({ source, sourceId }) => `${source}:${sourceId}`),
  })));
  const sourcePrecedence = Object.fromEntries(readPipelineConfig().sources.filter(({ sourceRole }) => sourceRole === 'authoritative').map(({ name, precedence }) => [name, precedence]));
  const candidates = generateDedupCandidates(originalEvents);
  const result = finalizeDeduplication({ events: originalEvents, candidates, resolutions, priorClusters, sourcePrecedence });
  const isolatedReviewIds = new Set(result.blockingReviews.flatMap(({ occurrenceIds = [] }) => occurrenceIds));
  for (const event of result.events) if ((event.sourceOccurrenceIds ?? []).some((id) => isolatedReviewIds.has(id))) {
    Object.assign(event, { lifecycleState: 'held', publicPlacement: 'none', mappingStatus: 'pending_review', reviewStatus: 'review', reviewReason: 'prior_cluster_join_review' });
  }
  const candidatesRef = 'normalized/dedup-candidates.json', decisionsRef = 'normalized/dedup-final-decisions.json';
  writeJson(join(runDir, candidatesRef), { schemaVersion: '1.0', runId: options.run, counts: { records: candidates.length }, records: candidates });
  writeJson(join(runDir, decisionsRef), { schemaVersion: '1.0', runId: options.run, counts: { records: result.decisions.length }, records: result.decisions });
  writeJson(eventsPath, { ...envelope, counts: { records: result.events.length }, records: result.events });
  for (const venue of Object.values(state.venues)) venue.eventIds = [...new Set(venue.eventIds.map((id) => result.events.find((event) => event.sourceOccurrenceIds.includes(id))?.id ?? id))];
  state.deduplication = {
    status: 'success', counts: result.counts,
    evidence: summarizeEvidenceLevels(result.events),
    artifactRefs: [candidatesRef, decisionsRef, 'normalized/events.json'], blockingReviews: result.blockingReviews,
    isolatedReviewEventIds: [...isolatedReviewIds], error: null, completedAt: new Date().toISOString(),
  };
  registerArtifacts(runDir, [candidatesRef, decisionsRef, 'normalized/events.json']);
  saveState(runDir, state);
  pipelineTrace(runDir, { stage: 'deduplication', action: 'deduplication_terminal', outcome: state.deduplication.status, entityType: 'run', entityId: options.run, counts: result.counts, reasonCode: result.blockingReviews.length ? 'prior_cluster_join_review' : null, blocker: state.deduplication.error, nextAction: `npm run event-pipeline -- advance --run ${options.run}` });
  printNext(state);
}

function prepareVenues(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  if (state.normalization.status !== 'success') fail('Cannot prepare venue recovery before successful normalization');
  if (Object.keys(state.venues).length === 0) {
    state.resolutionPreparation = { status: 'success', artifactRefs: [], error: null };
    saveState(runDir, state);
    printNext(state);
    return;
  }
  const indexPath = join(ROOT, 'outputs/local-venue-index/venues.sqlite');
  let hasOneMapRows = false;
  if (existsSync(indexPath)) {
    try {
      const db = new Database(indexPath, { readonly: true });
      hasOneMapRows = db.prepare("SELECT count(*) AS count FROM places WHERE source='onemap-3d'").get().count > 0;
      db.close();
    } catch { hasOneMapRows = false; }
  }
  if (!hasOneMapRows) execFileSync('npm', ['run', 'venue-index:build'], { cwd: ROOT, stdio: 'inherit' });
  try {
    execFileSync('npm', ['run', 'venue-index:enrich', '--', '--run', options.run], { cwd: ROOT, stdio: 'inherit' });
    const refreshedState = loadState(options.run);
    const run = readJson(join(runDir, 'run.json'));
    let resetCount = 0;
    for (const venue of Object.values(refreshedState.venues)) {
      if (venue.stages.resolve.status !== 'unresolved' || !venue.stages.resolve.outputRef) continue;
      const previous = readJson(join(runDir, venue.stages.resolve.outputRef));
      if (previous.result?.evidenceHash === branchEvidenceHash(runDir, venue)) continue;
      if (run.artifacts[venue.stages.resolve.outputRef]) run.artifacts[venue.stages.resolve.outputRef].status = 'invalidated';
      for (const stage of STAGES) venue.stages[stage] = { status: 'pending', outputRef: null, error: null };
      resetCount += 1;
    }
    if (resetCount) {
      writeJson(join(runDir, 'run.json'), run);
      refreshedState.verification = { status: 'pending', build: null, eventUi: null, error: null };
      saveState(runDir, refreshedState);
    }
    execFileSync('npm', ['run', 'venue-index:resolve', '--', '--run', options.run], { cwd: ROOT, stdio: 'inherit' });
  } catch (error) {
    state.resolutionPreparation = { status: 'failed', artifactRefs: [], error: `Venue recovery preparation failed with exit code ${error.status ?? 1}` };
    saveState(runDir, state);
    throw error;
  }
  const refs = ['normalized/location-enrichment.json', 'local-venue-resolution.json', 'local-venue-resolution.md'];
  registerArtifacts(runDir, refs);
  const localCandidateCount = readJson(join(runDir, 'local-venue-resolution.json')).results
    .filter((row) => row.status === 'candidate_matched').length;
  const preparedState = loadState(options.run);
  preparedState.resolutionPreparation = { status: 'success', artifactRefs: refs, localCandidateCount, error: null };
  saveState(runDir, preparedState);
  reuseCachedResolutions(options.run);
  printNext(loadState(options.run));
}

function recordStageValue(options, result, resultPath) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  const venue = state.venues[options.venue];
  if (!venue) fail(`Unknown venue branch: ${options.venue}`);
  const stageIndex = STAGES.indexOf(options.stage);
  if (stageIndex < 0) fail(`Stage must be one of: ${STAGES.join(', ')}`);
  if (options.stage === 'resolve' && state.resolutionPreparation?.status !== 'success') fail('Cannot record resolver outcomes before prepare-venues completes enrichment and local recovery');
  if (stageIndex > 0 && venue.stages[STAGES[stageIndex - 1]].status !== 'success') fail(`Cannot run ${options.stage} before successful ${STAGES[stageIndex - 1]}`);
  if (!TERMINAL_STAGE.has(result.status) || result.status === 'pending') fail('Stage result is not terminal');
  if (result.stage !== options.stage) fail('Stage result does not match --stage');
  if (result.status === 'success' && (!Array.isArray(result.outputRefs) || result.outputRefs.length === 0) && result.result?.changeAction !== 'noop') fail('Successful changed stage requires outputRefs');
  if (result.status === 'success' && ['highlight', 'pill', 'panel'].includes(options.stage) && !['create', 'update', 'noop'].includes(result.result?.changeAction)) fail('Frontend stage requires changeAction create, update, or noop');
  if (result.status === 'success') validateStageEventIds(options.stage, venue.eventIds, result);
  validateApprovedResolution(result);
  if (options.stage === 'resolve' && result.status === 'unresolved') {
    const expectedHash = branchEvidenceHash(runDir, venue), expectedKey = normalizeText(venue.venue);
    if (result.result?.evidenceHash !== expectedHash || result.result?.cacheKey !== expectedKey) fail('Unresolved resolution cacheKey or evidenceHash does not match executable branch evidence');
    if (result.result?.resolutionStatus === 'needs_review' && !options.allowCachedUnresolved) {
      const records = recoveryRecords(runDir), index = records.findIndex((record) => record.venueId === options.venue);
      const expectedRef = `normalized/venue-recovery-evidence.json#/records/${index}`;
      if (index < 0 || result.result?.recoveryEvidenceRef !== expectedRef) fail('needs_review requires an applied venue-recovery evidence checkpoint before it can be recorded');
    }
  }
  validateHighlightArtifacts(result);
  validateResolveRecoveryEvidence(runDir, options.run, options.venue, venue.eventIds, result);
  if (result.status !== 'success' && !result.error) fail('Non-success stage requires an error');
  const destination = join(runDir, 'stages', options.venue, `${options.stage}.json`);
  mkdirSync(dirname(destination), { recursive: true });
  if (resultPath !== destination) copyFileSync(resultPath, destination);
  registerArtifacts(runDir, [relative(runDir, destination)]);
  venue.stages[options.stage] = {
    status: result.status,
    outputRef: relative(runDir, destination),
    error: result.error ?? null,
    ...(options.stage === 'resolve' ? { resolutionStatus: result.result?.resolutionStatus ?? null } : {}),
  };
  if (options.stage === 'resolve' && result.status === 'success') {
    const registry = readJson(aliasRegistryPath()), value = result.result;
    const entry = { status: 'approved', rawVenue: venue.venue, normalizedVenue: normalizeText(venue.venue), canonicalVenue: value.canonicalVenue,
      verifiedAddress: value.verifiedAddress ?? null, coordinates: value.coordinates, poiId: value.poiId, gmlId: value.gmlId ?? null, gmlIds: value.gmlIds ?? (value.gmlId ? [value.gmlId] : []),
      acceptedGmlNames: value.acceptedGmlNames, sourceTiles: value.sourceTiles, evidence: value.evidence, verifiedAt: new Date().toISOString() };
    registry.entries = [...registry.entries.filter((item) => normalizeText(item.rawVenue) !== entry.normalizedVenue), entry];
    writeJson(aliasRegistryPath(), registry);
  }
  if (options.stage === 'resolve' && result.status === 'unresolved') {
    const cache = readResolutionCache();
    const entry = { normalizedVenue: normalizeText(venue.venue), cacheKey: result.result.cacheKey, evidenceHash: result.result.evidenceHash,
      status: result.result.resolutionStatus, result: result.result, updatedAt: new Date().toISOString() };
    cache.entries = [...cache.entries.filter((item) => item.cacheKey !== entry.cacheKey), entry];
    writeJson(resolutionCachePath(), cache);
    if (result.result.resolutionStatus === 'needs_review') {
      const repository = new AdminRepository({ databasePath: adminDatabasePath() });
      try {
        new AdminService({ repository }).createVenueReview({
          venueId: options.venue,
          evidenceHash: result.result.evidenceHash,
          evidenceSnapshot: {
            venue: venue.venue,
            rawNames: [venue.venue],
            addressCandidates: result.result.addressCandidates ?? [],
            postalCodes: result.result.postalCodes ?? [],
            evidenceInspected: result.result.evidenceInspected,
            recoveryAttempts: result.result.recoveryAttempts,
            localLookupEvidence: result.result.localLookupEvidence,
            finalReason: result.result.finalReason,
          },
          candidates: result.result.competingCandidates,
        });
      } finally { repository.close(); }
    }
  }
  if (result.status !== 'success') {
    for (const downstream of STAGES.slice(stageIndex + 1)) venue.stages[downstream] = { status: 'skipped', outputRef: null, error: `Upstream ${options.stage} was ${result.status}` };
  }
  saveState(runDir, state);
  pipelineTrace(runDir, { stage: options.stage, action: 'venue_stage_terminal', outcome: result.status, entityType: 'venue', entityId: options.venue, counts: { events: venue.eventIds.length }, reasonCode: result.result?.resolutionStatus ?? null, blocker: result.error ?? null, nextAction: `npm run event-pipeline -- advance --run ${options.run}` });
  if (!options.quiet) printNext(state);
  return state;
}

function recordStage(options) {
  return recordStageValue(options, readResult(options.result), resolve(ROOT, options.result ?? ''));
}

function recordRecoveredUnresolved(runId, venueId, venue, recovery, localRow) {
  const runDir = runDirectory(runId), now = new Date().toISOString();
  validateNotMappableAgainstLocalCandidates(recovery, venue.venue, localRow);
  const classification = recovery.notMappableEvidence ?? null;
  const resolutionStatus = classification ? 'not_mappable' : 'needs_review';
  const alternatives = localRow?.alternatives ?? [];
  const finalReason = classification
    ? `Authoritative recovery classified ${venue.venue} as ${classification.reasonCode.replaceAll('_', ' ')}.`
    : `${localRow?.reason ?? 'No local building candidate was found'}; the two authoritative recovery paths did not establish one exact OneMap GML identity.`;
  const result = {
    schemaVersion: '1.0', runId, stage: 'resolve', status: 'unresolved', startedAt: now, endedAt: now,
    inputRefs: venue.eventIds, outputRefs: [], error: finalReason, nextStep: null,
    result: {
      resolutionStatus, inputVenue: venue.venue, inputEventIds: venue.eventIds, finalReason,
      cacheKey: normalizeText(venue.venue), evidenceHash: branchEvidenceHash(runDir, venue),
      recoveryEvidenceRef: recoveryEvidenceRef(runDir, venueId),
      evidenceInspected: recovery.evidenceInspected.map(({ sourceType, label, url }) => ({ sourceType, label, url })),
      ...(classification ? { notMappableEvidence: classification } : {
        webResearch: recovery.evidenceInspected.map(({ sourceType, query, checkedAt, outcome, url }) => ({ sourceType, query, checkedAt, outcome, resultUrls: [url] })),
        localLookupEvidence: [
          { tool: 'venue-index:resolve', query: [...(recovery.addressCandidates ?? []), ...(recovery.postalCodes ?? []), venue.venue].join(' | '), outcome: localRow?.reason ?? 'No local place or fixed building matched' },
          { tool: 'find-poi-tile-candidates', query: venue.venue, outcome: alternatives.length ? `${alternatives.length} executable OneMap candidates remained ambiguous` : 'No executable OneMap candidate was returned' }
        ],
        recoveryAttempts: recovery.evidenceInspected.slice(0, 2).map((evidence, index) => ({ attempt: index + 1, approach: evidence.query, outcome: evidence.outcome })),
        competingCandidates: alternatives.map((candidate) => ({
          key: candidate.key, name: candidate.name, gmlIds: candidate.gmlIds ?? [], distanceMeters: candidate.distanceMeters ?? null,
          rejectionReason: `Authoritative recovery did not uniquely select this candidate from the ${alternatives.length} executable alternative${alternatives.length === 1 ? '' : 's'}.`
        }))
      })
    }
  };
  const resultPath = join(runDir, `resolve-recovery-${venueId}.json`);
  writeJson(resultPath, result);
  return recordStageValue({ run: runId, venue: venueId, stage: 'resolve', quiet: true }, result, resultPath);
}

async function applyDeterministicAddressRecovery(runId, venueId, venue, localRow) {
  const runDir = runDirectory(runId);
  if (deterministicRecoveryRecords(runDir).some((record) => record.venueId === venueId)) return false;
  const saved = branchSavedAddressEvidence(runDir, venue);
  const location = {
    addressCandidates: [...new Set([...(localRow?.locationEvidence?.addressCandidates ?? []), ...saved.addressCandidates])],
    postalCodes: [...new Set([...(localRow?.locationEvidence?.postalCodes ?? []), ...saved.postalCodes])],
    coordinateCandidates: localRow?.locationEvidence?.coordinateCandidates ?? []
  };
  if ((location.coordinateCandidates ?? []).length || !(location.addressCandidates ?? []).length) return false;
  let selected = null, queryResult = null, verifiedAddress = null;
  for (const address of location.addressCandidates) {
    let response;
    try { response = await queryOneMap(address); } catch { continue; }
    const exact = selectDeterministicOneMapAddress(address, response);
    if (!exact || !Number.isFinite(exact.latitude) || !Number.isFinite(exact.longitude)) continue;
    selected = exact; queryResult = response; verifiedAddress = address; break;
  }
  if (!selected) return false;
  const path = deterministicRecoveryPath(runDir);
  const envelope = existsSync(path) ? readJson(path) : { schemaVersion: '1.0', runId, generatedAt: new Date().toISOString(), records: [] };
  envelope.records = [...(envelope.records ?? []).filter((record) => record.venueId !== venueId), {
    venueId, venue: venue.venue, method: 'exact_onemap_address_geocode', verifiedAddress,
    addressCandidates: location.addressCandidates ?? [], postalCodes: location.postalCodes ?? [],
    coordinateCandidates: [{ lat: selected.latitude, lng: selected.longitude, source: 'onemap_public_exact_address', recordRef: queryResult.requestUrl, evidenceField: queryResult.selectedQuery }],
    result: selected, attempts: queryResult.attempts, recordedAt: new Date().toISOString()
  }];
  envelope.updatedAt = new Date().toISOString();
  writeJson(path, envelope);
  registerArtifacts(runDir, ['normalized/deterministic-location-recovery.json']);
  const child = spawnSync(process.execPath, [join(ROOT, 'scripts/resolve-venues-locally.mjs'), '--run', runId, '--ids', venueId], { cwd: ROOT, encoding: 'utf8' });
  if (child.status !== 0) fail(`Focused deterministic address recovery failed: ${child.stderr || child.stdout}`);
  registerArtifacts(runDir, ['local-venue-resolution.json', 'local-venue-resolution.md']);
  const local = readJson(join(runDir, 'local-venue-resolution.json'));
  const state = loadState(runId);
  state.resolutionPreparation = { ...state.resolutionPreparation,
    localCandidateCount: local.results.filter((row) => row.status === 'candidate_matched' && state.venues[row.venueId]?.stages.resolve.status === 'pending').length };
  saveState(runDir, state);
  return true;
}

async function recordVenueRecovery(options) {
  const runDir = runDirectory(options.run), state = loadState(options.run), venue = state.venues[options.venue];
  if (!venue) fail(`Unknown venue branch: ${options.venue}`);
  if (!options.evidence) fail('record-venue-recovery requires --evidence <json>');
  if (state.resolutionPreparation?.status !== 'success') fail('Venue recovery can only be recorded after prepare-venues');
  if (venue.stages.resolve.status === 'success' && !options.replace) fail('Cannot replace an already approved venue with recovery evidence without --replace');
  const submitted = validateVenueRecoveryEvidence(readJson(resolve(ROOT, options.evidence)), venue.venue);
  const normalized = await enrichRecoveryCoordinates(classifyNonBuildingRecovery(submitted));
  const previousLocal = existsSync(join(runDir, 'local-venue-resolution.json'))
    ? readJson(join(runDir, 'local-venue-resolution.json')).results?.find((row) => row.venueId === options.venue) ?? null
    : null;
  validateNotMappableAgainstLocalCandidates(normalized, venue.venue, previousLocal);
  const path = venueRecoveryPath(runDir);
  const envelope = existsSync(path) ? readJson(path) : { schemaVersion: '1.0', runId: options.run, generatedAt: new Date().toISOString(), records: [] };
  const record = { venueId: options.venue, venue: venue.venue, ...normalized, recordedAt: new Date().toISOString() };
  const previousIndex = envelope.records.findIndex((item) => item.venueId === options.venue);
  if (previousIndex >= 0) envelope.records[previousIndex] = record;
  else envelope.records.push(record);
  envelope.updatedAt = new Date().toISOString();
  writeJson(path, envelope);
  registerArtifacts(runDir, ['normalized/venue-recovery-evidence.json']);

  const run = readJson(join(runDir, 'run.json'));
  if (venue.stages.resolve.outputRef && run.artifacts[venue.stages.resolve.outputRef]) run.artifacts[venue.stages.resolve.outputRef].status = 'invalidated';
  for (const stage of STAGES) venue.stages[stage] = { status: 'pending', outputRef: null, error: null };
  state.verification = { status: 'pending', build: null, eventUi: null, browser: null, error: null };
  saveState(runDir, state);
  writeJson(join(runDir, 'run.json'), run);

  if (record.notMappableEvidence) {
    const terminalState = recordRecoveredUnresolved(options.run, options.venue, venue, record, previousLocal);
    if (!options.quiet) process.stdout.write(`${JSON.stringify({ ...progressResponse(terminalState), recoveryEvidenceRef: recoveryEvidenceRef(runDir, options.venue),
      localEvidence: compactLocalEvidence(previousLocal), recordedUnresolved: true }, null, 2)}\n`);
    process.exitCode = CONTINUE_EXIT_CODE;
    return;
  }

  const child = spawnSync(process.execPath, [join(ROOT, 'scripts/resolve-venues-locally.mjs'), '--run', options.run, '--ids', options.venue], { cwd: ROOT, encoding: 'utf8' });
  if (child.status !== 0) fail(`Focused local venue recovery failed: ${child.stderr || child.stdout}`);
  registerArtifacts(runDir, ['local-venue-resolution.json', 'local-venue-resolution.md']);
  const local = readJson(join(runDir, 'local-venue-resolution.json'));
  const refreshed = loadState(options.run);
  refreshed.resolutionPreparation = { ...refreshed.resolutionPreparation,
    localCandidateCount: local.results.filter((row) => row.status === 'candidate_matched' && refreshed.venues[row.venueId]?.stages.resolve.status === 'pending').length };
  saveState(runDir, refreshed);
  const localEvidence = local.results.find((row) => row.venueId === options.venue) ?? null;
  const terminalState = localEvidence?.status === 'candidate_matched'
    ? refreshed
    : recordRecoveredUnresolved(options.run, options.venue, refreshed.venues[options.venue], record, localEvidence);
  if (!options.quiet) process.stdout.write(`${JSON.stringify({ ...progressResponse(terminalState), recoveryEvidenceRef: recoveryEvidenceRef(runDir, options.venue), localEvidence: compactLocalEvidence(localEvidence),
    recordedUnresolved: localEvidence?.status !== 'candidate_matched' }, null, 2)}\n`);
  process.exitCode = CONTINUE_EXIT_CODE;
}

function resolveLocal(options) {
  const runDir = runDirectory(options.run);
  const local = readJson(join(runDir, 'local-venue-resolution.json'));
  let accepted = 0;
  const stateBefore = loadState(options.run);
  for (const row of local.results.filter((item) => item.status === 'candidate_matched' && stateBefore.venues[item.venueId]?.stages.resolve.status === 'pending')) {
    const building = row.building;
    const complete = building?.gmlIds?.length > 0 && building?.sourceTiles?.length > 0
      && building.sourceTiles.every((tile) => tile.tilePath && tile.batchIds?.length);
    if (!complete) {
      row.status = 'needs_review';
      row.reason = `${row.reason}; executable candidate lacks exact GML identity coverage or complete source tile/batch evidence`;
      continue;
    }
    const poiId = String(row.alias?.canonicalVenue ?? building.name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const timestamp = new Date().toISOString();
    const result = {
      schemaVersion: '1.0', runId: options.run, stage: 'resolve', status: 'success', startedAt: timestamp, endedAt: timestamp,
      inputRefs: row.eventIds, outputRefs: [`stages/${row.venueId}/resolve.json`], error: null, nextStep: null,
      result: { resolutionStatus: 'approved', inputVenue: row.venue, canonicalVenue: row.alias?.canonicalVenue ?? building.name,
        verifiedAddress: row.place?.address ?? row.locationEvidence?.addressCandidates?.[0] ?? null, poiId,
        gmlId: building.gmlIds?.length === 1 ? building.gmlIds[0] : null, gmlIds: building.gmlIds, acceptedGmlNames: row.alias?.acceptedGmlNames ?? building.acceptedGmlNames ?? [building.name],
        coordinates: { lng: building.longitude, lat: building.latitude },
        sourceTiles: (building.sourceTiles ?? []).map(({ tilePath, batchIds }) => ({ path: tilePath, batchIds })),
        evidence: [{ type: building.adminReview ? 'admin_selection_revalidated' : row.alias ? 'approved_alias_local_index' : 'executable_local_resolution', detail: row.reason, verifiedAt: local.generatedAt,
          ...(building.adminReview ? { reviewId: building.adminReview.reviewId, evidenceHash: building.adminReview.evidenceHash, candidateGmlId: building.adminReview.candidateGmlId,
            decisionReason: building.adminReview.decisionReason, decidedAt: building.adminReview.decidedAt } : {}) }],
        inputEventIds: row.eventIds }
    };
    const resultPath = join(runDir, `resolve-local-${row.venueId}.json`);
    writeJson(resultPath, result);
    recordStageValue({ run: options.run, venue: row.venueId, stage: 'resolve', quiet: true }, result, resultPath);
    accepted += 1;
  }
  writeJson(join(runDir, 'local-venue-resolution.json'), local);
  const state = loadState(options.run);
  state.resolutionPreparation = { ...state.resolutionPreparation, localCandidateCount: 0 };
  saveState(runDir, state);
  process.stdout.write(`${JSON.stringify({ ...progressResponse(state), locallyApproved: accepted }, null, 2)}\n`);
  if (!state.finalizedAt) process.exitCode = CONTINUE_EXIT_CODE;
}

function reopenImprovedLocalCandidates(state, localResults) {
  const reopened = [];
  for (const row of localResults ?? []) {
    const venue = state.venues[row.venueId];
    if (row.status !== 'candidate_matched' || venue?.stages.resolve.status !== 'unresolved') continue;
    for (const stage of STAGES) venue.stages[stage] = { status: 'pending', outputRef: null, error: null };
    reopened.push(row.venueId);
  }
  if (reopened.length) {
    state.resolutionPreparation.localCandidateCount = reopened.length;
    state.verification = { status: 'pending', extraction: null, poiSeparation: null, build: null, eventUi: null, browser: null, error: null };
    state.overallStatus = 'pending';
    state.finalizedAt = null;
  }
  return reopened;
}

function reprocessUnresolved(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  const child = spawnSync(process.execPath, [join(ROOT, 'scripts/resolve-venues-locally.mjs'), '--run', options.run, '--include-unresolved'], { cwd: ROOT, encoding: 'utf8' });
  if (child.status !== 0) fail(`Unresolved-only local venue rerun failed: ${child.stderr || child.stdout}`);
  registerArtifacts(runDir, ['local-venue-resolution.json', 'local-venue-resolution.md']);
  const local = readJson(join(runDir, 'local-venue-resolution.json'));
  const reopenedVenueIds = reopenImprovedLocalCandidates(state, local.results);
  saveState(runDir, state);
  process.stdout.write(`${JSON.stringify({ ...progressResponse(state), reopenedVenueIds, unresolvedChecked: local.results.length }, null, 2)}\n`);
  if (!state.finalizedAt) process.exitCode = CONTINUE_EXIT_CODE;
}

function branchEvidenceHash(runDir, venue) {
  const events = readJson(join(runDir, 'normalized/events.json')).records;
  const enrichmentPath = join(runDir, 'normalized/location-enrichment.json');
  const enrichment = existsSync(enrichmentPath) ? readJson(enrichmentPath).records ?? [] : [];
  return computeVenueEvidenceHash({
    venue: venue.venue,
    eventIds: venue.eventIds,
    events,
    enrichmentRecords: enrichment,
    recoveryRecords: recoveryRecords(runDir),
    deterministicRecoveryRecords: deterministicRecoveryRecords(runDir),
  });
}

function reusableResolutionEntry(cache, normalizedVenue, evidenceHash, eventIds = [], expectedGmlIds = []) {
  const coversCurrentCandidates = (entry) => {
    if (entry.result?.resolutionStatus !== 'needs_review' || !expectedGmlIds.length) return true;
    const cached = new Set((entry.result.competingCandidates ?? []).flatMap((candidate) => candidate?.gmlIds ?? (candidate?.gmlId ? [candidate.gmlId] : [])));
    return expectedGmlIds.every((gmlId) => cached.has(gmlId));
  };
  const entries = cache.entries?.filter((entry) => entry.normalizedVenue === normalizedVenue && coversCurrentCandidates(entry)) ?? [];
  const sameEvents = (entry) => {
    const cached = entry.result?.inputEventIds;
    return Array.isArray(cached) && cached.length === eventIds.length && cached.every((id) => eventIds.includes(id));
  };
  return entries.find((entry) => entry.evidenceHash === evidenceHash)
    ?? entries.find(sameEvents)
    ?? entries.find((entry) => ['mobile_venue', 'multi_venue'].includes(entry.result?.notMappableEvidence?.reasonCode))
    ?? null;
}

function reuseCachedResolutions(runId) {
  const runDir = runDirectory(runId), state = loadState(runId), cache = readResolutionCache();
  const localResolutionPath = join(runDir, 'local-venue-resolution.json');
  const localRows = new Map((existsSync(localResolutionPath) ? readJson(localResolutionPath).results ?? [] : []).map((row) => [row.venueId, row]));
  let reused = 0;
  for (const [venueId, venue] of Object.entries(state.venues)) {
    if (venue.stages.resolve.status !== 'pending') continue;
    const evidenceHash = branchEvidenceHash(runDir, venue);
    const expectedGmlIds = [...new Set((localRows.get(venueId)?.alternatives ?? []).flatMap((candidate) => candidate.gmlIds ?? []))];
    const entry = reusableResolutionEntry(cache, normalizeText(venue.venue), evidenceHash, venue.eventIds, expectedGmlIds);
    if (!entry) continue;
    const timestamp = new Date().toISOString();
    const result = { schemaVersion: '1.0', runId, stage: 'resolve', status: 'unresolved', startedAt: timestamp, endedAt: timestamp,
      inputRefs: venue.eventIds, outputRefs: [], error: entry.result.finalReason, nextStep: null,
      result: { ...entry.result, inputEventIds: venue.eventIds, cacheKey: entry.cacheKey, evidenceHash } };
    const resultPath = join(runDir, `resolve-cache-${venueId}.json`); writeJson(resultPath, result);
    recordStageValue({ run: runId, venue: venueId, stage: 'resolve', quiet: true, allowCachedUnresolved: true }, result, resultPath); reused += 1;
  }
  return reused;
}

function reuseResolutionCacheCommand(options) {
  const reused = reuseCachedResolutions(options.run), state = loadState(options.run);
  process.stdout.write(`${JSON.stringify({ ...progressResponse(state), reused }, null, 2)}\n`);
  if (!state.finalizedAt) process.exitCode = CONTINUE_EXIT_CODE;
}

function plainLocationText(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function collectLocationClues(value, output = []) {
  if (output.length >= 8 || value === null || value === undefined) return output;
  if (typeof value === 'string') {
    const primary = String(value).split(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:similar experiences|discover our top experiences|nearby|recommended|related|you may also like)\s*(?:\n|$)/i)[0];
    const text = plainLocationText(primary);
    const match = /\baddress\b|\bSingapore\s+\d{6}\b|\b\d{1,4}[A-Za-z]?\s+[A-Za-z][^,.]{1,60}\b(?:Road|Street|Avenue|Lane|Drive|Crescent|Walk|Boulevard|Terrace|Place|Parkway)\b/i.exec(text);
    if (match) output.push(text.slice(Math.max(0, match.index - 180), Math.min(text.length, match.index + 520)));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLocationClues(item, output);
    return output;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectLocationClues(item, output);
  }
  return output;
}

function branchSavedAddressEvidence(runDir, venue) {
  const events = readJson(join(runDir, 'normalized/events.json')).records;
  const selected = events.filter((event) => venue.eventIds.includes(event.id));
  const values = selected.flatMap((event) => [event.venue, event.address, event.description].filter(Boolean));
  for (const source of selected.flatMap((event) => event.sources ?? [])) {
    if (!source.recordRef) continue;
    const baseRef = baseArtifactRef(source.recordRef);
    for (const payloadRef of [baseRef, baseRef.replace(/\.json$/, '.response.json')]) {
      if (!existsSync(artifactPath(runDir, payloadRef))) continue;
      try { collectLocationStrings(readJson(artifactPath(runDir, payloadRef)), values); } catch { /* retain other saved evidence */ }
    }
  }
  return extractAddressEvidence(values);
}

function collectOfficialCandidatePages(value, output = [], path = []) {
  if (output.length >= 8 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectOfficialCandidatePages(item, output, path);
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (typeof item === 'string' && /^(?:BookingUrl|EventWebsite|Website|ExternalLink|OrganizerUrl|VenueUrl)$/i.test(key)) {
      try {
        const url = new URL(item);
        if (['http:', 'https:'].includes(url.protocol) && !output.some((entry) => entry.url === url.href)) {
          output.push({ label: nextPath.join('.'), url: url.href });
        }
      } catch {
        // Ignore malformed provider links; the source artifact remains authoritative evidence.
      }
    } else collectOfficialCandidatePages(item, output, nextPath);
  }
  return output;
}

function venueRecoveryContext(runId, venueId, venue, localRow) {
  const runDir = runDirectory(runId);
  const events = readJson(join(runDir, 'normalized/events.json')).records;
  const selected = events.filter((event) => venue.eventIds.includes(event.id));
  const sourcePages = [...new Map(selected.flatMap((event) => (event.sources ?? []).map((source) => [source.sourceUrl, {
    source: source.source ?? null,
    title: plainLocationText(event.title ?? ''),
    url: source.sourceUrl,
    recordRef: source.recordRef ?? null
  }])).filter(([url]) => typeof url === 'string' && /^https?:\/\//.test(url))).values()];
  const rawLocationClues = [], officialCandidatePages = [];
  for (const source of selected.flatMap((event) => event.sources ?? [])) {
    if (!source.recordRef) continue;
    const baseRef = baseArtifactRef(source.recordRef);
    const payloadRefs = [baseRef, baseRef.replace(/\.json$/, '.response.json')];
    for (const payloadRef of payloadRefs) {
      if (!existsSync(artifactPath(runDir, payloadRef))) continue;
      try {
        const payload = readJson(artifactPath(runDir, payloadRef));
        const raw = payloadRef === baseRef ? jsonPointer(payload, pointerFromArtifactRef(source.recordRef)) : payload;
        for (const clue of collectLocationClues(raw)) if (!rawLocationClues.includes(clue)) rawLocationClues.push(clue);
        for (const page of collectOfficialCandidatePages(raw)) if (!officialCandidatePages.some((entry) => entry.url === page.url)) officialCandidatePages.push(page);
      } catch {
        // The validated source pointer remains available in sourcePages even if a sibling payload is not searchable.
      }
    }
  }
  const templateRef = `normalized/recovery-input-${venueId}.json`;
  const templatePath = artifactPath(runDir, templateRef);
  const notMappableContract = {
    sourceUrlsRequired: true,
    sourceUrlsFormat: 'Array of HTTP(S) URL strings. Example: ["https://venue.example/event"]. Labelled objects are accepted and normalized, but strings are canonical.',
    selectionRule: 'Use a reason only after authoritative evidence proves that no single stable OneMap building can represent the event. If a route or mobile experience has a fixed building start, pickup, or meeting point, resolve that building instead.',
    reasons: {
      outside_singapore: 'The verified event location is outside Singapore.',
      mobile_venue: 'The event itself moves or follows a route and authoritative evidence provides no single stable building start, pickup, or meeting point.',
      multi_venue: 'The event spans multiple physical venues and authoritative evidence provides no single primary building anchor.',
      no_target_building: 'The verified fixed event location has no exact OneMap building GML, such as an MRT platform, gantry, passage, or standalone exit.'
    }
  };
  const recoveryFieldFormats = {
    addressCandidates: ['Verified address string'],
    postalCodes: ['Six-digit Singapore postal code'],
    coordinateCandidates: [{ lat: 1.3000, lng: 103.8000, source: 'venue_official', recordRef: 'https://actual-inspected-page.example/path', evidenceField: 'Published map pin' }],
    evidenceInspected: [{ sourceType: 'venue_official for the actual venue/operator site; host_or_authority for supplied Catch/SISTIC event pages', label: 'Opened page label', url: 'https://actual-inspected-page.example/path', query: 'Actual query or inspected terms', checkedAt: 'ISO-8601 timestamp', outcome: 'What the opened page established' }],
    notMappableEvidence: { reasonCode: 'One allowed notMappableContract reason', sourceUrls: ['https://actual-inspected-page.example/path'] }
  };
  const savedAddressEvidence = branchSavedAddressEvidence(runDir, venue);
  if (!existsSync(templatePath)) {
    writeJson(templatePath, {
      schemaVersion: '1.0',
      venue: venue.venue,
      addressCandidates: [...new Set([...(localRow?.locationEvidence?.addressCandidates ?? []), ...savedAddressEvidence.addressCandidates])],
      postalCodes: [...new Set([...(localRow?.locationEvidence?.postalCodes ?? []), ...savedAddressEvidence.postalCodes])],
      coordinateCandidates: localRow?.locationEvidence?.coordinateCandidates ?? [],
      evidenceInspected: [
        { sourceType: 'venue_official', label: officialCandidatePages[0]?.label ?? '', url: officialCandidatePages[0]?.url ?? '', query: '', checkedAt: '', outcome: '' },
        { sourceType: 'host_or_authority', label: sourcePages[0]?.source ? `${sourcePages[0].source} event page` : '', url: sourcePages[0]?.url ?? '', query: '', checkedAt: '', outcome: '' }
      ],
      notMappableEvidence: null
    });
  }
  const bundleRef = `normalized/recovery-context-${venueId}.json`;
  const bundlePath = artifactPath(runDir, bundleRef);
  writeJson(bundlePath, {
    schemaVersion: '1.0', runId, venueId, venue: venue.venue, eventIds: venue.eventIds,
    sourcePages, officialCandidatePages: officialCandidatePages.slice(0, 8), savedRawLocationClues: rawLocationClues.slice(0, 8),
    knownLocationEvidence: localRow?.locationEvidence ?? null,
    localEvidence: compactLocalEvidence(localRow),
    notMappableContract,
    recoveryFieldFormats
  });
  return {
    sourcePages,
    officialCandidatePages: officialCandidatePages.slice(0, 8),
    savedRawLocationClues: rawLocationClues.slice(0, 8),
    knownLocationEvidence: localRow?.locationEvidence ?? null,
    evidenceBundle: relative(ROOT, bundlePath),
    recoveryTemplate: relative(ROOT, templatePath),
    allowedLocalReads: [relative(ROOT, bundlePath), relative(ROOT, templatePath)],
    notMappableContract,
    recoveryFieldFormats,
    requiredSteps: [
      'Open both allowedLocalReads files for this branch before web research or editing; never reuse a patch or template content from the previous venue.',
      'Inspect officialCandidatePages first. When the saved provider identifies an operator, organiser, booking site, or studio, resolve that actual event host before researching a generic parent estate or landmark.',
      'Open the supplied host/authority source page and one actual venue-official page; do not use a search-results URL as evidence.',
      'Classify supplied Catch.sg, SISTIC, and SG Culture Pass listing/event pages as host_or_authority. Classify only the actual venue or operator website as venue_official; never swap these roles.',
      'When the actual venue/operator page address conflicts with a saved provider-page clue, discard the conflicting clue from addressCandidates and postalCodes. Do not geocode it or repeat it as provider evidence.',
      'A generic OneMap page is geographic evidence, not a venue-official page. Use it only after the operator or venue official page has established the real address.',
      "For raw HTTP or shortened map links, run npm run web-evidence -- --url '<url>' --terms '<comma-separated terms>'; always quote both values and never print a raw page body with curl, head, sed, or rg.",
      "If an official page establishes an address but supplies no pin, run npm run onemap-geocode -- --query '<verified address>'; do not discover or handcraft OneMap endpoints.",
      'A unique OneMap result at the verified street address is valid host-building evidence even when its building or complex name differs from the tenant name; the executable recovery command fills this coordinate automatically.',
      'When OneMap returns multiple rows for one postal code, use a coordinate only when exactly one OneMap searchValue matches the authoritative place, tenant, start-point, or pickup-point name. Otherwise leave coordinates empty and record that the lookup remained ambiguous.',
      'Rows with different names but coordinates within two metres represent the same geographic pin; the executable recovery command consolidates them automatically.',
      'If an official page exposes a map or directions link, open its destination and record the published pin as coordinate evidence; do not leave coordinates empty when the official page supplies them.',
      'If the operator has multiple outlets, use only the outlet explicitly tied to this event by its official product page, start-point label, or published map link; never default to the first address or flagship.',
      'Leave genuinely unavailable optional address, postal, coordinate, date, and time fields empty; record the inspected evidence and outcome instead of inventing values.',
      'If authoritative evidence corrects the supplied venue to a fixed physical building, recover that building address and coordinates; never classify the incorrect source label itself as no_target_building.',
      'Use only the reason codes and success criteria in notMappableContract; do not inspect repository files to discover schema values.',
      'Use recoveryFieldFormats as the complete submission schema. For coordinates, use canonical { "lat": number, "lng": number, "source": string, "recordRef": inspected URL or null, "evidenceField": string }; do not search repository files for examples.',
      'For coordinates returned by onemap-geocode, set source to onemap_public_exact_address and recordRef to that command result requestUrl. Never attribute a OneMap coordinate to a venue page that exposed no pin.',
      'When setting notMappableEvidence, use exactly { "reasonCode": "<allowed reason>", "sourceUrls": ["https://actual-inspected-page.example/path"] }; sourceUrls is canonically an array of URL strings, not labels or search-result URLs.',
      'Use notMappableEvidence.reasonCode no_target_building only when the verified event location itself is an MRT platform, gantry, passage, standalone exit, or another location without an exact OneMap building GML; do not collapse it onto a nearby building.',
      'Edit only the supplied recovery template with the inspected URLs, actual queries, outcomes, timestamps, and any verified address/postal/coordinates.',
      `Run: npm run event-pipeline -- record-venue-recovery --run ${runId} --venue ${venueId} --evidence ${relative(ROOT, templatePath)}`,
      'Wait for record-venue-recovery to exit and read its complete result before running another command. Never launch recoveryCommand and advance concurrently.',
      `Then run: npm run event-pipeline -- advance --run ${runId}`
    ],
    forbiddenWork: [
      'Do not inspect pipeline implementation code.',
      'Do not run rg, find, ls, or other searches anywhere under outputs/event-pipeline; only the two allowedLocalReads files may be opened locally.',
      'Do not search old run directories.',
      'Do not create a resolve-stage handoff manually.',
      'Do not use curl or another raw HTTP command; use web-evidence and onemap-geocode so output stays bounded and provider endpoints stay checked in.'
    ]
  };
}

function compactLocalEvidence(localRow) {
  if (!localRow) return null;
  return {
    status: localRow.status,
    reason: localRow.reason,
    place: localRow.place,
    alternatives: (localRow.alternatives ?? []).map(({ key, name, gmlIds, latitude, longitude, distanceMeters, footprintMatch }) => ({
      key, name, gmlIds, latitude, longitude, distanceMeters, footprintMatch
    }))
  };
}

async function advance(options) {
  const actions = new Set(['collect-source', 'normalize', 'prepare-venues', 'resolve-local', 'finalize-dedup', 'stage-frontend', 'verify', 'finalize']);
  const executed = [];
  while (true) {
    const state = loadState(options.run);
    let next = nextAction(state);
    if (next.action === 'record-stage' && next.stage === 'resolve') {
      const localPath = join(runDirectory(options.run), 'local-venue-resolution.json');
      if (existsSync(localPath) && readJson(localPath).results.some((row) => row.status === 'candidate_matched' && state.venues[row.venueId]?.stages.resolve.status === 'pending')) next = { action: 'resolve-local' };
      else {
        const localRow = existsSync(localPath) ? readJson(localPath).results.find((row) => row.venueId === next.venue) : null;
        const venue = state.venues[next.venue];
        const savedRecovery = recoveryRecords(runDirectory(options.run)).find((record) => record.venueId === next.venue) ?? null;
        if (savedRecovery) {
          recordRecoveredUnresolved(options.run, next.venue, venue, savedRecovery, localRow);
          executed.push({ action: 'reuse-venue-recovery', venue: next.venue, exitCode: 0 });
          continue;
        }
        if (applyDeterministicEventClassification(options.run, next.venue, venue, localRow)) {
          executed.push({ action: 'deterministic-event-classification', venue: next.venue, exitCode: 0 });
          continue;
        }
        if (await applyDeterministicAddressRecovery(options.run, next.venue, venue, localRow)) {
          executed.push({ action: 'deterministic-address-recovery', venue: next.venue, exitCode: 0 });
          continue;
        }
        const recoveryTemplatePath = join(runDirectory(options.run), 'normalized', `recovery-input-${next.venue}.json`);
        let recoveryTemplateReady = false;
        if (existsSync(recoveryTemplatePath)) {
          try { validateVenueRecoveryEvidence(readJson(recoveryTemplatePath), venue.venue); recoveryTemplateReady = true; }
          catch { /* An untouched or partially filled template still requires the scoped agent intervention below. */ }
        }
        if (recoveryTemplateReady) {
          await recordVenueRecovery({ run: options.run, venue: next.venue, evidence: recoveryTemplatePath, quiet: true });
          executed.push({ action: 'submit-saved-recovery-template', venue: next.venue, exitCode: 0 });
          continue;
        }
        const recoveryContext = venueRecoveryContext(options.run, next.venue, venue, localRow);
        process.stdout.write(`${JSON.stringify({ ...progressResponse(state), intervention: { type: 'ambiguous_venue', venue: next.venue,
          inputVenue: venue.venue, inputEventIds: venue.eventIds,
          cacheKey: normalizeText(venue.venue), evidenceHash: branchEvidenceHash(runDirectory(options.run), venue),
          recoveryEvidenceRef: recoveryEvidenceRef(runDirectory(options.run), next.venue), localEvidence: compactLocalEvidence(localRow),
          ...recoveryContext,
          recoveryCommand: `npm run event-pipeline -- record-venue-recovery --run ${options.run} --venue ${next.venue} --evidence ${recoveryContext.recoveryTemplate}` } }, null, 2)}\n`);
        process.exitCode = CONTINUE_EXIT_CODE;
        return;
      }
    }
    if (!actions.has(next.action)) {
      process.stdout.write(`${JSON.stringify({ ...progressResponse(state), intervention: { type: 'stage_not_yet_automated', ...next }, executed }, null, 2)}\n`);
      process.exitCode = CONTINUE_EXIT_CODE;
      return;
    }
    const args = [fileURLToPath(import.meta.url), next.action, '--run', options.run];
    if (next.source) args.push('--source', next.source);
    const child = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    executed.push({ action: next.action, exitCode: child.status });
    if (![0, CONTINUE_EXIT_CODE].includes(child.status)) fail(`Autonomous ${next.action} failed: ${child.stderr || child.stdout}`);
    if (next.action === 'finalize') {
      process.stdout.write(child.stdout);
      return;
    }
  }
}

function verify(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  if (state.normalization.status !== 'success' || state.deduplication && state.deduplication.status !== 'success') fail('Cannot verify before successful normalization and deduplication');
  const unfinished = Object.values(state.venues).some((venue) => STAGES.some((stage) => !TERMINAL_STAGE.has(venue.stages[stage].status)));
  if (unfinished) fail('Cannot verify while venue stages remain pending');
  const results = {};
  for (const [name, args] of [['poiSeparation', ['run', 'test:poi-separation']], ['build', ['run', 'build']], ['eventUi', ['run', 'test:event-ui']]]) {
    try {
      execFileSync('npm', args, { cwd: ROOT, stdio: 'inherit' });
      results[name] = { status: 'success' };
    } catch (error) {
      results[name] = { status: 'failed', exitCode: error.status ?? 1 };
    }
  }
  const failedChecks = Object.entries(results).filter(([, result]) => result.status !== 'success').map(([name]) => name);
  state.verification = {
    status: failedChecks.length ? 'failed' : 'success',
    ...results, error: failedChecks.length ? `Verification failed: ${failedChecks.join(', ')}` : null
  };
  writeJson(join(runDir, 'verification.json'), state.verification);
  registerArtifacts(runDir, ['verification.json']);
  saveState(runDir, state);
  pipelineTrace(runDir, { stage: 'verification', action: 'verification_terminal', outcome: state.verification.status, entityType: 'run', entityId: options.run, blocker: state.verification.error, nextAction: `npm run event-pipeline -- advance --run ${options.run}` });
  printNext(state);
}

async function stageFrontend(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  if (Object.values(state.venues).some((venue) => !TERMINAL_STAGE.has(venue.stages.resolve.status))) fail('Cannot stage frontend before every resolver branch is terminal');
  if (state.deduplication && state.deduplication.status !== 'success') fail('Cannot stage frontend before successful post-venue deduplication');
  const plan = await prepareFrontendPlan(options.run);
  for (const outcome of plan.sourceReconciliation?.traces ?? []) pipelineTrace(runDir, {
    stage: 'reconciliation', action: outcome.outcome, outcome: 'success', entityType: 'event', entityId: outcome.eventId,
    reasonCode: outcome.reasonCode ?? outcome.outcome, evidenceRefs: outcome.sourceRecordIds ?? [],
  });
  const preliminaryEligibility = evaluateCommitEligibility(state, { requireVerification: false });
  const registry = join(runDir, 'frontend/approved-pois.json');
  const assetsRoot = join(runDir, 'frontend/assets');
  const results = {};
  const boundedDiagnostic = (value) => {
    const redacted = String(redactTraceValue(String(value ?? '')))
      .replace(/\b(authorization|cookie|api[-_]?key|token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
      .trim();
    return redacted.length > 4000 ? `[truncated ${redacted.length - 4000} chars]\n${redacted.slice(-4000)}` : redacted;
  };
  const execute = (name, command, args, env = process.env) => {
    const child = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    const diagnostics = boundedDiagnostic(`${child.error?.message ?? ''}\n${child.stderr ?? ''}\n${child.stdout ?? ''}`);
    results[name] = {
      status: child.status === 0 ? 'success' : 'failed', exitCode: child.status ?? 1,
      command: [command, ...args].join(' '), ...(diagnostics ? { diagnostics } : {})
    };
    pipelineTrace(runDir, { stage: 'verification', action: `${name}_terminal`, outcome: results[name].status, entityType: 'gate', entityId: name, counts: { exitCode: results[name].exitCode }, blocker: results[name].status === 'failed' ? diagnostics : null });
  };
  if (plan.geometryChanged) {
    execute('extraction', process.execPath, ['scripts/extract-cbd-poi-tilesets.mjs', '--registry', registry, '--publish-root', assetsRoot, '--work-root', join(runDir, 'frontend/extraction-work')]);
    if (results.extraction.status === 'success') {
      const tileset = readJson(join(ROOT, 'optimized-tiles/tileset.json'));
      const verificationAssets = join(runDir, 'frontend/verification-assets');
      const relativeAssetUrl = (path) => relative(verificationAssets, path).split(/[/\\]/).join('/');
      const rewrite = (tile) => {
        const content = tile.content;
        if (content) {
          const key = content.uri ? 'uri' : content.url ? 'url' : null;
          if (key && !/^(?:https?:|\/)/.test(content[key])) {
            const uri = content[key];
            content[key] = relativeAssetUrl(existsSync(join(assetsRoot, 'optimized-tiles', uri))
              ? join(assetsRoot, 'optimized-tiles', uri) : join(ROOT, 'optimized-tiles', uri));
          }
        }
        for (const child of tile.children ?? []) rewrite(child);
      };
      rewrite(tileset.root);
      writeJson(join(runDir, 'frontend/verification-assets/background-tileset.json'), tileset);
    }
  } else results.extraction = { status: 'success', command: 'skipped: geometry content hash unchanged' };
  if (results.extraction.status === 'success') {
    try {
      const stagedPois = readJson(registry).records;
      const combinedOutput = join(assetsRoot, 'public/poi-tiles/event-venues/tileset.json');
      buildCombinedPoiTileset({
        pois: stagedPois,
        outputPath: combinedOutput,
        resolveTilesetPath: (poi) => {
          const staged = join(assetsRoot, 'public', poi.data);
          return existsSync(staged) ? staged : join(ROOT, 'public', poi.data);
        },
        resolveContentUri: (poi) => relative(dirname(combinedOutput), existsSync(join(assetsRoot, 'public', poi.data))
          ? join(assetsRoot, 'public', poi.data) : join(ROOT, 'public', poi.data)).split(/[/\\]/).join('/'),
      });
      results.combinedPoiTileset = { status: 'success', command: 'generated from staged approved POIs' };
    } catch (error) {
      results.combinedPoiTileset = { status: 'failed', error: error.message };
    }
  }
  if (results.extraction.status === 'success') execute('poiSeparation', process.execPath, ['scripts/verify-poi-background-separation.mjs', '--registry', registry, '--root', plan.geometryChanged ? assetsRoot : ROOT]);
  execute('build', 'npm', ['run', 'build']);
  execute('eventUi', 'npx', ['playwright', 'test', '-c', 'playwright.config.mjs', 'tests/event-ui.spec.mjs'], { ...process.env, PLAYWRIGHT_WORKERS: process.env.PLAYWRIGHT_WORKERS ?? '2' });
  execute('browser', 'npx', ['playwright', 'test', '-c', 'playwright.config.mjs', 'tests/event-pipeline-staged.spec.mjs'], { ...process.env, EVENT_PIPELINE_RUN_DIR: runDir });
  const failed = Object.entries(results).filter(([, value]) => value.status !== 'success').map(([name]) => name);
  const verification = { status: failed.length ? 'failed' : 'success', ...results, error: failed.length ? `Verification failed: ${failed.join(', ')}` : null };
  writeJson(join(runDir, 'verification.json'), verification);
  registerArtifacts(runDir, ['verification.json']);
  state.verification = verification;
  const commitEligibility = evaluateCommitEligibility(state);
  if (!failed.length && preliminaryEligibility.eligible && commitEligibility.eligible) {
    plan.status = 'verified'; plan.verifiedAt = new Date().toISOString();
    writeJson(join(runDir, 'frontend/plan.json'), plan);
    const stageRefs = writeVerifiedStageHandoffs({ runDir, state, plan, verification });
    registerArtifacts(runDir, ['frontend/plan.json', 'frontend/approved-pois.json', 'frontend/approved-landmarks.json', 'frontend/approved-events.json', ...stageRefs]);
    const publication = commitFrontendSnapshot({
      runDir,
      root: process.env.EVENT_PIPELINE_FRONTEND_ROOT ? resolve(process.env.EVENT_PIPELINE_FRONTEND_ROOT) : ROOT,
      run: readJson(join(runDir, 'run.json')),
      state,
      commitEligibility,
    });
    state.publication = {
      decision: 'publish', reasonCodes: [], candidateSnapshotId: publication.snapshotId,
      activeSnapshotId: publication.snapshotId, publishedAt: publication.committedAt,
    };
  } else if (failed.length) {
    for (const venue of Object.values(state.venues)) {
      if (venue.stages.resolve.status !== 'success') continue;
      venue.stages.highlight = { status: 'failed', outputRef: null, error: verification.error };
      venue.stages.pill = { status: 'skipped', outputRef: null, error: 'Frontend verification failed' };
      venue.stages.panel = { status: 'skipped', outputRef: null, error: 'Frontend verification failed' };
    }
  } else {
    state.publication = {
      decision: 'preserve_previous',
      reasonCodes: [...new Set([...preliminaryEligibility.reasons, ...commitEligibility.reasons])],
      candidateSnapshotId: state.runId,
      activeSnapshotId: state.publication?.activeSnapshotId ?? null,
    };
    for (const venue of Object.values(state.venues)) {
      if (venue.stages.resolve.status !== 'success') continue;
      for (const stage of ['highlight', 'pill', 'panel']) venue.stages[stage] = { status: 'skipped', outputRef: null, error: 'Incomplete source or venue snapshot was verified but not committed' };
    }
  }
  saveState(runDir, state);
  pipelineTrace(runDir, { stage: 'publication', action: 'staged_publication_terminal', outcome: state.publication?.decision ?? verification.status, entityType: 'snapshot', entityId: state.publication?.candidateSnapshotId ?? options.run, reasonCode: state.publication?.reasonCodes?.join(',') || null, blocker: verification.error, nextAction: `npm run event-pipeline -- advance --run ${options.run}` });
  printNext(state);
}

function canCommitFrontendSnapshot(state) {
  return stateCanCommitFrontendSnapshot(state);
}

function environmentRecords(name) {
  const path = process.env[name];
  if (!path) return undefined;
  const value = readJson(resolve(path));
  return Array.isArray(value) ? value : value.records;
}

async function prepareFrontendPlan(runId) {
  const runDir = runDirectory(runId), state = loadState(runId);
  const currentPois = environmentRecords('EVENT_PIPELINE_CURRENT_POIS');
  const currentLandmarks = environmentRecords('EVENT_PIPELINE_CURRENT_LANDMARKS');
  const approved = currentPois || currentLandmarks ? null : loadCurrentApprovedData(ROOT);
  return prepareFrontendSnapshot({
    runDir, state, run: readJson(join(runDir, 'run.json')),
    currentPois: currentPois ?? approved?.pois ?? [],
    currentLandmarks: currentLandmarks ?? approved?.landmarks ?? [],
  });
}

async function planFrontend(options) {
  const plan = await prepareFrontendPlan(options.run);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

function nextAction(state) {
  return nextPipelineAction(state);
}

function progressResponse(state) {
  return stateProgressResponse(state);
}

function terminalProblems(state) {
  return stateTerminalProblems(state);
}

function renderStatus(state, run, frontendPlan = null) {
  return renderPipelineStatus(state, run, frontendPlan);
}

function finalize(options) {
  const runDir = runDirectory(options.run);
  const state = loadState(options.run);
  const problems = terminalProblems(state);
  if (problems.length) fail(`Refusing to finalize an incomplete run:\n- ${problems.join('\n- ')}`, 2);
  const activeReviewVenues = Object.entries(state.venues ?? {})
    .filter(([, venue]) => venue.stages?.resolve?.resolutionStatus === 'needs_review')
    .map(([venueId, venue]) => ({ venueId, evidenceHash: venue.evidenceHash ?? branchEvidenceHash(runDir, venue) }));
  const repository = new AdminRepository({ databasePath: adminDatabasePath() });
  try {
    state.adminReviewReconciliation = {
      ...repository.reconcileVenueReviewQueue(activeReviewVenues),
      reconciledAt: new Date().toISOString(),
    };
  } finally { repository.close(); }
  state.overallStatus = deriveTerminalStatus(state);
  state.finalizedAt = new Date().toISOString();
  saveState(runDir, state);
  const run = readJson(join(runDir, 'run.json'));
  const frontendPlanPath = join(runDir, 'frontend/plan.json');
  const frontendPlan = existsSync(frontendPlanPath) ? readJson(frontendPlanPath) : null;
  pipelineTrace(runDir, { stage: 'run', action: 'run_finalized', outcome: state.overallStatus, entityType: 'run', entityId: options.run, reasonCode: state.publication?.reasonCodes?.join(',') || null, blocker: state.verification?.error ?? null, nextAction: null });
  pipelineTrace(runDir, { stage: 'run', action: 'admin_review_queue_reconciled', outcome: 'success', entityType: 'run', entityId: options.run,
    counts: { active: state.adminReviewReconciliation.activeVenueIds.length, superseded: state.adminReviewReconciliation.superseded,
      pending: state.adminReviewReconciliation.pending, deferred: state.adminReviewReconciliation.deferred }, reasonCode: null, blocker: null, nextAction: null });
  const tracePath = join(runDir, 'logs/trace.jsonl');
  const summary = { ...statusSummary(state, run, frontendPlan), trace: { path: 'logs/trace.jsonl', sha256: existsSync(tracePath) ? sha(readFileSync(tracePath)) : null } };
  atomicWrite(join(runDir, 'status.json'), `${JSON.stringify(summary, null, 2)}\n`);
  atomicWrite(join(runDir, 'status.md'), renderStatus(state, run, frontendPlan));
  process.stdout.write(`${JSON.stringify({ ...progressResponse(state), statusPath: join(runDir, 'status.md'), statusJsonPath: join(runDir, 'status.json'), tracePath }, null, 2)}\n`);
}

function printNext(state) {
  process.stdout.write(`${JSON.stringify(progressResponse(state), null, 2)}\n`);
  if (!state.finalizedAt) process.exitCode = CONTINUE_EXIT_CODE;
}

function status(options) {
  const state = loadState(options.run);
  process.stdout.write(`${JSON.stringify({ ...state, ...progressResponse(state), blockers: terminalProblems(state) }, null, 2)}\n`);
  if (!state.finalizedAt) process.exitCode = CONTINUE_EXIT_CODE;
}

function usage() {
  process.stdout.write(`Usage:\n  npm run event-pipeline -- run [--date YYYY-MM-DD]\n  npm run event-pipeline -- start [--date YYYY-MM-DD]\n  npm run event-pipeline -- resume --run <run-id>\n  npm run event-pipeline -- advance --run <run-id>\n  npm run event-pipeline -- status --run <run-id>\n  npm run event-pipeline -- collect-source --run <run-id> --source <name>\n  npm run event-pipeline -- record-source --run <run-id> --source <name> --result <json>\n  npm run event-pipeline -- normalize --run <run-id>\n  npm run event-pipeline -- record-normalization --run <run-id> --result <json>\n  npm run event-pipeline -- prepare-venues --run <run-id>\n  npm run event-pipeline -- resolve-local --run <run-id>\n  npm run event-pipeline -- finalize-dedup --run <run-id>\n  npm run event-pipeline -- reprocess-unresolved --run <run-id>\n  npm run event-pipeline -- record-venue-recovery --run <run-id> --venue <id> --evidence <json>\n  npm run event-pipeline -- reuse-resolution-cache --run <run-id>\n  npm run event-pipeline -- plan-frontend --run <run-id>\n  npm run event-pipeline -- stage-frontend --run <run-id>\n  npm run event-pipeline -- record-stage --run <run-id> --venue <id> --stage <stage> --result <json>\n  npm run event-pipeline -- verify --run <run-id>\n  npm run event-pipeline -- finalize --run <run-id>\n`);
}

export { branchEvidenceHash, canCommitFrontendSnapshot, classifyNonBuildingRecovery, collectLocationClues, collectOfficialCandidatePages, enrichRecoveryCoordinates, eventInterval, explicitMultiVenueSourceUrls, jsonPointer, nextAction, parseManifest, progressResponse, readPipelineConfig, reconcileNormalizedVenueBranches, renderStatus, reopenImprovedLocalCandidates, replaceLastSuccessfulUse, reusableResolutionEntry, selectDeterministicOneMapAddress, singaporeWindow, terminalProblems, validateApprovedResolution, validateHighlightArtifacts, validateNormalizedSemantics, validateNotMappableAgainstLocalCandidates, validateResolveRecoveryEvidence, validateSourceEvidence, validateSourceResult, validateSourceSemantics, validateStageEventIds, validateVenueRecoveryEvidence };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    const commands = { run: runAll, start, resume, advance, status, 'collect-source': collectSourceCommand, 'record-source': recordSource, normalize, 'record-normalization': recordNormalization, 'prepare-venues': prepareVenues, 'resolve-local': resolveLocal, 'finalize-dedup': finalizeDedupCommand, 'reprocess-unresolved': reprocessUnresolved, 'record-venue-recovery': recordVenueRecovery, 'reuse-resolution-cache': reuseResolutionCacheCommand, 'plan-frontend': planFrontend, 'stage-frontend': stageFrontend, 'record-stage': recordStage, verify, finalize };
    if (!command || command === 'help' || !commands[command]) usage();
    else if (command === 'run' || command === 'start' || command === 'status' || command === 'advance') await commands[command](options);
    else {
      acquireLock(options.run);
      try { await commands[command](options); } finally { releaseLock(); }
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
