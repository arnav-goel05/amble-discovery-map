# Tasks: Optimize Map-Move Event Refresh

## Phase 1: Setup

- [x] T001 Verify the feature remains scoped to `develop` and Issue 1 files in `specs/012-optimize-moveend-refresh/plan.md`

## Phase 2: Foundational

- [x] T002 Capture the existing legacy timing evidence and comparison fields in `specs/012-optimize-moveend-refresh/quickstart.md`

## Phase 3: User Story 1 - Smooth Map Movement

**Goal**: Reuse the latest discovery result on map movement while retaining full refreshes
for data and filter changes.

**Independent test**: Movement does not increase the full discovery count; a filter change
does; viewport results remain correct; paired timings meet SC-002.

- [x] T003 [US1] Add a failing browser regression for move-end cache reuse and filter invalidation in `tests/event-discovery.spec.mjs`
- [x] T004 [US1] Add complete-result caching and viewport-only refresh behavior in `activity-scenes/landmark-event-search.js`
- [x] T005 [US1] Route production move-end through viewport refresh and expose diagnostic full/viewport modes in `activity-scenes/esplanade-performance.js`
- [x] T006 [US1] Extend diagnostic workload control for the legacy paired comparison in `activity-scenes/performance-diagnostic-variants.js`
- [x] T007 [US1] Add the paired legacy refresh variant and validation coverage in `config/map-performance-diagnostic-variants.json` and `tests/map-performance-diagnostics.test.mjs`
- [x] T008 [US1] Run focused correctness tests and record passing commands in `specs/012-optimize-moveend-refresh/quickstart.md`
- [x] T009 [US1] Run controlled before/after timing trials and record results in `specs/012-optimize-moveend-refresh/performance-results.md`

## Phase 4: Polish and Cross-Cutting Concerns

- [x] T010 Run lint, production build, and relevant browser gates documented in `specs/012-optimize-moveend-refresh/quickstart.md`
- [x] T011 Verify only Issue 1 behavior changed and mark all completed tasks in `specs/012-optimize-moveend-refresh/tasks.md`

## Dependencies

- T001-T002 precede implementation.
- T003 must fail before T004-T007.
- T004 precedes T005; T005 precedes T006-T007.
- T008 precedes timing task T009.
- T010-T011 follow all story tasks.

## Implementation Strategy

Deliver only User Story 1, measure it, converge it, and stop for explicit user approval
before creating or implementing work for the minimap or 3D issues.
