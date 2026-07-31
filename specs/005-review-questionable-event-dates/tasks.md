# Tasks: Review Questionable Event Dates

**Input**: Design documents from `specs/005-review-questionable-event-dates/`

**Branch**: Execute all tasks on `develop`; do not create or switch branches unless the user explicitly requests it.

**Tests**: Required by FR-012 and the constitution. Add each behavior test before its corresponding integration change.

## Phase 1: Foundational Date Policy

**Purpose**: Complete the shared deterministic contract used by the audit command and pipeline.

- [x] T001 Add policy version, stable review identity, selectable/anytime, stale, multi-reason, and threshold-boundary tests in `tests/event-date-quality-audit.test.mjs`
- [x] T002 Implement versioned assessment, stable review item construction, and reconciled summaries in `scripts/lib/event-pipeline/date-quality-audit.mjs`
- [x] T003 Align CLI policy metadata and output with the shared review contract in `scripts/audit-event-dates.mjs`

**Checkpoint**: The pure policy produces stable plausible/review outcomes with no filesystem or network dependency.

---

## Phase 2: User Story 1 - Isolate Questionable Schedules (Priority: P1)

**Goal**: Hold otherwise-eligible questionable schedules before deduplication and venue processing.

**Independent Test**: Normalize mixed plausible and questionable fixtures and verify exact accepted/review partitions, reason codes, source accounting, and venue isolation.

### Tests for User Story 1

- [x] T004 [US1] Add failing mixed plausible/questionable normalization, artifact schema, isolation, and accounting tests in `tests/event-pipeline.test.mjs`
- [x] T005 [US1] Add failing normalization artifact validation and assessment-failure containment tests in `tests/event-pipeline.test.mjs`

### Implementation for User Story 1

- [x] T006 [US1] Partition otherwise-eligible questionable events and write `normalized/date-reviews.json` before same-source deduplication in `scripts/event-normalizer.mjs`
- [x] T007 [US1] Validate date-review schema, exclusivity, provenance, reason vocabulary, and reconciled counts when recording normalization in `scripts/event-pipeline.mjs`
- [x] T008 [US1] Register date-review artifacts and carry reconciled review summaries in normalization state in `scripts/event-pipeline.mjs`

**Checkpoint**: Questionable events are retained as held review items and never enter deduplication or venue branches.

---

## Phase 3: User Story 2 - Trace and Reconcile Date Review (Priority: P2)

**Goal**: Make date reviews reproducible, visible, and self-clearing when source evidence improves.

**Independent Test**: Reprocess unchanged, changed-questionable, and corrected evidence and verify stable IDs, current-run supersession semantics, exact terminal summaries, and dashboard counts.

### Tests for User Story 2

- [x] T009 [P] [US2] Add failing date-review reason vocabulary and terminal trace tests in `tests/event-pipeline.test.mjs`
- [x] T010 [P] [US2] Add failing dashboard date-review placement and exact-reason aggregation tests in `tests/event-dashboard-sync.test.mjs`
- [x] T011 [US2] Add failing unchanged/corrected evidence review identity and current-run reconciliation tests in `tests/event-date-quality-audit.test.mjs`

### Implementation for User Story 2

- [x] T012 [P] [US2] Extend date-review trace reason vocabulary and normalized terminal logging in `scripts/lib/event-sources/trace.mjs` and `scripts/event-pipeline.mjs`
- [x] T013 [P] [US2] Add date-review identity/source/reason summaries to operator reporting in `scripts/lib/event-pipeline/reporting.mjs`
- [x] T014 [US2] Include normalized date reviews in dashboard review outcomes and reason breakdowns in `scripts/lib/event-pipeline/dashboard-sync.mjs`

**Checkpoint**: Operators can trace every active review and corrected evidence no longer appears in the current review partition.

---

## Phase 4: Validation and Documentation

**Purpose**: Prove the integrated behavior without a complete network run.

- [x] T015 Update validation evidence and final commands in `specs/005-review-questionable-event-dates/quickstart.md`
- [x] T016 Run focused unit, normalizer integration, dashboard, and trace tests from `specs/005-review-questionable-event-dates/quickstart.md`
- [x] T017 Run focused ESLint and `git diff --check`, preserving unrelated worktree changes and leaving generated run output untracked
- [x] T018 Audit the latest completed normalized artifact with `npm run event-date-audit` and record the reproducible counts in `specs/005-review-questionable-event-dates/quickstart.md`

---

## Dependencies and Execution Order

- Foundational policy tasks T001–T003 block both user stories.
- US1 tasks T004–T008 establish the pipeline partition and run-state contract.
- US2 tests T009–T011 follow US1; reporting implementations T012–T014 can proceed independently after their tests.
- Validation tasks T015–T018 depend on both stories.

## Parallel Opportunities

- T009 and T010 test independent trace and dashboard boundaries.
- T012 and T013 modify independent trace and reporting owners.

## Implementation Strategy

1. Complete the pure policy and prove deterministic boundaries.
2. Deliver US1 as the MVP: questionable identities are safely held.
3. Add US2 observability and corrected-evidence reconciliation.
4. Run only focused synthetic and existing-artifact validation; do not recollect sources.

## Phase 5: Convergence

- [x] T019 Prefer schedule-specific evidence when deriving stable date-review identity and add changed-schedule regression coverage in `scripts/lib/event-pipeline/date-quality-audit.mjs` and `tests/event-date-quality-audit.test.mjs` per FR-006/FR-007 (partial)
- [x] T020 Isolate unexpected per-record date-assessment failures as `date_assessment_failed` held reviews with regression coverage in `scripts/event-normalizer.mjs`, `scripts/lib/event-pipeline/date-quality-audit.mjs`, and `tests/event-pipeline.test.mjs` per US1 edge case/FR-008 (missing)
