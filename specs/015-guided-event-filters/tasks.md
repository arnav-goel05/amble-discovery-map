---
description: "Task list for implementing the guided event filter builder"
---

# Tasks: Guided Event Filters

**Input**: Design documents from `/specs/015-guided-event-filters/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/filter-builder.md

**Branch**: Execute feature tasks on `develop`; do not create or switch branches unless the
user explicitly requests it.

**Tests**: Relevant automated tests and the production build are REQUIRED by the project
constitution. Tests are written before the corresponding implementation.

**Organization**: Tasks are grouped by user story so the options-only MVP, option
combination, empty-result recovery, and compact progressive-disclosure revision can be
validated incrementally.

## Phase 1: Setup and Compatibility Baseline

**Purpose**: Protect existing event selection and direct-action behavior before replacing
the public entry point.

- [x] T001 Capture the existing direct event action and result-selection compatibility baseline in tests/voice-action-coverage.spec.mjs and tests/event-ui.spec.mjs

---

## Phase 2: Foundational Filter Contracts

**Purpose**: Establish pure, tested option/state/location contracts that block all UI work.

- [x] T002 [P] Add failing tests for option identities, normalization, token multiplicity, projection, and stale reconciliation in tests/event-filter-options.test.mjs
- [x] T003 [P] Add failing tests for weekend windows, radius, map bounds, area, landmark, and venue predicates in tests/event-discovery-model.test.mjs
- [x] T004 Implement pure filter option catalogs, token transitions, filter projection, and geographic helpers in activity-scenes/events/event-filter-options.js
- [x] T005 Extend event discovery filtering and source-backed option metadata without disturbing existing query behavior in activity-scenes/events/event-discovery-model.js

**Checkpoint**: Pure option state and all discovery predicates pass independently of the DOM.

---

## Phase 3: User Story 1 - Build a Partial Event Search (Priority: P1) 🎯 MVP

**Goal**: Replace the public keyword field with an any-order, stop-anywhere builder that
exposes every filter dimension, applies each selection immediately, and renders removable
inline tokens.

**Independent Test**: Select one What, When, Where, or Price option first in separate runs
and verify each creates a token and immediately updates usable results without submission.

### Tests for User Story 1

- [x] T006 [US1] Add failing browser coverage for grouped options, any-first selection, immediate results, token removal, custom dates, map-area refresh, and Near me permission outcomes in tests/event-discovery.spec.mjs

### Implementation for User Story 1

- [x] T007 [US1] Replace separate keyword/category/date controls with grouped options and inline tokens while preserving result rendering and public methods in activity-scenes/landmark-event-search.js
- [x] T008 [US1] Inject current map bounds and ephemeral one-shot geolocation, including three-kilometre Near me behavior, in activity-scenes/esplanade-performance.js
- [x] T009 [US1] Implement the desktop and mobile builder, token, option-group, custom-date, permission, and focus styling in style.css
- [x] T010 [US1] Update feature-tour anchors and copy for the unified builder in activity-scenes/feature-tour.js and tests/feature-tour.spec.mjs
- [x] T011 [US1] Adapt existing event discovery, minimap, selection, and direct-action tests to the options-only public UI in tests/event-discovery.spec.mjs, tests/event-ui.spec.mjs, and tests/voice-action-coverage.spec.mjs

**Checkpoint**: Any valid single or partial filter state works as a complete discovery flow.

---

## Phase 4: User Story 2 - Find and Combine Recognized Options (Priority: P2)

**Goal**: Let users type to find recognized options, combine multiple What values, replace
single-value dimensions, and operate the builder with keyboard, pointer, or touch.

**Independent Test**: Type a partial recognized label and combine filters in a non-default
order; verify unmatched text changes no results, multi-category selection is inclusive,
single-value dimensions replace, and all tokens remain reachable at mobile width.

### Tests for User Story 2

- [x] T012 [US2] Add failing unit and browser coverage for option narrowing, unmatched text, inclusive What selection, single-value replacement, Backspace removal, arrow/Enter/Escape behavior, and mobile wrapping in tests/event-filter-options.test.mjs and tests/event-discovery.spec.mjs

### Implementation for User Story 2

- [x] T013 [US2] Implement full-catalog typed narrowing, active-option keyboard navigation, recognized-only commits, and ordered token transitions in activity-scenes/landmark-event-search.js
- [x] T014 [US2] Refine responsive wrapping, enlarged-text behavior, 44-pixel mobile targets, selected-state affordances, and option-list focus styling in style.css

**Checkpoint**: Recognized choices can be found and combined in any order without exposing
free-text event filtering.

---

## Phase 5: User Story 3 - Recover from Over-Filtering (Priority: P3)

**Goal**: Turn every zero-result combination into an actionable recovery state.

**Independent Test**: Create a zero-result combination and verify each useful suggested
removal shows its exact restored count; if none restore results, verify Clear all works.

### Tests for User Story 3

- [x] T015 [US3] Add failing exact-count and clear-all recovery tests in tests/event-filter-options.test.mjs and tests/event-discovery.spec.mjs

### Implementation for User Story 3

- [x] T016 [US3] Implement bounded single-token recovery evaluation in activity-scenes/events/event-filter-options.js
- [x] T017 [US3] Render accessible recovery actions and wire one-click removal and clear-all behavior in activity-scenes/landmark-event-search.js and style.css

**Checkpoint**: Empty results always provide a deterministic next action.

---

## Phase 6: Polish and Cross-Cutting Validation

**Purpose**: Verify lifecycle reconciliation, privacy, performance, compatibility, and
release gates across all stories.

- [x] T018 [P] Add snapshot-replacement stale-token and error-state regression coverage in tests/event-filter-options.test.mjs and tests/event-discovery.spec.mjs
- [x] T019 Measure the largest local selection and recovery updates against the 200-millisecond target using existing diagnostics in tests/event-discovery.spec.mjs
- [x] T020 Verify no exact geolocation or free-text option input reaches logs, diagnostics, storage, or external requests in activity-scenes/landmark-event-search.js and activity-scenes/esplanade-performance.js
- [x] T021 Run the targeted unit and Chromium desktop/mobile commands from specs/015-guided-event-filters/quickstart.md
- [x] T022 Run npm run lint, npm run format:check, and npm run build from package.json
- [x] T023 Run the required desktop/mobile Chromium, WebKit, and Firefox event UI matrix from specs/015-guided-event-filters/quickstart.md
- [x] T024 Complete the manual keyboard, permission-denial, zero-result, and 320-pixel-width scenarios in specs/015-guided-event-filters/quickstart.md

---

## Phase 7: Progressive-Disclosure Revision

**Purpose**: Replace the oversized four-column option dashboard with an AI
Autocomplete-style flow that shows four compact dimension choices first and one value list
at a time.

### Tests for the Revision

- [x] T025 [US1] Add failing browser coverage for the compact dimension chooser, one-group value view, Back navigation, return-to-chooser behavior, and bounded desktop popover in tests/event-discovery.spec.mjs
- [x] T026 [US2] Add failing browser coverage for globally labelled typed matches, dimension-scoped typing, and keyboard transitions in tests/event-ui.spec.mjs

### Implementation for the Revision

- [x] T027 [US1] Implement active disclosure state, the compact dimension chooser, one-group value rendering, and return-to-chooser transitions in activity-scenes/landmark-event-search.js
- [x] T028 [US2] Implement global and dimension-scoped recognized-option matching plus focus and keyboard transitions in activity-scenes/landmark-event-search.js
- [x] T029 [US1] Replace the dashboard grid with a compact bounded popover, two-column dimension chooser, and single-column value list in style.css
- [x] T030 [US1] Update guided-filter browser interactions for the progressive-disclosure flow in tests/event-discovery.spec.mjs and tests/event-ui.spec.mjs; existing feature-tour anchors and assertions remain compatible

### Validation for the Revision

- [x] T031 Run the targeted unit and Chromium desktop/mobile commands from specs/015-guided-event-filters/quickstart.md
- [x] T032 Complete the desktop map-visibility, keyboard, and 320-pixel-width scenarios in specs/015-guided-event-filters/quickstart.md
- [x] T033 Run npm run lint, npm run format:check, and npm run build from package.json
- [x] T034 Run the required desktop/mobile Chromium, WebKit, and Firefox event UI matrix from specs/015-guided-event-filters/quickstart.md
- [x] T035 [US1] Hide selected dimensions from the chooser, restore them after token removal, preserve typed What composition and single-value replacement, and add cross-browser regression coverage in activity-scenes/landmark-event-search.js, tests/event-discovery.spec.mjs, and tests/event-ui.spec.mjs

---

## Phase 8: Sentence Composer and Local Classifier Revision

**Purpose**: Match the approved AI Autocomplete reference while supporting guided choices,
free text, and deterministic local classification without an external service.

- [x] T036 [US2] Add failing classifier fixtures for explicit grammar, longest catalog
      matches, residual What text, overlap, ambiguity, normalization, and determinism in
      tests/event-query-classifier.test.mjs
- [x] T037 [US1] Add failing browser coverage for the inline sentence, bold borderless
      phrases, commit arrow, guided advance, deviations, phrase editing, and local free-text
      commit in tests/event-ui.spec.mjs and tests/event-discovery.spec.mjs
- [x] T038 [US2] Implement the pure bounded classifier in
      activity-scenes/events/event-query-classifier.js
- [x] T039 [US1] Implement atomic classified commits, sentence phrase rendering, editing,
      removal, remaining-step navigation, and unchanged public action/filter projection in
      activity-scenes/landmark-event-search.js
- [x] T040 [US1] Match the approved rounded composer and compact option-card styling,
      remove pill/close-icon presentation, and preserve responsive accessibility in style.css
- [x] T041 Run classifier/unit tests, targeted six-project browser tests, lint, format,
      production build, and manual desktop/mobile visual inspection

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately on `develop`.
- **Foundational (Phase 2)**: Depends on T001 and blocks all user-story implementation.
- **User Story 1 (Phase 3)**: Depends on T002–T005 and delivers the MVP.
- **User Story 2 (Phase 4)**: Depends on the rendered builder from User Story 1.
- **User Story 3 (Phase 5)**: Depends on the active token and result pipeline from User
  Story 1; it does not depend on typed narrowing from User Story 2.
- **Polish (Phase 6)**: Depends on all three desired stories.
- **Progressive-Disclosure Revision (Phase 7)**: Depends on the complete Phase 6 baseline;
  revision tests precede the disclosure-state and layout changes.
- **Sentence Composer Revision (Phase 8)**: Depends on Phase 7 and keeps its shared
  action/filter boundary; classifier and browser tests precede implementation.

### User Story Dependencies

- **User Story 1 (P1)**: Foundational contracts only.
- **User Story 2 (P2)**: Integrates with User Story 1's builder but is independently
  testable through recognized-option discovery and combination.
- **User Story 3 (P3)**: Integrates with User Story 1's filter state but is independently
  testable through a zero-result combination and recovery.

### Within Each User Story

- Tests must be written and observed failing before implementation.
- Pure state and discovery predicates precede DOM interaction.
- DOM interaction precedes responsive styling and integration updates.
- Each story's checkpoint must pass before advancing.

### Parallel Opportunities

- T002 and T003 touch separate test files and can be written in parallel.
- After User Story 1, User Story 2 tests and User Story 3 tests can be prepared in parallel
  because their behaviors are independent.
- T018 can be prepared while performance and privacy verification are reviewed, provided
  implementation files are not edited concurrently.

---

## Parallel Example: Foundational Contracts

```text
Task T002: Write pure option/state tests in tests/event-filter-options.test.mjs
Task T003: Write event discovery geography/date tests in tests/event-discovery-model.test.mjs
```

## Parallel Example: Independent Later Stories

```text
Task T012: Prepare recognized-option combination coverage
Task T015: Prepare zero-result recovery coverage
```

---

## Implementation Strategy

### MVP First

1. Protect existing direct-action and selection contracts.
2. Build and test the pure filter foundation.
3. Deliver User Story 1 with all four dimensions, partial selection, live results, tokens,
   current map area, and Near me.
4. Validate the User Story 1 checkpoint before adding typed narrowing or recovery.

### Incremental Delivery

1. Setup + Foundation → deterministic contracts ready.
2. User Story 1 → options-only guided filtering is usable.
3. User Story 2 → long lists and complex combinations become efficient.
4. User Story 3 → zero-result states become recoverable.
5. Cross-browser, privacy, performance, lint, format, and build gates complete the feature.

## Notes

- No task creates or switches branches.
- No task modifies approved event snapshots or generated event data.
- Existing dirty-worktree changes are user-owned and must be preserved.
- Exact user location remains ephemeral and must not be added to diagnostic datasets.
- The public builder projects only locally classified residual What text through `query`;
  direct action compatibility remains unchanged.
