# Implementation Plan: Local Background-Lite Migration

**Branch**: `develop` | **Date**: 2026-08-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/025-local-background-lite/spec.md`

## Summary

Preserve `tiles/` as the one authoritative original building corpus and replace the two current derived runtime trees with a stable lightweight nationwide background plus an automatically reconciled full-quality overlay catalogue for active highlighted identities. Reclaim local capacity by deleting the replaceable `optimized-tiles/` only after a fresh exact-target preflight and confirmation; temporary local application breakage is an accepted migration state. Build the lightweight background in resumable verified batches, derive overlays from approved identity evidence without rebuilding the background, switch the local renderer to 30% background plus 100% overlays, validate the supported automated browser matrix and combined payload, and retire legacy `public/poi-tiles/` only after identity, renderer-contract, payload, and rollback evidence pass. No remote or production action is included.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 24+; browser JavaScript

**Primary Dependencies**: Existing Sharp 0.32, glTF Transform 3.x, deck.gl/mapbox `Tile3DLayer` 8.5, loaders.gl 3D Tiles, Playwright 1.61; Node built-ins for orchestration, hashing, atomic filesystem work, and capacity checks

**Storage**: Local filesystem only: `tiles/` authoritative source; ignored versioned run directories under a configurable destination; generated `background-lite/`, `highlight-overlays/`, manifests, checkpoints, reports, and screenshots

**Testing**: Node test runner; focused B3DM identity/geometry tests; extraction and reconciliation contract tests; failure/resume/capacity/destructive-gate tests; Playwright desktop/mobile Chromium, WebKit, and Firefox; lint, formatting, build, and diff checks

**Target Platform**: Local macOS development and the existing desktop/mobile web renderer; no remote platform or production target in this feature

**Project Type**: Static web application with deterministic local Node asset-generation commands

**Performance Goals**: At least 40% combined background-plus-active-overlay payload reduction versus the current runtime asset set; bounded configurable concurrency; no verified-tile reprocessing on resume; highlight-set changes rewrite zero background tiles

**Constraints**: Preserve `tiles/` byte-for-byte; initially only about 1 GB was free; `optimized-tiles/` is approximately 119.8 GB and may be deleted to fund generation; local app may be intentionally broken during migration; all destructive targets must be explicit and confirmed; no network, deployment, commit, push, or release; exact geometry and identity preservation; new focused modules should remain below 400 lines

**Scale/Scope**: Approximately 24,592 original B3DM tiles and 120.2 GB; current derived background approximately 119.8 GB; current legacy POI tree approximately 9.3 GB; currently approved highlight paths and identities are recalculated from the active snapshot

## Constitution Check

- **Branch workflow — PASS**: Actual work remains on `develop`. SpecKit's directory label does not create or select a feature branch.
- **Evidence — PASS**: `tiles/` is authoritative source evidence. Highlight membership comes only from the active approved snapshot and extraction/identity evidence. Missing or contradictory identity is `review` or failure, never inference.
- **Automation — PASS**: Deterministic commands own preflight, deletion inventory, transformation, extraction, checkpointing, reconciliation, switching, validation, and reporting. Human involvement is limited to explicit destructive confirmation.
- **Identity and publication — PASS**: Canonical source path plus building identity remains stable. Overlay reconciliation defines create, update, no-op, expire, and review. Candidate catalogues and switch manifests are atomic. There is no publication; failures leave the migration incomplete and preserve `tiles/`.
- **Boundaries — PASS**: Background transformation, overlay extraction/reconciliation, migration/destruction, renderer consumption, and validation are separate focused owners. Manifests use explicit schema versions and boundary validation.
- **Shared capabilities — PASS**: No public command/query capability changes. Map rendering consumes a new local asset contract while stable POI/event identities remain authoritative. Direct and conversational application behavior is unchanged.
- **Conversational feedback — PASS**: No conversational capability changes; therefore no new dialogue matrix is required.
- **Quality and security — PASS**: Tests cover success, no-op, interruption, corrupt checkpoints, path normalization, extraction parity, ambiguous textures, insufficient capacity, exact destructive targeting, missing assets, and rollback. No secrets, accounts, network requests, or quota-limited checks are introduced.
- **UX and performance — PASS**: The renderer change requires the six-project desktop/mobile browser matrix, exact-once overlay reachability, payload measurement, opacity/depth contracts, and explicit missing/incomplete states. Human visual review and repeated runtime benchmarking are retained as advisory diagnostics by owner waiver.
- **Operations and privacy — PASS**: All work is local, ignored, and contains no personal data or telemetry. Generated runs are disposable. `tiles/` remains durable source; old derived assets are deleted only through recorded gates.

The check passes before research and remains satisfied after Phase 1 design. No constitutional exception is required.

## Project Structure

### Documentation

```text
specs/025-local-background-lite/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── local-background-lite-cli.md
│   ├── manifests.md
│   └── renderer-assets.md
└── checklists/
    └── requirements.md
```

### Source Code

```text
scripts/
├── local-background-lite.mjs          # thin command dispatcher
├── render-background-lite-mixed.mjs   # distinct-area visual validator
└── lib/
    ├── background-lite-b3dm.mjs       # texture-only transformation/integrity
    ├── background-lite-run.mjs        # inventory, batching, resume, report
    ├── highlight-overlay-build.mjs     # original-source identity extraction
    ├── highlight-overlay-reconcile.mjs # create/update/no-op/expire/review
    └── local-asset-migration.mjs       # exact deletion/switch gates

map-layers/
└── building-highlight-layers.js       # stable background + overlay renderer

tests/
├── background-lite-b3dm.test.mjs
├── background-lite-run.test.mjs
├── highlight-overlay-build.test.mjs
├── highlight-overlay-reconcile.test.mjs
├── local-asset-migration.test.mjs
├── building-highlight-movement.test.mjs
└── background-lite-local.spec.mjs

tiles/                                 # preserved authoritative source
<configured-local-output>/
├── background-lite/
├── highlight-overlays/
├── checkpoints/
├── manifests/
└── reports/
```

**Structure Decision**: Keep the existing single web application and Node tooling. Extend the existing B3DM library, but separate high-volume run orchestration, overlay generation, reconciliation, and destructive migration into focused modules. The browser remains a thin consumer of validated background and overlay catalogue URLs.

## Design

### Phase A — Preflight and space reclamation

1. Inventory and hash `tiles/`, validate `tiles/tileset.json`, and prove every referenced source exists.
2. Resolve active highlight identities against original source tiles and record any ambiguity before deletion.
3. Inventory exact absolute paths, byte counts, and recoverability of `optimized-tiles/` and `public/poi-tiles/`.
4. Produce a no-write preflight report with expected reclaimed space, output estimate, reserve, and migration state.
5. Require a fresh explicit confirmation naming `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/optimized-tiles` immediately before deletion.
6. Delete only that resolved derived directory and record actual reclaimed capacity. Leave `tiles/` and `public/poi-tiles/` untouched. Mark the local app `intentionally-unavailable`.

### Phase B — Stable background generation

1. Traverse the original tileset once and assign canonical paths and source hashes.
2. Transform every supported source tile with the approved 128px colour-preserving policy, regardless of highlight membership.
3. Preserve alpha-capable base-colour evidence and all supported non-colour maps; exclude ambiguous semantics.
4. Validate identity, feature/batch tables, triangle/vertex counts, Draco contract, and retained buffer hashes before atomic output.
5. Commit bounded checkpoints after verified output; resume only exact identity matches.
6. Assemble an isomorphic lightweight tileset and complete only with full terminal accounting.

### Phase C — Automatic highlight overlays

1. Read active highlighted identities from the approved snapshot and normalize their source references.
2. Reuse the existing reviewed geometry-filtering concepts to extract only selected building identities from `tiles/` at original texture quality.
3. Deduplicate shared building geometry across venue owners and build one sparse spatial overlay catalogue.
4. Reconcile create/update/no-op/expire/review without touching background outputs.
5. Prove every active identity is present exactly once and every overlay is source-traceable.

### Phase D — Renderer migration

1. Add an explicit local asset manifest that points to the complete background-lite and overlay catalogues; do not infer partial directories.
2. Render background at 30% opacity and overlays at 100% opacity.
3. Render background first and apply a narrowly scoped overlay depth bias/depth function so coincident full-quality geometry wins without flicker; keep this renderer treatment behind tests rather than mutating geometry.
4. Superseding movement amendment: hide both 3D layers and pause traversal during camera movement; after movement, show both layers and progressively render ready destination tiles while refining the background at SSE `8` and highlights at SSE `4`, then freeze traversal after the complete selection remains stable for `300 ms`.
5. Highlight catalogue changes reload only the overlay layer; background URL and hashes remain unchanged.

### Phase E — Validation and legacy retirement

1. Run unit, contract, lifecycle, resume, capacity, and destructive-gate tests.
2. Run the supported desktop/mobile browser matrix and record immutable automated evidence for local manifest loading, opacity, depth preference, exact-once highlights, and missing/incomplete states.
3. Reconcile unique background-plus-overlay payload and require at least 40% reduction. Optional visual and runtime diagnostics remain advisory and must never be represented as completed when absent.
4. Switch the local app only after candidate manifests and validation pass; retain an exact rollback manifest.
5. Require a second explicit confirmation before deleting `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/public/poi-tiles`.
6. Delete legacy POI assets only after overlay identity parity, source provenance, automated renderer-contract parity, payload acceptance, and rollback readiness are all true.

## Complexity Tracking

No constitution violation is required. The temporary local outage and two explicit destructive gates are intentional migration states authorized by the owner, not publication shortcuts. Separate background and overlay outputs are necessary because one source tile can contain shared geometry/textures while the renderer requires different quality and opacity for active highlights.
