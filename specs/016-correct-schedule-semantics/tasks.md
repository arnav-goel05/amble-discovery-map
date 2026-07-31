# Tasks: Correct Event Schedule Semantics

**Input**: Design documents from `/specs/016-correct-schedule-semantics/`

**Branch**: Execute on `develop`; do not create or switch branches.

## Phase 1: Foundation

- [x] T001 Add failing parser and schedule-contract tests for enumerated, structured,
      continuous, ambiguous, and malformed schedules in `tests/event-pipeline.test.mjs`
- [x] T002 Implement the pure Singapore schedule parser and strict timestamp helpers in
      `scripts/lib/event-sources/schedule-semantics.mjs`
- [x] T003 Integrate typed schedule evidence and grounded authority references in
      `scripts/event-source-collector.mjs`
- [x] T004 Correct concrete sibling-performance classification and boundary validation in
      `scripts/lib/event-sources/activity-policy.mjs` and `scripts/event-normalizer.mjs`

## Phase 2: User Story 1 - Trust Date Filters

- [x] T005 Add failing projected-venue, matched-session, malformed-boundary, and timezone
      regression tests in `tests/event-discovery-model.test.mjs`
- [x] T006 Carry projected venue-group and session membership through
      `activity-scenes/esplanade-performance.js`
- [x] T007 Implement Singapore-day filtering, strict ISO validation, projected-session
      intersection, and matched-session projection in
      `activity-scenes/events/event-discovery-model.js`

## Phase 3: User Story 2 - Preserve Authority and Precision

- [x] T008 Add failing authority-linked precision, generic-offsite suppression, and
      provenance-retention tests in `tests/event-activity-projection.test.mjs`
- [x] T009 Preserve grounded authority references and suppress redundant coarse envelopes
      in `scripts/event-normalizer.mjs` and
      `scripts/lib/event-pipeline/activity-projection.mjs`
- [x] T010 Add deterministic reason-coded schedule and reconciliation counts to pipeline
      outputs in `scripts/event-source-collector.mjs`,
      `scripts/lib/event-pipeline/activity-projection.mjs`, and
      `activity-scenes/events/event-discovery-model.js`

## Phase 4: User Story 3 - Repair Current Listings

- [x] T011 Add failing idempotence, integrity, known-event, and rollback tests in
      `tests/approved-snapshot.test.mjs`
- [x] T012 Implement local saved-evidence repair and staged activation in
      `scripts/lib/event-pipeline/schedule-semantics-repair.mjs`
- [x] T013 Expose the repair command in
      `scripts/migrate-approved-snapshot-to-activities.mjs`
- [x] T014 Stage, audit, and activate the repaired current snapshot without source
      recollection; update `data/approved-snapshot.json` only after verification

## Phase 5: Validation

- [x] T015 Run focused parser, adapter, normalization, projection, discovery, and snapshot
      tests; fix only schedule-semantic regressions
- [x] T016 Run the production build and existing relevant browser test gates
- [x] T017 Verify quickstart scenarios, generated-artifact classification, immutable
      rollback, and current snapshot referential integrity

## Dependencies & Execution Order

- T001 precedes T002-T004.
- T005 precedes T006-T007.
- T008 precedes T009-T010.
- T011 precedes T012-T014.
- T015-T017 follow all implementation tasks.
- Tests are written and observed failing before their corresponding implementation.

## Phase 6: Convergence

- [x] T018 Add reason-coded collection, reconciliation, and frontend filter diagnostic
      counts per FR-014
- [x] T019 Add an automated Singapore/UTC/Los Angeles date-filter regression per FR-018
      and SC-003
- [x] T020 Add Catch official-booking authority-reference regression coverage per FR-010
      and FR-018

## Phase 7: Convergence

- [x] T021 CRITICAL Restrict date-quality conflict checks to normalized boundaries so
      human schedule display evidence cannot hold a valid concrete performance per FR-002 and
      SC-001 (contradicts)
- [x] T022 Reconcile authority-linked date-only sessions across a generic off-map venue
      and a more specific reviewable venue without inventing a mapped approval per FR-011 and
      FR-012 (partial)
- [x] T023 Add an integration regression over collected-shape Catch and SISTIC records
      proving Memory Palace yields exactly the 26 July and 2 August 9am sessions, no 27 July
      match, and one specific venue group per FR-018 and SC-001 (partial)
