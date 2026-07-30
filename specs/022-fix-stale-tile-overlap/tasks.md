# Tasks: Eliminate Stale Highlight Overlap

**Input**: Design documents from `/specs/022-fix-stale-tile-overlap/`

**Branch**: Execute on `develop`.

## Phase 1: Setup

- [X] T001 Create the versioned audit and release contracts in `specs/022-fix-stale-tile-overlap/contracts/`
- [X] T002 Document the operator audit, synchronization, recovery, and cache-version workflow in `specs/022-fix-stale-tile-overlap/quickstart.md`

## Phase 2: Foundational

- [X] T003 Write failing enumeration, B3DM identity parsing, classification, shared-owner, and deterministic release-ID tests in `tests/background-geometry-release.test.mjs`
- [X] T004 Implement active snapshot/extraction-manifest enumeration and validated B3DM inspection in `scripts/lib/background-geometry-release.mjs`
- [X] T005 Implement exhaustive audit result aggregation and versioned tileset rewriting in `scripts/lib/background-geometry-release.mjs`

## Phase 3: User Story 1 - See One Stable Venue Surface (P1)

**Goal**: No active selected GML identity is present in served background geometry.

**Independent Test**: Exhaustively audit every active object and verify National Stadium and all
other venues have zero retained identities at all detail levels.

- [X] T006 [US1] Add National Stadium and multi-level overlap regression fixtures to `tests/background-geometry-release.test.mjs`
- [X] T007 [US1] Add the production-origin exhaustive audit mode and structured report output in `scripts/sync-r2-background-tiles.mjs`
- [X] T008 [US1] Verify local enumeration accounts for all active POIs and objects with no parsing failures

## Phase 4: User Story 2 - Publish a Coherent Geometry Release (P1)

**Goal**: Synchronize and activate background geometry only after full remote parity.

**Independent Test**: Simulate stale, interrupted, resumed, failed, and no-op synchronization and
verify the manifest/release descriptor cannot be published early.

- [X] T009 [US2] Write failing upload failure, bounded retry, resume, manifest-last, and no-op tests in `tests/background-geometry-release.test.mjs`
- [X] T010 [US2] Implement the injected Wrangler upload adapter, bounded concurrency/retries, post-upload verification, and manifest-last gate in `scripts/sync-r2-background-tiles.mjs`
- [X] T011 [US2] Add and validate `data/background-geometry-release.json`, consume its tileset URL in `main.js`, and expose npm audit/sync commands in `package.json`
- [X] T012 [US2] Synchronize the stale production R2 objects, verify them, publish the digest-versioned manifest, and deploy the activated release

## Phase 5: User Story 3 - Audit All Active Geometry (P2)

**Goal**: Produce an exhaustive bounded report with exact object, identity, venue, and failure totals.

**Independent Test**: Audit the production origin and reconcile summary totals against every
per-object outcome.

- [X] T013 [US3] Add report-total reconciliation and malformed/unavailable remote-object tests in `tests/background-geometry-release.test.mjs`
- [X] T014 [US3] Run the post-deployment production audit until it reports 0 stale objects, 0 retained identities, 0 affected venues, and 0 failures

## Phase 6: Polish and Cross-Cutting Validation

- [X] T015 Run targeted unit tests, repository verification/build gates, and supported browser checks; fix every related failure
- [X] T016 Run `speckit-converge`, close all discovered gaps, restore the prior Spec Kit feature pointer, and commit only feature-owned files on `develop`

## Phase 7: Convergence

- [X] T017 Extract background evidence enumeration and B3DM parsing from `scripts/lib/background-geometry-release.mjs` into a focused module so each new module remains below 400 lines per Constitution VII (partial)

## Dependencies and Execution Order

- T001-T002 are complete before implementation.
- T003 must fail before T004-T005.
- T004-T005 block all story work.
- T006-T008 establish exhaustive detection before synchronization.
- T009 must fail before T010-T011.
- T010-T011 block the external write in T012.
- T012 blocks the final audit T014.
- T013 may run after T005 and before T014.
- T015-T016 run only after the production report reaches zero.

## Implementation Strategy

Use test-driven increments: enumeration and parsing, then audit classification, then safe
synchronization, then application activation. Rerun the same production audit after every repair;
do not stop while any stale object, retained identity, affected venue, or request failure remains.
