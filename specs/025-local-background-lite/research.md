# Research: Local Background-Lite Migration

## Decision 1: Preserve `tiles/` as the only authoritative source

**Decision**: Keep `tiles/` byte-for-byte and generate both the lightweight background and highlight overlays from it.

**Rationale**: It contains all original identities, geometry, and textures. The current `optimized-tiles/` differs in 676 files and includes background-specific removals or replacements, so it is not a complete source for future dynamic highlights.

**Alternatives considered**: Keep `optimized-tiles/` as source; rejected because highlighted identities have been removed from some tiles. Keep both 120 GB trees; rejected because storage is constrained and the second tree is derived.

## Decision 2: Delete `optimized-tiles/` first, behind a destructive gate

**Decision**: After a fresh source and deletion preflight plus explicit exact-path confirmation, delete only `optimized-tiles/` to reclaim approximately 120 GB. Temporary local application failure is an explicit state.

**Rationale**: The directories are separate physical files rather than hard links, so deletion should reclaim the measured space. The user authorized temporary local breakage. `tiles/` remains the recovery source and `public/poi-tiles/` remains a temporary highlight fallback.

**Alternatives considered**: Delete `tiles/`; rejected because it removes authoritative source. Delete POI assets first; rejected because it frees much less space and removes the only current highlights. Delete both derived trees immediately; rejected because it removes useful parity/rollback evidence before replacement validation.

## Decision 3: One stable lightweight background includes all buildings

**Decision**: Apply the same lightweight treatment to every supported source tile, including tiles containing highlighted identities.

**Rationale**: Background output then depends only on source bytes and transformation policy, not the current highlight list. Highlight changes cannot trigger a nationwide rebuild.

**Alternatives considered**: Exclude every highlighted source tile; rejected because changing highlights changes background membership and mixed tiles leave many ordinary buildings heavy. Remove highlighted identities from background; rejected because background would need amendment whenever highlight status changes.

## Decision 4: Reconcile a full-quality overlay cache automatically

**Decision**: Extract current highlighted building identities from `tiles/` into a deduplicated sparse overlay catalogue with create/update/no-op/expire/review outcomes.

**Rationale**: The map needs independent quality and opacity for highlights. Automatic identity reconciliation removes the need to maintain the current per-POI asset layout manually while preserving source provenance.

**Alternatives considered**: Search and transform source tiles in the browser; rejected due CPU, latency, complexity, and inability to fetch partial shared textures. Retain manually amended POI directories permanently; rejected because highlight membership changes.

## Decision 5: Resolve coincident geometry in the renderer

**Decision**: Draw background first and give the overlay a tested narrow depth preference using renderer parameters, while leaving source and generated geometry coordinates unchanged.

**Rationale**: The lightweight background contains highlighted buildings underneath full-quality overlays. A renderer-only offset/depth rule preserves independent asset lifecycles and avoids lossy geometry mutation.

**Alternatives considered**: Remove highlighted geometry from background; rejected because it reintroduces background rebuilding. Modify overlay vertices; rejected because it breaks exact geometry preservation. Accept z-fighting; rejected as visually unstable.

## Decision 6: Use resumable atomic filesystem generation

**Decision**: Use configurable bounded concurrency, per-tile atomic writes, append-free checkpoint snapshots, content hashes, and a reserved-free-space threshold.

**Rationale**: The corpus is large and interruption or disk exhaustion is expected. Exact checkpoint identities make resume deterministic and safe.

**Alternatives considered**: One all-or-nothing run; rejected due capacity and recovery cost. Trust file existence on resume; rejected because partial or stale files could be accepted.

## Decision 7: Keep the feature local-only

**Decision**: No upload, remote inventory, production URL, deployment, commit, push, or release operation is reachable from the local migration command.

**Rationale**: This matches the requested scope and keeps destructive local migration separate from future publication authorization.

**Alternatives considered**: Reuse release/sync commands directly; rejected because they broaden scope and could mutate remote state.
