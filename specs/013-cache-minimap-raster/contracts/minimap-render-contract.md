# Minimap Render Contract

## Movement

- Recalculate the viewport rectangle.
- Schedule at most one animation-frame render.
- Copy the current cached static raster.
- Draw the viewport rectangle.
- Do not rebuild terrain, density, or compass.

## Discovery update

- Replace density points.
- Rebuild the static raster once.
- Render the new raster and current viewport.
- Update activity and density-cell metadata.

## Diagnostics

- Count static-raster builds separately from composites.
- Record cumulative and last durations.
- Permit `cached` and `legacy` modes only when diagnostics are enabled.
