# Implementation Plan: Retire Honeycombers and ArtsEquator

**Branch**: `develop` | **Date**: 2026-07-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-retire-editorial-sources/spec.md`

## Summary

Remove Honeycombers and ArtsEquator from current source configuration, provider and adapter registries, current operational documentation, generated dashboard data, and the Sites dashboard. Add a generic reconciliation safeguard that removes events no longer represented by the current supported-source set from both the event catalogue and landmark copies while preserving mixed-source events and unrelated identities. Preserve immutable snapshots and completed historical specs, then validate through focused tests, an offline immutable-snapshot retirement derived from approved data without recollection, and the existing dashboard deployment path.

## Technical Context

**Language/Version**: JavaScript ES modules on the repository's current Node.js runtime; TypeScript/React in the Sites dashboard

**Primary Dependencies**: Existing event pipeline modules, Node test runner, Next.js Sites application, Playwright/browser gates

**Storage**: Versioned JSON configuration and immutable approved snapshots; Sites D1 payload storage

**Testing**: `node --test`, repository production build, focused dashboard checks, and offline snapshot migration verification

**Target Platform**: Existing single-host web application and public Sites dashboard

**Project Type**: Event ingestion pipeline plus web dashboard

**Performance Goals**: No additional network work; source planning and dashboard rendering must not regress measurably

**Constraints**: Preserve unrelated uncommitted work, do not rewrite immutable snapshots or completed specs, use no paid service, atomically publish generated data, keep the dashboard viewport-fitted

**Scale/Scope**: Two retired sources, six remaining sources, current event catalogue and landmark arrays, one public dashboard

## Constitution Check

- **Branch workflow**: PASS — work remains on `develop`.
- **Evidence**: PASS — current configuration defines supported sources; historical snapshots remain untouched evidence.
- **Automation**: PASS — source retirement and landmark cleanup are deterministic; no manual per-event decision is introduced.
- **Identity and publication**: PASS — source contributions are filtered by stable identity, mixed-source events survive, empty landmarks are lifecycle-pruned, and publication remains staged and atomic.
- **Boundaries**: PASS — source adapters, reconciliation, dashboard payload generation, and dashboard presentation retain separate ownership.
- **Quality and security**: PASS — regression tests cover retired-only, mixed-source, lifecycle, stale-payload, and rollback-sensitive paths; no credential or external-content change.
- **UX and performance**: PASS — no new interaction or rendering loop; existing browser gates and viewport contract remain.
- **Operations and privacy**: PASS — two free sources are removed, no new service or personal data is added, and historical/current artifact policy is explicit.

Post-design re-check: PASS. The design adds no constitutional exception.

## Project Structure

### Documentation (this feature)

```text
specs/007-retire-editorial-sources/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── source-retirement.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
data/
├── event-pipeline-config.json
└── provider-policy.json

scripts/
├── event-frontend-snapshot.mjs
├── reconcile-event-content.mjs
├── validate-event-field-extraction.mjs
└── lib/
    ├── event-pipeline/dashboard-sync.mjs
    └── event-sources/
        ├── index.mjs
        ├── authority-confirmation.mjs
        ├── honeycombers.mjs              # remove
        └── arts-equator.mjs              # remove

tests/
├── event-source-contract.test.mjs
├── event-pipeline.test.mjs
├── event-reconciliation.test.mjs
├── event-dashboard-sync.test.mjs
├── event-authority-confirmation.test.mjs
├── event-deduplication.test.mjs
├── event-publication.test.mjs
├── event-venue-recovery.test.mjs
└── fixtures/event-sources/
    ├── honeycombers/                     # remove
    └── arts-equator/                     # remove

skills/event-pipeline-runner/references/source-adapters.md
pull_data.md

/Users/arnav/.codex/visualizations/2026/07/17/019f6f25-181a-7451-bcff-5e3e8ff9cc8b/sites-event-dashboard/
├── app/page.tsx
├── app/api/pipeline/route.ts
└── tests/rendered-html.test.mjs
```

**Structure Decision**: Modify the existing pipeline and dashboard boundaries only. The generic retirement safeguard belongs in reconciliation/snapshot assembly; source-specific files are deleted rather than retained as dormant code.

## Implementation Phases

1. Add failing focused tests for supported-source enumeration, retired-only and mixed-source reconciliation, orphan landmark cleanup, dashboard payload filtering, and stale Sites payloads.
2. Remove source configuration, providers, adapters, source-specific validation, fixtures, and current operational documentation; retain generic editorial behavior tests with Time Out Singapore where appropriate.
3. Add deterministic source-retirement reconciliation and structured trace counts before landmark and POI lifecycle pruning.
4. Filter retired source rows at dashboard generation and Sites ingestion/read boundaries so stale stored payloads are safe immediately.
5. Run focused tests and production builds, then execute the offline source-retirement migration against the approved snapshot and verify current artifacts contain no retired sources.
6. Publish the updated Sites dashboard and verify the public page.

## Complexity Tracking

No constitutional violations or additional complexity exceptions are required.
