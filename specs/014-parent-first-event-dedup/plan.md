# Implementation Plan: Parent-First Event Deduplication

**Branch**: `develop` | **Date**: 2026-07-26 | **Spec**: [spec.md](spec.md)

## Summary

Extend the existing activity projection so it builds evidence summaries for stable source parents, links compatible parents before projecting sessions, and then unions sessions, venue groups, and offers beneath one public activity. Keep occurrence-level normalization and venue resolution unchanged. Add a bounded repair mode that reads the active snapshot's internal events, creates and validates a new immutable snapshot, and optionally activates it without contacting any source.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 24

**Primary Dependencies**: Node standard library and existing event-pipeline modules; no new runtime dependencies

**Storage**: Versioned JSON run artifacts, immutable `data/snapshots/<snapshot-id>/` directories, and atomic `data/approved-snapshot.json`

**Testing**: Node test runner with focused activity-projection, deduplication, publication, and approved-snapshot tests

**Target Platform**: Existing weekly event-pipeline runtime and anonymous browser frontend

**Project Type**: Event ingestion/publication pipeline with static approved-data projection

**Performance Goals**: Reproject the current approved catalogue in under 10 seconds; candidate generation remains bounded by indexed title/product groups rather than an unbounded all-pairs comparison

**Constraints**: Stay on `develop`; no source recollection; no network calls; preserve occurrence identities and approved venue evidence; stage before activation; no new dependency; do not modify prior snapshots

**Scale/Scope**: Current approved snapshot contains 748 public activity records and approximately 13,000 accepted sessions derived from six sources

## Constitution Check

- **Branch workflow — PASS**: Work remains on `develop`; no branch is created or selected.
- **Evidence — PASS**: Parent links require normalized title plus product, organizer, approved-venue/schedule, or prior grouping evidence. Conflicts become structured reviews.
- **Automation — PASS**: Pure deterministic projection and a bounded repair CLI own all decisions. No agent or network intervention occurs.
- **Identity and publication — PASS**: Occurrence and source-parent identities remain stable; activity membership changes are reconciled; a new snapshot is staged and atomically activated only after validation.
- **Boundaries — PASS**: Occurrence deduplication remains responsible for occurrence identity; activity projection owns parent grouping; approved-snapshot utilities own staging and activation.
- **Quality and security — PASS**: Focused tests cover merge, non-merge, review, idempotency, and rollback. No credentials or external content are introduced.
- **UX and performance — PASS**: The public contract remains activity-first and retains all sessions and offers. No rendering work or browser compatibility change is introduced.
- **Operations and privacy — PASS**: Repair reads version-controlled public event data, creates an immutable snapshot, and performs no collection or personal-data processing.

Post-design re-check: **PASS**. No constitutional exception or complexity justification is required.

## Project Structure

### Documentation

```text
specs/014-parent-first-event-dedup/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── parent-activity-grouping.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
scripts/
├── event-normalizer.mjs
├── migrate-approved-snapshot-to-activities.mjs
└── lib/
    └── event-pipeline/
        ├── activity-projection.mjs
        └── activity-reconciliation.mjs

tests/
├── event-activity-projection.test.mjs
├── event-deduplication.test.mjs
└── approved-snapshot.test.mjs

data/
├── approved-snapshot.json
└── snapshots/
    └── <new-parent-dedup-snapshot>/
```

**Structure Decision**: Extend the existing pure activity projector and existing approved-snapshot migration boundary. Do not add a service, database, external API, or frontend layer.

## Design Phases

1. Normalize source-parent title, schedule coverage, product identity, organizer, and canonical venue evidence.
2. Generate indexed parent candidates and classify merge, keep-distinct, or review outcomes.
3. Union accepted parent groups before session, venue-group, and offer projection.
4. Preserve distinct sessions and offers while recording deterministic parent-grouping decisions and reviews.
5. Add repair mode over the current active snapshot's internal event catalogue.
6. Validate referential integrity, idempotency, rollback behavior, and audit-set consolidation.
7. Stage and activate the repaired snapshot without collection.

## Complexity Tracking

No constitution violations or additional architectural layers are introduced.
