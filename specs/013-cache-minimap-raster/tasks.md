# Tasks: Cache Minimap Raster

## Phase 1: Setup

- [x] T001 Confirm `develop` branch and Issue 2-only scope in `specs/013-cache-minimap-raster/plan.md`
- [x] T002 Record legacy evidence and benchmark fields in `specs/013-cache-minimap-raster/quickstart.md`

## Phase 2: User Story 1 - Responsive Minimap Tracking

**Independent test**: Motion reuses the cache; a filter invalidates it once; the paired
benchmark meets SC-003.

- [x] T003 [US1] Add a failing cache-reuse/invalidation browser regression in `tests/event-discovery.spec.mjs`
- [x] T004 [US1] Implement static-raster caching and diagnostic counters in `activity-scenes/event-density-minimap.js`
- [x] T005 [US1] Route diagnostic render mode through `activity-scenes/esplanade-performance.js`
- [x] T006 [US1] Add cached/legacy paired variants in `config/map-performance-diagnostic-variants.json`
- [x] T007 [US1] Capture before-motion datasets in `scripts/diagnose-map-performance.mjs`
- [x] T008 [US1] Validate new diagnostic contracts in `scripts/lib/map-performance-diagnostics.mjs` and `tests/map-performance-diagnostics.test.mjs`
- [x] T009 [US1] Run focused and cross-browser correctness gates documented in `specs/013-cache-minimap-raster/quickstart.md`
- [x] T010 [US1] Run three paired hardware trials and record `specs/013-cache-minimap-raster/performance-results.md`

## Phase 3: Polish

- [x] T011 Run ESLint and the production build documented in `specs/013-cache-minimap-raster/quickstart.md`
- [x] T012 Verify Issue 1 and 3 remain unchanged and complete `specs/013-cache-minimap-raster/tasks.md`

## Dependencies

T003 fails before T004-T008. T004 precedes T005-T008. Correctness gates precede timing.
Polish follows all story tasks.

## Implementation Strategy

Complete and converge Issue 2 only. Stop for user approval before any 3D optimization.
