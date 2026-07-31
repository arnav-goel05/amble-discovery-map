# Implementation Plan: Expose Canonical Event Details

**Branch**: `develop` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-event-detail-links/spec.md`

## Summary

Make the event-detail panel consume the approved activity catalogue contract directly for both map and search entry points. Extract the panel's event-detail projection into a pure adapter that expands canonical sessions and venue groups, preserves validated source-offer identity and scope, derives date/time values from schedules, and retains the legacy fixture shape. Keep rendering and the existing `event.openreference` executor unchanged, then add canonical regression, session-scope, unsafe-URL, and entry-point parity coverage.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 24+

**Primary Dependencies**: Browser DOM, Vite 8, Playwright 1.61, existing event discovery and assistant capability modules

**Storage**: Read-only approved JSON activity snapshots; no storage changes

**Testing**: Node built-in test runner for pure projection tests; Playwright for event-panel integration and parity; Vite production build

**Target Platform**: Current desktop and mobile Chrome/Chromium, Safari/WebKit, Firefox, and Edge-compatible browsers

**Project Type**: Browser-based map application with local and Cloudflare snapshot adapters

**Performance Goals**: Linear projection in the number of displayed activities, sessions, and offers; no polling, network request, layout loop, or additional render pass

**Constraints**: Preserve approved provenance and stable identities; expose only valid HTTP(S) links; keep direct and conversational action eligibility synchronized; do not modify or republish approved snapshots

**Scale/Scope**: Active catalogue currently contains 566 activities, 12,006 sessions, 665 venue groups before the latest repair reduction, and 724 published offers; panel results remain bounded by existing discovery and UI limits

## Constitution Check

- **Branch workflow — PASS**: The actual Git branch remains `develop`. Spec Kit's feature directory is independent of the branch.
- **Evidence — PASS**: `activities.json` remains authoritative. The adapter only displays approved fields and valid HTTP(S) source offers; missing fields remain "Not available."
- **Automation — PASS**: Projection, validation, filtering, and parity checks are deterministic code. No manual or agent decision enters runtime behavior.
- **Identity and publication — PASS**: Existing activity, session, venue-group, and offer identities are preserved. This is a read-only presentation fix with no create/update/expire/review or snapshot publication behavior.
- **Boundaries — PASS**: The approved activity contract owns data; a pure event-detail projector owns UI adaptation; the panel owns DOM and interactions; the assistant connector remains a thin consumer of published context.
- **Shared capabilities — PASS**: The affected capability is existing `event.openreference`. The panel remains authoritative for current selected event/session context, publishes bounded stable reference identities after changes, and the same executor serves direct link clicks and conversational commands. Local and Cloudflare environments already expose the same activity contract.
- **Quality and security — PASS**: Pure and browser regression tests cover valid, multiple, scoped, absent, and unsafe offers; canonical session expansion; missing fields; legacy compatibility; and context parity. The production build is required. No credentials or administrative behavior are involved.
- **UX and performance — PASS**: Existing singleton panel layout and link safety are preserved. Focused Chromium coverage is required for implementation; the existing release workflow supplies the full desktop/mobile Chromium, WebKit, and Firefox matrix. No rendering architecture change requires a new performance benchmark.
- **Operations and privacy — PASS**: No external service, paid dependency, personal data, retention change, generated production artifact, or deployment topology change is introduced.

**Post-design re-check**: PASS. The design preserves one approved-data boundary and one panel projection path for both entry points, with no constitutional exception.

## Project Structure

### Documentation (this feature)

```text
specs/018-event-detail-links/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── event-detail-projection.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
activity-scenes/
├── event-detail-projection.js
├── landmark-event-panel.js
├── esplanade-performance.js
└── events/
    └── event-discovery-model.js

tests/
├── event-detail-projection.test.mjs
├── event-discovery-model.test.mjs
└── event-ui.spec.mjs
```

**Structure Decision**: Add one pure projection module because the current panel exceeds 900 lines and mixes canonical-data adaptation with DOM behavior. Both map and search panel entry points call that projector. Keep discovery filtering and DOM rendering in their existing owners.

## Complexity Tracking

No constitution violations or additional dependencies are required.
