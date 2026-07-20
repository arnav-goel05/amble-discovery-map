import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const EVENT_STAGES = Object.freeze(['resolve', 'highlight', 'pill', 'panel']);
export const TERMINAL_SOURCE_STATUSES = new Set(['success', 'blocked', 'failed', 'pilot_failed', 'disabled']);
export const TERMINAL_STAGE_STATUSES = new Set(['success', 'blocked', 'failed', 'skipped', 'unresolved']);

export function safeResolutionOutcome(venue) {
  const stage = venue?.stages?.resolve;
  return stage?.status === 'success'
    || (stage?.status === 'unresolved' && ['not_mappable', 'needs_review'].includes(stage?.resolutionStatus));
}

export function evaluateCommitEligibility(state, { requireVerification = true } = {}) {
  const reasons = [];
  const sources = Object.entries(state.sources ?? {});
  const venues = Object.entries(state.venues ?? {});
  const enabledSources = sources.filter(([, source]) => source.operatingMode !== 'disabled');
  const sourceReconciliationAccounted = state.normalization?.sourceReconciliation?.accounted === true;
  if (!enabledSources.length || enabledSources.some(([, source]) => source.operatingMode !== 'pilot' && source.status !== 'success') && !sourceReconciliationAccounted) reasons.push('required_source_incomplete');
  if (state.normalization?.status !== 'success') reasons.push('normalization_incomplete');
  if (venues.length && state.resolutionPreparation?.status !== 'success') reasons.push('venue_accounting_incomplete');
  if (venues.some(([, venue]) => !safeResolutionOutcome(venue))) reasons.push('venue_resolution_incomplete');
  if (state.deduplication && state.deduplication.status !== 'success') reasons.push('deduplication_incomplete');
  if (requireVerification) {
    if (state.verification?.status !== 'success') reasons.push('verification_incomplete');
    for (const gate of ['poiSeparation', 'build', 'eventUi', 'browser']) {
      if (state.verification?.[gate]?.status !== 'success') reasons.push(`${gate}_failed`);
    }
  }
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export const canCommitFrontendSnapshot = (state, options) => evaluateCommitEligibility(state, options).eligible;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
};

export const runStatePath = (runDirectory) => join(runDirectory, 'orchestrator-state.json');
export const loadRunState = (runDirectory) => readJson(runStatePath(runDirectory));

export function saveRunState(runDirectory, state, { now = () => new Date().toISOString() } = {}) {
  state.updatedAt = now();
  writeJson(runStatePath(runDirectory), state);
  const runPath = join(runDirectory, 'run.json');
  const run = readJson(runPath);
  run.updatedAt = state.updatedAt;
  run.status = state.overallStatus;
  writeJson(runPath, run);
  return state;
}

export function nextPipelineAction(state) {
  for (const [source, value] of Object.entries(state.sources ?? {})) if (value.status === 'pending') return { action: 'collect-source', source };
  if (state.normalization?.status === 'pending') return { action: 'normalize' };
  if (state.normalization?.status === 'failed') return { action: 'finalize' };
  if (Object.keys(state.venues ?? {}).length && state.resolutionPreparation?.status !== 'success') return { action: 'prepare-venues' };
  const pendingResolve = Object.entries(state.venues ?? {}).find(([, venue]) => venue.stages.resolve.status === 'pending');
  if (pendingResolve) return (state.resolutionPreparation?.localCandidateCount ?? 0) > 0
    ? { action: 'resolve-local' }
    : { action: 'record-stage', venue: pendingResolve[0], stage: 'resolve' };
  const allResolvesTerminal = Object.values(state.venues ?? {}).every((venue) => TERMINAL_STAGE_STATUSES.has(venue.stages.resolve.status));
  if (allResolvesTerminal && state.deduplication?.status === 'pending') return { action: 'finalize-dedup' };
  if (state.deduplication?.status === 'blocked' || state.deduplication?.status === 'failed') return { action: 'finalize' };
  const frontendPending = Object.values(state.venues ?? {}).some((venue) => ['highlight', 'pill', 'panel'].some((stage) => venue.stages[stage].status === 'pending'));
  if (allResolvesTerminal && (frontendPending || state.verification?.status === 'pending')) return { action: 'stage-frontend' };
  for (const [venue, value] of Object.entries(state.venues ?? {})) {
    for (const stage of EVENT_STAGES) if (value.stages[stage].status === 'pending') return { action: 'record-stage', venue, stage };
  }
  if (state.verification?.status === 'pending') return { action: 'verify' };
  return { action: 'finalize' };
}

export function terminalProblems(state) {
  const problems = [];
  for (const [source, value] of Object.entries(state.sources ?? {})) if (!TERMINAL_SOURCE_STATUSES.has(value.status)) problems.push(`source ${source} is ${value.status}`);
  if (state.normalization?.status === 'pending') problems.push('normalization is pending');
  if (Object.keys(state.venues ?? {}).length && state.resolutionPreparation?.status !== 'success') problems.push(`venue recovery preparation is ${state.resolutionPreparation?.status ?? 'missing'}`);
  for (const [venue, value] of Object.entries(state.venues ?? {})) for (const stage of EVENT_STAGES) {
    if (!TERMINAL_STAGE_STATUSES.has(value.stages[stage].status)) problems.push(`${venue}/${stage} is ${value.stages[stage].status}`);
  }
  if (state.verification?.status === 'pending' && state.normalization?.status === 'success') problems.push('verification is pending');
  if (state.deduplication?.status === 'pending') problems.push('deduplication is pending');
  return problems;
}

export function deriveTerminalStatus(state) {
  if (state.verification?.status === 'failed' || state.normalization?.status === 'failed') return 'failed';
  const sources = Object.values(state.sources ?? {});
  const enabledSources = sources.filter((source) => source.operatingMode !== 'disabled');
  if (!enabledSources.length || enabledSources.every((source) => source.status !== 'success')) return 'failed';
  if (enabledSources.some((source) => source.operatingMode !== 'pilot' && source.status === 'failed')) return 'failed';
  if (enabledSources.some((source) => source.operatingMode !== 'pilot' && source.status === 'blocked') && state.normalization?.sourceReconciliation?.accounted !== true) return 'partial';
  if (!evaluateCommitEligibility(state).eligible) return 'partial';
  return 'success';
}
