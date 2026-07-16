import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APPROVED_POIS } from '../data/approved-pois.js';
import { APPROVED_LANDMARKS } from '../data/approved-landmarks.js';
import { contentHash, pruneExpiredContent, reconcileLandmark, reconcilePoi } from './reconcile-event-content.mjs';
import { restorePoiBackgrounds } from './restore-poi-backgrounds.mjs';
import { activateStagedSnapshot, loadApprovedSnapshot, stageImmutableSnapshot } from './lib/approved-snapshot.mjs';

const atomicWrite = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
};
const writeJson = (path, value) => atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
const moduleText = (name, records) => `export const ${name} = ${JSON.stringify(records, null, 2)};\n`;

export function loadCurrentApprovedData(root) {
  try {
    const active = loadApprovedSnapshot({ root });
    return {
      snapshot: active,
      pois: JSON.parse(readFileSync(join(active.directory, active.poisRef), 'utf8')),
      landmarks: JSON.parse(readFileSync(join(active.directory, active.landmarksRef), 'utf8')),
    };
  } catch (error) {
    if (error?.code === 'snapshot_pointer_missing') return { snapshot: null, pois: APPROVED_POIS, landmarks: APPROVED_LANDMARKS };
    throw error;
  }
}

function readResolve(runDir, venueId, stage) {
  if (stage.status !== 'success' || !stage.outputRef) return null;
  return JSON.parse(readFileSync(join(runDir, stage.outputRef), 'utf8')).result;
}

function poiFromResolution(resolution) {
  const tiles = {};
  for (const tile of resolution.sourceTiles ?? []) {
    const path = tile.path ?? tile.tilePath;
    if (path) tiles[path] = [...new Set(tile.batchIds ?? [])];
  }
  return { id: resolution.poiId, label: resolution.canonicalVenue.toUpperCase(), data: `poi-tiles/${resolution.poiId}/tileset.json`, names: resolution.acceptedGmlNames, tiles };
}

export async function prepareFrontendSnapshot({ runDir, state, run, currentPois = APPROVED_POIS, currentLandmarks = APPROVED_LANDMARKS }) {
  const events = JSON.parse(readFileSync(join(runDir, 'normalized/events.json'), 'utf8')).records;
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const pruned = pruneExpiredContent({ landmarks: currentLandmarks, pois: currentPois, asOf: run.window.start });
  const pois = new Map(pruned.pois.map((poi) => [poi.id, poi]));
  const landmarks = new Map(pruned.landmarks.map((landmark) => [landmark.id, landmark]));
  const groups = new Map();
  for (const [venueId, venue] of Object.entries(state.venues)) {
    const resolution = readResolve(runDir, venueId, venue.stages.resolve);
    if (!resolution) continue;
    const group = groups.get(resolution.poiId) ?? { resolution, venueIds: [], sourceVenues: [], eventIds: [] };
    group.venueIds.push(venueId); group.sourceVenues.push(venue.venue); group.eventIds.push(...venue.eventIds);
    groups.set(resolution.poiId, group);
  }

  const classifications = [];
  for (const [poiId, group] of groups) {
    group.eventIds = [...new Set(group.eventIds)];
    const resolution = group.resolution;
    const nextPoi = poiFromResolution(resolution);
    const poiResult = reconcilePoi(pois.get(poiId), nextPoi);
    pois.set(poiId, poiResult.poi);
    const nextLandmark = { id: poiId, label: resolution.canonicalVenue, anchor: resolution.coordinates,
      events: group.eventIds.map((id) => ({ ...eventMap.get(id), coordinates: resolution.coordinates, venueVerified: true })) };
    const landmarkResult = reconcileLandmark(landmarks.get(poiId), nextLandmark, group.sourceVenues);
    landmarks.set(poiId, landmarkResult.landmark);
    classifications.push({ poiId, venueIds: group.venueIds, eventIds: group.eventIds,
      highlightAction: poiResult.action, pillAction: landmarkResult.action, panelAction: landmarkResult.action,
      canonicalVenue: resolution.canonicalVenue, anchor: resolution.coordinates });
  }

  const frontendDir = join(runDir, 'frontend'), assetsDir = join(frontendDir, 'assets');
  rmSync(frontendDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });
  const nextPois = [...pois.values()], nextLandmarks = [...landmarks.values()];
  writeJson(join(frontendDir, 'approved-pois.json'), { schemaVersion: '1.0', records: nextPois });
  writeJson(join(frontendDir, 'approved-landmarks.json'), { schemaVersion: '1.0', records: nextLandmarks });
  atomicWrite(join(frontendDir, 'approved-pois.js'), moduleText('APPROVED_POIS', nextPois));
  atomicWrite(join(frontendDir, 'approved-landmarks.js'), moduleText('APPROVED_LANDMARKS', nextLandmarks));

  const removedPois = currentPois.filter((poi) => pruned.removedLandmarkIds.includes(poi.id));
  if (removedPois.length) await restorePoiBackgrounds({ pois: removedPois, poiIds: pruned.removedLandmarkIds, outputRoot: assetsDir });
  const plan = { schemaVersion: '1.0', runId: run.runId, status: 'staged', classifications,
    expiry: { asOf: run.window.start, expiredEventIds: pruned.expiredEventIds, removedLandmarkIds: pruned.removedLandmarkIds, undatedReviewEventIds: pruned.undatedReviewEventIds },
    geometryChanged: classifications.some((item) => item.highlightAction !== 'noop'),
    hashes: { pois: contentHash(nextPois), landmarks: contentHash(nextLandmarks) } };
  writeJson(join(frontendDir, 'plan.json'), plan);
  return plan;
}

export function writeVerifiedStageHandoffs({ runDir, state, plan, verification }) {
  if (verification.status !== 'success') throw new Error('Cannot create successful frontend handoffs without successful executable verification');
  const timestamp = new Date().toISOString(), written = [];
  for (const item of plan.classifications) for (const venueId of item.venueIds) {
    const eventIds = state.venues[venueId].eventIds;
    const definitions = {
      highlight: { changeAction: item.highlightAction, poiId: item.poiId, canonicalVenue: item.canonicalVenue, anchor: item.anchor,
        poiTilesetUrl: `public/poi-tiles/${item.poiId}/tileset.json`, extractionManifestUrl: `public/poi-tiles/${item.poiId}/extraction-manifest.json`,
        backgroundTileRefs: ['optimized-tiles/tileset.json'], frontendLayerId: 'event-venues-3d', eventIds,
        verification: { command: 'npm run test:poi-separation', status: verification.poiSeparation.status, browser: verification.browser, evidenceRef: 'verification.json' }, inputEventIds: eventIds },
      pill: { changeAction: item.pillAction, poiId: item.poiId, rootId: `${item.poiId}-event-pill`, component: 'activity-scenes/landmark-event-pill.js',
        updateMode: 'successful-snapshot-reconcile', eventIds, selectedEventId: eventIds[0], verification: { command: 'npm run test:event-ui', status: verification.eventUi.status, evidenceRef: 'verification.json' }, inputEventIds: eventIds },
      panel: { changeAction: item.panelAction, poiId: item.poiId, component: 'activity-scenes/landmark-event-panel.js', eventIds,
        fieldContractVersion: '1.0', refreshMode: 'replace-active-landmark-events', verification: { command: 'npm run test:event-ui', status: verification.eventUi.status, evidenceRef: 'verification.json' }, inputEventIds: eventIds }
    };
    for (const [stage, result] of Object.entries(definitions)) {
      const outputRef = `stages/${venueId}/${stage}.json`;
      const envelope = { schemaVersion: '1.0', runId: state.runId, stage, status: 'success', startedAt: timestamp, endedAt: timestamp,
        inputRefs: stage === 'highlight' ? [`stages/${venueId}/resolve.json`] : [`stages/${venueId}/${stage === 'pill' ? 'highlight' : 'pill'}.json`],
        outputRefs: result.changeAction === 'noop' ? [] : [outputRef], error: null, nextStep: null, result };
      writeJson(join(runDir, outputRef), envelope); written.push(outputRef);
      state.venues[venueId].stages[stage] = { status: 'success', outputRef, error: null };
    }
  }
  return written;
}

export function commitFrontendSnapshot({ runDir, root, run = null, state = null, commitEligibility = { eligible: true } }) {
  const frontendDir = join(runDir, 'frontend');
  const plan = JSON.parse(readFileSync(join(frontendDir, 'plan.json'), 'utf8'));
  if (plan.status !== 'verified') throw new Error('Refusing to commit an unverified frontend snapshot');
  if (commitEligibility?.eligible !== true) throw new Error(`Refusing to commit an ineligible frontend snapshot: ${(commitEligibility?.reasons ?? []).join(', ')}`);
  run ??= existsSync(join(runDir, 'run.json')) ? JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) : {
    runId: plan.runId, window: { start: new Date().toISOString(), end: new Date(Date.now() + 7 * 86400000).toISOString() },
  };
  const assets = join(frontendDir, 'assets'), backupRoot = join(frontendDir, 'commit-backup');
  rmSync(backupRoot, { recursive: true, force: true });
  const files = [];
  const walk = (directory, prefix = '') => {
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name), relative = join(prefix, name);
      if (statSync(absolute).isDirectory()) walk(absolute, relative); else files.push({ source: absolute, relative });
    }
  };
  walk(assets);
  const journal = [];
  try {
    for (const file of files) {
      const destination = join(root, file.relative), backup = join(backupRoot, file.relative), existed = existsSync(destination);
      if (existed) { mkdirSync(dirname(backup), { recursive: true }); copyFileSync(destination, backup); }
      mkdirSync(dirname(destination), { recursive: true });
      const temporary = `${destination}.pipeline-next-${process.pid}`;
      copyFileSync(file.source, temporary); renameSync(temporary, destination);
      journal.push({ destination, backup, existed });
    }
    const publishedAt = new Date().toISOString();
    const current = loadCurrentApprovedData(root).snapshot;
    const candidateTileset = join(assets, 'public/poi-tiles/event-venues/tileset.json');
    const tileset = existsSync(candidateTileset)
      ? JSON.parse(readFileSync(candidateTileset, 'utf8'))
      : current ? JSON.parse(readFileSync(join(current.directory, current.tilesetRef), 'utf8')) : { asset: { version: '1.0' }, geometricError: 0, root: {} };
    const makeDurable = (tile) => {
      const content = tile?.content;
      if (content) for (const key of ['uri', 'url']) if (typeof content[key] === 'string') {
        content[key] = content[key].replace(/^\/.*?\/frontend\/assets\/public\//, '/');
        if (content[key].startsWith('/poi-tiles/')) content[key] = `../../../../${content[key].slice(1)}`;
      }
      for (const child of tile?.children ?? []) makeDurable(child);
    };
    makeDurable(tileset.root);
    const records = (name) => JSON.parse(readFileSync(join(frontendDir, name), 'utf8')).records;
    const sourceHealth = Object.fromEntries(Object.entries(state?.sources ?? {}).map(([name, source]) => [name, {
      status: source.status, lastSuccessfulAt: source.completedAt ?? publishedAt,
    }]));
    const snapshot = {
      schemaVersion: '1.0', snapshotId: run.runId, publishedAt,
      coveredWindow: { start: run.window.start.slice(0, 10), end: run.window.end.slice(0, 10), timezone: run.timezone ?? 'Asia/Singapore' },
      freshness: 'fresh', staleAfter: new Date(Date.parse(publishedAt) + 7 * 86400000).toISOString(), sourceHealth,
      landmarksRef: 'landmarks.json', poisRef: 'pois.json', tilesetRef: 'tileset.json',
      previousSnapshotId: current?.snapshotId ?? null, contentHash: '0'.repeat(64),
    };
    const staged = stageImmutableSnapshot({
      root, snapshot, commitEligibility,
      artifacts: {
        'landmarks.json': `${JSON.stringify(records('approved-landmarks.json'), null, 2)}\n`,
        'pois.json': `${JSON.stringify(records('approved-pois.json'), null, 2)}\n`,
        'tileset.json': `${JSON.stringify(tileset, null, 2)}\n`,
      },
    });
    activateStagedSnapshot({ root, staged });
    plan.status = 'committed'; plan.committedAt = publishedAt; plan.snapshotId = run.runId; plan.previousSnapshotId = current?.snapshotId ?? null;
    writeJson(join(frontendDir, 'plan.json'), plan);
    rmSync(backupRoot, { recursive: true, force: true });
    return plan;
  } catch (error) {
    for (const item of journal.reverse()) {
      if (item.existed) copyFileSync(item.backup, item.destination); else rmSync(item.destination, { force: true });
    }
    throw new Error(`Frontend snapshot commit rolled back before activation: ${error.message}`);
  }
}
