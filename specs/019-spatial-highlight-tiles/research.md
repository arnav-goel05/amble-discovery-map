# Research: Spatial Highlight Tiles

## Decision 1: Use a sparse spatial hierarchy with direct fragment content

**Decision**: Generate one pruned hierarchy from the existing optimized source tree and reference extracted highlight B3DM files directly.

**Rationale**: The current combined file contains 136 external tileset references. Each referenced venue tileset then exposes all of its fragments as siblings with zero geometric error, so the renderer pays extra JSON round trips and cannot use the original coarse-to-detailed chain. Direct content removes those manifest requests while a pruned source hierarchy restores culling.

**Alternatives considered**:

- Keep external venue tilesets and only group their roots spatially: improves culling but still adds a JSON request before each visible venue can render.
- Merge B3DM files per spatial tile: offers fewer content requests but requires binary geometry rewriting, complicates stable attribution, and risks changing approved geometry.
- Use 3D Tiles 1.1 multiple contents: the installed loaders.gl generation is built around 3D Tiles 1.0 behavior; introducing an extension is unnecessary and riskier than independent venue branches.

## Decision 2: Directly select the finest fragment per visible venue branch

**Decision**: Within each source spatial group, validate and sort every venue fragment, but expose only the minimum-level, finest available fragment as a zero-error content leaf.

**Rationale**: The user explicitly prefers immediate finest-detail highlights even if they cost more to download. Independent leaves allow multiple venues to share a spatial source tile without merging identities, while the sparse parent hierarchy still prevents off-screen branches from loading.

**Alternatives considered**:

- Expose a coarse-to-fine chain: lowers first-pixel cost but causes visible highlight refinement and requests geometry the user does not want displayed.
- Force all finest fragments globally: removes refinement but defeats viewport culling.

## Decision 3: Treat manifests and optimized hierarchy as separate evidence owners

**Decision**: Extraction manifests prove fragment provenance and asset identity; the optimized hierarchy proves spatial bounds, ancestry, and refinement error.

**Rationale**: Neither source alone is sufficient. Per-venue tilesets contain bounds but flatten refinement, while manifests retain source URIs but not the complete spatial tree. Cross-validation prevents invented placement.

## Decision 4: Retain a versioned top-level venue catalogue

**Decision**: `extras.venueIds` remains the singular identity declaration, while content nodes repeat `poiId` only for traceability.

**Rationale**: A venue can span several spatial branches and detail levels. Counting content annotations as entities would falsely report duplicate venues. Validation compares the declared set to both approved records and the set of reachable content identities.

## Decision 5: Keep the runtime interface unchanged

**Decision**: Continue serving `/poi-tiles/event-venues/tileset.json` and consuming it through the existing single `Tile3DLayer`.

**Rationale**: The problem is asset organization, not layer behavior. Keeping the URL and layer contract avoids changes to selection, labels, voice/MCP capability boundaries, and the camera-movement exception.

## Decision 6: Measure structural and browser outcomes

**Decision**: Record deterministic structural measures for every build and run a same-camera-path browser benchmark for before/after timing.

**Rationale**: Structural evidence proves removal of manifest waterfalls; browser evidence proves user-perceived improvement. Both are required because either alone can miss regressions.

## Baseline

Measured from the active approved snapshot on 2026-07-29:

| Measure                                     | Legacy value |
| ------------------------------------------- | -----------: |
| Approved venues                             |          136 |
| External venue tileset references           |          136 |
| Extracted highlight fragments               |          818 |
| Venue/spatial branches                      |          143 |
| Extraction-manifest bytes read during build |    1,257,583 |

The implementation benchmark will append spatial output and runtime results to `benchmark.md`.
