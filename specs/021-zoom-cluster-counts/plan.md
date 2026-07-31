# Implementation Plan: Zoom-Aware Event Cluster Counts

**Branch**: `develop` | **Date**: 2026-07-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/021-zoom-cluster-counts/spec.md`

## Summary

Add an event-driven overview presentation for approved event locations below the existing
full-pill zoom threshold. Matching visible locations will be grouped by their projected
screen proximity into accessible count buttons. The groups naturally split as projection
scale increases; selecting a group moves the map closer, and the existing pills become the
only ordinary presentation at the established detail level.

The implementation will keep event filtering and identity ownership in the existing event
pill layer while extracting projection clustering and count DOM reconciliation into a small
presentation module. No external service, persistent state, generated event data, or public
capability contract changes.

## Technical Context

**Language/Version**: Browser JavaScript ES modules on Node.js 24+ tooling

**Primary Dependencies**: MapLibre GL 1.15 map projection/navigation boundary; existing
application DOM and CSS; no new dependency

**Storage**: N/A; clusters are derived transiently from current approved in-memory landmarks

**Testing**: Playwright 1.61 browser tests, Node.js built-in test runner where pure grouping
coverage is useful, ESLint, Vite production build

**Target Platform**: Current desktop and mobile Chrome, Safari/WebKit, Firefox, and Edge

**Project Type**: Public client-side map web application

**Performance Goals**: One bounded cluster reconciliation per existing scheduled position
pass; zero idle polling or animation; smooth map interaction for the current approved
landmark scale

**Constraints**: Preserve the current pill threshold, filters, panel selection, navigation
target exception, and user-owned changes in a dirty worktree; avoid new telemetry and
external calls

**Scale/Scope**: Tens to low hundreds of approved event landmarks in a Singapore viewport,
with one temporary point per matching on-map landmark

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

- **Branch workflow**: Work remains on the existing `develop` branch. SpecKit's feature
  directory is independent of the git branch.
- **Evidence**: The feature renders only current approved landmarks already owned by event
  discovery. It does not collect, transform, approve, or publish event/venue evidence.
- **Automation**: Grouping, reconciliation, transitions, and navigation are deterministic
  code paths driven by map and filter events. No manual or agent runtime intervention exists.
- **Identity and publication**: Stable landmark and event identities remain unchanged.
  Clusters are transient projections keyed from sorted member landmark identities and have
  no create/update/expire publication lifecycle. Approved snapshots are untouched.
- **Boundaries**: The event pill layer remains authoritative for filtered landmark state.
  A narrow cluster presentation module owns projected grouping, accessible count DOM, and
  cluster navigation callbacks. The map object remains the thin projection/navigation
  adapter.
- **Shared capabilities**: No user-facing command/query capability changes. Event discovery
  continues to use the existing authoritative catalogue and capability path for direct and
  conversational consumers. The cluster is a presentation and navigation affordance only.
- **Quality and security**: Focused grouping and browser behavior tests cover count accuracy,
  zoom transitions, filters, empty state, navigation, keyboard activation, cleanup, and
  idle behavior. Existing event UI tests, lint, and production build remain gates. No new
  input, privilege, secret, or external-content boundary is introduced.
- **UX and performance**: Counts use compact touch/keyboard targets and descriptive labels.
  Browser tests cover desktop/mobile behavior, while existing full-matrix gates remain
  authoritative. A before/after frontend benchmark and the existing idle-update assertion
  provide performance evidence. Rendering remains event-driven.
- **Operations and privacy**: No source, paid service, storage, logging, analytics, telemetry,
  personal data, retention, cleanup, or deployment topology changes.

## Project Structure

### Documentation (this feature)

```text
specs/021-zoom-cluster-counts/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── cluster-presentation.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
activity-scenes/
├── landmark-event-pill.js             # authoritative filtered landmark state
├── landmark-event-clusters.js         # projected grouping and count presentation
└── map-location-focus.js              # existing detail zoom constants/helpers

tests/
├── event-location-clusters.test.mjs   # pure deterministic grouping coverage
└── event-ui.spec.mjs                  # integrated DOM, zoom, filter, navigation coverage

style.css                              # count indicator visuals and responsive states
```

**Structure Decision**: Extend the existing event presentation boundary and extract the new
cluster responsibility into one dependency-free module because the pill layer already
exceeds the constitution's preferred module size. Keep styling with the existing shared
event UI stylesheet and tests in the established unit/browser suites.

## Complexity Tracking

No constitutional violations or complexity exceptions are required.
