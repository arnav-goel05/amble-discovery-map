---
description: "Dependency-ordered implementation tasks for local background-lite migration"
---

# Tasks: Local Background-Lite Migration

**Input**: Design documents from `/specs/025-local-background-lite/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Branch**: Execute on `develop`; do not create or switch branches.

**Tests**: Test-first coverage is required for transformation, resume, reconciliation, destructive gates, renderer behavior, and automated browser validation.

## Phase 1: Setup

**Purpose**: Establish local-only command and ignored output boundaries.

- [x] T001 Add local background-lite command entry and scripts to `package.json` and `scripts/local-background-lite.mjs`
- [x] T002 Add local generated-output patterns and verify source protection in `.gitignore`
- [x] T003 [P] Document the implementation/run boundary in `docs/local-background-lite.md`

---

## Phase 2: Foundational

**Purpose**: Shared identities, manifests, filesystem safety, and test fixtures required by every story.

- [x] T004 Add canonical source-path, deterministic serialization, hashing, and schema validation utilities in `scripts/lib/background-lite-run.mjs`
- [x] T005 [P] Add bounded synthetic source/tileset/highlight fixtures in `tests/fixtures/background-lite-local/`
- [x] T006 [P] Add manifest contract tests for invalid paths, duplicate identities, partial outputs, and deterministic serialization in `tests/background-lite-run.test.mjs`
- [x] T007 Add atomic file/checkpoint helpers and capacity-reserve checks in `scripts/lib/background-lite-run.mjs`
- [x] T008 Add exact-target preflight and confirmation-token contract tests in `tests/local-asset-migration.test.mjs`
- [x] T009 Implement no-write inventory, deletion-candidate resolution, confirmation tokens, and migration states in `scripts/lib/local-asset-migration.mjs`
- [x] T010 Wire `preflight`, `status`, and guarded `reclaim` dispatch in `scripts/local-background-lite.mjs`

**Checkpoint**: Local source and deletion scope can be inspected safely; no destructive action has run.

---

## Phase 3: User Story 1 - Build a Stable Lightweight Background (Priority: P1) 🎯 MVP

**Goal**: Generate one policy-stable lightweight result for every supported original source tile.

**Independent Test**: Process a mixed fixture and prove every supported building remains present, broad colour is retained, identities/geometry match, and source bytes do not change.

### Tests for User Story 1

- [x] T011 [P] [US1] Extend transformation tests for alpha, semantic ownership, small textures, colour preservation, and mixed-highlight tiles in `tests/background-lite-b3dm.test.mjs`
- [x] T012 [P] [US1] Add full inventory-to-tileset integration tests and terminal accounting in `tests/background-lite-run.test.mjs`

### Implementation for User Story 1

- [x] T013 [US1] Finalize the 128px colour-preserving transformation and integrity evidence in `scripts/lib/background-lite-b3dm.mjs`
- [x] T014 [US1] Implement full source inventory and stable background run identity in `scripts/lib/background-lite-run.mjs`
- [x] T015 [US1] Implement per-tile atomic transformation, validation, output, and isomorphic tileset assembly in `scripts/lib/background-lite-run.mjs`
- [x] T016 [US1] Add `build` command options, progress, bounded concurrency, and structured outcomes in `scripts/local-background-lite.mjs`
- [x] T017 [US1] Run a bounded 20-tile mixed fixture and record evidence in `outputs/background-lite-local/fixture/report.json`

**Checkpoint**: The stable-background MVP works independently without changing highlights or local renderer configuration.

---

## Phase 4: User Story 2 - Resume a Large Local Run Safely (Priority: P2)

**Goal**: Safely stop, resume, and reject stale or partial high-volume output.

**Independent Test**: Interrupt after a checkpoint, resume without rewriting verified tiles, and reject corrupt output, changed policy, changed source, and insufficient capacity.

### Tests for User Story 2

- [x] T018 [P] [US2] Add interruption, corrupt-checkpoint, stale-source, stale-policy, and no-op tests in `tests/background-lite-run.test.mjs`
- [x] T019 [P] [US2] Add capacity reserve and atomic-write failure tests in `tests/local-asset-migration.test.mjs`

### Implementation for User Story 2

- [x] T020 [US2] Implement checkpoint sequencing, verified resume, stale invalidation, and no-op completion in `scripts/lib/background-lite-run.mjs`
- [x] T021 [US2] Add configurable batch size, concurrency, reserve, and resume reporting in `scripts/local-background-lite.mjs`
- [x] T022 [US2] Validate interrupt/resume and capacity-blocked fixture scenarios in `outputs/background-lite-local/resume/`

**Checkpoint**: Full-corpus generation can safely continue across interruptions after space is reclaimed.

---

## Phase 5: User Story 3 - Change Highlights Without Rebuilding Background (Priority: P3)

**Goal**: Reconcile source-backed full-quality overlays independently from stable background output.

**Independent Test**: Add, retain, share, and remove fixture highlights; verify create/no-op/deduplicate/expire actions while all background hashes remain unchanged.

### Tests for User Story 3

- [x] T023 [P] [US3] Add source-identity extraction and ambiguity tests in `tests/highlight-overlay-build.test.mjs`
- [x] T024 [P] [US3] Add create/update/no-op/expire/review and shared-owner tests in `tests/highlight-overlay-reconcile.test.mjs`

### Implementation for User Story 3

- [x] T025 [US3] Implement original-source identity extraction with full-quality material retention in `scripts/lib/highlight-overlay-build.mjs`
- [x] T026 [US3] Implement overlay reconciliation and stable deduplicated identities in `scripts/lib/highlight-overlay-reconcile.mjs`
- [x] T027 [US3] Build and validate the sparse overlay catalogue in `scripts/lib/highlight-overlay-build.mjs`
- [x] T028 [US3] Add `overlays` command and structured reconciliation output in `scripts/local-background-lite.mjs`
- [x] T029 [US3] Prove fixture highlight changes leave background hashes unchanged in `outputs/background-lite-local/overlays/`

**Checkpoint**: Highlight membership changes only the full-quality overlay catalogue.

---

## Phase 6: User Story 4 - Review and Switch the Local Renderer (Priority: P4)

**Goal**: Render the new background and overlays correctly, prove parity, and gate legacy cleanup.

**Independent Test**: Activate one complete fixture manifest and verify 30% background, 100% overlays, stable depth, complete identities, explicit missing states, and rollback.

### Tests for User Story 4

- [x] T030 [P] [US4] Add renderer manifest, empty-overlay, missing-asset, depth, opacity, and reload tests in `tests/building-highlight-movement.test.mjs`
- [x] T031 [P] [US4] Add five-distinct-camera and matched-count browser tests in `tests/background-lite-local.spec.mjs`
- [x] T032 [P] [US4] Add switch/rollback and legacy-cleanup gate tests in `tests/local-asset-migration.test.mjs`

### Implementation for User Story 4

- [x] T033 [US4] Implement local switch-manifest validation and atomic local activation in `scripts/lib/local-asset-migration.mjs`
- [x] T034 [US4] Update background-plus-overlay rendering and explicit incomplete states in `map-layers/building-highlight-layers.js`
- [x] T035 [US4] Add overlay-only reload and tested depth preference in `map-layers/building-highlight-layers.js`
- [x] T037 [US4] Add `validate` and `switch-local` commands in `scripts/local-background-lite.mjs`
- [x] T038 [US4] Produce the combined payload, identity, browser, rollback, and advisory-diagnostics report in `outputs/background-lite-local/final/report.json`
- [x] T039 [US4] Implement a separately confirmed exact-target legacy POI cleanup gate in `scripts/lib/local-asset-migration.mjs`

**Checkpoint**: The new local renderer is validated; legacy POI deletion is eligible but still requires explicit confirmation.

---

## Phase 7: Polish and Cross-Cutting Validation

- [x] T040 [P] Update final operator instructions and recovery states in `docs/local-background-lite.md` and `specs/025-local-background-lite/quickstart.md`
- [x] T041 Run all focused Node tests named in `specs/025-local-background-lite/quickstart.md`
- [x] T042 Run desktop/mobile Chromium, WebKit, and Firefox coverage in `tests/background-lite-local.spec.mjs`
- [x] T043 Run `npm run lint`, `npm run format:check`, `npm run build`, and `git diff --check`
- [x] T044 Verify generated artifacts remain ignored and reports explicitly state local-only/no publication in `outputs/background-lite-local/final/report.json`
- [x] T045 Verify every task and acceptance gate, record unresolved work in `specs/025-local-background-lite/tasks.md`, and leave all remote/Git publication actions untouched

---

## Dependencies and Execution Order

- Phase 1 → Phase 2 blocks all user stories.
- US1 depends on Phase 2 and provides the stable background MVP.
- US2 depends on the US1 run model but is independently testable with interruption fixtures.
- US3 depends only on foundational identities and original source; it never mutates US1 output.
- US4 depends on complete US1 and US3 candidates plus US2 safety behavior.
- Final validation depends on every desired user story.
- Destructive `optimized-tiles/` reclaim may occur after T010 and an explicit confirmation; it is not required to finish fixture-level US1–US3 implementation.
- Legacy `public/poi-tiles/` cleanup may occur only after T038–T039 and a second explicit confirmation.

## Parallel Opportunities

- T003, T005, and T006 can proceed in parallel after T001–T002.
- US1 test tasks T011–T012 can proceed in parallel before T013–T016.
- US2 tests T018–T019 can proceed in parallel.
- US3 tests T023–T024 can proceed in parallel; overlay work does not rewrite background output.
- US4 tests T030–T032 can proceed in parallel before renderer and switch implementation.
- Documentation T040 can proceed alongside final automated validation.

## Implementation Strategy

### MVP first

1. Complete Setup and Foundational tasks.
2. Run no-write preflight and stop at exact destructive confirmation.
3. Complete US1 against bounded fixtures without requiring corpus deletion.
4. Validate stable background transformation and integrity independently.

### Incremental migration

1. Add verified resume and capacity behavior.
2. Add dynamic full-quality overlays and reconciliation.
3. Reclaim `optimized-tiles/` space only after confirmation.
4. Run full background generation.
5. Migrate and validate the local renderer.
6. Retire legacy POI assets only after separate parity confirmation.

## Notes

- No task deploys, uploads, commits, pushes, opens a pull request, or releases.
- `tiles/` is never a deletion target.
- Mark tasks `[X]` only after implementation and relevant validation succeed.

## Phase 8: Convergence

- [x] T046 Add active-highlight identity counts, batching scope, proposed run identity, and blockers to no-write preflight per FR-019 and SC-001 (partial)
- [x] T047 Resolve or explicitly re-authorize the 155 approved GML identities absent from every referenced current source LOD sibling, without name or position inference, per FR-004 and SC-002 (partial)
- [x] T048 Load the atomically activated local asset manifest in the normal local application path, while retaining explicit unavailable and rollback behavior, per US4/AC1 and FR-027 (partial)
- [x] T049 After fresh explicit reclaim confirmation, generate and terminally account for the full original corpus while preserving `tiles/` per FR-001, FR-015, FR-016, and SC-010 (missing)
- [x] T052 Split new migration and B3DM modules into coherent sub-400-line responsibilities without changing behavior per plan module boundaries and Constitution VII (partial)
- [x] T053 Re-run every focused, browser, lint, format, build, artifact, task-checkmark, and SpecKit convergence gate after T046-T052, appending further work if any gap remains per T045 (77 focused Node tests, 18 six-project browser tests, lint, format, build, diff, ignored-artifact, and final convergence audit pass)
- [x] T054 Restore or formally exclude the exact 52 inaccessible authoritative source contents recorded as official 403 failures and omitted by the immutable release tileset, including `tiles/5/13/19_3.b3dm`, while retaining descendants; then rerun no-write preflight before any reclaim per FR-001 and FR-025 (contradicts)
- [x] T055 Establish sufficient local working capacity for the full background candidate after APFS released only 4.77 GB from the 119.86 GB allocated deleted tree, without deleting `tiles/` or the validated overlay catalogue, per FR-014 and SC-006 (missing)

## Terminal convergence record

- Full background: 24,592 processed/resumed tiles plus 52 hash-bound formal exclusions; 0 failures; geometry and identity verified for every processed tile.
- Overlay catalogue: 199 active building identities exactly once, 199 logical fragments, 125 shared full-quality assets, 0 unresolved; sparse hierarchy v2 matches known-rendering LOD-family attachment depths at all five target areas.
- Unique runtime payload: 122,210,789,506-byte retained full-quality-source proxy versus 5,899,945,240-byte candidate, a 95.17% reduction. The proxy is explicitly not represented as a fresh measurement of the deleted legacy runtime.
- Automated convergence: 77 focused Node tests, 18 Playwright tests across desktop/mobile Chromium, WebKit, and Firefox, lint, format, build, and `git diff --check` pass; all new focused modules are below 400 lines. Future scene failures now persist a structured blocked report without retrying or fabricating captures.
- Owner waiver: the only real visual/performance attempts occurred before the sparse-overlay-v2 selection fix and stopped at overlay 0/0. Five-scene human review and the 50-run runtime sample were explicitly removed as local completion gates; their tooling and historical blocked reports remain advisory and are not represented as passes.
- Safety boundary: `tiles/` and `public/poi-tiles/` remain present, `optimized-tiles/` remains intentionally unavailable, and no deployment, commit, push, pull request, or other publication action occurred.
