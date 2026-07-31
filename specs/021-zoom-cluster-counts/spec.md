# Feature Specification: Zoom-Aware Event Cluster Counts

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-30

**Status**: Complete

**Input**: User description: "When zoomed out above the pill highlighting level, show a clustered count depending on the zoom level so users can easily tell where to explore next."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Find event areas while zoomed out (Priority: P1)

As a map explorer, I can see compact counts over areas containing matching event locations
when full event pills would be too dense, so I know where to zoom next.

**Why this priority**: The map currently removes all event-location cues below the pill
visibility level, leaving users without a clear next action.

**Independent Test**: Open a map containing event locations, zoom below the pill visibility
level, and verify that every matching on-map location is represented by exactly one visible
cluster count.

**Acceptance Scenarios**:

1. **Given** matching event locations are present, **When** the map is below the full-pill
   visibility level, **Then** visible locations are grouped into compact spatial counts.
2. **Given** multiple nearby locations belong to one group, **When** the map is zoomed out,
   **Then** the group shows the number of matching locations it represents.
3. **Given** no matching on-map locations exist, **When** the map is below the full-pill
   visibility level, **Then** no empty or zero-count indicators appear.

---

### User Story 2 - Refine clusters by zooming (Priority: P2)

As a map explorer, I see broad counts split into more precise groups as I zoom in, then see
full event pills once the map reaches the existing detail level.

**Why this priority**: Progressive refinement connects the overview and detailed event
experiences without adding map clutter.

**Independent Test**: Observe the same event locations across several zoom levels and verify
that broad groups split as map scale increases, with a single transition to full pills at
the established pill level.

**Acceptance Scenarios**:

1. **Given** a cluster represents separated event areas, **When** the user zooms in while
   remaining below the pill level, **Then** the cluster can split into smaller spatial
   groups whose combined location count is unchanged.
2. **Given** cluster counts are visible, **When** the map reaches the full-pill visibility
   level, **Then** counts disappear and matching full pills appear without both presentations
   competing.
3. **Given** the user zooms back out, **When** the map drops below the pill level, **Then**
   full pills disappear and current cluster counts reappear.

---

### User Story 3 - Navigate from a count (Priority: P3)

As a keyboard, mouse, or touch user, I can select a cluster count to move closer to the
represented event locations.

**Why this priority**: A count should provide a direct path from discovery to detail rather
than acting only as passive decoration.

**Independent Test**: Select a multi-location cluster and verify that the map moves closer
to its represented locations while retaining the current event filters.

**Acceptance Scenarios**:

1. **Given** a visible multi-location cluster, **When** the user selects it, **Then** the map
   moves closer to the represented locations and reveals a more precise cluster or full
   pills.
2. **Given** a visible one-location cluster, **When** the user selects it, **Then** the map
   moves to that location at the full-pill visibility level.
3. **Given** a cluster is focused with a keyboard, **When** the user activates it, **Then**
   it performs the same navigation as pointer activation.

### Edge Cases

- Locations outside the current viewport do not contribute to visible counts.
- Locations at a viewport or cluster boundary are represented once, never duplicated or
  omitted.
- Search and category changes immediately recompute counts from matching locations only.
- Multiple events at the same approved location count as one location.
- A navigation-target pill may remain visible below the normal pill level only when the
  existing navigation flow explicitly requires it; its location must not also appear in a
  cluster count.
- Map movement, resizing, and rapid zoom changes settle on counts that match the final
  viewport and zoom.

## Scope and Constraints _(mandatory)_

- **In scope**: Zoom-dependent spatial grouping of matching on-map event locations below the
  existing pill level; compact count indicators; count selection that moves toward the
  represented area; transitions among cluster, pill, filtered, and empty states.
- **Out of scope**: Changes to event ingestion, venue approval, building highlights, event
  details, the established full-pill content, or off-map event presentation.
- **Evidence and dependencies**: Counts use only the current approved event-location state
  already available to the map and inherit its search/category filtering. No new external
  data or service is introduced.
- **Privacy and lifecycle**: The feature remains anonymous, stores no user information, and
  adds no analytics, telemetry, retention, or logging.
- **Experience**: Counts must remain legible and operable in supported desktop and mobile
  browsers, avoid obscuring core map controls, support keyboard and touch interaction, and
  avoid continuous background work.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST represent every matching approved on-map event location with
  either one cluster count or one full event pill whenever it is within the viewport.
- **FR-002**: The system MUST show cluster counts below the existing full-pill visibility
  level and MUST show full pills at or above that level.
- **FR-003**: The system MUST prevent the same location from appearing simultaneously in a
  cluster count and a full pill, except for an existing explicit navigation target that is
  excluded from clustering.
- **FR-004**: Each cluster count MUST equal the number of distinct matching event locations
  represented, regardless of how many event occurrences belong to each location.
- **FR-005**: Spatial groups MUST become more precise as the user zooms in, without changing
  the combined count of matching locations solely because of zoom.
- **FR-006**: Counts MUST update after map movement, zoom, resize, reconciliation, search,
  category filtering, and navigation-target changes.
- **FR-007**: Selecting a multi-location cluster MUST move the map closer to its represented
  locations; selecting a one-location cluster MUST move to that location at the full-pill
  visibility level.
- **FR-008**: Cluster counts MUST be pointer, touch, and keyboard operable and expose an
  accessible label describing the number of event locations represented.
- **FR-009**: The system MUST show no cluster indicator for an empty result and MUST remove
  stale indicators when locations or filters change.
- **FR-010**: Cluster updates MUST remain event-driven and MUST NOT introduce continuous
  polling, permanent animation, or hidden full-pill rendering work.
- **FR-011**: Existing stable location and event identities, filter behavior, pill
  selection, panel behavior, and navigation behavior MUST remain unchanged.
- **FR-012**: This presentation-only feature MUST NOT create or change a public capability
  command or query; direct and conversational discovery continue to use the existing
  authoritative event-discovery state.

### Key Entities _(include if feature involves data)_

- **Event Location**: A distinct approved on-map landmark with a stable identity, map
  coordinate, and one or more matching event occurrences.
- **Location Cluster**: A temporary viewport-and-zoom-specific group of one or more event
  locations, with a count, geographic extent, and navigation target.
- **Presentation Mode**: The mutually exclusive cluster-count or full-pill representation
  chosen from the current zoom and explicit navigation state.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At every tested zoom and filter state, 100% of matching visible on-map event
  locations are represented exactly once by either a cluster count or a full pill.
- **SC-002**: At the established pill-level boundary, tests observe no frame in the settled
  state where ordinary locations have both a cluster count and a full pill.
- **SC-003**: Selecting any tested cluster reaches a more detailed cluster or full-pill view
  in one interaction.
- **SC-004**: Cluster count totals remain equal to the number of matching visible locations
  across at least three representative zoom levels.
- **SC-005**: Desktop and mobile users can identify at least one event-containing area from
  the zoomed-out map without opening search or changing filters.
- **SC-006**: Existing event-pill, filtering, event-panel, map-navigation, and production
  build checks continue to pass.

## Assumptions

- Counts represent distinct approved event locations rather than event occurrences because
  the map cue answers where to explore.
- Grouping distance adapts continuously or in bounded zoom bands so clusters naturally
  split as map scale increases.
- Selecting a cluster preserves the user's current search and category filters.
- Existing navigation-target behavior remains the sole exception to the normal zoom-based
  presentation transition.
