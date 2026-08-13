# Feature Specification: Local Background-Lite Migration

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "Locally replace the current derived background and highlighted datasets with one stable colour-preserving lightweight background generated from the original source plus automatically generated full-quality overlays for whichever buildings are currently highlighted, without deployment."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Build a stable lightweight background (Priority: P1)

As the project owner, I want every building in the original source corpus to receive the approved lightweight background appearance so that changing the highlighted set never requires rebuilding the background.

**Why this priority**: One stable background avoids continually amending a full-country dataset when buildings become highlighted or stop being highlighted.

**Independent Test**: Run the workflow against a bounded fixture containing background-only, highlighted, and mixed-identity source tiles. Confirm that every supported tile receives the same lightweight treatment, unsupported tiles are explicitly excluded, full-quality overlays are generated only for active highlighted identities, and the original source remains unchanged.

**Acceptance Scenarios**:

1. **Given** a complete inventory of the original local source and approved highlighted-building evidence, **When** the operator starts a local run, **Then** every source tile is classified as processed, excluded for review, already complete, or failed before the run can be considered complete.
2. **Given** a supported source tile, **When** it is processed, **Then** every building in it retains recognizable broad source colours while fine texture detail and payload size are reduced.
3. **Given** a highlighted building inside a processed background tile, **When** the active highlight overlay is generated, **Then** only that highlighted identity is included at original quality and the stable lightweight background is not rebuilt.
4. **Given** any processed tile or extracted overlay, **When** its result is validated, **Then** its geometry, feature identity, metadata, and retained material evidence match the applicable source contract.

---

### User Story 2 - Resume a large local run safely (Priority: P2)

As the operator, I want the migration to run in bounded batches and resume from verified progress so that interruption, limited disk space, or one unsupported tile does not require repeating completed work.

**Why this priority**: The local corpus is too large for an all-or-nothing process and the current derived background must be retired to create working space.

**Independent Test**: Interrupt a multi-batch fixture run after a checkpoint, restart it with the same inputs and settings, and confirm that verified results are reused while incomplete work resumes without duplicate output.

**Acceptance Scenarios**:

1. **Given** a partially completed run with valid checkpoints, **When** the same run is resumed, **Then** verified tiles are not reprocessed and remaining tiles continue from the last safe checkpoint.
2. **Given** changed source bytes or transformation settings, **When** a background checkpoint is examined, **Then** stale results are not reused; changing only the highlighted set invalidates the overlay catalogue but not the stable background.
3. **Given** insufficient free storage for the next batch, **When** preflight runs, **Then** processing stops before partial output and reports the additional capacity required.
4. **Given** one unsupported or corrupt tile, **When** it is encountered, **Then** it receives an explicit terminal failure or review outcome while previously verified work remains reusable.

---

### User Story 3 - Change highlights without rebuilding background (Priority: P3)

As the project owner, I want full-quality overlays to follow the current approved highlighted set automatically so that highlights can change while the nationwide lightweight background remains stable.

**Why this priority**: Dynamic highlight membership is the reason for replacing manually maintained per-POI derived datasets.

**Independent Test**: Add, remove, and retain highlighted identities in a fixture catalogue. Confirm create, expire, and no-op overlay outcomes while the background output remains byte-identical.

**Acceptance Scenarios**:

1. **Given** a newly highlighted building, **When** overlays reconcile, **Then** one source-backed full-quality overlay is created without rewriting background tiles.
2. **Given** a building that is no longer highlighted, **When** overlays reconcile, **Then** its overlay expires while its lightweight background representation remains visible.
3. **Given** two venues sharing one building identity, **When** overlays reconcile, **Then** the geometry is stored and rendered once with both owners recorded.

---

### User Story 4 - Review and switch the local renderer (Priority: P4)

As the project owner, I want clear local reports and automated renderer-contract evidence so that I can verify the replacement architecture before retiring the legacy highlighted assets.

**Why this priority**: The temporary local break is acceptable, but completion still requires inspectable parity and recovery evidence.

**Independent Test**: Complete a representative run and confirm that its report accounts for every source tile and active overlay, exposes integrity, payload, rollback, and automated browser outcomes, and contains no publication claim.

**Acceptance Scenarios**:

1. **Given** validated background and overlay candidates, **When** the local renderer switches to them, **Then** backgrounds render at the approved opacity and highlights render once at full quality.
2. **Given** complete candidate assets, **When** automated renderer contracts run across the supported browser/device matrix, **Then** the lightweight background remains at 30%, highlights remain full quality at 100%, each highlighted identity is reachable once, and missing or incomplete assets are rejected.
3. **Given** unresolved failures, **When** the run is summarized, **Then** it is labeled incomplete and legacy highlighted assets are retained.
4. **Given** full local parity and rollback evidence, **When** legacy cleanup is requested, **Then** old highlighted derived assets may be removed without deleting the original source.

### Edge Cases

- Equivalent `tiles/`, `optimized-tiles/`, relative, and platform-specific paths must resolve to one canonical source identity.
- Multiple highlighted venues may reference the same source tile or building identity and must share one overlay fragment.
- Mixed source tiles keep every building in the lightweight background while overlays select only active highlighted identities.
- Overlay geometry occupies the same position as its lightweight background representation; the renderer must prevent flicker or depth conflict.
- Textures may be smaller than the target, contain meaningful transparency, use non-colour maps, share images, or have ambiguous semantic ownership.
- A transformed tile may be larger than its source and must not be silently counted as a saving.
- Checkpoints may be missing, corrupt, edited, or left by an interrupted write.
- Source or approved highlight evidence may change between batches.
- A requested batch may exceed available storage.
- Optional visual or performance diagnostics may fail or remain unexecuted; they must be reported honestly but do not gate this explicitly local-only completion.
- Local derived assets may be deliberately absent after the space-reclamation step; the application must report an intentional incomplete state.

## Scope and Constraints _(mandatory)_

- **In scope**: A deterministic, resumable, local-only workflow that preserves and inventories `tiles/`; gates deletion of replaceable `optimized-tiles/`; generates a stable lightweight background for every supported building; automatically reconciles full-quality overlays for current highlighted identities; changes the local renderer to combine those sources; validates geometry, identity, renderer contracts, rollback, and payload impact; and retires legacy `public/poi-tiles/` only after replacement parity passes.
- **Out of scope**: Deployment, remote upload, cloud mutation, production switching, event publication, commits, pushes, pull requests, release creation, and any claim that the result is production-approved.
- **Evidence and dependencies**: `tiles/` is the authoritative original geometry and texture source. The approved local snapshot and extraction evidence identify active highlighted buildings until the new overlay catalogue is derived from the same approved state. Missing, contradictory, or ambiguous evidence causes exclusion or failure rather than inference. Counts and byte totals are recalculated at run start.
- **Privacy and lifecycle**: The workflow handles building assets and technical manifests only. Generated tiles, checkpoints, screenshots, and reports remain local ignored artifacts. Operational records contain paths, hashes, byte counts, settings, classifications, and validation outcomes only.
- **Experience**: The primary experience is a local operator command and reviewable report. Temporary local application breakage is authorized during migration. The workflow must expose concise progress, destructive confirmation, explicit incomplete states, safe interruption, and resume instructions.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST inventory every original source tile reachable from `tiles/tileset.json` and assign a canonical stable identity.
- **FR-002**: The system MUST derive active highlighted building identities from the current approved local snapshot and source evidence at the start of each overlay run.
- **FR-003**: Equivalent path prefixes and separators MUST normalize to the same source identity.
- **FR-004**: Every active highlighted identity MUST resolve to authoritative original source geometry before the legacy highlight dataset can be retired.
- **FR-005**: Highlight status MUST NOT change stable background output; every supported source tile receives the lightweight treatment, including tiles containing active highlighted identities.
- **FR-006**: Background transformation MUST affect only base-colour evidence, preserve broad source colour, add no blur, avoid enlargement, and retain meaningful transparency.
- **FR-007**: Supported non-colour material evidence MUST remain unchanged; ambiguous texture ownership MUST fail or be excluded explicitly.
- **FR-008**: Processing MUST preserve feature and batch metadata, identifiers and names, feature-to-geometry relationships, vertex and triangle counts, compression requirements, and retained non-image binary content.
- **FR-009**: `tiles/` MUST remain unchanged. Background, overlay, and report candidates MUST be written separately. Approved snapshots and all remote or production state MUST remain unchanged.
- **FR-010**: Background run identity MUST derive from source inventory and transformation policy; overlay run identity MUST additionally include the approved highlighted-identity set.
- **FR-011**: Processing MUST support bounded batches and checkpoint only after output and validation evidence are atomically complete.
- **FR-012**: Resume MUST reuse only outputs whose source, policy, output, and validation identities match.
- **FR-013**: Individual tile, checkpoint, catalogue, switch-manifest, and report writes MUST be atomic.
- **FR-014**: Before each batch, available storage MUST be checked against estimated working capacity and a configured reserve.
- **FR-015**: Every source tile MUST end as processed, excluded, failed, or resumed complete; every active highlight identity MUST end as overlaid, deduplicated, excluded, or failed.
- **FR-016**: Completion requires terminal accounting for every source tile and active highlight identity with no unresolved integrity failure or missing output.
- **FR-017**: Reports MUST include background and overlay outcomes, source/output bytes, reduction, settings, highlighted identities, integrity, failures, exclusions, resume activity, deletion evidence, reclaimed space, and artifact locations.
- **FR-018**: Aggregate savings MUST count each unique background tile and unique overlay fragment once without duplicate venue references.
- **FR-019**: A no-write preflight MUST report scope, active highlights, batching, deletion candidates, expected reclaimed space, and blockers.
- **FR-020**: The workflow MUST support bounded representative validation before full-corpus generation.
- **FR-021**: Automated renderer validation MUST cover the supported desktop/mobile browser matrix, enforce 30% background and 100% overlay contracts, require exact-once highlighted identity reachability, and reject missing or incomplete assets.
- **FR-022**: The workflow MUST expose preparing, awaiting-confirmation, reclaiming-space, intentionally-unavailable, processing, checkpointed, resumed, blocked-by-capacity, failed-validation, ready-to-switch, and complete states.
- **FR-023**: Deployment, remote upload, production switching, version-control publication, and release authorization MUST remain structurally outside this workflow.
- **FR-024**: An unchanged completed run MUST verify and return no-op rather than rewrite output.
- **FR-025**: Migration MUST use these destructive gates in order: verify `tiles/`; inventory the old derived assets; resolve the exact `optimized-tiles/` target; obtain operator confirmation; delete it and record reclaimed space; generate and validate new candidates; switch the local renderer; prove identity, renderer-contract, payload, and rollback parity; then separately confirm and delete legacy `public/poi-tiles/`.
- **FR-026**: Between deletion of `optimized-tiles/` and successful local renderer switching, the application MUST be reported as intentionally incomplete rather than silently reconstructing or using partial assets.
- **FR-027**: The renderer MUST show the lightweight background at 30% opacity and full-quality overlays at 100% without flicker, duplicate-darkening, missing geometry, or background regeneration after highlight changes.
- **FR-028**: The renderer and overlay catalogue MUST reconcile highlights using stable building identity with create, no-op, update, expire, and review outcomes.
- **FR-029**: The old `public/poi-tiles/` tree MUST remain available until the replacement overlay catalogue proves complete identity coverage, source provenance, automated renderer-contract parity, and rollback readiness.

### Key Entities

- **Original Source Tile**: Authoritative input with path, hash, structure, textures, identities, and tileset relationship.
- **Transformation Policy**: Versioned appearance contract for texture size, colour preservation, transparency, material semantics, and background opacity.
- **Background Tile Result**: Terminal output and evidence for one original tile.
- **Highlight Evidence**: Approved relationship among venues, original source tiles, building identities, and extraction evidence.
- **Highlight Overlay**: Deduplicated full-quality geometry fragment for one or more active highlighted venues.
- **Local Run**: Stable resumable execution identity containing inventory, policy, checkpoints, state, and outcome.
- **Checkpoint**: Atomic record of verified reusable results.
- **Migration Inventory**: Exact resolved old assets, sizes, hashes, recoverability evidence, deletion authorization, and reclaimed space.
- **Switch Manifest**: Local renderer inputs and rollback references activated only after candidate validation.
- **Automated Renderer Evidence**: Versioned results from the supported browser/device matrix covering manifest loading, opacity, exact-once reachability, incomplete states, and missing-asset rejection.
- **Run Report**: Complete local accounting of background, overlays, migration, impact, integrity, automated browser evidence, unresolved advisory diagnostics, and non-publication status.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Preflight accounts for 100% of source tiles and active highlighted identities before any output or deletion.
- **SC-002**: Every current highlighted path and building identity resolves to authoritative original geometry across supported path forms.
- **SC-003**: 100% of transformed tiles pass geometry, feature-identity, metadata, and retained-content verification.
- **SC-004**: 100% of active highlighted identities appear exactly once in the generated full-quality overlay catalogue and remain traceable to verified source evidence.
- **SC-005**: An interrupted representative run resumes without reprocessing verified work or accepting partial output.
- **SC-006**: Capacity-constrained processing stops before an unsafe batch and leaves prior checkpoints verifiable.
- **SC-007**: Final reporting accounts for 100% of source tiles and active highlights in exactly one terminal state and reconciles totals without double-counting.
- **SC-008**: All supported desktop/mobile browser projects pass the automated local asset-manifest, opacity, exact-once highlight, incomplete-state, and missing-asset contracts.
- **SC-009**: Lightweight background plus deduplicated active overlays reduces the measured current runtime building payload by at least 40%; lower results require review.
- **SC-010**: Deleting `optimized-tiles/` reclaims its measured local storage without changing `tiles/`; deleting legacy highlights occurs only after overlay parity.
- **SC-011**: Adding or removing a fixture highlight changes only overlay outputs and leaves every background output hash unchanged.
- **SC-012**: Every summary confirms whether migration is incomplete or complete and that no deployment, upload, production switch, commit, push, or release occurred.

## Assumptions

- The approved background appearance is colour-preserving textures capped at 128 pixels, no added blur, and 30% layer opacity; overlays remain original quality at 100% opacity.
- `tiles/` is preserved as the original source. It currently contains about 24,592 B3DM files and 120.2 GB.
- The replaceable `optimized-tiles/` currently occupies about 119.8 GB and will be the first deletion target after a fresh destructive preflight and explicit confirmation.
- The legacy `public/poi-tiles/` tree is about 9.3 GB including source caches and remains until replacement overlay parity is proven.
- Temporary local application breakage after background deletion is authorized.
- The project owner explicitly waived the five-scene human visual review and repeated runtime benchmark as local completion gates. Their diagnostic tooling and historical blocked evidence remain available but advisory.
- Generated artifacts are disposable local evidence and are not required for CI or production.
