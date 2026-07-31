# Tasks: Group Event Activities

**Input**: Design documents from `/specs/006-group-event-activities/`

**Branch**: Execute feature tasks on `develop`; do not create or switch branches.

**Tests**: Relevant automated tests and production builds are required.

## Phase 1: Setup

- [x] T001 Verify the active feature artifacts and clean `develop` baseline in specs/006-group-event-activities/ and .specify/feature.json
- [x] T002 Define fixture builders for activity, occurrence, venue-group, offer, and conflict cases in tests/event-activity-projection.test.mjs

## Phase 2: Foundational Contracts

- [x] T003 Add source parent identity preservation through occurrence deduplication in scripts/event-normalizer.mjs and scripts/lib/event-sources/deduplicate.mjs
- [x] T004 Implement stable, input-order-independent activity/session/venue-group/offer identities and schema validation in scripts/lib/event-pipeline/activity-projection.mjs
- [x] T005 Add structured grouping decisions, direct-conflict reviews, count reconciliation, and trace-safe diagnostics in scripts/lib/event-pipeline/activity-projection.mjs

## Phase 3: User Story 1 - Discover Each Activity Once (P1)

**Independent Test**: Repeated and multi-source session fixtures yield one expected activity while materially different items remain separate.

- [x] T006 [US1] Add failing grouping, safe bridge, false-positive, deterministic-order, and review-isolation tests in tests/event-activity-projection.test.mjs
- [x] T007 [US1] Write activities and grouping-review artifacts during normalization in scripts/event-normalizer.mjs
- [x] T008 [US1] Add stored-run reprojection without network access in scripts/project-event-activities.mjs and package.json
- [x] T009 [US1] Add failing activity-first filter, search, date, venue, placement, and deduplicated-result tests in tests/event-discovery-model.test.mjs
- [x] T010 [US1] Make discovery activity-first while retaining occurrence-level matching and representative map selection in activity-scenes/events/event-discovery-model.js
- [x] T011 [US1] Preserve grouped activity result data through pill-layer search selection in activity-scenes/landmark-event-pill.js and activity-scenes/esplanade-performance.js

## Phase 4: User Story 2 - Choose Venue and Session (P1)

**Independent Test**: One activity detail exposes chronologically ordered sessions under distinct venue groups and keeps exact plan identity.

- [x] T012 [US2] Add failing single/multi-venue, large-session, flexible-schedule, keyboard, and plan-selection tests in tests/event-ui.spec.mjs
- [x] T013 [US2] Render activity summaries, venue groups, session selectors, and explicit empty states in activity-scenes/landmark-event-panel.js
- [x] T014 [US2] Route grouped search selections and mapped landmark selections into the activity detail model in activity-scenes/esplanade-performance.js
- [x] T015 [US2] Add responsive, accessible activity/session/venue styles without continuous work in style.css

## Phase 5: User Story 3 - Use Trusted Event and Ticket Links (P2)

**Independent Test**: Activity- and session-scoped source offers are labelled, deduplicated, safe, and only shown for applicable sessions.

- [x] T016 [US3] Add failing source-offer scope, canonical URL, missing-link, and unsafe-link tests in tests/event-activity-projection.test.mjs and tests/event-ui.spec.mjs
- [x] T017 [US3] Project provenance-backed activity/session offers in scripts/lib/event-pipeline/activity-projection.mjs
- [x] T018 [US3] Render selected-session and activity-level source offers in activity-scenes/landmark-event-panel.js

## Phase 6: User Story 4 - Inspect Accurate Pipeline Counts (P2)

**Independent Test**: Stored-run and dashboard payload counts distinguish activities, occurrences, sessions, venue groups, offers, and reviews and reconcile exactly.

- [x] T019 [US4] Add failing activity metric and compatibility tests in tests/event-dashboard-sync.test.mjs and tests/event-pipeline.test.mjs
- [x] T020 [US4] Integrate activity metrics and artifact reads into scripts/lib/event-pipeline/dashboard-sync.mjs, scripts/lib/event-pipeline/reporting.mjs, and scripts/event-pipeline.mjs
- [x] T021 [US4] Update the existing Sites dashboard activity/session metrics and hierarchy explanation in app/page.tsx and app/globals.css
- [x] T022 [US4] Update Sites rendered-output tests in tests/rendered-html.test.mjs

## Phase 7: Validation and Publication

- [x] T023 Run focused activity projection, discovery, UI, dashboard, pipeline, publication, and lifecycle tests; fix regressions in affected files
- [x] T024 Reproject the stored completed run, record reconciled counts and performance in specs/006-group-event-activities/quickstart.md, and verify no collection artifacts or active snapshot pointer changed
- [x] T025 Run the main production build and the Sites build/test suite; fix failures in affected files
- [x] T026 Deploy the validated Sites dashboard through the existing Sites project and confirm the deployment succeeds
- [x] T027 Re-run Spec Kit convergence, append and implement any remaining traceable gaps, then converge cleanly in specs/006-group-event-activities/tasks.md

## Dependencies & Execution Order

- Phase 2 depends on Phase 1 and blocks all stories.
- User Story 1 establishes the projection and activity-first discovery contract.
- User Story 2 depends on the activity result shape from User Story 1.
- User Story 3 depends on the projection and detail panel but remains independently testable with fixtures.
- User Story 4 depends on projection counts and can be tested without the public UI.
- Validation and publication follow all user stories.

## Parallel Opportunities

- Projection fixtures and dashboard fixtures affect separate files after the foundational contract is stable.
- Public UI tests and Sites dashboard tests are independent.
- Main application tests and Sites builds can run independently once implementation is complete.

## Implementation Strategy

Deliver the pure projection first, then activity-first discovery, then detail/session/source-offer UI, then operational metrics and Sites. Preserve occurrence-level pipeline stages throughout and validate against stored data without source collection.

## Phase 8: Convergence

- [x] T028 Embed and validate the activity projection in the immutable approved event catalogue per FR-012 (partial)
- [x] T029 Add a concise initial session set and accessible reveal control to grouped activity details per US2/AC3 (missing)
- [x] T030 Classify deterministic create, update, no-op, expire, and review actions for activities, sessions, venue groups, and source offers per FR-009 (partial)
- [x] T031 Emit structured parent-selection, membership, reconciliation-action, review, and count-reconciliation decisions per FR-016 (partial)
