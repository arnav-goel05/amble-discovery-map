# Implementation Plan: Guided Event Filters

**Branch**: `develop` | **Date**: 2026-07-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-guided-event-filters/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Revise the public event builder into the approved AI Autocomplete-style sentence: regular
connector text, bold borderless selected phrases, an editable text tail, a round commit
arrow, and one compact option card that recommends What → When → Where → Price while
allowing any order and stop-anywhere use. Add a pure local classifier that recognizes
explicit date/price grammar and longest source-backed catalog labels, preserves unmatched
meaningful text as the existing event query, and never calls an external service. Keep the
existing shared event-action/filter projection, recovery, map bounds, geolocation, result
selection, and catalog-refresh behavior compatible.

## Technical Context

**Language/Version**: Browser JavaScript ES modules on Node.js 24 tooling

**Primary Dependencies**: Existing DOM APIs, MapLibre GL 1.15, Phosphor icons; no new
runtime dependency

**Storage**: N/A; active filters and exact user location remain in page memory only

**Testing**: Node test runner, Playwright 1.61, ESLint, Vite production build

**Target Platform**: Current desktop and mobile Chrome/Chromium, Safari/WebKit, Firefox,
and Edge-compatible browsers

**Project Type**: Public single-page map web application

**Performance Goals**: Local option filtering, result reconciliation, and bounded recovery
calculation complete within 200 ms for the approved event snapshot

**Constraints**: Deterministic local classification only; no paid service, network lookup,
learned inference, user analytics, or persistent typed/location/filter state; only one
dimension's values render at a time; touch targets remain at least 44 CSS px on mobile;
retain existing result/detail/map and public action behavior

**Scale/Scope**: One reusable event-discovery component, four filter dimensions, current
approved event snapshot, and its mapped/off-map activity set

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **Branch workflow — PASS**: Work remains on `develop`; no branch is created or switched.
- **Evidence — PASS**: Category, schedule, price, area, landmark, venue, and coordinates
  come only from the approved event discovery model. The classifier adds only explicit
  grammar and source-backed labels; unmatched wording remains query text.
- **Automation — PASS**: Option derivation, state transitions, location predicates, result
  reconciliation, and recovery counts are deterministic pure code with bounded inputs.
- **Identity and publication — PASS**: This feature does not mutate or publish event data.
  Stable event, landmark, activity, area, and venue identities remain unchanged. Missing
  options after snapshot replacement are removed from ephemeral UI state without modifying
  the approved snapshot.
- **Boundaries — PASS**: Event discovery owns filtering; the guided builder owns UI state
  and interaction; the map scene supplies current bounds; the geolocation adapter supplies
  one ephemeral coordinate. The UI contract is documented in `contracts/filter-builder.md`.
- **Quality and security — PASS**: Unit tests cover state, dates, geography, option matching,
  classifier precedence, ambiguity, residual text, and recovery; browser tests cover the
  sentence UI, keyboard, touch-sized controls, permission denial, empty states, mobile
  wrapping, and existing selection behavior. Lint and production build remain gates.
- **UX and performance — PASS**: The interaction follows choice-over-entry, visible scope,
  progressive disclosure, sufficient control size, non-color state, predictable focus,
  and adaptive wrapping guidance. Targeted Chromium tests precede the full desktop/mobile
  Chromium, WebKit, and Firefox matrix. Before/after filter timing uses the existing
  diagnostics counters and a bounded local benchmark.
- **Operations and privacy — PASS**: No service or generated production artifact is added.
  Exact geolocation is requested only after Near me is selected, held only in memory, and
  never logged or persisted. Permission denial has a local fallback.

## Project Structure

### Documentation (this feature)

```text
specs/015-guided-event-filters/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
activity-scenes/
├── esplanade-performance.js
├── landmark-event-search.js
└── events/
    ├── event-discovery-model.js
    ├── event-filter-options.js
    └── event-query-classifier.js

style.css
tests/
├── event-filter-options.test.mjs
├── event-query-classifier.test.mjs
├── event-discovery-model.test.mjs
├── event-discovery.spec.mjs
├── event-ui.spec.mjs
└── voice-action-coverage.spec.mjs
```

**Structure Decision**: Keep the established single-project browser application. Extract
pure option/state/location behavior into `activity-scenes/events/event-filter-options.js`
so the already-large DOM component does not absorb business rules. Extend the existing
event discovery model only at its filter boundary and keep map/geolocation work in
`esplanade-performance.js` and injected component callbacks.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations.
