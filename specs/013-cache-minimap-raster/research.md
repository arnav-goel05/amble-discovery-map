# Research: Cache Minimap Raster

## Decision: Cache the full non-viewport raster

Terrain, density pixels, and compass labels are rendered into a backing canvas. Each move
copies the backing canvas and draws the viewport rectangle.

**Rationale**: It eliminates polygon projection, mask allocation, synchronous pixel
readback, terrain loops, density calculation, and text rasterization from movement frames.

**Alternatives considered**:

- Dirty-rectangle restoration on one canvas: rejected as more stateful and fragile.
- Separate visible DOM canvases: rejected because it adds layout/layering complexity.
- Worker OffscreenCanvas: rejected because the 96×64 rebuild is infrequent after caching.
- Build-time land raster: rejected as unnecessary for the first bounded fix.

## Decision: Rebuild synchronously on discovery changes

**Rationale**: Filter/data changes already require updated density immediately, are
infrequent relative to movement, and the canvas is tiny.

## Decision: Retain diagnostic legacy mode

**Rationale**: Cached and old complete redraw paths can be measured on the same build,
hardware, snapshot, viewport, and route.
