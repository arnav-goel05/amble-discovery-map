# Data Model: Spatial Highlight Tiles

## Approved Venue

- `id`: Stable approved POI identity; non-empty and unique.
- `label`: Public display label.
- `data`: Existing per-venue tileset path used to locate the sibling extraction manifest.
- Relationship: Has one extraction manifest and one or more highlight fragments.
- Lifecycle: Create/update/no-op/remove follows the active approved POI catalogue.

## Extraction Manifest

- `schemaVersion`: Existing manifest schema.
- `poiId`: Must equal the approved venue identity.
- `tiles[]`: Evidence records.
- Relationship: Owns fragment file identity, source tile URI, content hash, and geometry evidence.
- Validation: Must exist, parse, match the venue, and contain at least one valid tile.

## Highlight Fragment

- `poiId`: Stable approved venue identity.
- `sourceTile`: Safe normalized source URI matching a content node in the optimized hierarchy.
- `poiFile`: Safe basename of an existing extracted B3DM file.
- `poiSha256`: Evidence hash.
- `level`: Numeric detail suffix parsed from the source tile.
- `spatialKey`: Source path without the detail suffix.
- `contentUri`: Output-relative direct reference.
- Relationship: Belongs to one venue and one venue/spatial branch.

## Source Spatial Node

- `path`: Stable position in the optimized hierarchy.
- `boundingVolume`: Finite six-number region.
- `geometricError`: Finite non-negative refinement error.
- `contentUri`: Optional normalized background source tile URI.
- `children`: Ordered source descendants.
- Relationship: Provides evidence to a sparse spatial node or a venue refinement node.

## Venue Geometry Branch

- `poiId`: Stable venue identity.
- `spatialKey`: Spatial group identity.
- `node`: Zero-error content leaf containing the finest available fragment.
- `attachmentPath`: Parent path of the coarse source content node.
- `sourceFragmentCount`: Number of validated extracted levels represented by the selected finest fragment.
- State rule: The content leaf has no children and directly references the minimum-level fragment.

## Spatial Highlight Tileset

- `asset.version`: `1.0`.
- `asset.generator`: Stable builder identity.
- `root`: Sparse, content-free spatial hierarchy.
- `extras.schemaVersion`: `spatial-highlight-v1`.
- `extras.layout`: `spatial-finest`.
- `extras.venueCount`: Count of declared unique venues.
- `extras.venueIds`: Sorted approved venue identities.
- `extras.fragmentCount`: Reachable direct content references.
- `extras.sourceFragmentCount`: Validated extracted source fragments.
- `extras.venueBranchCount`: Venue/spatial branch count.
- `extras.externalTilesetCount`: Always zero.
- Relationship: Contains sparse spatial nodes and venue geometry branches.

## Publication Candidate

- `tileset`: Fully generated and validated spatial highlight tileset.
- `serialized`: Canonically formatted JSON with deterministic ordering.
- `metrics`: Structured identity, hierarchy, branch, fragment, and external-manifest counts.
- `operation`: `create`, `update`, or `noop`.
- State transitions:
  - `assembled` → `validated` after all checks pass.
  - `validated` → `published` by atomic rename.
  - Any error → `rejected`; existing served file remains unchanged.

## Invariants

1. Approved venue IDs, declared venue IDs, and reachable fragment venue IDs have identical sets.
2. Every declared venue has at least one reachable finest fragment.
3. Every fragment path is the single-parent sibling form `../<poi-id>/<file>.b3dm` and is reachable within `public/poi-tiles`.
4. Every fragment source tile maps to an optimized source node with valid bounds and error.
5. Each venue/spatial branch contains only its finest available fragment, has zero geometric error, and has no highlight children.
6. Spatial hierarchy children and venue branches use deterministic ordering.
7. No content URI targets another tileset JSON.
