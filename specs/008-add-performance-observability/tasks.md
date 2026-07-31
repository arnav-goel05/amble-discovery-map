# Tasks: Performance Observability

**Input**: Design documents from `specs/008-add-performance-observability/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Branch**: Execute feature tasks on `develop`; do not create or switch branches unless the user explicitly requests it.

**Tests**: Tests are required and are written before their corresponding implementation.

## Phase 1: Setup

**Purpose**: Establish versioned configuration and test boundaries.

- [x] T001 Add red-line per-profile guardrails in `config/frontend-performance-budgets.json`
- [x] T002 [P] Add benchmark budget evaluator tests in `tests/performance-budgets.test.mjs`
- [x] T003 [P] Add runtime lifecycle and snapshot tests in `tests/performance-observability.test.mjs`

---

## Phase 2: Foundational

**Purpose**: Implement the pure contracts shared by runtime and release diagnostics.

- [x] T004 Implement configuration validation, metric resolution, evaluation, and report validation in `scripts/lib/frontend-performance-budgets.mjs`
- [x] T005 Run `tests/performance-budgets.test.mjs` and confirm the pure budget contract passes

---

## Phase 3: User Story 1 - Diagnose a Heavy Session (Priority: P1)

**Goal**: An explicitly enabled, privacy-safe panel explains live application cost.

**Independent Test**: Enable diagnostics, exercise map movement, verify every supported
signal group updates, then disable/remove the map and verify all work is released.

### Tests for User Story 1

- [x] T006 [P] [US1] Add opt-in, default-inactive, capability, motion, and cleanup browser coverage in `tests/performance-observability.spec.mjs`

### Implementation for User Story 1

- [x] T007 [US1] Implement the metric/resource model in `activity-scenes/performance-diagnostics-model.js` and injectable collector, lifecycle controller, and compact view in `activity-scenes/performance-diagnostics.js`
- [x] T008 [US1] Conditionally initialize diagnostics before the main module in `app-entry.js`
- [x] T009 [US1] Attach map-aware sampling and cleanup to the existing lifecycle in `main.js`
- [x] T010 [US1] Add compact responsive diagnostics styling and accessible states in `style.css`
- [x] T011 [US1] Run unit and Chromium browser tests for `tests/performance-observability.test.mjs` and `tests/performance-observability.spec.mjs`

---

## Phase 4: User Story 2 - Compare Release Performance (Priority: P2)

**Goal**: Release reports evaluate explicit, reproducible cost guardrails.

**Independent Test**: Run pure threshold fixtures and one bounded real benchmark; verify
complete JSON/Markdown evaluations and enforced failure behavior.

### Implementation for User Story 2

- [x] T012 [US2] Add report/enforce modes, schema version 2, environment provenance, complete summaries, budget evaluations, and Markdown tables to `scripts/benchmark-frontend-performance.mjs`
- [x] T013 [US2] Make `benchmark:release` enforce checked-in budgets while `benchmark:frontend` reports them in `package.json`
- [x] T014 [US2] Run `tests/performance-budgets.test.mjs` and a bounded `npm run benchmark:release`

---

## Phase 5: User Story 3 - Inspect a Portable Snapshot (Priority: P3)

**Goal**: Developers can export bounded evidence without application or personal data.

**Independent Test**: Capture sentinel application state, export a snapshot, and prove the
versioned aggregate allowlist, 100 KiB bound, and absence of prohibited values.

### Tests for User Story 3

- [x] T015 [P] [US3] Extend network, persistence, and prohibited-value checks in `tests/no-telemetry.test.mjs`

### Implementation for User Story 3

- [x] T016 [US3] Add explicit snapshot export and bounded sanitized resources in `activity-scenes/performance-diagnostics.js`
- [x] T017 [US3] Verify runtime export behavior in `tests/performance-observability.test.mjs` and `tests/performance-observability.spec.mjs`

---

## Phase 6: Polish and Cross-Cutting Validation

**Purpose**: Document operations and complete all quality gates.

- [x] T018 [P] Document activation, metrics, guardrail meaning, export, browser limitations, and privacy in `docs/performance-baseline.md`
- [x] T019 Run focused unit/privacy/browser tests, `npm run lint`, and `npm run build`
- [x] T020 Run `npm run format:check` and validate `specs/008-add-performance-observability/quickstart.md`
- [x] T021 Review the final diff for privacy, zero-work default behavior, cleanup ownership, ignored runtime artifacts, and constitution compliance

---

## Dependencies and Execution Order

- Phase 1 establishes failing tests and configuration.
- Phase 2 blocks all user stories.
- User Story 1 supplies the runtime collector used by User Story 3.
- User Story 2 is independent after Phase 2.
- User Story 3 depends on User Story 1.
- Phase 6 depends on all stories.

## Parallel Opportunities

- T002 and T003 affect separate test files.
- T006 and the User Story 2 benchmark work affect separate runtime/tooling paths after the
  foundational evaluator exists.
- T015 and T018 affect separate privacy/documentation files.

## Implementation Strategy

1. Build and test the pure budget contract.
2. Deliver the opt-in runtime diagnostic MVP and prove cleanup.
3. Enforce release guardrails through the existing benchmark.
4. Add bounded export and no-telemetry proof.
5. Run all focused gates, build, benchmark, and convergence.

## Phase 7: Convergence

- [x] T022 Record and display map initialization, overlay, event UI, and tileset milestone timings in `activity-scenes/performance-diagnostics.js` per FR-002 and SC-001 (partial)
- [x] T023 Include bounded first/largest resource cost fields in `activity-scenes/performance-diagnostics-model.js` and render them through `activity-scenes/performance-diagnostics-view.js` per FR-002 and US1/AC1 (partial)
- [x] T024 Extend milestone and resource attribution regression coverage in `tests/performance-observability.test.mjs` and `tests/performance-observability.spec.mjs` per FR-002 (partial)

## Phase 8: Convergence

- [x] T025 Expose first-contentful paint and the bounded first resource cost in `activity-scenes/performance-diagnostics.js`, `activity-scenes/performance-diagnostics-view.js`, and focused tests per FR-002 and US1/AC1 (partial)

## Phase 9: Convergence

- [x] T026 Extract milestone capture into `activity-scenes/performance-diagnostics-model.js` so every new diagnostics module remains below 400 lines per Constitution VII (partial)
