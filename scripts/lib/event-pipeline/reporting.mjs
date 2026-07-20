import {
  EVENT_STAGES,
  evaluateCommitEligibility,
  safeResolutionOutcome,
} from "./run-state.mjs";

export const REPORT_OUTCOMES = Object.freeze([
  "mapped",
  "off_map",
  "carry_forward_stale",
  "review",
  "held",
  "excluded",
  "archived",
  "release_rollback",
]);

export function summarizeActivityOutcomes(events = []) {
  const summary = Object.fromEntries(REPORT_OUTCOMES.map((key) => [key, 0]));
  for (const event of events) {
    if (event.lifecycleState === "active" && event.publicPlacement === "mapped")
      summary.mapped += 1;
    else if (
      event.lifecycleState === "active" &&
      event.publicPlacement === "off_map"
    )
      summary.off_map += 1;
    else if (event.lifecycleState === "held") summary.held += 1;
    else if (event.lifecycleState === "excluded") summary.excluded += 1;
    else if (event.lifecycleState === "archived") summary.archived += 1;
    if (event.freshness === "stale") summary.carry_forward_stale += 1;
    if (
      event.mappingStatus === "pending_review" ||
      event.reviewStatus === "review"
    )
      summary.review += 1;
  }
  return summary;
}

export function summarizeEvidenceLevels(events = []) {
  const levels = {};
  const upgrades = {};
  for (const event of events) {
    const level = event.evidenceLevel ?? "direct";
    levels[level] = (levels[level] ?? 0) + 1;
    for (const contribution of event.sourceContributions ?? []) {
      if (!contribution.upgradedFrom || contribution.upgradedFrom === level)
        continue;
      const key = `${contribution.upgradedFrom}->${level}`;
      upgrades[key] = (upgrades[key] ?? 0) + 1;
    }
  }
  return { uniqueActivities: events.length, levels, upgrades };
}

export function progressResponse(state) {
  const complete = Boolean(state.finalizedAt);
  const continueCommand = complete
    ? null
    : `npm run event-pipeline -- advance --run ${state.runId}`;
  return {
    runId: state.runId,
    status: state.overallStatus,
    complete,
    mustContinue: !complete,
    mayAskUserToContinue: false,
    requiredSkill: "skills/event-pipeline-runner/SKILL.md",
    commandMeaning:
      "Run the complete pipeline through finalization; initialization alone is not completion.",
    next: complete ? null : { action: "run-command", command: continueCommand },
    continueCommand,
    instruction: complete
      ? "The pipeline is finalized; report the terminal result."
      : "Run next.command exactly. The executable orchestrator owns all internal stage selection; do not infer or implement another action.",
  };
}
export function statusSummary(state, run, frontendPlan = null) {
  const eligibility = evaluateCommitEligibility(state);
  return {
    schemaVersion: "3.0",
    runId: state.runId,
    window: run.window,
    timezone: run.timezone,
    status: state.overallStatus,
    finalizedAt: state.finalizedAt ?? null,
    publication: state.publication ?? {
      decision: eligibility.eligible ? "publish" : "preserve_previous",
      reasonCodes: eligibility.reasons,
    },
    sources: Object.fromEntries(
      Object.entries(state.sources ?? {}).map(([name, source]) => [
        name,
        {
          role: source.sourceRole ?? "authoritative",
          mode: source.operatingMode ?? "required",
          status: source.status,
          counts: source.counts ?? {},
          completion: source.completion ?? null,
          confirmationRefs: source.confirmationRefs ?? [],
          blockerReasonCode: source.blockerReasonCode ?? null,
          error: source.error ?? null,
        },
      ]),
    ),
    normalization: state.normalization,
    deduplication: state.deduplication ?? null,
    evidence:
      state.deduplication?.evidence ?? state.normalization?.evidence ?? null,
    venues: Object.fromEntries(
      Object.entries(state.venues ?? {}).map(([id, venue]) => [
        id,
        {
          venue: venue.venue,
          eventIds: venue.eventIds,
          resolve: venue.stages.resolve,
        },
      ]),
    ),
    verification: state.verification,
    reconciliation: frontendPlan?.expiry ?? null,
    adminReviewReconciliation: state.adminReviewReconciliation ?? null,
    nextAction: state.finalizedAt ? null : progressResponse(state).next,
  };
}
export function renderStatus(state, run, frontendPlan = null) {
  const eligibility = evaluateCommitEligibility(state);
  const sourceRows = Object.entries(state.sources ?? {})
    .map(([name, source]) => {
      const c = source.counts ?? {};
      const blockedSurfaces = (source.completion?.surfaceOutcomes ?? []).filter(
        ({ status }) => status === "blocked",
      ).length;
      return `| ${name} | ${source.sourceRole ?? "authoritative"} | ${source.operatingMode ?? "required"} | ${source.status} | ${c.pages ?? 0} | ${c.listingAppearances ?? 0} | ${c.uniqueSourcePointers ?? c.sourceRecordsReceived ?? 0} | ${c.listingDuplicatesCollapsed ?? 0} | ${blockedSurfaces} | ${c.sourceRecordsReceived ?? 0} | ${c.invalidSourceRecords ?? 0} | ${c.processedSourceRecords ?? 0} | ${c.occurrencesEmitted ?? 0} | ${c.excludedOccurrences ?? 0} | ${c.eligiblePreDedup ?? 0} | ${c.duplicateCollapsed ?? 0} | ${c.acceptedPrimary ?? 0} | ${JSON.stringify(c.confirmationOutcomeCounts ?? {})} | ${(source.artifactRefs ?? []).join("<br>")} |`;
    })
    .join("\n");
  const venueRows =
    Object.entries(state.venues ?? {})
      .map(
        ([id, venue]) =>
          `| ${id} | ${venue.venue} | ${EVENT_STAGES.map((stage) => venue.stages[stage].status).join(" | ")} | ${EVENT_STAGES.map((stage) => venue.stages[stage].outputRef ?? "-").join("<br>")} |`,
      )
      .join("\n") || "| - | - | - | - | - | - | - | - |";
  const errors = [
    ...Object.entries(state.sources ?? {})
      .filter(([, value]) => value.error)
      .map(([name, value]) => `- Source ${name}: ${value.error}`),
    ...Object.entries(state.venues ?? {}).flatMap(([id, venue]) =>
      EVENT_STAGES.filter((stage) => venue.stages[stage].error).map(
        (stage) => `- ${id}/${stage}: ${venue.stages[stage].error}`,
      ),
    ),
    ...(state.verification?.error
      ? [`- Verification: ${state.verification.error}`]
      : []),
  ];
  const needsReview = Object.values(state.venues ?? {}).filter(
    (venue) => venue.stages.resolve.resolutionStatus === "needs_review",
  ).length;
  const notMappable = Object.values(state.venues ?? {}).filter(
    (venue) => venue.stages.resolve.resolutionStatus === "not_mappable",
  ).length;
  const nextSteps = [
    ...Object.entries(state.sources ?? {})
      .filter(([, value]) => value.status !== "success")
      .map(
        ([name, value]) =>
          `- Restore ${name} after resolving ${value.blockerReasonCode ?? value.status}, then rerun the complete refresh.`,
      ),
    ...(needsReview
      ? [
          `- Review ${needsReview} evidence-bound venue case${needsReview === 1 ? "" : "s"} in the private admin queue.`,
        ]
      : []),
    ...(state.verification?.status === "failed"
      ? [
          "- Correct the earliest failed executable verification and rerun `stage-frontend`.",
        ]
      : []),
  ];
  const reconciliation = frontendPlan
    ? `- Expired events: ${frontendPlan.expiry.expiredEventIds.join(", ") || "none"}\n- Undated review events: ${(frontendPlan.expiry.undatedReviewEventIds ?? []).join(", ") || "none"}\n- Removed landmarks: ${frontendPlan.expiry.removedLandmarkIds.join(", ") || "none"}\n- Geometry changed: ${frontendPlan.geometryChanged}`
    : "- No frontend reconciliation plan was required.";
  const publication = state.publication ?? {
    decision: eligibility.eligible ? "publish" : "preserve_previous",
    reasonCodes: eligibility.reasons,
  };
  return `# Event Pipeline Status\n\n## Run and window\n\n- Run ID: \`${state.runId}\`\n- Status: \`${state.overallStatus}\`\n- Finalized: \`${Boolean(state.finalizedAt)}\`\n- Publication: \`${publication.decision}\`\n- Active snapshot: \`${publication.activeSnapshotId ?? "unchanged"}\`\n- Candidate snapshot: \`${publication.candidateSnapshotId ?? "none"}\`\n- Window: \`${run.window.start}\` through \`${run.window.end}\` (inclusive)\n- Timezone: \`${run.timezone}\`\n- Manifest snapshot: \`${run.manifestSnapshot.path}\` (\`${run.manifestSnapshot.sha256}\`)\n- Pipeline config snapshot: \`${run.adapterDefinitionsSnapshot.path}\` (\`${run.adapterDefinitionsSnapshot.sha256}\`)\n\n## Reconciled summary\n\n${reconciliation}\n\n- Normalized eligible pre-dedup: ${state.normalization.counts?.eligiblePreDedup ?? 0}\n- Cross-source duplicates collapsed: ${state.deduplication?.counts?.crossSourceDuplicateCollapsed ?? 0}\n- Accepted events: ${state.deduplication?.counts?.acceptedPrimary ?? state.normalization.counts?.acceptedPrimary ?? 0}\n- Blocking dedup reviews: ${state.deduplication?.blockingReviews?.length ?? 0}\n- Safely not mappable: ${notMappable}\n- Pending venue review: ${needsReview}\n\n## Per-source accounting\n\n| Source | Role | Mode | Status | Pages | Listing appearances | Unique pointers | Listing overlaps | Blocked surfaces | Received | Invalid | Processed | Occurrences | Excluded | Eligible | Duplicates | Accepted primary | Confirmations | Artifacts |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|\n${sourceRows}\n\n## Per-venue stages\n\n| Venue branch | Venue | Resolve | Highlight | Pill | Panel | Output refs |\n|---|---|---|---|---|---|---|\n${venueRows}\n\n## Build and browser verification\n\n- Overall: \`${state.verification.status}\`\n- POI separation: \`${state.verification.poiSeparation?.status ?? "not run"}\`\n- Build: \`${state.verification.build?.status ?? "not run"}\`\n- Event UI: \`${state.verification.eventUi?.status ?? "not run"}\`\n- Staged browser: \`${state.verification.browser?.status ?? "not run"}\`\n\n## Errors\n\n${errors.join("\n") || "- None."}\n\n## Ordered next steps\n\n${nextSteps.join("\n") || "- None. The run is fully accounted for."}\n`;
}
