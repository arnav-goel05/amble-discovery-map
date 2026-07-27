# Implementation Plan: Optimize Map-Move Event Refresh

**Branch**: `develop` | **Date**: 2026-07-25 | **Spec**: [spec.md](spec.md)

## Summary

Keep full event discovery for data/filter changes, cache its unprojected result inside the
search component, and add a viewport-only refresh that reapplies map-dependent placement
and ordering. Production `moveend` uses the viewport path; a diagnostic-only legacy mode
retains the previous path for paired measurements.

## Technical Context

**Language/Version**: Browser JavaScript (ES modules), Node.js 22 tooling

**Primary Dependencies**: MapLibre GL JS, existing event discovery/search/pill modules

**Storage**: Existing immutable event snapshot; no format or persistence changes

**Testing**: Node test runner, Playwright browser checks, ESLint, Vite production build

**Target Platform**: Current desktop/mobile Chromium, WebKit, and Firefox

**Project Type**: Browser-based map application

**Performance Goals**: Zero full discovery passes on unchanged map movement; at least 80%
lower median move-end refresh duration than the legacy full-refresh mode

**Constraints**: Preserve visible results; change only issue 1; retain deterministic,
diagnostic-only legacy comparison; no new dependency

**Scale/Scope**: Current approved snapshot of 781 activities and roughly 11,302 sessions
processed by the discovery model

## Constitution Check

- **Branch workflow**: PASS — work remains on `develop`.
- **Evidence**: PASS — uses the approved local snapshot and checked-in diagnostic route.
- **Automation**: PASS — behavior and timing comparison are deterministic code paths.
- **Identity and publication**: PASS — event identities and published data are unchanged.
- **Boundaries**: PASS — discovery owns filtering/grouping; search owns cached result
  rendering; pills own viewport projection.
- **Quality and security**: PASS — TDD regression, browser behavior, lint, and build gates;
  no credentials or external content.
- **UX and performance**: PASS — preserves visuals and records before/after timings.
- **Operations and privacy**: PASS — no service, telemetry, user data, or retention change.

Post-design re-check: PASS. No constitutional exception or complexity waiver is required.

## Project Structure

### Documentation

```text
specs/012-optimize-moveend-refresh/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── refresh-contract.md
└── tasks.md
```

### Source Code

```text
activity-scenes/
├── landmark-event-search.js
├── esplanade-performance.js
└── performance-diagnostic-variants.js

config/
└── map-performance-diagnostic-variants.json

tests/
├── event-discovery.spec.mjs
└── map-performance-diagnostics.test.mjs

scripts/
└── diagnose-map-performance.mjs
```

**Structure Decision**: Make the smallest change at existing ownership boundaries; do not
add a production module or dependency.

## Complexity Tracking

No violations.
