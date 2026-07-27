# Implementation Plan: Correct Event Schedule Semantics

**Branch**: `develop` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-correct-schedule-semantics/spec.md`

## Summary

Replace implicit start/end-envelope inference with a typed schedule contract. A pure
Singapore schedule parser will turn supported official enumerations into exact sessions,
normalization will preserve concrete sibling performances as exact and reject invented
boundaries, parent reconciliation will prefer authority-linked precise sessions, and the
discovery model will filter only the projected venue group's sessions using Singapore day
boundaries. A deterministic local repair will reproject the active snapshot from saved
evidence and activate it only after validation.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 20+

**Primary Dependencies**: Existing Node standard library, browser JavaScript, current
event-source adapters and snapshot libraries; no new dependency

**Storage**: Versioned JSON snapshots under `data/snapshots/` with
`data/approved-snapshot.json` as the atomic pointer

**Testing**: `node:test`, Playwright for existing browser gates, production build scripts

**Target Platform**: Node pipeline plus current desktop/mobile web browsers

**Project Type**: Single web application with a local ingestion/reconciliation pipeline

**Performance Goals**: Linear parsing/filtering over the current event catalogue; no
additional network calls, polling, animation, or rendering work

**Constraints**: Stay on `develop`; preserve dirty unrelated changes; no source
recollection; no paid services; strict evidence and rollback behavior

**Scale/Scope**: Current six event sources, approximately 30k collected occurrences,
approximately 13k eligible sessions, and fewer than 1k distinct activities

## Constitution Check

- **Branch workflow — PASS**: Work remains on `develop`; no branch is created.
- **Evidence — PASS**: Structured performances, official display text, official product
  identifiers/URLs, and saved raw responses are the only schedule authority. Unsupported
  text becomes reviewable rather than guessed.
- **Automation — PASS**: Parsing, validation, filtering, diagnostics, repair, and rollback
  are deterministic code paths with reason-coded outcomes.
- **Identity and publication — PASS**: Exact session identities remain stable; a changed
  coarse schedule is updated or suppressed; uncertain schedules are held; repair stages an
  immutable snapshot and atomically activates only verified output.
- **Boundaries — PASS**: Source parsing lives in a pure adapter helper, schedule
  normalization in the policy module, activity reconciliation in the projection module,
  frontend date projection in the discovery model, and publication in a repair adapter.
- **Quality and security — PASS**: Focused unit/integration tests cover success, ambiguity,
  timezone independence, malformed input, idempotence, and rollback. No credentials or new
  external requests are introduced.
- **UX and performance — PASS**: Existing UI remains unchanged; only which sessions qualify
  changes. Existing browser gates and production build remain required. No rendering
  benchmark is necessary because the change adds no rendering work.
- **Operations and privacy — PASS**: Public event data only, local saved evidence only,
  ignored run artifacts remain ignored, approved snapshots remain version-controlled, and
  the single-host model is unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/016-correct-schedule-semantics/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── schedule-contract.md
└── tasks.md
```

### Source Code

```text
scripts/
├── event-source-collector.mjs
├── event-normalizer.mjs
├── migrate-approved-snapshot-to-activities.mjs
└── lib/
    ├── event-sources/
    │   ├── activity-policy.mjs
    │   └── schedule-semantics.mjs
    └── event-pipeline/
        ├── activity-projection.mjs
        └── schedule-semantics-repair.mjs

activity-scenes/
├── esplanade-performance.js
└── events/event-discovery-model.js

tests/
├── event-pipeline.test.mjs
├── event-activity-projection.test.mjs
├── event-discovery-model.test.mjs
└── approved-snapshot.test.mjs
```

**Structure Decision**: Extend the existing thin source adapter, pure policy/projection
modules, browser discovery model, and immutable snapshot boundary. Add one small pure
schedule helper and one repair adapter rather than embedding source-specific date logic
across existing large modules.

## Complexity Tracking

No constitutional exception or new architectural layer is required.
