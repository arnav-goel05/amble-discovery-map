# Tasks: Eliminate Stale Highlight Overlap

**Input**: Design documents from `/specs/022-fix-stale-tile-overlap/`

**Branch**: Execute on `develop`.

## Phase 1: Setup

- [x] T001 Create the versioned audit and release contracts in `specs/022-fix-stale-tile-overlap/contracts/`
- [x] T002 Document the operator audit, synchronization, recovery, and cache-version workflow in `specs/022-fix-stale-tile-overlap/quickstart.md`

## Phase 2: Foundational

- [x] T003 Write failing enumeration, B3DM identity parsing, classification, shared-owner, and deterministic release-ID tests in `tests/background-geometry-release.test.mjs`
- [x] T004 Implement active snapshot/extraction-manifest enumeration and validated B3DM inspection in `scripts/lib/background-geometry-release.mjs`
- [x] T005 Implement exhaustive audit result aggregation and versioned tileset rewriting in `scripts/lib/background-geometry-release.mjs`

## Phase 3: User Story 1 - See One Stable Venue Surface (P1)

**Goal**: No active selected GML identity is present in served background geometry.

**Independent Test**: Exhaustively audit every active object and verify National Stadium and all
other venues have zero retained identities at all detail levels.

- [x] T006 [US1] Add National Stadium and multi-level overlap regression fixtures to `tests/background-geometry-release.test.mjs`
- [x] T007 [US1] Add the production-origin exhaustive audit mode and structured report output in `scripts/sync-r2-background-tiles.mjs`
- [x] T008 [US1] Verify local enumeration accounts for all active POIs and objects with no parsing failures

## Phase 4: User Story 2 - Publish a Coherent Geometry Release (P1)

**Goal**: Synchronize and activate background geometry only after full remote parity.

**Independent Test**: Simulate stale, interrupted, resumed, failed, and no-op synchronization and
verify the manifest/release descriptor cannot be published early.

- [x] T009 [US2] Write failing upload failure, bounded retry, resume, manifest-last, and no-op tests in `tests/background-geometry-release.test.mjs`
- [x] T010 [US2] Implement the injected Wrangler upload adapter, bounded concurrency/retries, post-upload verification, and manifest-last gate in `scripts/sync-r2-background-tiles.mjs`
- [x] T011 [US2] Add and validate `data/background-geometry-release.json`, consume its tileset URL in `main.js`, and expose npm audit/sync commands in `package.json`
- [x] T012 [US2] Synchronize the stale production R2 objects, verify them, publish the digest-versioned manifest, and deploy the activated release

## Phase 5: User Story 3 - Audit All Active Geometry (P2)

**Goal**: Produce an exhaustive bounded report with exact object, identity, venue, and failure totals.

**Independent Test**: Audit the production origin and reconcile summary totals against every
per-object outcome.

- [x] T013 [US3] Add report-total reconciliation and malformed/unavailable remote-object tests in `tests/background-geometry-release.test.mjs`
- [x] T014 [US3] Run the post-deployment production audit until it reports 0 stale objects, 0 retained identities, 0 affected venues, and 0 failures

## Phase 6: Polish and Cross-Cutting Validation

- [x] T015 Run targeted unit tests, repository verification/build gates, and supported browser checks; fix every related failure
- [x] T016 Run `speckit-converge`, close all discovered gaps, restore the prior Spec Kit feature pointer, and commit only feature-owned files on `develop`

## Phase 7: Convergence

- [x] T017 Extract background evidence enumeration and B3DM parsing from `scripts/lib/background-geometry-release.mjs` into a focused module so each new module remains below 400 lines per Constitution VII (partial)

## Phase 8: Quota-Safe Exhaustive Verification

**Goal**: Preserve byte-parity and overlap proof without exhausting visitor-facing Cloudflare
request capacity.

**Independent Test**: With counted transports, verify an unchanged complete release in one public
inventory request, detect a same-size stale object by validator, transfer only mismatches through
Wrangler, and stop a legacy diagnostic after its first `429`.

- [x] T018 [P] [US4] Add reliable-validator, same-size-stale, absent-validator, release-aware-cache, and bounded-object-detail fixtures in `tests/r2-tileset-integrity.test.mjs`
- [x] T019 [P] [US4] Add one-request inventory comparison and rate-limit-stop fixtures in `tests/tileset-integrity.test.mjs`
- [x] T020 [US4] Extend the isolated R2 inventory contract with release-aware cache keys, stored-validator verification, and bounded active-background/POI metadata in `cloudflare/r2-tileset-integrity.mjs` and `cloudflare/tile-integrity-worker.mjs`
- [x] T021 [US4] Implement reusable binding-inventory parsing and direct Wrangler mismatch retrieval/verification in `scripts/lib/r2-binding-inventory.mjs`
- [x] T022 [US4] Replace public per-object background audit and post-upload verification with inventory preflight and mismatch-only control-plane transfer in `scripts/sync-r2-background-tiles.mjs`
- [x] T023 [US4] Replace public per-object POI audit and post-upload verification with inventory preflight and mismatch-only control-plane verification in `scripts/sync-r2-poi-tiles.mjs`
- [x] T024 [US4] Wire one-request release-aware inventory verification into the exact-SHA release gate, keep it out of ordinary CI and the connected deployment build, and document the request budget in `scripts/verify-r2-tile-delivery.mjs`, `.github/workflows/release-production.yml`, and `docs/cloudflare-cloud-native.md`
- [ ] T025 Run focused unit/browser tests, exhaustive local integrity, lint, formatting, and production build; after allowance reset deploy the isolated Worker and rerun production background, highlighted, render, and R2 gates until all report zero errors

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
- T018-T019 must fail before T020-T024. T020-T021 block T022-T024. T025 runs only after every
  quota-safe implementation task is complete.

## Implementation Strategy

Use test-driven increments: enumeration and parsing, then audit classification, then safe
synchronization, then application activation. Rerun the same production audit after every repair;
do not stop while any stale object, retained identity, affected venue, or request failure remains.

## Phase 9: Convergence

- [x] T026 [US4] Make the single-request routine integrity gate compare every highlighted POI object's local byte length and MD5 with bounded R2-binding inventory metadata, and add a same-size stale-highlight regression fixture per FR-002, FR-016, and SC-008 (partial)
- [x] T027 [US4] Derive the integrity cache identity from the background release plus the complete ordered highlighted-object metadata so a changed POI publication cannot reuse an earlier report per FR-018 (partial)
- [x] T028 Align the SpecKit plan, research, data model, and quickstart on clean B3DM content URIs, manifest-level release selection, embedded expected validators, and control-plane post-upload verification so future work cannot restore the deck.gl query-string tile-type defect per FR-013 (contradicts)
- [x] T029 [US4] Add a bounded per-run verification identity to R2 inventory requests and cache keys so mutable-object preflight or post-upload checks cannot reuse stale cached evidence while preserving the one-request budget per FR-006, FR-018, and SC-008 (partial)
