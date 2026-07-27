# Feature Specification: Optimize Map-Move Event Refresh

**Working Branch**: `develop`

**Created**: 2026-07-25

**Status**: Ready

**Input**: Solve the first diagnosed map-performance issue only, test it, measure the
before-and-after timing, and stop for approval before addressing another issue.

## User Scenarios & Testing

### User Story 1 - Smooth Map Movement (Priority: P1)

As a person exploring events, I want map movement to avoid repeating invariant event
grouping work so that panning and zooming remain responsive while event pills and search
results continue to reflect the visible area.

**Why this priority**: The diagnostic audit identified repeated grouping of 11,302 event
sessions on every completed map movement as the first isolated main-thread stall.

**Independent Test**: Move the map through the reproducible benchmark route and verify
that no full event-discovery pass occurs, while visible pills and distance ordering still
refresh.

**Acceptance Scenarios**:

1. **Given** event data and filters have not changed, **When** map movement completes,
   **Then** only viewport-dependent placement and ordering are refreshed.
2. **Given** event data or a search filter changes, **When** results refresh, **Then** a
   full event-discovery pass still occurs.
3. **Given** the same scene and movement route, **When** legacy and optimized refreshes
   are benchmarked, **Then** the optimized path records its timing and materially reduces
   the map-movement stall without changing visible behavior.

### Edge Cases

- A map movement completing before the first discovery result exists must be a safe no-op.
- Repeated move completions must not duplicate pills or search results.
- Empty filter results must remain empty after subsequent map movement.
- Runtime event-data reconciliation must replace the cached discovery result before the
  next viewport refresh.

## Scope and Constraints

- **In scope**: Separate invariant event discovery/grouping from viewport-dependent
  placement and result ordering; add regression coverage; compare timings on the existing
  deterministic benchmark.
- **Out of scope**: Minimap rendering, building geometry or texture quality, source data,
  ingestion, event grouping semantics, visual redesign, and any second performance issue.
- **Evidence and dependencies**: Use the checked-in performance diagnostic and the
  existing approved event snapshot; no external service or new data collection.
- **Privacy and lifecycle**: No new user data, analytics, storage, or retention behavior.
- **Experience**: Preserve current map pills, search results, filters, minimap, and browser
  behavior.

## Requirements

### Functional Requirements

- **FR-001**: A completed map movement MUST NOT repeat invariant event discovery or
  activity/session grouping when event data and filters are unchanged.
- **FR-002**: A completed map movement MUST refresh viewport-dependent pill placement,
  visibility, distance ordering, and the rendered result list from the latest discovery
  result.
- **FR-003**: Filter changes and event-data reconciliation MUST continue to run a complete
  discovery pass and replace the result used by later viewport refreshes.
- **FR-004**: A viewport refresh without a prior discovery result MUST be a safe no-op.
- **FR-005**: Diagnostics MUST distinguish a legacy full move-end refresh from the
  optimized viewport-only refresh so both paths can be timed using the same scene and
  movement route.
- **FR-006**: Automated tests MUST prove both that map movement skips full discovery and
  that changing filters still performs it.
- **FR-007**: The implementation MUST preserve the current visual and interaction
  contract and MUST NOT modify other diagnosed bottlenecks.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Across the standard movement route, completed map movements trigger zero
  additional full discovery passes when filters and event data are unchanged.
- **SC-002**: The optimized move-end path reduces its measured median refresh duration by
  at least 80% relative to the legacy full-refresh path in the same benchmark environment.
- **SC-003**: Event pills and search results remain correct after movement, and changing a
  filter still changes the result set.
- **SC-004**: Relevant automated tests, lint, and production build complete successfully.

## Assumptions

- Activity grouping depends on event data and filters, not map center or bounds.
- Viewport placement and distance ordering remain map-dependent and therefore still run
  after movement.
- The existing diagnostic controls can retain the legacy path for benchmark comparison
  without exposing it to normal users.
