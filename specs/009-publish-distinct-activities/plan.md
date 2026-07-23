# Implementation Plan: Publish Distinct Activities

**Branch**: `develop` | **Date**: 2026-07-23 | **Spec**: [spec.md](spec.md)

## Summary

Replace the browser-facing occurrence catalogue with one canonical, compact activity catalogue. Immutable snapshots publish `activities.json`; landmarks publish lightweight activity/venue-group references; the browser consumes activities directly and evaluates their inline sessions. Internal normalization, venue resolution, evidence, and occurrence reconciliation remain unchanged.

## Technical Context

**Language/Version**: JavaScript on Node.js 24+, browser ES modules

**Primary Dependencies**: Existing Vite, MapLibre, deck.gl, Cloudflare worker, and Node standard library; no new dependency

**Storage**: Versioned JSON artifacts in `data/snapshots/<snapshot-id>/`

**Testing**: Node test runner, Playwright desktop/mobile Chromium/WebKit/Firefox, Vite production build, existing performance benchmark

**Target Platform**: Single-host public web application and Cloudflare production bundle

**Project Type**: Web application with deterministic ingestion/publication scripts

**Performance Goals**: Materially reduce event transfer and parsed object volume while preserving or improving UI-ready time, memory, and frame rate

**Constraints**: Immediate schema cutover; no occurrence fallback; all sessions inline; internal evidence excluded; mapped/off-map activities unified; atomic rollback on any invalid reference

**Scale/Scope**: Approximately 781 activities and 12,916 sessions replacing more than 11,000 public occurrence objects in the current approved dataset

## Constitution Check

- **Branch workflow**: PASS — all work remains on `develop`.
- **Evidence**: PASS — evidence remains in approved pipeline artifacts; the public projection only removes audit weight and never fabricates fields.
- **Automation**: PASS — projection, validation, staging, loading, and reconciliation remain deterministic and resumable.
- **Identity and publication**: PASS — activity, session, venue-group, offer, and landmark references have stable identities; candidate validation precedes atomic activation; failure preserves the prior snapshot.
- **Boundaries**: PASS — the occurrence pipeline remains the data owner; public projection owns redaction/compaction; snapshot APIs own delivery; discovery owns interaction.
- **Quality and security**: PASS — contract, failure, rollback, browser, build, and URL validation tests are required; no secret or privileged path changes.
- **UX and performance**: PASS — current UI behavior remains; before/after transfer, memory, UI-ready, and frame-rate measurements plus the full browser matrix are required.
- **Operations and privacy**: PASS — no new services, telemetry, personal data, caches, or retention behavior.

Post-design check: PASS. The design uses existing modules and immutable snapshot machinery without adding services or exceptions.

## Project Structure

### Documentation

```text
specs/009-publish-distinct-activities/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/public-activity-snapshot.md
└── tasks.md
```

### Source Code

```text
scripts/
├── event-frontend-snapshot.mjs
├── approved-snapshot-api-plugin.cjs
├── generate-cloudflare-snapshot.mjs
└── lib/
    ├── approved-snapshot.mjs
    ├── public-event-catalogue.cjs
    └── contracts/baseline-contracts.mjs

activity-scenes/
├── esplanade-performance.js
├── events/event-discovery-model.js
├── events/event-map-reconciliation.js
└── shared/api-client.js

cloudflare/
└── cloud-native-worker.mjs

tests/
├── approved-snapshot.test.mjs
├── event-activity-publication.test.mjs
├── event-discovery-model.test.mjs
├── event-pipeline.test.mjs
├── cloudflare-cloud-native.test.mjs
└── event-discovery.spec.mjs
```

**Structure Decision**: Extend the existing public-projection, immutable-snapshot, API, and discovery boundaries. Do not change source collection or occurrence normalization.

## Design Phases

1. Define and validate a compact public activity contract.
2. Stage `activities.json` and landmark references atomically in place of `events.json`.
3. Expose only `activitiesRef` from local and Cloudflare snapshot APIs.
4. Load canonical activities once and let discovery evaluate nested sessions directly.
5. Adapt map pills and details through lightweight landmark references without duplicating canonical activity objects.
6. Verify reference integrity, rollback, current UX, build, browser matrix, and performance.

## Complexity Tracking

No constitution violations or new architectural layers are required.
