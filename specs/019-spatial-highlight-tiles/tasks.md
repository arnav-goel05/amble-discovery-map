# Tasks: Spatial Highlight Tiles

**Input**: Design documents from `/specs/019-spatial-highlight-tiles/`

**Branch**: Execute on `develop`.

## Phase 1: Setup and Baseline

- [x] T001 Confirm active approved POI, legacy combined catalogue, extraction-manifest, and optimized hierarchy counts in `specs/019-spatial-highlight-tiles/benchmark.md`
- [x] T002 Define the versioned hierarchy and builder contracts in `specs/019-spatial-highlight-tiles/contracts/`

## Phase 2: Foundational Validation

- [x] T003 [P] Add failing pure hierarchy tests for spatial pruning, direct finest fragments, shared spatial tiles, and deterministic ordering in `tests/spatial-highlight-tileset.test.mjs`
- [x] T004 [P] Extend failing combined-catalogue tests for exact approved/reachable identity parity, zero external manifests, unsafe paths, missing assets, and atomic failure in `tests/combined-poi-tileset.test.mjs`
- [x] T005 Implement source hierarchy indexing, manifest validation, stable fragment identities, bounds validation, and structured metrics in `scripts/lib/spatial-highlight-tileset.mjs`

## Phase 3: User Story 1 — Visible Finest-Detail Highlights

**Goal**: Stream only visible highlighted venue geometry at its finest available detail without per-venue manifest requests or coarse highlight requests.

**Independent Test**: A generated fixture contains one zero-error finest B3DM leaf per venue/spatial branch; the existing map layer loads it through the unchanged URL.

- [x] T006 [US1] Implement sparse source-tree pruning and independent finest-fragment branch construction in `scripts/lib/spatial-highlight-tileset.mjs`
- [x] T007 [US1] Refactor `scripts/build-combined-poi-tileset.mjs` to generate `spatial-highlight-v1` output and report bounded structural metrics
- [x] T008 [US1] Generate `public/poi-tiles/event-venues/tileset.json` from the active approved catalogue without regenerating geometry
- [x] T009 [US1] Verify the existing introduction zoom exception and normal movement policy remain unchanged with `tests/building-highlight-movement.test.mjs` and `tests/map-render-sync.spec.mjs`

## Phase 4: User Story 2 — Preserve Approved Locations

**Goal**: Keep exact stable venue parity and publish only complete, valid candidates.

**Independent Test**: Every approved venue has reachable direct geometry, no unapproved identity exists, and a deliberately invalid candidate leaves the previous output unchanged.

- [x] T010 [US2] Implement complete-candidate validation and atomic create/update/no-op publication in `scripts/build-combined-poi-tileset.mjs`
- [x] T011 [US2] Update staged event publication in `scripts/event-pipeline.mjs` to resolve extraction manifests and direct fragment paths for staged or reused assets
- [x] T012 [US2] Update immutable snapshot durable-URI rewriting in `scripts/event-frontend-snapshot.mjs` for nested direct content references
- [x] T013 [US2] Run `npm run test:poi-separation` and verify 100% active approved venue/background disjointness

## Phase 5: User Story 3 — Prove the Improvement

**Goal**: Record deterministic structural and browser evidence before handoff.

**Independent Test**: The benchmark and release gates show zero venue manifests, finest-only reachable content, exact source-fragment validation, compatible detailed rendering, and no regression.

- [x] T014 [US3] Add a reproducible legacy-versus-spatial structural benchmark test and fill structural results in `specs/019-spatial-highlight-tiles/benchmark.md`
- [x] T015 [US3] Run a same-camera-path browser benchmark and fill first-highlight/request/detailed-state results in `specs/019-spatial-highlight-tiles/benchmark.md`
- [x] T016 [US3] Run focused Node tests and the required desktop/mobile Chromium, WebKit, and Firefox map-rendering matrix
- [x] T017 [US3] Run lint, changed-file formatting, and the production build

## Phase 6: Convergence

- [x] T018 Audit specification, plan, contracts, implementation, generated artifact, tests, and benchmark using Spec Kit convergence
- [x] T019 Resolve every actionable convergence finding, rerun affected gates, and repeat convergence until no blocking issue remains
- [x] T020 Update `specs/019-spatial-highlight-tiles/quickstart.md` and mark all completed tasks with final evidence

## Phase 7: Finest-Only Revision

- [x] T021 Amend the specification, plan, research, data model, and contracts so visible venue branches select only their finest available fragment
- [x] T022 Update hierarchy generation and validation to retain spatial culling, validate all source fragments, and expose one zero-error finest leaf per venue/spatial branch
- [x] T023 Regenerate the combined tileset and verify exact approved parity, 143 finest leaves from 818 validated source fragments, and zero external manifests
- [x] T024 Verify a real Marina Bay viewport issues only finest-level highlight requests, then rerun focused tests, geometry separation, cross-browser rendering, lint, formatting, and production build

## Dependencies and Order

- T001–T002 establish the evidence and contracts.
- T003–T004 must fail before T005–T010 implement the behavior.
- T005–T010 complete the standalone builder before T011–T012 integrate publication.
- T013–T17 verify the assembled feature.
- T018–T020 complete only after the original implementation and verification tasks pass.
- T021–T024 amend the uncommitted feature contract and repeat affected verification for the user-approved finest-only policy.

## Capability and Privacy Review

- No user-facing application capability changes; direct UI, voice, and future MCP adapters continue using the existing stable POI/application contracts.
- No new query result, command executor, assistant eligibility rule, credential, external service, telemetry, or retained user data is introduced.
- Generated spatial catalogues are deployment artifacts; benchmark output is feature evidence; extraction caches and pipeline runs remain outside this task.
