# Implementation Plan: Review Questionable Event Dates

**Branch**: `develop` | **Date**: 2026-07-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-review-questionable-event-dates/spec.md`

## Summary

Promote the existing read-only date audit into a shared, versioned normalization policy.
Otherwise-eligible records with questionable schedules are partitioned into a dedicated
needs-review artifact before same-source deduplication and venue branching. Pipeline state,
traces, reports, and dashboard payloads expose reconciled review counts and reasons; clean
records retain their current behavior.

## Technical Context

**Language/Version**: Node.js JavaScript ES modules on the repository-supported runtime

**Primary Dependencies**: Node.js standard library and existing pipeline modules; no new dependency

**Storage**: Versioned JSON run artifacts under ignored `outputs/event-pipeline/<run-id>/`

**Testing**: `node:test`, focused pipeline integration tests, ESLint

**Target Platform**: Existing local/server weekly event-pipeline runtime

**Project Type**: Deterministic CLI data pipeline with dashboard synchronization

**Performance Goals**: Assess at least 30,000 normalized occurrences without network calls or material pipeline delay

**Constraints**: Read existing evidence once; no fabricated dates; Singapore timezone; isolated review outcomes; no full live run

**Scale/Scope**: Eight configured sources and the current approximately 30,000-occurrence weekly input

## Constitution Check

- **Branch workflow**: PASS — work remains on `develop`; no branch is created or switched.
- **Evidence**: PASS — assessments retain source refs and evidence hashes and never replace dates.
- **Automation**: PASS — pure deterministic policy owns classification; thresholds and reason codes are bounded and versioned.
- **Identity and publication**: PASS — review IDs derive from stable event identity and evidence; affected identities are held while unrelated identities continue.
- **Boundaries**: PASS — one pure date-policy module is shared by CLI and normalization; filesystem/reporting remain boundary adapters.
- **Quality and security**: PASS — focused unit, integration, failure, reconciliation, and trace tests are required; no credentials or new external content are introduced.
- **UX and performance**: PASS — no public UI or rendering behavior changes, so browser matrices and frontend benchmarks are not applicable.
- **Operations and privacy**: PASS — no paid service, personal data, permanent cache, or tracked generated run output is introduced.

Post-design re-check: PASS. The artifact, state, reporting, and test contracts preserve all
constitutional requirements without an exception.

## Project Structure

### Documentation (this feature)

```text
specs/005-review-questionable-event-dates/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── date-review-artifact.md
└── tasks.md
```

### Source Code (repository root)

```text
scripts/
├── audit-event-dates.mjs
├── event-normalizer.mjs
├── event-pipeline.mjs
└── lib/
    ├── event-pipeline/
    │   ├── dashboard-sync.mjs
    │   ├── date-quality-audit.mjs
    │   └── reporting.mjs
    └── event-sources/trace.mjs

tests/
├── event-date-quality-audit.test.mjs
├── event-dashboard-sync.test.mjs
└── event-pipeline.test.mjs
```

**Structure Decision**: Extend the existing pipeline module layout. Keep assessment pure and
under the event-pipeline library; keep CLI, normalization, trace, and dashboard concerns in
their existing owners.

## Design Sequence

1. Finalize the shared assessment contract, policy version, stable review ID, and summary helpers.
2. Partition otherwise-eligible questionable identities before normalizer deduplication.
3. Persist and validate `normalized/date-reviews.json`; reconcile source and run totals.
4. Exclude held date reviews from venue branches and published event inputs by construction.
5. Emit terminal trace/report/dashboard summaries by identity, source, and reason.
6. Verify unit and synthetic normalization integration without network collection.

## Complexity Tracking

No constitution violations or additional architectural layers are required.
