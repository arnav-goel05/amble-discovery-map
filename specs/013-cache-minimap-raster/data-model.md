# Data Model: Cache Minimap Raster

## Static raster cache

- Terrain derived from Singapore geometry
- Density cells derived from current discovery points
- Compass labels
- Build generation/count and cumulative build duration for diagnostics

States:

1. Dirty at construction.
2. Built before first display.
3. Reused for every viewport movement.
4. Marked dirty and rebuilt once when discovery points change.
5. Released at destruction.

## Viewport composite

- Cached static raster
- Current projected viewport rectangle
- Render count and cumulative duration for diagnostics

## Diagnostic render mode

- `cached`: production behavior
- `legacy`: reconstruct every layer per render

Runtime-only and never persisted.
