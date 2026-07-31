# Feature Specification: Coarsen Moving Buildings

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-23

**Status**: Draft

**Input**: Temporarily reduce 3D building detail further while the map moves, without changing stationary quality or any other application behavior.

## User Scenarios & Testing

### User Story 1 - Smoother Map Movement (Priority: P1)

As an Amble user, I want map movement to do less temporary 3D rendering work so that panning and rotating remain as responsive as possible while the complete visual scene returns after movement.

**Why this priority**: Controlled map movement is currently the clearest remaining performance bottleneck.

**Independent Test**: Move the map through the existing controlled benchmark and verify the temporary movement representation is coarser, full stationary detail returns, and unrelated interface behavior remains unchanged.

**Acceptance Scenarios**:

1. **Given** the complete 3D scene is visible, **When** map movement begins, **Then** the application uses the newly approved coarser movement-only representation.
2. **Given** the map was moving, **When** movement ends, **Then** the original full-detail representation returns through the existing restoration behavior.
3. **Given** the performance change is active, **When** focused map synchronization, build, browser, and benchmark checks run, **Then** they pass without an application regression.

### Edge Cases

- Repeated movement before restoration restarts the existing bounded restoration sequence without leaving the map in reduced quality.
- A map that is destroyed during movement does not retain timers or movement state.
- The highlighted venue layer and background building layer continue to use the same temporary movement policy and full-detail restoration contract.

## Scope and Constraints

- **In scope**: One movement-only 3D refinement adjustment and the focused validation needed to prove it restores full detail and does not regress the application.
- **Out of scope**: Changes to stationary 3D quality, opacity, tile request limits, event data, event UI, MRT rendering, the minimap, application features, dependencies, or pipeline behavior.
- **Evidence and dependencies**: Use the checked-in frontend benchmark and existing deterministic map-render synchronization tests.
- **Privacy and lifecycle**: No user data, persistence, identity, or lifecycle behavior changes.
- **Experience**: Preserve the current supported desktop experience and all existing controls; only transient building detail during active movement may differ.

## Requirements

### Functional Requirements

- **FR-001**: The map MUST use the approved coarser 3D representation only while movement is active.
- **FR-002**: The map MUST restore the existing full stationary visual quality after movement through the unchanged bounded restoration sequence.
- **FR-003**: The background building and highlighted venue layers MUST remain synchronized through movement and restoration.
- **FR-004**: The change MUST NOT alter any application behavior outside temporary 3D refinement during movement.
- **FR-005**: The implementation MUST preserve existing movement-state observability so automated checks can distinguish moving, refining, and full-detail states.
- **FR-006**: The production build, focused automated tests, browser smoke check, and controlled performance benchmark MUST pass before completion.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every focused automated movement test observes the approved movement-only quality and restoration to the unchanged full-detail quality.
- **SC-002**: The controlled benchmark reports no performance-budget regression and records the post-change frame-rate result beside the existing baseline.
- **SC-003**: The production build and focused browser smoke check complete with the map, buildings, highlighted venues, event interface, and minimap loading correctly.
- **SC-004**: A review of the final diff finds no application behavior change outside temporary 3D refinement during movement.

## Assumptions

- The existing movement-only refinement mechanism and 350 ms restoration delay remain correct.
- The existing stationary refinement setting remains unchanged.
- Existing benchmark variance is handled by the checked-in performance budgets and comparison notes rather than by adding a new hard frame-rate target.
