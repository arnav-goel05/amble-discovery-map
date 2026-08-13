# Contract: Local Renderer Building Assets

## Inputs

The renderer receives one validated local asset manifest with:

- a complete lightweight background tileset;
- a complete current highlight overlay catalogue;
- background policy identity and opacity `0.30`;
- overlay catalogue identity and opacity `1.00`.

It must not infer assets by scanning directories or consume incomplete checkpoints.

## Rendering behavior

- Background uses screen-space error `8`; highlighted overlays retain screen-space error `4`.
- During camera movement, both 3D layers are truly hidden and tile traversal is paused.
- After movement, both layers resume traversal at preload opacity, wait for the destination selection to become fully renderable and stable for `300 ms`, freeze that selection, and reveal together.
- Overlay loads independently and uses a tested depth preference so coincident original-quality surfaces win without geometry modification.
- One active highlighted building identity is rendered by at most one overlay fragment.
- Updating highlight membership reloads only overlay inputs.
- Readiness distinguishes background-ready, overlay-ready, complete, empty-overlay, missing, and failed states.

## Observable validation

Diagnostics expose manifest identities, selected/renderable counts, errors, loaded asset URLs, current opacity, refinement state, and overlay identity counts. They contain no personal data or remote telemetry.

## Failure behavior

Missing or incomplete background assets produce an explicit intentional-unavailable/error state. Missing required overlays fail validation and prevent local switch. An empty valid overlay catalogue is allowed when no highlights are active.
