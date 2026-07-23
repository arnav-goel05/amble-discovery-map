# Tasks: Retire Honeycombers and ArtsEquator

**Input**: Design documents from `/specs/007-retire-editorial-sources/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Branch**: Execute feature tasks on `develop`; do not create or switch branches unless the user explicitly requests it.

**Tests**: Relevant automated tests and production builds are required. Historical snapshots and completed earlier specs must remain unchanged.

## Phase 1: Regression Harness

**Purpose**: Establish failing proof for retirement and lifecycle behavior before implementation.

- [x] T001 [P] [US1] Add supported-source enumeration assertions excluding both retired adapters/providers in `tests/event-source-contract.test.mjs` and `tests/event-pipeline.test.mjs`
- [x] T002 [P] [US1] Add retired-only, mixed-source, unrelated-source, and retirement-trace reconciliation cases in `tests/event-reconciliation.test.mjs`
- [x] T003 [US1] Add orphan landmark and empty landmark/POI lifecycle coverage in `tests/event-pipeline.test.mjs`
- [x] T004 [P] [US2] Add pipeline dashboard-payload assertions excluding retired sources in `tests/event-dashboard-sync.test.mjs`
- [x] T005 [P] [US2] Add stale stored-payload sanitization and rendered-source absence checks in the Sites dashboard tests

## Phase 2: Retire Pipeline Sources

**Purpose**: Remove current and future collection/adapter surface without rewriting history.

- [x] T006 [US1] Remove Honeycombers and ArtsEquator source definitions from `data/event-pipeline-config.json` and provider entries from `data/provider-policy.json`
- [x] T007 [US1] Remove their adapter imports/exports from `scripts/lib/event-sources/index.mjs` and delete `scripts/lib/event-sources/honeycombers.mjs` and `scripts/lib/event-sources/arts-equator.mjs`
- [x] T008 [US1] Remove source-specific field-validation samples and fixtures while converting still-relevant editorial behavior tests to supported generic/Time Out coverage
- [x] T009 [US3] Update current source documentation in `skills/event-pipeline-runner/references/source-adapters.md` and `pull_data.md`, preserving `data/snapshots/**` and completed earlier specs unchanged

## Phase 3: Safe Current-State Reconciliation

**Purpose**: Ensure current publication loses retired contributions without silent data loss elsewhere.

- [x] T010 [US1] Implement generic absent-source contribution filtering and `source_retired` traces in `scripts/reconcile-event-content.mjs`
- [x] T011 [US1] Apply reconciled current events to every landmark before venue updates and lifecycle pruning in `scripts/event-frontend-snapshot.mjs`
- [x] T012 [US1] Add structured retirement counts/logging to the staged frontend plan and existing event-pipeline reporting surface

## Phase 4: Current Dashboard Only

**Purpose**: Remove retired sources from generated and previously stored dashboard views.

- [x] T013 [US2] Remove retired source identifiers from `scripts/lib/event-pipeline/dashboard-sync.mjs` and ensure generated totals derive only from current status sources
- [x] T014 [US2] Remove retired fallback rows and sanitize dashboard API GET/PUT payloads against the six-source allowlist in the Sites application
- [x] T015 [US2] Preserve the viewport-fitted dashboard layout while updating source-count copy and current-source tests

## Phase 5: Verification and Publication

**Purpose**: Prove retirement is complete and publish one clean current state.

- [x] T016 Run focused pipeline/source/reconciliation/dashboard tests and both production builds; fix all retirement-related failures
- [x] T017 Run the offline `event-sources:retire` migration without collection, verify the new immutable current artifacts contain zero retired-source references, and confirm supported identities and atomic publication invariants
- [x] T018 Publish the existing Sites dashboard project and verify the public dashboard contains only the remaining sources and correct post-retirement totals
- [x] T019 Run Spec Kit convergence, append any discovered gaps, implement them, and repeat until converged

## Dependencies & Execution Order

- Phase 1 precedes implementation and supplies the regression contract.
- Phase 2 and the reconciliation implementation in Phase 3 must both complete before the offline migration.
- Phase 4 may be implemented after its tests and before the offline migration; stale payload filtering makes the public dashboard safe immediately.
- T017 requires all local tests/builds in T016 to pass.
- T018 requires a verified offline migration and successful Sites build.
- T019 is last and may create a new convergence phase only when a real gap remains.

## Implementation Strategy

Use one offline six-source snapshot retirement and do not recollect external data. Keep removal generic by treating current configuration/status as the supported-source authority, preserve original freshness metadata, and preserve immutable historical artifacts exactly as they are.

## Phase 6: Convergence

- [x] T020 Preserve unrelated POI-only identities by removing only POIs and tileset children whose landmarks became empty per FR-007 and SC-003 (partial)
- [x] T021 Execute stale dashboard payload filtering in a behavioral unit test per US2/AC2 and T005 (partial)
