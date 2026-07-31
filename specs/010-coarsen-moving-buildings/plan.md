# Implementation Plan: Coarsen Moving Buildings

**Branch**: `develop` | **Date**: 2026-07-23 | **Spec**: [spec.md](spec.md)

## Summary

Increase only the temporary 3D screen-space error used by both building layers during active map movement from 12 to 24. Keep the stationary error at 4, the 350 ms restoration delay, layer opacity, request limits, data, and all unrelated behavior unchanged. Update the existing synchronization assertion, then validate through focused automation, the production build, a real-browser smoke check, and the checked-in release benchmark.

## Technical Context

**Language/Version**: Browser JavaScript ES modules on the existing Node.js project

**Primary Dependencies**: Existing MapLibre, Deck.gl `Tile3DLayer`, and loaders.gl 3D Tiles integration

**Storage**: N/A

**Testing**: Node test runner, Playwright, Vite production build, checked-in frontend benchmark

**Target Platform**: Current supported desktop browsers

**Project Type**: Existing web application

**Performance Goals**: Reduce movement-time 3D refinement work without a performance-budget regression

**Constraints**: Change one movement constant and its direct assertion only; stationary error remains 4 and restoration remains 350 ms

**Scale/Scope**: Existing background building tileset and combined highlighted-venue tileset

## Constitution Check

- **Branch workflow**: PASS — work remains on `develop`.
- **Evidence**: PASS — no publication or source evidence changes.
- **Automation**: PASS — existing deterministic movement/refinement state machine and benchmark remain authoritative.
- **Identity and publication**: PASS — no data, identity, reconciliation, or publication changes.
- **Boundaries**: PASS — the adjustment remains owned by `map-layers/building-highlight-layers.js`.
- **Quality and security**: PASS — focused regression tests, production build, browser smoke, and benchmark are required; no security boundary changes.
- **UX and performance**: PASS — the optimization is movement-only, before/after metrics are recorded, and full visual quality must restore.
- **Operations and privacy**: PASS — no services, retention, user data, generated production data, or operational workflow changes.

The post-design check also passes. No constitutional exception or complexity justification is required.

## Project Structure

### Documentation

```text
specs/010-coarsen-moving-buildings/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
map-layers/building-highlight-layers.js
tests/map-render-sync.spec.mjs
outputs/performance-baseline/latest.{json,md}  # ignored benchmark evidence
```

**Structure Decision**: Reuse the existing 3D layer owner, its focused Playwright synchronization test, and the existing benchmark. No new runtime module or dependency is warranted.

## Complexity Tracking

No violations.
