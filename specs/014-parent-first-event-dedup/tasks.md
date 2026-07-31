# Tasks: Parent-First Event Deduplication

## Phase 1: Setup

- [x] T001 Confirm the active feature, `develop` branch, clean Spec Kit checklist, and existing dirty-worktree boundaries in specs/014-parent-first-event-dedup/tasks.md

## Phase 2: Foundational

- [x] T002 Add parent-summary and Singapore schedule-normalization test fixtures in tests/event-activity-projection.test.mjs
- [x] T003 Add snapshot-repair staging, rollback, and idempotency fixtures in tests/approved-snapshot.test.mjs

## Phase 3: User Story 1 — See Each Activity Once

**Goal**: Merge compatible source parents before projecting their sessions and offers.

**Independent Test**: Broad SISTIC ranges, expanded Catch.sg sessions, equivalent Singapore dates, and duplicate Fever surfaces project as one activity without losing sessions or offers.

- [x] T004 [US1] Add failing broad-range, timezone-equivalent, and same-product grouping tests in tests/event-activity-projection.test.mjs
- [x] T005 [US1] Implement normalized source-parent summaries and bounded candidate generation in scripts/lib/event-pipeline/activity-projection.mjs
- [x] T006 [US1] Union accepted parent groups before session, venue-group, and source-offer projection in scripts/lib/event-pipeline/activity-projection.mjs
- [x] T007 [US1] Emit deterministic parent grouping decisions, counts, and logs from scripts/lib/event-pipeline/activity-projection.mjs

## Phase 4: User Story 2 — Preserve Genuine Distinctions

**Goal**: Prevent unsafe merges and isolate strong matches with conflicting evidence.

**Independent Test**: Generic titles remain separate, edition/organizer conflicts remain separate, and conflicting approved venues generate review evidence.

- [x] T008 [US2] Add failing generic-title, conflicting-edition, conflicting-organizer, and venue-conflict tests in tests/event-activity-projection.test.mjs
- [x] T009 [US2] Implement parent conflict classification and grouping reviews in scripts/lib/event-pipeline/activity-projection.mjs
- [x] T010 [US2] Extend projection validation for parent membership, decisions, reviews, sessions, venues, and offers in scripts/lib/event-pipeline/activity-projection.mjs

## Phase 5: User Story 3 — Repair Approved Listings Safely

**Goal**: Reproject the active approved snapshot without source collection and activate only after validation.

**Independent Test**: Repair stages a new immutable snapshot, preserves the prior snapshot, reports before/after counts, and leaves the pointer unchanged on failure.

- [x] T011 [US3] Add `--repair-parent-dedup` staging and activation behavior to scripts/migrate-approved-snapshot-to-activities.mjs
- [x] T012 [US3] Add deterministic repair audit output and no-op/idempotency handling to scripts/migrate-approved-snapshot-to-activities.mjs
- [x] T013 [US3] Complete repair regression coverage in tests/approved-snapshot.test.mjs

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T014 Run focused event projection, deduplication, and approved-snapshot tests documented in specs/014-parent-first-event-dedup/quickstart.md
- [x] T015 Stage the active snapshot repair, audit duplicate and review counts, then activate the verified immutable snapshot using scripts/migrate-approved-snapshot-to-activities.mjs
- [x] T016 Run relevant event pipeline regression tests and production build, recording results in specs/014-parent-first-event-dedup/quickstart.md

## Dependencies

```text
T001
  └─ T002–T003
       ├─ T004 → T005 → T006 → T007
       ├─ T008 → T009 → T010
       └─ T011 → T012 → T013
                    └─ T014 → T015 → T016
```

## Parallel Opportunities

- T002 and T003 touch different test files and may proceed independently.
- After foundational fixtures, US1 and US3 implementation touch different files, but T015 waits for all grouping behavior.
- Validation commands in T014 are independent but their results must all pass before T015.

## Implementation Strategy

1. Deliver US1 first with focused failing tests and a pure parent-grouping implementation.
2. Add US2 safety boundaries before applying the feature to real approved data.
3. Add US3 repair mode and prove rollback/idempotency.
4. Stage, inspect, and only then activate the repaired snapshot.
