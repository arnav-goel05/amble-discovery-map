# Tasks: Zoom-Aware Event Cluster Counts

**Input**: Design documents from `/specs/021-zoom-cluster-counts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Branch**: Execute feature tasks on `develop`; do not create or switch branches unless the user explicitly requests it.

**Tests**: Relevant automated tests and the production build are REQUIRED by the project constitution. Tests are written before their corresponding implementation and must cover success, empty, transition, interaction, and cleanup behavior.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified as a coherent increment.

## Phase 1: Setup (Shared Evidence)

**Purpose**: Capture the pre-change performance baseline and confirm the working boundary.

- [x] T001 Record the bounded pre-change frontend benchmark described in `specs/021-zoom-cluster-counts/quickstart.md` under `outputs/performance-baseline/zoom-clusters-before/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish deterministic grouping and lifecycle behavior shared by every story.

**⚠️ CRITICAL**: No user story work begins until the cluster model is covered by a failing test and implemented.

- [x] T002 Write failing deterministic tests for stable membership, exact totals, adjacent spatial cells, invalid points, and empty input in `tests/event-location-clusters.test.mjs`
- [x] T003 Implement dependency-free spatial-hash grouping, keyed DOM reconciliation, and destroy cleanup in `activity-scenes/landmark-event-clusters.js`
- [x] T004 Run `tests/event-location-clusters.test.mjs` and document the passing foundation in `specs/021-zoom-cluster-counts/tasks.md`

**Checkpoint**: Projected event locations can be grouped exactly once and reconciled without map integration.

---

## Phase 3: User Story 1 - Find event areas while zoomed out (Priority: P1) 🎯 MVP

**Goal**: Show compact counts for every matching visible event location below the pill level.

**Independent Test**: At low zoom, every matching visible event landmark belongs to one count, full pills are inert, filters update totals, and empty results remove counts.

### Tests for User Story 1

- [x] T005 [US1] Write failing low-zoom count, filter, empty-state, navigation-target exclusion, and destroy lifecycle tests in `tests/event-ui.spec.mjs`

### Implementation for User Story 1

- [x] T006 [P] [US1] Add accessible compact cluster count, hover, focus, hidden, and mobile styles beside existing pill rules in `style.css`
- [x] T007 [US1] Integrate cluster eligibility and reconciliation with existing scheduled position, add/upsert/remove, filter, navigation-target, and destroy paths in `activity-scenes/landmark-event-pill.js`
- [x] T008 [US1] Run the focused cluster tests in `tests/event-ui.spec.mjs` and confirm exact low-zoom representation

**Checkpoint**: The zoomed-out map always provides an accurate event-location overview.

---

## Phase 4: User Story 2 - Refine clusters by zooming (Priority: P2)

**Goal**: Split counts as scale increases and replace them with full pills at the established threshold.

**Independent Test**: The same landmark set forms broader then narrower groups across representative zooms, totals remain stable, and settled detail mode contains pills but no counts.

### Tests for User Story 2

- [x] T009 [US2] Write failing zoom split/merge, exact-total, and mutually exclusive cluster-to-pill transition tests in `tests/event-ui.spec.mjs`

### Implementation for User Story 2

- [x] T010 [US2] Complete zoom-dependent projection grouping and mutually exclusive presentation transitions in `activity-scenes/landmark-event-pill.js` and `activity-scenes/landmark-event-clusters.js`
- [x] T011 [US2] Run the focused zoom-transition tests in `tests/event-ui.spec.mjs` at desktop and mobile viewport sizes

**Checkpoint**: Overview counts progressively refine and hand off cleanly to existing pills.

---

## Phase 5: User Story 3 - Navigate from a count (Priority: P3)

**Goal**: Let pointer, touch, and keyboard users move closer to a cluster's locations.

**Independent Test**: Activating multi- and single-location counts moves the map to greater detail, preserves filters, and Enter/Space match pointer activation.

### Tests for User Story 3

- [x] T012 [US3] Write failing pointer, Enter, Space, single-location, multi-location, and focus-handoff navigation tests in `tests/event-ui.spec.mjs`

### Implementation for User Story 3

- [x] T013 [US3] Implement bounded cluster-center navigation and accessible activation behavior in `activity-scenes/landmark-event-clusters.js` and `activity-scenes/landmark-event-pill.js`
- [x] T014 [US3] Add one real-map discovery assertion for count activation and cluster-to-pill handoff in `tests/event-discovery.spec.mjs`
- [x] T015 [US3] Run the focused cluster navigation tests in `tests/event-ui.spec.mjs` and `tests/event-discovery.spec.mjs`

**Checkpoint**: Every overview count provides a direct, accessible next step toward event detail.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Prove performance, regression safety, compatibility, and artifact policy.

- [x] T016 [P] Extend idle-update regression coverage to prove cluster rendering adds no polling or permanent animation in `tests/event-ui.spec.mjs`
- [x] T017 [P] Review implementation behavior against `specs/021-zoom-cluster-counts/contracts/cluster-presentation.md` and record any contract corrections in that file
- [x] T018 Run ESLint, changed-file format checks, focused Node/Playwright tests, the required event UI browser matrix, and the production build from `package.json`
- [x] T019 Record the bounded post-change benchmark under `outputs/performance-baseline/zoom-clusters-after/` and compare it with T001 for movement, long-task, DOM, and idle regressions
- [x] T020 Verify benchmark outputs remain ignored, only feature documentation/code/tests are tracked, and mark completed tasks in `specs/021-zoom-cluster-counts/tasks.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Starts after T001 and blocks all stories.
- **User Story 1 (Phase 3)**: Depends on the foundational cluster module and is the MVP.
- **User Story 2 (Phase 4)**: Depends on User Story 1's presentation integration.
- **User Story 3 (Phase 5)**: Depends on visible cluster controls from User Stories 1 and 2.
- **Polish (Phase 6)**: Depends on all desired stories.

### User Story Dependencies

- **User Story 1 (P1)**: Independently delivers accurate overview counts.
- **User Story 2 (P2)**: Uses User Story 1 counts but remains independently testable through zoom transitions.
- **User Story 3 (P3)**: Uses the established count controls but remains independently testable through navigation outcomes.

### Within Each User Story

- Write and observe failing tests before implementation.
- Implement pure grouping before DOM/map integration.
- Complete core presentation before navigation behavior.
- Run each story's focused checks before advancing.

### Parallel Opportunities

- T006 styling can proceed after the DOM contract is fixed while T007 integrates state.
- T016 idle regression coverage and T017 contract review can proceed independently after stories complete.
- Pure Node grouping tests and browser test authoring touch separate files during the foundational/MVP boundary.

---

## Parallel Example: User Story 1

```text
Task T006: Add cluster count styles in style.css.
Task T007: Integrate cluster reconciliation in activity-scenes/landmark-event-pill.js.
```

## Parallel Example: Polish

```text
Task T016: Extend idle-update browser coverage in tests/event-ui.spec.mjs.
Task T017: Review the implemented UI contract in specs/021-zoom-cluster-counts/contracts/cluster-presentation.md.
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Capture the baseline benchmark.
2. Implement and prove deterministic grouping.
3. Add low-zoom counts and filter/lifecycle reconciliation.
4. Stop and validate exact location representation before zoom refinement.

### Incremental Delivery

1. Foundation: exact transient clusters with stable keyed reconciliation.
2. User Story 1: discover event-containing areas at low zoom.
3. User Story 2: progressively split groups and transition to pills.
4. User Story 3: activate groups to move toward detail.
5. Polish: compatibility, build, and performance evidence.

## Notes

- `[P]` tasks touch independent files or concerns.
- No event/venue data, approved snapshots, capability contracts, external services, or
  persistent state change.
- The feature remains on `develop` as required by repository governance.
- Total tasks: 20 (US1: 4, US2: 3, US3: 4, shared/polish: 9).
