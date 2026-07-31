# Implementation Plan: Group Event Activities

**Branch**: `develop` | **Date**: 2026-07-22 | **Spec**: [spec.md](spec.md)

## Summary

Add a deterministic, evidence-preserving activity projection over normalized event occurrences. The projection links source-level parent activities only through accepted occurrence deduplication evidence, unions independently evidenced sessions, groups them by venue, scopes source offers, and isolates direct contradictions. The public discovery model consumes activities while retaining occurrence identities for filtering, planning, expiry, and booking. Pipeline reports and the Sites dashboard expose distinct activity, occurrence, venue-group, offer, and review counts. Existing normalized data is reprojected for validation; source collection is not rerun.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 22; browser ES modules; TypeScript/React 19 in the existing Sites dashboard

**Primary Dependencies**: Existing Node standard-library pipeline, browser DOM modules, existing Vinext/Next-compatible Sites application; no new runtime dependencies

**Storage**: Versioned JSON run artifacts and immutable approved snapshots; existing Sites D1 payload storage

**Testing**: Node test runner, existing browser-oriented DOM tests, pipeline contract/publication tests, dashboard build and rendered HTML tests

**Target Platform**: Current desktop and mobile Chrome, Safari/WebKit, Firefox, and Edge; Cloudflare-compatible Sites deployment

**Project Type**: Event ingestion/publication pipeline plus anonymous map-based web UI and operator dashboard

**Performance Goals**: Project the current roughly 13,000 accepted occurrences in under 10 seconds; one discovery card per activity; no continuous polling or hidden-rendering loop

**Constraints**: Work on `develop`; retain source provenance; keep occurrence identity separate; no source recollection; no paid services; preserve atomic publication and per-identity review isolation; avoid new dependencies

**Scale/Scope**: Approximately 30,000 collected occurrences, 13,000 accepted occurrence records, and hundreds to low thousands of parent activities per weekly run

## Constitution Check

- **Branch workflow — PASS**: Work remains on `develop`; no feature branch is created or selected.
- **Evidence — PASS**: Activity membership is based on explicit parent identities and accepted deduplication bridges. Sessions and offers retain provenance. Ambiguous direct conflicts become structured grouping reviews.
- **Automation — PASS**: A pure grouping module and validated artifact generation own projection. Existing-run reprojection is deterministic, bounded, and does not invoke adapters.
- **Identity and publication — PASS**: Activity, occurrence, venue group, merged occurrence, and offer identities remain distinct. Membership changes classify create/update/no-op/expire/review through existing reconciliation and validation gates.
- **Boundaries — PASS**: Ingestion remains occurrence-oriented; activity projection owns grouping; frontend owns rendering; dashboard sync owns operational metrics. Evolving JSON contracts receive explicit schema versions.
- **Quality and security — PASS**: No new credentials or external requests. Tests cover grouping, conflicts, filters, lifecycle, payloads, rendering, and build behavior.
- **UX and performance — PASS**: Activity cards replace repeated session cards; details expose keyboard/touch session controls and explicit empty/missing states. A stored-run benchmark verifies projection cost.
- **Operations and privacy — PASS**: No personal data or new retention. Reprojection uses stored artifacts; future finalized runs update dashboard payloads automatically.

Post-design re-check: **PASS**. No constitutional exception or complexity justification is required.

## Project Structure

### Documentation

```text
specs/006-group-event-activities/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── activity-projection.md
└── tasks.md
```

### Source Code

```text
scripts/
├── event-normalizer.mjs
├── event-frontend-snapshot.mjs
├── project-event-activities.mjs
└── lib/event-pipeline/
    ├── activity-projection.mjs
    ├── dashboard-sync.mjs
    └── reporting.mjs

activity-scenes/
├── events/event-discovery-model.js
├── landmark-event-search.js
├── landmark-event-panel.js
├── landmark-event-pill.js
└── esplanade-performance.js

style.css

tests/
├── event-activity-projection.test.mjs
├── event-discovery-model.test.mjs
├── event-dashboard-sync.test.mjs
├── event-pipeline.test.mjs
└── event-ui.spec.mjs

/Users/arnav/.codex/visualizations/.../sites-event-dashboard/
├── app/page.tsx
├── app/globals.css
└── tests/rendered-html.test.mjs
```

**Structure Decision**: Add one pure pipeline-domain grouping module and a thin stored-run CLI. Reuse existing frontend components and the existing Sites project rather than introducing a service, database table, or second UI architecture.

## Design Phases

1. Preserve each source parent activity/listing identity through occurrence deduplication.
2. Project accepted occurrences into validated activities, venue groups, sessions, offers, and isolated grouping reviews.
3. Write the activity artifacts during normalization and use the same projector for stored-run regeneration and dashboard payloads.
4. Make search/filter results activity-first while retaining a representative occurrence for map focus and all occurrences for details and planning.
5. Render activity summaries, venue-grouped sessions, and scoped source offers in the existing details panel.
6. Update operational reporting and the Sites dashboard with unambiguous activity/session metrics.
7. Validate focused behavior, relevant regression suites, production builds, and stored-run performance without invoking source collection.

## Complexity Tracking

No constitution violations or additional architectural layers are introduced.
