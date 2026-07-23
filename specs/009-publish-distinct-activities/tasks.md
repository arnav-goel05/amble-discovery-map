# Tasks: Publish Distinct Activities

**Input**: Design documents from `/specs/009-publish-distinct-activities/`

**Branch**: `develop`

**Tests**: Contract, failure, rollback, UI, browser, build, and performance validation are required.

## Phase 1: Setup

- [X] T001 Confirm the active feature artifacts and accepted cutover decisions in specs/009-publish-distinct-activities/
- [X] T002 Capture the occurrence-based artifact and browser benchmark baseline in specs/009-publish-distinct-activities/validation.md

## Phase 2: Foundational Contract

- [X] T003 [P] Add failing public activity projection and redaction tests in tests/event-activity-publication.test.mjs
- [X] T004 [P] Add failing immutable activity-reference and rollback tests in tests/approved-snapshot.test.mjs
- [X] T005 Implement compact activity, venue-group, session, offer, and landmark-reference projection in scripts/lib/public-event-catalogue.cjs
- [X] T006 Implement activitiesRef manifest validation, hashing, staging, loading, and asset resolution in scripts/lib/approved-snapshot.mjs and scripts/lib/contracts/baseline-contracts.mjs

## Phase 3: User Story 1 - Load distinct activities (P1)

**Goal**: Publish and load each accepted activity exactly once.

**Independent Test**: A candidate snapshot exposes activitiesRef, no eventsRef, no embedded landmark events, and reconciles all compact sessions.

- [X] T007 [US1] Stage approved-activities.json and landmark activity references from the existing activity projection in scripts/event-frontend-snapshot.mjs
- [X] T008 [US1] Expose activitiesRef and projected activity assets through scripts/approved-snapshot-api-plugin.cjs
- [X] T009 [US1] Generate and serve the activity-first Cloudflare snapshot in scripts/generate-cloudflare-snapshot.mjs and cloudflare/cloud-native-worker.mjs
- [X] T010 [US1] Load activitiesRef with explicit unsupported-schema and missing-asset failures in activity-scenes/shared/api-client.js

## Phase 4: User Story 2 - Discover and plan every session (P2)

**Goal**: Preserve search, filters, map pills, details, offers, and planning from canonical activities.

**Independent Test**: Multi-session, multi-venue, mapped, and off-map fixtures produce one discovery result per activity with correct session matches and map references.

- [X] T011 [P] [US2] Add failing canonical-activity discovery tests in tests/event-discovery-model.test.mjs
- [X] T012 [P] [US2] Add failing activity-first browser acceptance coverage in tests/event-discovery.spec.mjs
- [X] T013 [US2] Consume canonical activities and inline sessions without rebuilding occurrence records in activity-scenes/events/event-discovery-model.js
- [X] T014 [US2] Resolve landmark activity references for pills and details in activity-scenes/esplanade-performance.js and activity-scenes/landmark-event-pill.js
- [X] T015 [US2] Reconcile activity-first refreshes and map state in activity-scenes/events/event-map-reconciliation.js and main.js

## Phase 5: User Story 3 - Safe immediate cutover (P3)

**Goal**: Fail closed on old or invalid contracts and preserve the previous snapshot.

**Independent Test**: Missing/dangling references, removed eventsRef requests, and invalid geometry produce traceable failures without activation.

- [X] T016 [US3] Add reference-integrity and public-redaction validation before snapshot activation in scripts/event-frontend-snapshot.mjs
- [X] T017 [US3] Add traceable activity contract and removed occurrence contract reason codes in scripts/approved-snapshot-api-plugin.cjs and cloudflare/cloud-native-worker.mjs
- [X] T018 [US3] Update affected event-pipeline, approved-snapshot, Cloudflare, and discovery fixtures/tests under tests/

## Phase 6: Polish and Validation

- [X] T019 Run focused Node contract, snapshot, discovery, pipeline, and Cloudflare tests and fix failures
- [X] T020 Run lint and the production build and fix failures
- [X] T021 Run required desktop/mobile Chromium, WebKit, and Firefox event-discovery checks and fix regressions
- [X] T022 Record after-change transfer, object-count, memory, UI-ready, and frame-rate results in specs/009-publish-distinct-activities/validation.md
- [X] T023 Verify generated-artifact policy, atomic rollback, stale/error states, and quickstart expectations

## Dependencies

- T001-T002 precede contract changes.
- T003-T006 block publication work.
- T007-T010 complete User Story 1 and block browser migration.
- T011-T015 complete User Story 2.
- T016-T018 complete the immediate cutover.
- T019-T023 are release gates.

## Implementation Strategy

Implement the public contract and publication boundary first, migrate browser consumption second, then remove all occurrence fallback behavior and run the full focused validation matrix. No event-source recollection is required.
