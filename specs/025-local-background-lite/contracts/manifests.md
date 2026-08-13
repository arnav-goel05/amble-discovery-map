# Contract: Local Background-Lite Manifests

## Background run manifest

Schema: `local-background-lite-run-v1`

Must contain run/source/policy identities, canonical inventory count, batch/checkpoint state, one terminal record per source tile, unique byte totals, integrity summaries, unresolved work, capacity observations, and `complete`.

## Overlay catalogue

Schema: `local-highlight-overlays-v2`

Version 2 selects exactly one authoritative finest source LOD per stable
building identity. Buildings selected from the same exact source payload share
one content asset, so each building and each content asset is reachable exactly
once without duplicating full-quality textures.

The tileset layout is `sparse-source-hierarchy-finest-v2`: it prunes the
authoritative source spatial tree and attaches each finest payload beside its
coarsest LOD branch, ensuring normal screen-space-error traversal reaches it.

Must contain approved snapshot/evidence identity, unique active building identities, owner mappings, source provenance, sparse hierarchy, direct content references, create/update/no-op/expire/review accounting, and completeness. Duplicate reachable geometry identity is invalid.

## Migration report

Schema: `local-building-asset-migration-v1`

Must contain exact absolute targets, filesystem identity, before/after allocated bytes, source validation, confirmation evidence, deletion outcome, intentionally unavailable interval, switch outcome, rollback reference, and explicit local-only status.

## Switch manifest

Schema: `local-building-assets-v1`

Must contain immutable references and hashes for one complete background tileset and one complete overlay catalogue, expected policy/snapshot identities, validation report, state, and rollback reference. Missing, partial, or mutable checkpoint paths are invalid.

All manifests serialize deterministically and are written through same-directory temporary files followed by atomic rename.
