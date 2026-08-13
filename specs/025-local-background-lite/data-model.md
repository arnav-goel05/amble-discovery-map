# Data Model: Local Background-Lite Migration

## OriginalSourceTile

- `canonicalPath`: normalized path relative to `tiles/`
- `sourceSha256`, `sourceBytes`
- `tilesetNodeIdentity`, `boundingVolume`, `geometricError`, optional `transform`
- `buildingIdentities`, feature/batch identity, texture semantics
- `inventoryState`: `valid | missing | malformed | review`

One source tile produces at most one stable background result and may source zero or more overlay fragments.

## TransformationPolicy

- `schemaVersion`, `policyId`
- maximum texture dimension, colour-preservation bounds, quality, blur, alpha policy
- supported semantic ownership rules
- background opacity expectation

The policy identity participates in background run identity. Any policy change invalidates prior background checkpoints.

## BackgroundTileResult

- source path/hash/bytes and policy identity
- output path/hash/bytes
- outcome: `processed | resumed | excluded | failed`
- texture semantic summary
- geometry, identity, metadata, and retained-content validation flags
- atomic completion timestamp and error/review reason

Exactly one terminal result exists per source tile.

## HighlightEvidence

- stable building identity and owning POI IDs
- canonical source path and batch/feature selection
- approved snapshot identity and evidence hash
- original source hash and extraction provenance
- state: `resolved | ambiguous | missing | review`

Multiple owners may reference one building identity; contradictory source mappings are invalid.

## HighlightOverlay

- stable overlay identity derived from source plus selected building identities
- source path/hash, selected identities, owner POI IDs
- output path/hash/bytes and original-quality material contract
- geometry/identity validation
- reconciliation action: `create | update | noop | expire | review`

An active building identity is reachable exactly once in the overlay catalogue.

## Checkpoint

- run ID, source inventory ID, policy ID
- monotonically increasing batch sequence
- verified background result identities
- byte totals and available-capacity observation
- atomic hash and creation time

State transition: `preparing → processing → checkpointed → processing`, or terminal `blocked-by-capacity | failed-validation | complete`.

## MigrationInventory

- absolute resolved source and deletion-candidate paths
- device/inode boundary, file counts, logical and allocated bytes
- source validation and recoverability result
- requested action, confirmation token, confirmation time
- deletion start/end, actual reclaimed bytes, outcome

State transition: `preparing → awaiting-confirmation → reclaiming-space → intentionally-unavailable`. A path mismatch returns to `awaiting-confirmation`.

## OverlayCatalogue

- schema and catalogue identity
- approved snapshot/evidence identity
- sparse spatial hierarchy and content references
- unique building/owner/fragment counts
- unresolved identities and terminal accounting

It becomes switch-eligible only with complete active-identity parity.

## SwitchManifest

- schema and manifest identity
- complete background tileset path/hash
- complete overlay catalogue path/hash
- expected policy and snapshot identities
- previous local configuration/rollback reference
- validation report identity
- state: `candidate | ready | active-local | rolled-back`

Partial paths are never eligible for activation.

## AdvisoryValidationScene

- category, requested and observed camera/location
- before/after asset manifests
- selected/renderable background and overlay counts
- load errors, timing, movement, memory, screenshot paths
- human checks: colour, opacity, holes, flicker, duplicate-darkening
- outcome: `pass | reject | review`; advisory only and never synthesized when unexecuted

## RunReport

- complete counts and unique byte totals
- background, overlay, exclusion, failure, resume, deletion, and switch summaries
- integrity, automated browser, payload, and rollback acceptance gates; advisory visual/runtime outcomes
- unresolved work and completion state
- explicit local-only/non-publication statement
