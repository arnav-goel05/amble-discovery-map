# Feature Specification: Cache Minimap Raster

**Working Branch**: `develop`
**Created**: 2026-07-25
**Status**: Ready

**Input**: Solve the second diagnosed map-performance issue only, test it, measure
before-and-after timings, and stop for approval before addressing another issue.

## User Scenarios & Testing

### User Story 1 - Responsive Minimap Tracking (Priority: P1)

As a person moving around the event map, I want the minimap viewport box to track my view
without repeatedly rebuilding unchanged Singapore terrain and event-density pixels.

**Why this priority**: The diagnostic audit found that every movement frame recreates a
mask canvas, reads its pixels, and redraws static terrain, density, and compass content.

**Independent Test**: Move the map through the standard route and verify viewport renders
increase while static-raster builds do not, then change an event filter and verify the
static density raster rebuilds once.

**Acceptance Scenarios**:

1. **Given** event density is unchanged, **When** the map moves, **Then** the minimap
   composites its cached raster and redraws only viewport-dependent content.
2. **Given** an event filter or data model changes, **When** density changes, **Then** the
   cached raster is rebuilt and the displayed activity count remains correct.
3. **Given** identical scene and movement inputs, **When** cached and legacy rendering are
   benchmarked, **Then** the cached path materially lowers minimap work without changing
   its appearance or viewport behavior.

### Edge Cases

- Movement scheduled while a density update occurs must render the newest density.
- Disabling viewport tracking must cancel pending viewport-only work.
- Destroying the minimap must cancel frames and release backing canvases.
- A missing or empty geometry/data set must still render a valid empty minimap.

## Scope and Constraints

- **In scope**: Cache terrain, current density, and compass pixels; composite the cache
  during movement; instrument static rebuilds; retain a diagnostic-only legacy comparison.
- **Out of scope**: Event discovery, map search, 3D assets, minimap redesign/removal,
  ingestion, and other performance causes.
- **Evidence and dependencies**: Existing approved snapshot and checked-in performance
  route only; no external service or dependency.
- **Privacy and lifecycle**: No user data, analytics, storage, or retention change.
- **Experience**: The minimap must remain visually and functionally equivalent across the
  supported browser matrix.

## Requirements

### Functional Requirements

- **FR-001**: Map movement MUST NOT rebuild the terrain mask, read mask pixels, recalculate
  density cells, or rerasterize compass text when density is unchanged.
- **FR-002**: Map movement MUST continue to update the minimap viewport rectangle.
- **FR-003**: Filter and event-data changes MUST rebuild the cached density raster exactly
  once per applied change and update accessibility/count metadata.
- **FR-004**: Diagnostics MUST separately count full static-raster builds and viewport
  composites.
- **FR-005**: Diagnostics MUST support cached and legacy rendering in the same build for a
  controlled comparison.
- **FR-006**: Automated tests MUST prove cache reuse during movement and invalidation after
  a filter change.
- **FR-007**: The change MUST preserve minimap appearance, tracking behavior, and existing
  loading/empty behavior without modifying Issue 1 or 3.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The standard map route causes zero additional static-raster builds in cached
  mode while viewport render count increases.
- **SC-002**: A filter change causes exactly one additional static-raster build.
- **SC-003**: Cached mode reduces movement-time minimap rendering work by at least 80%
  relative to legacy mode in the same benchmark environment.
- **SC-004**: Relevant unit/browser tests, cross-browser regression, lint, and production
  build pass.

## Assumptions

- Singapore geometry and compass labels are immutable for a minimap instance.
- Density cells change only when discovery results or models change.
- A small backing canvas is supported by all required browsers.
