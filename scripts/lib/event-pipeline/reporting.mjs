import { EVENT_STAGES, evaluateCommitEligibility, safeResolutionOutcome } from './run-state.mjs';

export function progressResponse(state) {
  const complete = Boolean(state.finalizedAt);
  const continueCommand = complete ? null : `npm run event-pipeline -- advance --run ${state.runId}`;
  return {
    runId: state.runId, status: state.overallStatus, complete, mustContinue: !complete,
    mayAskUserToContinue: false, requiredSkill: 'skills/event-pipeline-runner/SKILL.md',
    commandMeaning: 'Run the complete pipeline through finalization; initialization alone is not completion.',
    next: complete ? null : { action: 'run-command', command: continueCommand }, continueCommand,
    instruction: complete ? 'The pipeline is finalized; report the terminal result.'
      : 'Run next.command exactly. The executable orchestrator owns all internal stage selection; do not infer or implement another action.',
  };
}
export function renderStatus(state, run, frontendPlan = null) {
  const eligibility = evaluateCommitEligibility(state);
  const sourceRows = Object.entries(state.sources ?? {}).map(([name, source]) => {
    const c = source.counts ?? {};
    return `| ${name} | ${source.status} | ${c.pages ?? 0} | ${c.sourceRecordsReceived ?? 0} | ${c.invalidSourceRecords ?? 0} | ${c.processedSourceRecords ?? 0} | ${c.occurrencesEmitted ?? 0} | ${c.excludedOccurrences ?? 0} | ${c.eligiblePreDedup ?? 0} | ${c.duplicateCollapsed ?? 0} | ${c.acceptedPrimary ?? 0} | ${(source.artifactRefs ?? []).join('<br>')} |`;
  }).join('\n');
  const venueRows = Object.entries(state.venues ?? {}).map(([id, venue]) => `| ${id} | ${venue.venue} | ${EVENT_STAGES.map((stage) => venue.stages[stage].status).join(' | ')} | ${EVENT_STAGES.map((stage) => venue.stages[stage].outputRef ?? '-').join('<br>')} |`).join('\n') || '| - | - | - | - | - | - | - | - |';
  const errors = [
    ...Object.entries(state.sources ?? {}).filter(([, value]) => value.error).map(([name, value]) => `- Source ${name}: ${value.error}`),
    ...Object.entries(state.venues ?? {}).flatMap(([id, venue]) => EVENT_STAGES.filter((stage) => venue.stages[stage].error).map((stage) => `- ${id}/${stage}: ${venue.stages[stage].error}`)),
    ...(state.verification?.error ? [`- Verification: ${state.verification.error}`] : []),
  ];
  const needsReview = Object.values(state.venues ?? {}).filter((venue) => venue.stages.resolve.resolutionStatus === 'needs_review').length;
  const notMappable = Object.values(state.venues ?? {}).filter((venue) => venue.stages.resolve.resolutionStatus === 'not_mappable').length;
  const nextSteps = [
    ...Object.entries(state.sources ?? {}).filter(([, value]) => value.status !== 'success').map(([name, value]) => `- Restore ${name} after resolving ${value.blockerReasonCode ?? value.status}, then rerun the complete refresh.`),
    ...(needsReview ? [`- Review ${needsReview} evidence-bound venue case${needsReview === 1 ? '' : 's'} in the private admin queue.`] : []),
    ...(state.verification?.status === 'failed' ? ['- Correct the earliest failed executable verification and rerun `stage-frontend`.'] : []),
  ];
  const reconciliation = frontendPlan ? `- Expired events: ${frontendPlan.expiry.expiredEventIds.join(', ') || 'none'}\n- Undated review events: ${(frontendPlan.expiry.undatedReviewEventIds ?? []).join(', ') || 'none'}\n- Removed landmarks: ${frontendPlan.expiry.removedLandmarkIds.join(', ') || 'none'}\n- Geometry changed: ${frontendPlan.geometryChanged}` : '- No frontend reconciliation plan was required.';
  const publication = state.publication ?? { decision: eligibility.eligible ? 'publish' : 'preserve_previous', reasonCodes: eligibility.reasons };
  return `# Event Pipeline Status\n\n## Run and window\n\n- Run ID: \`${state.runId}\`\n- Status: \`${state.overallStatus}\`\n- Finalized: \`${Boolean(state.finalizedAt)}\`\n- Publication: \`${publication.decision}\`\n- Active snapshot: \`${publication.activeSnapshotId ?? 'unchanged'}\`\n- Candidate snapshot: \`${publication.candidateSnapshotId ?? 'none'}\`\n- Window: \`${run.window.start}\` through \`${run.window.end}\` (inclusive)\n- Timezone: \`${run.timezone}\`\n- Manifest snapshot: \`${run.manifestSnapshot.path}\` (\`${run.manifestSnapshot.sha256}\`)\n- Pipeline config snapshot: \`${run.adapterDefinitionsSnapshot.path}\` (\`${run.adapterDefinitionsSnapshot.sha256}\`)\n\n## Reconciled summary\n\n${reconciliation}\n\n- Normalized eligible pre-dedup: ${state.normalization.counts?.eligiblePreDedup ?? 0}\n- Duplicates collapsed: ${state.normalization.counts?.duplicateCollapsed ?? 0}\n- Accepted events: ${state.normalization.counts?.acceptedPrimary ?? 0}\n- Safely not mappable: ${notMappable}\n- Pending venue review: ${needsReview}\n\n## Per-source accounting\n\n| Source | Status | Pages | Received | Invalid | Processed | Occurrences | Excluded | Eligible | Duplicates | Accepted primary | Artifacts |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${sourceRows}\n\n## Per-venue stages\n\n| Venue branch | Venue | Resolve | Highlight | Pill | Panel | Output refs |\n|---|---|---|---|---|---|---|\n${venueRows}\n\n## Build and browser verification\n\n- Overall: \`${state.verification.status}\`\n- POI separation: \`${state.verification.poiSeparation?.status ?? 'not run'}\`\n- Build: \`${state.verification.build?.status ?? 'not run'}\`\n- Event UI: \`${state.verification.eventUi?.status ?? 'not run'}\`\n- Staged browser: \`${state.verification.browser?.status ?? 'not run'}\`\n\n## Errors\n\n${errors.join('\n') || '- None.'}\n\n## Ordered next steps\n\n${nextSteps.join('\n') || '- None. The run is fully accounted for.'}\n`;
}
