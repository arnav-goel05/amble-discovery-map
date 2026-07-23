# Tasks: Coarsen Moving Buildings

**Input**: Design documents from `specs/010-coarsen-moving-buildings/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Branch**: Execute on `develop`; do not create or switch branches.

**Tests**: The direct state assertion must fail before implementation. Focused automation, production build, browser smoke, and benchmark are required.

## Phase 1: Baseline

**Purpose**: Preserve comparable pre-change evidence.

- [X] T001 Record the existing movement value and latest benchmark metrics in `specs/010-coarsen-moving-buildings/validation.md`

---

## Phase 2: User Story 1 - Smoother Map Movement (Priority: P1) 🎯 MVP

**Goal**: Use the approved coarser representation only while the map moves and restore unchanged full detail afterward.

**Independent Test**: The map synchronization test observes movement value 24 and restored value 4, while the focused browser smoke and benchmark pass.

### Tests for User Story 1

- [X] T002 [US1] Update the direct movement/refinement expectation in `tests/map-render-sync.spec.mjs` and confirm it fails before implementation

### Implementation for User Story 1

- [X] T003 [US1] Change only the movement screen-space error from 12 to 24 in `map-layers/building-highlight-layers.js`
- [X] T004 [US1] Run the focused lifecycle test, Chromium map synchronization test, production build, and real-browser loading check from `specs/010-coarsen-moving-buildings/quickstart.md`

---

## Phase 3: Performance Validation

**Purpose**: Prove the movement-only adjustment remains safe and measurable.

- [X] T005 Run `npm run benchmark:release`, record post-change metrics in `specs/010-coarsen-moving-buildings/validation.md`, and verify every configured budget passes
- [X] T006 Review the final diff and confirm no application behavior outside `map-layers/building-highlight-layers.js` and its direct test changed

## Dependencies & Execution Order

- T001 establishes the baseline.
- T002 must fail before T003.
- T004 follows T003.
- T005 and T006 follow successful focused validation.

## Implementation Strategy

Implement one parameter change, validate its direct state contract, verify the full-quality restoration and application loading behavior, then retain it only if the existing benchmark budgets pass.
