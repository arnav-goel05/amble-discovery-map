# Tasks: Diagnose Map Slowness

**Input**: Design documents from `specs/011-diagnose-map-slowness/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Branch**: Execute all tasks on `develop`.

**Tests**: Diagnostic controls, invalid trials, aggregation, browser execution, asset
inspection, lint, and build validation are required.

## Phase 1: Setup

**Purpose**: Define the bounded diagnostic surface and artifact policy.

- [x] T001 Add versioned scene variants and single-variable comparison metadata in config/map-performance-diagnostic-variants.json
- [x] T002 [P] Add ignored raw diagnostic output paths to .gitignore and diagnostic commands to package.json
- [x] T003 Validate the checked-in report contract in tests/map-performance-diagnostics.test.mjs

---

## Phase 2: Foundational

**Purpose**: Implement pure validation and aggregation before browser instrumentation.

- [x] T004 Write failing tests for variant validation, control compatibility, invalid-trial exclusion, statistics, effect direction, and causal classification in tests/map-performance-diagnostics.test.mjs
- [x] T005 Implement versioned variant/trial validation and causal aggregation in scripts/lib/map-performance-diagnostics.mjs
- [x] T006 Add deterministic Markdown and machine-readable report generation in scripts/lib/map-performance-diagnostics.mjs

**Checkpoint**: Diagnostic evidence can be validated and aggregated without a browser.

---

## Phase 3: User Story 1 - Attribute Interactive Slowness (Priority: P1)

**Goal**: Isolate top-level application workloads through repeated controlled motion.

**Independent Test**: Run the fixed network-idle scene matrix and receive compatible
single-variable frame-time comparisons for all top-level workloads.

### Tests

- [x] T007 [US1] Write failing browser coverage for allowlisted opt-in variants, ordinary-session inactivity, layer absence/retention state, and lifecycle cleanup in tests/map-performance-diagnostics.spec.mjs

### Implementation

- [x] T008 [US1] Implement validated opt-in scene variant resolution in activity-scenes/performance-diagnostic-variants.js
- [x] T009 [US1] Expose bounded background/highlight layer, tileset, selection, readiness, and lifecycle snapshots in map-layers/building-highlight-layers.js
- [x] T010 [US1] Apply diagnostic-only workload composition without changing ordinary behavior in main.js
- [x] T011 [US1] Implement repeated fixed-route browser trials, foreground/readiness validity checks, frame/long-task/network/memory capture, and scene identity in scripts/diagnose-map-performance.mjs
- [x] T012 [US1] Run the top-level isolation matrix and record valid raw evidence under outputs/map-performance-diagnostics/

**Checkpoint**: Full-scene motion cost is attributed across basemap, overlays/interface,
background 3D, and highlighted 3D or has a quantified residual interaction.

---

## Phase 4: User Story 2 - Separate Loading from Rendering Cost (Priority: P2)

**Goal**: Distinguish cold transfer/decode/upload cost from warm steady rendering and drill
an expensive 3D subsystem to observed resources and renderer work.

**Independent Test**: Produce separate cold, warm, and network-idle results plus technical
profiles for only the 3D assets implicated by valid comparisons.

### Tests

- [x] T013 [P] [US2] Write failing phase-window and trace-summary tests in tests/map-performance-diagnostics.test.mjs
- [x] T014 [P] [US2] Write failing B3DM/GLB geometry, material, texture, compression, and malformed-asset fixtures in tests/map-performance-diagnostics.test.mjs

### Implementation

- [x] T015 [US2] Add cold/warm/network-idle phase boundaries, active-request accounting, failed-resource validation, and bounded Chromium trace summaries in scripts/diagnose-map-performance.mjs
- [x] T016 [US2] Implement observed-resource-only B3DM/GLB asset inspection in scripts/inspect-3d-tile-assets.mjs
- [x] T017 [US2] Add targeted follow-up variants for the confirmed expensive layer or lifecycle operation in config/map-performance-diagnostic-variants.json
- [x] T018 [US2] Execute follow-up trials and asset inspection until the smallest measurable renderer operation or asset class is isolated under outputs/map-performance-diagnostics/

**Checkpoint**: Loading and steady rendering have separate causes, and broad layer findings
are drilled to the smallest supported operation or asset class.

---

## Phase 5: User Story 3 - Review Exact Solution Options (Priority: P3)

**Goal**: Deliver an evidence-backed audit and authoritative solution research without an
optimization.

**Independent Test**: Every confirmed cause links to controlled comparisons, observed
assets/traces, and unimplemented solution options that address the measured mechanism.

- [x] T019 [US3] Research authoritative upstream guidance for each confirmed rendering, tiling, geometry, texture, or lifecycle cause in specs/011-diagnose-map-slowness/audit-report.md
- [x] T020 [US3] Classify confirmed causes, contributing factors, non-causes, residual interactions, and limitations in specs/011-diagnose-map-slowness/audit-report.md
- [x] T021 [US3] Map prioritized unimplemented solution options, expected metric effects, risks, and validation plans to findings in specs/011-diagnose-map-slowness/audit-report.md

---

## Phase 6: Polish and Validation

- [x] T022 Run diagnostic unit/browser tests, lint, schema validation, and production build per specs/011-diagnose-map-slowness/quickstart.md
- [x] T023 Verify ordinary sessions are behaviorally unchanged and review the diff for accidental optimization
- [x] T024 Review spec, plan, tasks, instrumentation, evidence, and audit for remaining diagnostic gaps before the separate convergence pass

---

## Dependencies and Execution Order

- Phase 1 precedes Phase 2.
- Phase 2 blocks all browser and asset work.
- User Story 1 establishes causal top-level attribution before User Story 2 drills into a
  confirmed subsystem.
- User Story 3 depends on the completed evidence from User Stories 1 and 2.
- Final validation depends on all stories.

## Parallel Opportunities

- T002 and T003 can proceed independently after T001.
- T013 and T014 cover independent trace and asset fixtures.
- T019 can begin source collection while T020 structures measured findings, but final
  solution mapping waits for both.

## Implementation Strategy

1. Build and validate pure evidence contracts.
2. Establish the top-level causal matrix.
3. Separate phase costs and drill the winning subsystem.
4. Research only solutions relevant to confirmed mechanisms.
5. Validate, converge, and stop without applying an optimization.
