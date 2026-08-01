# Feature Specification: Eliminate Stale Highlight Overlap

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-30

**Status**: In Progress

**Input**: User description: "Fix every background tile that still renders geometry also published as an active highlight, validate the result exhaustively, and keep fixing until no overlap remains."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See One Stable Venue Surface (Priority: P1)

As a map user, I see each highlighted event venue once, without a textured or muted background copy fighting with the highlight.

**Why this priority**: Duplicate coplanar geometry produces severe flickering and broken-looking venue surfaces, making the primary map experience unreliable.

**Independent Test**: Load every active highlighted venue at each supported detail level and verify that its approved building identities occur only in the highlight dataset.

**Acceptance Scenarios**:

1. **Given** an active venue highlight, **When** its map area is rendered at any supported zoom, **Then** none of its approved building identities are present in the served background geometry.
2. **Given** a venue spanning shared tiles or multiple detail levels, **When** the view refines, **Then** the venue remains represented by one highlight surface without a background duplicate.
3. **Given** a previously stale National Stadium background tile, **When** the current assets are served, **Then** the textured stadium is absent from the background while the white highlight remains available.

---

### User Story 2 - Publish a Coherent Geometry Release (Priority: P1)

As an operator, I can publish highlight and background geometry as one verified release so a new highlight cannot become active while its old background copy remains served.

**Why this priority**: Updating only one side of the geometry pair creates the defect even when local extraction is correct.

**Independent Test**: Stage a release containing changed highlight and background assets, simulate successful and incomplete remote publication, and verify that activation occurs only after complete remote parity.

**Acceptance Scenarios**:

1. **Given** changed background and highlight assets, **When** publication completes, **Then** every required remote object matches the staged release before the release is reported successful.
2. **Given** a missing, stale, or unverifiable remote object, **When** publication verification runs, **Then** the release is not reported successful and the last coherent active state is preserved.
3. **Given** an interrupted publication, **When** the operator resumes it, **Then** already-correct objects are reused and remaining objects are completed deterministically.

---

### User Story 3 - Audit All Active Geometry (Priority: P2)

As an operator, I receive an exhaustive, bounded audit that identifies every mismatched background object and every retained active building identity.

**Why this priority**: Byte parity alone cannot distinguish harmless differences from the exact identity overlap that causes the visual defect.

**Independent Test**: Audit the complete active POI catalogue against the served background and confirm exact totals for checked files, mismatches, retained identities, affected venues, and failures.

**Acceptance Scenarios**:

1. **Given** pristine, intermediate, and current remote tile versions, **When** the audit runs, **Then** it classifies each active background object and inspects retained building identities in every mismatch.
2. **Given** shared background tiles, **When** the audit reports affected venues, **Then** ownership is attributed to every active venue whose selected identity remains.
3. **Given** an unavailable or malformed remote object, **When** the audit runs, **Then** it reports an explicit failure and cannot return a zero-overlap success.

---

### User Story 4 - Preserve Production Request Capacity (Priority: P1)

As an operator, I can verify every required background and highlight object without consuming
the public request capacity needed by map visitors.

**Why this priority**: A correct release gate must not make the deployed application unavailable
by exhausting its daily request allowance.

**Independent Test**: Run routine audit, synchronization, CI, and deployment verification with a
counted request transport and prove that exhaustive inventory uses a bounded metadata operation,
while direct object transfer is limited to objects already proven stale.

**Acceptance Scenarios**:

1. **Given** an unchanged complete release, **When** routine verification runs, **Then** it makes a bounded constant number of integrity-report requests and no per-object public requests.
2. **Given** one stale object, **When** synchronization runs, **Then** inventory identifies it and only that object is transferred through the operator-owned object-store boundary.
3. **Given** production rate limiting, **When** any legacy public diagnostic receives a rate-limit response, **Then** it stops without probing the remaining objects.

### Edge Cases

- One background object may contain selected identities for multiple active venues.
- A remote object may be neither pristine nor current because it reflects an intermediate extraction state.
- A venue may have four, five, or six detail-level objects rather than a uniform count.
- A byte-mismatched object may require identity inspection before deciding whether it creates visual overlap.
- Remote metadata may omit content length or use validators that cannot prove byte equality.
- Edge caches may retain an earlier object after the backing object has changed.
- Publication credentials or the remote object store may be unavailable during a run.
- A retry may begin after only some objects were uploaded.
- A validator may be absent or unsuitable for byte-parity proof; that object must remain
  unverifiable rather than pass by key and size alone.
- A cached inventory report may predate a manifest-last publication and must not be accepted as
  proof for a different release identity.

## Scope and Constraints _(mandatory)_

- **In scope**: All background objects referenced by the active approved POI catalogue; current stale-object remediation; deterministic remote synchronization; exhaustive byte and identity verification; safe failure and resumable operation; regression coverage and operator documentation.
- **Out of scope**: Changing approved venue resolutions, automatically adding same-name sibling buildings, redesigning highlight appearance, or changing event collection.
- **Evidence and dependencies**: The approved snapshot, extraction manifests, pristine source tiles, generated background tiles, generated highlight tiles, and remote object metadata/content are authoritative. Publication requires access to the existing object store and must retain the existing free/open-data architecture.
- **Privacy and lifecycle**: Geometry auditing uses public building identifiers and object metadata only. It must not collect user data, analytics, credentials, or request authorization material in reports. Routine audit reports remain ephemeral or gitignored.
- **Experience**: The corrected geometry must behave consistently across supported desktop and mobile browsers and through zoom/refinement transitions.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST enumerate every unique background object referenced by the active approved POI catalogue across all selected detail levels.
- **FR-002**: The system MUST determine whether each served background object is byte-identical to its staged approved counterpart using reliable object content or validators.
- **FR-003**: For every byte mismatch, the system MUST inspect the served building identity set and determine which active selected identities remain.
- **FR-004**: A geometry release MUST have zero active selected building identities in served background objects before it can be reported successful.
- **FR-005**: The system MUST synchronize every changed background object required by the release rather than publishing highlight objects alone.
- **FR-006**: The system MUST verify remote parity after synchronization and treat missing, stale, malformed, inaccessible, or unverifiable objects as release failures.
- **FR-007**: Publication MUST preserve the last coherent active state when complete geometry parity cannot be established.
- **FR-008**: Synchronization MUST be idempotent and resumable, reusing already-correct remote objects and retrying only bounded outstanding work.
- **FR-009**: Audit and publication reports MUST include checked-object, matched-object, mismatched-object, retained-identity, affected-venue, and request-failure totals.
- **FR-010**: Shared objects MUST be attributed to every active venue whose approved identity remains in the served background.
- **FR-011**: The system MUST distinguish current, pristine, and intermediate remote object states without treating an intermediate state as safe solely because it differs from pristine.
- **FR-012**: Automated coverage MUST exercise success, stale-object detection, intermediate-state detection, shared-object ownership, malformed/unavailable remote objects, interrupted synchronization, resumption, and no-op synchronization.
- **FR-013**: The operational workflow MUST document prerequisites, execution, zero-overlap success output, failure recovery, and cache invalidation/version behavior.
- **FR-014**: The current production-backed object set MUST be remediated and exhaustively re-audited until the retained active identity count is zero.
- **FR-015**: Routine audit, CI, and deployment verification MUST NOT issue one public runtime request per geometry object; exhaustive remote verification MUST use a bounded object-store inventory operation tied to the expected release.
- **FR-016**: Remote byte parity MUST be proven with a reliable stored checksum or upload validator plus byte length. Missing, malformed, multipart-ambiguous, or mismatched validators MUST fail closed.
- **FR-017**: Object bodies MAY be transferred through the operator-owned object-store control plane only for objects that inventory cannot prove current, and post-upload verification MUST bypass visitor-facing request capacity.
- **FR-018**: Integrity caching MUST be release-aware and use a bounded per-run verification identity after mutable-object operations so neither a report for an earlier manifest nor pre-mutation evidence can verify a newer publication.
- **FR-019**: Every routine verifier MUST declare and test its maximum public request count, and any legacy per-object public diagnostic MUST stop immediately on rate limiting and remain excluded from CI and routine deployment.

### Key Entities

- **Geometry Release**: One coherent set of approved snapshot metadata, background objects, and highlight objects that must be verified together.
- **Background Object**: A remotely served 3D tile identified by its stable object path, local approved digest, remote validator/content, and detail level.
- **Selected Building Identity**: A OneMap GML identity approved for one or more active venue highlights and required to be absent from background objects.
- **Object Audit Result**: The classification, parity evidence, retained identities, affected venues, and failure state for one background object.
- **Synchronization Run**: A bounded, resumable attempt with explicit pending, uploaded, verified, failed, and complete outcomes.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of background objects referenced by the active catalogue are checked, with zero unaccounted request or parsing failures.
- **SC-002**: Zero active selected building identities remain in the served background across every referenced detail level.
- **SC-003**: 100% of remotely served active background objects match their staged approved counterparts after successful publication.
- **SC-004**: National Stadium and every other previously affected venue render without an exact background geometry duplicate through supported zoom transitions.
- **SC-005**: An incomplete or unverifiable synchronization produces no successful-release result in 100% of tested failure cases.
- **SC-006**: Re-running synchronization against an already-correct release performs zero object replacements and still proves zero overlap.
- **SC-007**: The exhaustive post-remediation report shows 0 affected objects, 0 retained active identities, and 0 affected venues.
- **SC-008**: An unchanged release containing every referenced background and highlight object is verified with at most one public integrity-report request per gate and zero per-object public requests.
- **SC-009**: Same-size stale objects, absent validators, missing objects, and non-drawable objects each fail routine integrity verification in 100% of automated fixtures.
- **SC-010**: A rate-limited legacy diagnostic makes no further requests after its first rate-limit response in 100% of automated fixtures.

## Assumptions

- The active approved snapshot and its POI extraction manifests define the complete set of highlighted identities in scope.
- Existing remote-object credentials and deployment ownership remain available to the operator environment but are never persisted in repository files or logs.
- Object paths may remain stable only if publication also provides reliable invalidation or version selection; otherwise immutable versioned paths are required.
- Same-name sibling geometry is a separate venue-resolution concern and is not automatically selected by this feature.
