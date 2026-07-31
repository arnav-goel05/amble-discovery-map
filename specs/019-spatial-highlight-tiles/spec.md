# Feature Specification: Spatial Highlight Tiles

**Working Branch**: `develop`

**Created**: 2026-07-29

**Status**: Draft

**Input**: Replace the event-venue highlight layer's flat, per-venue external tileset catalogue with a spatial hierarchy that culls off-screen venues and directly loads the finest available geometry for visible venues without changing their locations, appearance, or interaction.

## User Scenarios & Testing

### User Story 1 - See Highlighted Venues Promptly (Priority: P1)

As a visitor exploring the map, I see visible event venues at their finest available detail without waiting for a separate manifest or loading coarse highlight levels first.

**Why this priority**: The delayed and visibly refining highlight is the user-facing problem. Direct finest-detail display makes visible event locations stable when they appear.

**Independent Test**: Open the experience, select **Let's explore**, and observe a viewport containing approved event venues. Every requested highlight must be the finest available fragment for its venue/spatial branch, with no coarse highlight request and no external venue manifest request.

**Acceptance Scenarios**:

1. **Given** the introduction has completed and approved event venues are visible, **When** the user selects **Let's explore**, **Then** the camera zoom sequence retains the current background-building exception and requests the visible venues' finest highlight fragments directly.
2. **Given** the user pans, zooms, or rotates after the introduction, **When** camera movement settles, **Then** only spatially visible highlight branches load and the existing normal movement rendering policy remains unchanged.
3. **Given** a venue has several extracted levels of detail, **When** it enters the viewport, **Then** only its finest available fragment in each spatial branch is eligible for rendering.

---

### User Story 2 - Preserve Every Approved Location (Priority: P2)

As a data operator, I can publish the new highlight layout without losing, duplicating, moving, or visually changing any approved event venue.

**Why this priority**: Faster streaming is not acceptable if the map becomes incomplete or highlights background-only buildings.

**Independent Test**: Compare the approved POI catalogue, extracted geometry evidence, and generated spatial hierarchy. Every approved venue identity must occur exactly once in the declared catalogue and have at least one reachable geometry fragment; no unapproved identity may be introduced.

**Acceptance Scenarios**:

1. **Given** the active approved snapshot, **When** the spatial highlight hierarchy is generated, **Then** its declared venue identities exactly match the approved POI catalogue.
2. **Given** unchanged approved venue geometry, **When** the hierarchy is rebuilt, **Then** existing extracted geometry is reused and the result is deterministic.
3. **Given** missing, malformed, or inconsistent geometry evidence, **When** generation or publication is attempted, **Then** the candidate is rejected and the last approved, internally consistent state remains available.

---

### User Story 3 - Verify Streaming Improvement (Priority: P3)

As a maintainer, I can prove the new packaging improves highlight loading and remains safe before it is published.

**Why this priority**: Structural and runtime evidence prevents a performance change from becoming an unmeasured regression.

**Independent Test**: Run deterministic hierarchy validation, repository tests, production build, and a before/after benchmark report that records manifest requests, hierarchy shape, content reachability, and camera-to-highlight behavior.

**Acceptance Scenarios**:

1. **Given** the previous flat layout and the new spatial layout, **When** the benchmark runs, **Then** it records comparable before/after measures and demonstrates that venue-level external manifest requests have been eliminated.
2. **Given** a generated candidate, **When** validation runs, **Then** missing files, unsafe paths, duplicate identities, invalid bounds, incorrect finest-level selection, and catalogue mismatches fail deterministically.
3. **Given** a valid generated candidate, **When** existing map, event, build, and browser tests run, **Then** current event selection, labels, movement behavior, and visual highlighting remain compatible.

### Edge Cases

- Multiple approved venues may occupy the same spatial source tile and level of detail; all must remain independently attributable and reachable.
- A venue may contain fragments from more than one spatial source tile; its identity must remain singular even though it has multiple geometry branches.
- A venue may have only one extracted detail level; it must still render as a valid terminal branch.
- Source-tile evidence may use mixed levels, bounds, or missing optional metadata; generation must use validated evidence or reject the candidate rather than inventing placement.
- Empty catalogues must generate a valid empty hierarchy without an invalid global bounding volume.
- A rebuild interrupted before completion must not leave a partially written served hierarchy.
- Existing immutable snapshots using the legacy flat catalogue remain readable for validation and migration, but the served highlight layer must not fall back to per-venue manifest traversal.

## Scope and Constraints

- **In scope**: A deterministic spatial highlight hierarchy; viewport culling with finest-only highlight selection; direct geometry references; exact approved-catalogue parity; safe generation and publication; compatibility with the current highlight material, labels, picking, introduction zoom, and normal camera-movement policy; structural and browser verification.
- **Out of scope**: Event source collection, venue research or resolution, geometry re-extraction, changing approved coordinates, changing highlight colours or labels, changing background-building geometry, loading every Singapore building eagerly, or adding a new user-facing command.
- **Evidence and dependencies**: The active approved snapshot, existing venue extraction manifests, and existing extracted geometry are authoritative. Generation reuses them and fails closed when evidence is incomplete. No external runtime service is added.
- **Privacy and lifecycle**: The feature processes public venue geometry and stable public venue identities only. It collects no new personal data or user history. Snapshot retention and removal continue to follow the existing immutable publication lifecycle.
- **Experience**: Existing supported desktop and mobile browsers remain supported. The change is internal to rendering and publication; controls, text, accessibility semantics, and user interaction remain unchanged.

## Requirements

### Functional Requirements

- **FR-001**: The served event-venue highlight layer MUST use a spatial hierarchy with direct geometry content references and MUST NOT require a separate external tileset manifest request for each venue.
- **FR-002**: The hierarchy MUST preserve spatial culling so the renderer avoids requesting off-screen venue geometry, while every visible venue/spatial branch MUST directly reference only its finest available extracted fragment.
- **FR-003**: Every approved venue identity MUST be declared exactly once in the generated catalogue and MUST have at least one reachable geometry fragment; no unapproved venue identity may be declared or referenced.
- **FR-004**: Every generated geometry reference MUST resolve to an existing extracted highlight asset through a safe relative path, and background-only geometry MUST NOT be added to the highlight layer.
- **FR-005**: Generated spatial nodes MUST have finite valid bounding volumes, deterministic ordering, and refinement metadata consistent with their descendant geometry.
- **FR-006**: The system MUST preserve stable venue identity and define generation as create for newly approved geometry, update for changed approved geometry, no-op for byte-equivalent output, and remove only when the approved snapshot no longer contains the venue.
- **FR-007**: The system MUST isolate invalid venue evidence, reject an internally inconsistent assembled candidate, and preserve the last approved served state rather than partially publishing or silently reverting to legacy per-venue traversal.
- **FR-008**: Empty catalogues MUST be valid; missing geometry, malformed evidence, unreachable finest content, and publication failures MUST be explicit deterministic errors.
- **FR-009**: No user-facing capability contract is added or changed. Existing event selection, camera, label, and highlight executors MUST continue to consume the same authoritative POI identities.
- **FR-010**: Validation MUST return bounded, structured results containing stable venue identities, fragment counts, hierarchy counts, and observable pass/fail outcomes.
- **FR-011**: The same generated hierarchy and validation rules MUST be used in local, test, preview, and production environments; eligibility remains derived from the active approved snapshot.
- **FR-012**: The existing rule that hides background buildings and pauses their traversal during normal camera movement MUST remain unchanged, including the one-shot exception for the introduction's post-click zoom sequence.
- **FR-013**: Generation MUST reuse existing approved extracted geometry and MUST NOT invoke event collection, venue research, venue resolution, or geometry extraction.
- **FR-014**: Publication MUST write candidates atomically and MUST validate exact catalogue parity, finest-content reachability, URI safety, hierarchy bounds, and source-level ordering before the served pointer or file is replaced.
- **FR-015**: A reproducible verification MUST record external manifest request counts, hierarchy size, selected finest-content count, validated source-fragment count, and camera-to-highlight behavior.

### Key Entities

- **Spatial Highlight Tileset**: The versioned top-level catalogue containing global bounds, hierarchy metadata, approved venue identities, and a root spatial node.
- **Spatial Node**: A bounded hierarchy node used to cull descendants and organize one or more source-tile branches.
- **Highlight Fragment**: An existing extracted geometry asset associated with a stable venue identity, source-tile identity, and detail level.
- **Venue Geometry Branch**: One finest-detail content leaf for an approved venue within one source spatial tile, attached to the sparse hierarchy at that branch's coarse spatial parent.
- **Publication Candidate**: A fully generated and validated hierarchy that can atomically replace the currently served highlight catalogue.
- **Capability Contract**: No new command or query is introduced. Existing stable POI identities, map state, event projection, and highlight selection remain the authoritative shared contract.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Validation reports 100% parity with the active approved POI catalogue, with zero missing, duplicate, or extra venue identities and exactly one reachable finest fragment per venue/spatial branch.
- **SC-002**: The served hierarchy requires zero venue-level external tileset manifest requests, eliminating the current one-manifest-per-visible-venue pattern.
- **SC-003**: On the representative protected **Let's explore** camera path, every requested highlight B3DM is the minimum-level, finest available fragment for its venue/spatial branch.
- **SC-004**: The representative protected camera path starts zero coarse highlight geometry requests and zero venue-manifest requests.
- **SC-005**: Deterministic regeneration from unchanged inputs produces byte-equivalent hierarchy output and performs no geometry extraction or external venue lookup.
- **SC-006**: Existing production build, geometry separation, event interaction, map rendering, and supported-browser tests pass with no change to approved venue placement or visible highlight styling.

## Assumptions

- Existing extracted venue fragments and their extraction manifests contain sufficient source-tile identity and level-of-detail evidence to build the hierarchy.
- The current approved venue catalogue remains the authority for inclusion; pending-review or not-mappable venues are not promoted by this feature.
- The renderer already supports nested 3D Tiles refinement and direct geometry content references, as used by the background-building layer.
- A comparative performance target is more reliable than a fixed loading deadline across unknown devices and networks.
- Legacy immutable snapshots may retain their original catalogue representation; new served output and future candidates use the spatial layout.
