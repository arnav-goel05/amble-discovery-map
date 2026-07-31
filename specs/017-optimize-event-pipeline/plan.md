# Implementation Plan: Optimize Event Pipeline

**Branch**: `develop` | **Date**: 2026-07-27 | **Spec**: [spec.md](spec.md)

## Summary

Optimize the complete event pipeline without changing its editorial, evidence, identity,
venue, deduplication, reconciliation, geometry, or publication results. The implementation
adds canonical equivalence evidence and versioned stage-input contracts, then removes
repeated work in four coherent categories:

1. deterministic checkpoint and verification-gate reuse;
2. persistent evidence-keyed recovery reuse with bounded freshness;
3. content-addressed frontend geometry and generated-asset reuse;
4. idempotent finalization, delivery, and resource observability.

Each category is activated only after its focused tests, relevant existing regression
tests, and canonical comparison pass. Total runtime is reported but not used as a fixed
threshold. A full live collection is reserved for gaps that saved evidence and staged
integration cannot prove.

## Technical Context

**Language/Version**: Node.js ESM on the repository-supported Node version

**Primary Dependencies**: Node standard library, Playwright, Vite, glTF tooling,
SQLite-backed admin repository, existing TinyFish/OneMap/OSM boundary adapters

**Storage**: Immutable JSON snapshots, per-run JSON/JSONL artifacts, content-addressed
generated assets, ignored local SQLite/OSM venue index

**Testing**: `node:test`, focused CLI/integration fixtures, Playwright staged event checks,
existing build and POI-separation gates

**Target Platform**: Local/CI pipeline runner with atomic filesystem publication

**Project Type**: CLI orchestration plus generated web application data/assets

**Performance Goals**: Every activated category preserves canonical output and measurably
reduces its declared waste target; report cold/warm wall time, external calls, bytes,
generated artifacts, gate executions, and review blocking time

**Constraints**: No output-quality reduction, no event/venue/organizer exception,
no new country architecture, no automatic approval of ambiguity, no paid dependency,
no full live pipeline unless focused evidence is insufficient

**Scale/Scope**: Current six-source weekly pipeline, approximately 32k occurrences,
13.5k accepted sessions, 566 activities, 302 venue branches, and multi-gigabyte generated
run artifacts; contracts must remain configuration-driven and extensible

## Constitution Check

- **Branch workflow — PASS**: work remains on `develop`; no feature branch is created.
- **Evidence — PASS**: existing official-source, TinyFish, OneMap, OSM, review, and
  not-mappable rules remain authoritative. Reuse requires a complete matching input hash.
- **Automation — PASS**: checkpointing, invalidation, retries, cache freshness, comparison,
  and activation are deterministic. Manual work remains limited to genuine venue ambiguity.
- **Identity and publication — PASS**: stable source, occurrence, activity, venue, POI,
  stage, and snapshot identities remain unchanged. Atomic publication and rollback remain.
- **Boundaries — PASS**: orchestration owns stage scheduling; source, recovery, geometry,
  verification, admin, and dashboard adapters keep explicit contracts.
- **Shared capabilities — PASS / NO CHANGE**: no user-facing capability contract changes;
  published activity/event data remains canonical and is tested through existing UI gates.
- **Quality and security — PASS**: secrets stay in environment boundaries; logs are
  bounded/redacted; parity, failure, recovery, and rollback paths receive focused coverage.
- **UX and performance — PASS / NO RENDERING CHANGE**: browser runtime is out of scope.
  Existing staged browser gates remain authoritative and can be reused only by exact input.
- **Operations and privacy — PASS**: no new provider or personal data. Cache entries retain
  public evidence provenance and bounded freshness; generated retention remains explicit.

### Post-design re-check

The contracts preserve a single authoritative verification barrier, require complete
invalidation inputs, and never let a cached or skipped result bypass existing quality
rules. No constitution exception is required.

## Project Structure

### Documentation

```text
specs/017-optimize-event-pipeline/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── equivalence-contract.md
│   ├── recovery-cache-contract.md
│   └── stage-checkpoint-contract.md
└── tasks.md
```

### Source and tests

```text
scripts/
├── event-pipeline.mjs
├── compare-event-pipeline-runs.mjs
├── event-frontend-snapshot.mjs
└── lib/
    ├── event-pipeline/
    │   ├── run-state.mjs
    │   ├── stage-checkpoints.mjs
    │   ├── equivalence.mjs
    │   ├── resource-metrics.mjs
    │   └── dashboard-sync.mjs
    └── event-sources/
        └── tinyfish-venue-recovery.mjs

tests/
├── event-pipeline.test.mjs
├── event-pipeline-comparison.test.mjs
├── event-pipeline-optimization.test.mjs
├── event-venue-recovery.test.mjs
├── event-dashboard-sync.test.mjs
└── fixtures/event-pipeline-optimization/
```

**Structure Decision**: Keep the existing single-project ESM CLI structure. Add small pure
modules under `scripts/lib/event-pipeline/`; do not split the orchestrator into a new
service or introduce a second persistence system.

## Optimization Categories and Proof

| Category                            | Targeted waste                                                         | Implementation boundary                                                                                  | Required proof before proceeding                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A. Equivalence and checkpoints      | Repeated successful stages/gates after retry                           | Canonical comparison, stage input manifests, immutable checkpoint records, dependency invalidation       | Checkpoint unit/CLI fixtures, comparison tests, existing pipeline tests; exact canonical parity    |
| B. Recovery reuse and scheduling    | Repeated TinyFish recovery and synchronous ambiguity waiting           | Persistent evidence-keyed positive/negative cache, freshness policy, bounded independent work scheduling | Recovery freshness/invalidation fixtures, existing venue tests; zero external calls on valid reuse |
| C. Frontend assets and verification | Broad geometry extraction, copied multi-GB assets, duplicate gate runs | Content-addressed asset manifest, changed-POI plan, authoritative gate checkpoints                       | 12-changed/100-unchanged fixture, POI/build/event UI staged tests; unchanged hashes preserved      |
| D. Finalization and observability   | Repeated admin/dashboard side effects and opaque gaps                  | Content-keyed delivery receipts, idempotent admin reconciliation, per-stage resource metrics             | Finalization retry fixture, dashboard tests, trace schema tests; one side effect per content key   |

## Activation and Rollback

For each category:

1. record the saved-evidence baseline;
2. add focused tests that fail for the measured waste;
3. implement only that category;
4. run focused and existing relevant tests;
5. canonicalize and compare the before/after result;
6. retain the category only when parity is exact and one declared resource improves;
7. otherwise revert that category without weakening the comparison contract.

The final convergence pass searches for incomplete requirements, hidden repeated work,
case-specific branching, missing invalidation inputs, and unproved performance claims.

## Complexity Tracking

No constitution violations or new architectural systems are planned.
