# Implementation Plan: Cache Minimap Raster

**Branch**: `develop` | **Date**: 2026-07-25 | **Spec**: [spec.md](spec.md)

## Summary

Pre-render terrain, current density cells, and compass labels into a backing canvas. Normal
movement copies that cached image and draws only the viewport rectangle. Discovery-result
changes invalidate and rebuild the cache. A diagnostic-only legacy mode retains the old
complete redraw for causal timing.

## Technical Context

**Language/Version**: Browser JavaScript ES modules; Node.js 22 tooling
**Primary Dependencies**: Canvas 2D, MapLibre GL JS, existing minimap module
**Storage**: Runtime-only backing canvas; no persisted data
**Testing**: Node test runner, Playwright, ESLint, Vite build
**Target Platform**: Required desktop/mobile Chromium, WebKit, and Firefox
**Project Type**: Browser map application
**Performance Goals**: Zero static rebuilds during motion; at least 80% less movement-time
minimap render work than legacy mode
**Constraints**: Same appearance and activity/viewport metadata; no dependency; Issue 2 only
**Scale/Scope**: 96×64 minimap, current approved discovery result and Singapore geometry

## Constitution Check

- **Branch workflow**: PASS — remains on `develop`.
- **Evidence**: PASS — approved local snapshot and checked-in route.
- **Automation**: PASS — deterministic invalidation, counters, and benchmark modes.
- **Identity/publication**: PASS — no event or snapshot changes.
- **Boundaries**: PASS — minimap owns raster cache and rendering.
- **Quality/security**: PASS — causal TDD, browser matrix, lint, build; no external input.
- **UX/performance**: PASS — visuals preserved and before/after benchmark required.
- **Operations/privacy**: PASS — no services, telemetry, storage, or personal data.

Post-design re-check: PASS. No exception is required.

## Project Structure

```text
specs/013-cache-minimap-raster/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/minimap-render-contract.md
└── tasks.md

activity-scenes/
├── event-density-minimap.js
└── esplanade-performance.js

config/map-performance-diagnostic-variants.json
scripts/diagnose-map-performance.mjs
scripts/lib/map-performance-diagnostics.mjs
tests/event-discovery.spec.mjs
tests/event-density-minimap.test.mjs
tests/map-performance-diagnostics.test.mjs
```

**Structure Decision**: Extend existing minimap and diagnostic ownership; add no production
module or dependency.

## Complexity Tracking

No violations.
