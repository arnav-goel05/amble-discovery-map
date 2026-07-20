# Executable Orchestrator

Use `npm run event-pipeline -- <command>` as the authoritative state machine. The skill supplies judgment and browser work; it does not decide whether the run is complete.

## Commands

0. `run [--date YYYY-MM-DD]` creates a run and advances autonomously through finalization or the first structured intervention.
1. `start [--date YYYY-MM-DD]` creates immutable snapshots, `run.json`, and `orchestrator-state.json`. Preserve the returned run ID.
2. `status --run <run-id>` returns the single next action plus all blockers.
3. `collect-source --run <run-id> --source <configured name>` executes the configured adapter, complete pagination/detail capture, artifacts, and accounting. `record-source` is compatibility-only for tests and structured intervention submission.
4. `normalize --run <run-id>` deterministically builds parents, finite sessions, and venue occurrences; applies inclusion/schedule/evidence/location policy without a weekly ingestion cutoff; collapses safe repeats; writes normalized artifacts; creates only required venue branches; and records complete/unavailable per-source accounting. Cross-source merging remains provisional until venue resolution. `record-normalization` remains available only for compatibility and fixture-driven testing.
5. `prepare-venues --run <run-id>` validates or builds the local index, enriches every pending venue branch, and writes the local recovery candidate set. Resolve results are rejected until this succeeds.
6. `resolve-local --run <run-id>` submits every unambiguous executable local match. Only remaining ambiguous branches may request agent adjudication.
7. `record-venue-recovery --run <run-id> --venue <id> --evidence <json>` records newly verified address/coordinate evidence and reruns only that venue through the local resolver. If no exact candidate is approved, it writes the validated `needs_review` handoff itself. It preserves every completed branch.
8. `finalize-dedup --run <run-id>` completes same-source/all-source deduplication after every venue resolve result is terminal. It uses approved POI or strong compatible off-map evidence, preserves prior anchors/children/contributions, and isolates uncertain identities for review.
9. `stage-frontend --run <run-id>` reconciles current contributions with stale carry-forward and expiry, stages mapped/off-map/held/archive outcomes, performs create/update/noop geometry work, runs release-wide asset/build/UI/staged-browser verification, writes evidence-backed handoffs, and atomically activates the immutable candidate only when every release gate passes.
10. `verify --run <run-id>` handles the zero-landmark path and compatibility verification after all venue stages are terminal and deduplication succeeds.
11. `finalize --run <run-id>` writes `status.json`, `status.md`, and the final trace event only when no required work remains pending. It exits with code 2 for an incomplete run.

`advance --run <run-id>` follows executable actions autonomously until finalization or a structured intervention is emitted. Normal progression never asks an agent to choose or manufacture the next checkpoint.

After every command, follow the returned `next.action` immediately while `mustContinue` is `true`. Do not pause, ask whether to continue, offer the next checkpoint as optional work, or treat successful initialization/checkpoint recording as a stopping point. Do not write or manually edit `orchestrator-state.json`, `run.json`, or `status.md`.

Before each frontend stage, compare the incoming canonical content with the current approved artifact. Record `create`, `update`, or `noop`. For `noop`, reuse geometry, tiles, and component data without extraction, generated-data writes, or landmark-specific browser checks. Run integrated verification once after assembling the complete snapshot.

Immediately after normalization and before the first resolve checkpoint:

1. Confirm the local venue index exists and contains OneMap rows; run `npm run venue-index:build` when it does not.
2. Run `npm run venue-index:enrich -- --run <run-id>` while branches are pending.
3. Run `npm run venue-index:resolve -- --run <run-id>`.
4. Submit approved local matches. For each remaining `not_found` or ambiguous row, execute the resolver's authoritative web/address recovery.
5. Treat the emitted intervention as self-contained: use its inline context or branch-scoped evidence bundle and pre-created schema-version `1.0` recovery template. Only the files in `allowedLocalReads` may be opened; never search `outputs/event-pipeline`, inspect implementation code, or read older runs. Open the two required authoritative pages, edit only the template, then run the exact `record-venue-recovery` command emitted by `advance`.
6. Let `record-venue-recovery` submit `needs_review` when that focused local rerun still cannot approve one building. Do not construct a second handoff manually. Never bulk-convert local misses to `not_mappable`.

Enrichment must consume saved official-provider coordinates before web recovery. When newly recovered address or coordinate evidence changes an unresolved branch's evidence hash, reopen only that branch and its downstream stages; retain every unchanged terminal branch.

Nonterminal commands deliberately exit with code `3` (`continuation_required`) after printing valid JSON. This is not a pipeline failure. It is an executable signal that the current task must run the returned `next` action before it may finish. Only a finalized run exits normally.

Every nonterminal response supplies `next: { "action": "run-command", "command": "..." }`. Run `next.command` exactly. Internal stage selection is intentionally not exposed and must not be inferred from output files.

Every nonterminal response contains:

```json
{
  "complete": false,
  "mustContinue": true,
  "mayAskUserToContinue": false,
  "next": { "action": "..." },
  "instruction": "Execute the next action immediately. Do not pause for confirmation or offer to continue later."
}
```

Only a finalized response has `complete: true` and `mustContinue: false`. A worker may return control to the user before finalization only for a concrete external blocker it cannot resolve after exhausting the adapter and skill recovery rules. Ordinary pending work, an isolated source failure that can be terminally accounted and reconciled, a scoped review, or the availability of a next checkpoint is not such a blocker. A release-wide rejection finalizes with the prior active snapshot preserved and explicit validation/activation lineage.

## Worker result formats

Source result:

```json
{
  "status": "success",
  "counts": {
    "pages": 1,
    "sourceRecordsReceived": 10,
    "invalidSourceRecords": 1,
    "processedSourceRecords": 9,
    "occurrencesEmitted": 12,
    "excludedOccurrences": 2,
    "eligiblePreDedup": 10
  },
  "completion": {
    "paginationComplete": true,
    "pagesVisited": ["raw/catch/listings/page-0001.dom.md"],
    "sourceRecordsDiscovered": 10,
    "providerReportedTotal": 10,
    "providerTotalEvidence": {
      "artifactRef": "raw/catch/listings/page-0001.json",
      "jsonPointer": "/response/total"
    },
    "pageRecordCounts": [10],
    "detailUrlsDiscovered": 10,
    "detailPagesCaptured": 10,
    "zeroResultConfirmed": false
  },
  "sourceRecordRefs": ["raw/catch/details/<hash>.json#/records/0"],
  "invalidSourceRecordRefs": [],
  "processedSourceRecordRefs": ["raw/catch/details/<hash>.json#/records/0"],
  "artifactRefs": [
    "raw/catch/listings/page-0001.dom.md",
    "raw/catch/details/<hash>.json"
  ],
  "error": null
}
```

The example abbreviates the record-ref arrays; their actual lengths must equal the corresponding counts. Invalid and processed refs must exactly partition all unique source record refs. Every pointer must target `raw/<source>/details/<hash>.json#/records/<index>`, resolve to a current-run JSON envelope, and contain a real detail URL, source ID, adapter version, and listing page. Listing pages, loading shells, extraction notes, and JSON invented from them are not source records. Every pagination/record artifact must be declared and present.

Never copy raw or normalized artifacts from another run. Capture source evidence during the current run and bind each detail envelope to the current `runId` and `createdAt`.

When the provider response reports a total, result count, page count, or next-page marker, follow it completely. `providerReportedTotal`, the sum of `pageRecordCounts`, `sourceRecordsDiscovered`, `sourceRecordsReceived`, and the number of unique record refs must be identical. Never submit one representative record when the provider reports more records.

Save the untouched raw listing response as `raw/<source>/listings/page-<n>.json` and point `providerTotalEvidence` at its provider-owned total using JSON Pointer. The orchestrator reads that value itself. Do not create a summary response or rewrite the provider total.

A successful zero-record source additionally requires `completion.zeroResultConfirmed: true`, meaning the official listing explicitly proved there were no source records after complete pagination. A loading shell, placeholders, inaccessible event cards, or “nothing validated in this pass” is pending or blocked - not zero-result success.

Blocked or failed sources require `error` and may omit counts. Successful normalization requires `status: "success"`, `counts`, `artifactRefs`, and:

When a listing is reachable but extraction is incomplete, submit or retain:

```json
{
  "status": "pending",
  "message": "Listing is reachable; extraction is still in progress."
}
```

Continue extracting that source. Wait for an active browser operation when necessary, then retry the same checkpoint. Pending sources prevent normalization and finalization.

`blocked` is reserved for a genuine external condition and requires `blockerReasonCode`: `authentication_or_captcha`, `layout_contract_changed`, `pagination_inaccessible`, `persistent_rate_limit`, or `source_unavailable`. “Reachable but extraction incomplete” is never blocked.

Successful normalization requires `status: "success"`, `counts`, `artifactRefs`, and:

```json
{
  "venueBranches": [
    { "id": "venue-<hash>", "venue": "Source venue", "eventIds": ["event-id"] }
  ]
}
```

The executable validator also requires every accepted event to have parseable date evidence overlapping the run window. `acceptedPrimary` must equal the number of normalized event records. Venue branches must exactly partition physical events, each branch must contain one exact normalized venue only, and generic umbrella branches are rejected. Every successful resolve, highlight, pill, and panel handoff must preserve the complete event ID set of its branch.

Stage result files use `stage-handoffs.md`. The CLI copies each accepted result into the run's canonical `stages/<venue>/<stage>.json` location.

## Completion contract

- A reachable listing page is not a completed source.
- A reachable but incomplete source stays `pending`; wait for active work and continue rather than marking it `blocked`.
- Passing existing UI tests is not evidence that source-backed events were processed.
- Numeric totals are not evidence by themselves. Every claimed source record must have a stable artifact pointer that survives into normalized provenance or `invalid.json`.
- `partial` is a terminal outcome only after every source and venue branch is accounted for; it is never a synonym for unfinished.
- Do not pause merely because a checkpoint completed. Continue through every returned action in the same task.
- If an unresolvable external blocker truly forces a pause, leave the run pending, report the exact failed operation and evidence, and include the next action from `status`. Do not call `finalize` merely to end the task.
