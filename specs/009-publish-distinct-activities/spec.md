# Feature Specification: Publish Distinct Activities

**Working Branch**: `develop`

**Created**: 2026-07-23

**Status**: Approved

**Input**: Publish each distinct event activity once before data reaches the browser while retaining compact sessions, venue groups, and source offers.

## User Scenarios & Testing

### User Story 1 - Load distinct activities (Priority: P1)

As a visitor, I receive one discovery activity for each thing to do instead of thousands of repeated occurrence records.

**Why this priority**: Repeated occurrence payloads are the largest remaining event-data cost and make the application slow before the otherwise distinct UI can render.

**Independent Test**: Load an approved snapshot and verify that the public contract contains one record per activity, contains no occurrence catalogue, and preserves all accepted sessions.

**Acceptance Scenarios**:

1. **Given** multiple accepted occurrences for one activity, **when** a snapshot is published, **then** the browser receives one activity with compact nested sessions.
2. **Given** mapped and off-map activities, **when** the browser loads the snapshot, **then** both are represented in the same canonical activity collection.
3. **Given** an internal activity containing evidence and audit history, **when** it is published, **then** the browser receives stable identities and display fields without internal evidence or audit payloads.

---

### User Story 2 - Discover and plan every session (Priority: P2)

As a visitor, I can search, filter, inspect, and plan a distinct activity without losing any relevant date, price, venue, or source-offer choice.

**Why this priority**: Payload reduction is only valid if current discovery and planning behavior remains accurate.

**Independent Test**: Exercise text, category, date, price, placement, map-pill, details, source-offer, and planning flows against a multi-session fixture.

**Acceptance Scenarios**:

1. **Given** one activity with multiple sessions, **when** a date filter matches one session, **then** the activity appears once and exposes the matching session.
2. **Given** one activity at multiple mapped venues, **when** the map is viewed, **then** it appears at every relevant landmark but once in discovery results.
3. **Given** an off-map activity, **when** its placement filter is selected, **then** it remains discoverable without fabricated map geometry.

---

### User Story 3 - Publish a safe immediate cutover (Priority: P3)

As an operator, I can publish the activity-first schema atomically and identify contract, reference, or performance regressions before activation.

**Why this priority**: The user selected an immediate cutover with no legacy occurrence fallback, so the release must fail closed.

**Independent Test**: Stage valid and invalid candidate snapshots, verify complete reference reconciliation and rollback behavior, then run browser and performance gates.

**Acceptance Scenarios**:

1. **Given** a missing, duplicate, or dangling activity/session/venue reference, **when** publication is attempted, **then** the candidate is rejected and the previous snapshot remains active.
2. **Given** an older cached client requesting the removed occurrence contract, **when** the request fails, **then** the failure is explicit, observable, and does not corrupt the approved snapshot.
3. **Given** a valid candidate, **when** all contract, build, browser, and performance gates pass, **then** the snapshot activates atomically.

### Edge Cases

- An activity has no mapped venue but has an accepted off-map subtype.
- An activity has multiple venue groups, including mapped and off-map groups.
- Several sessions share one venue, while another session uses a different venue.
- A session has a flexible or unverified schedule rather than exact timestamps.
- An activity has multiple source offers with activity-wide and session-specific scopes.
- A landmark references an activity whose mapped venue group does not belong to that landmark.
- All sessions of an activity expire while sibling activities at the landmark remain active.
- A refresh changes activity membership or venue grouping without changing the stable activity identity.

## Scope and Constraints

- **In scope**: Immediate replacement of the browser-facing occurrence catalogue with one canonical activity collection; compact inline sessions; landmark-to-activity/venue references; mapped and off-map discovery; source offers; schema validation; observability; browser and performance tests.
- **Out of scope**: Recollecting event sources, changing occurrence-level normalization, changing deduplication policy, redesigning discovery UI, or lazily fetching session details.
- **Evidence and dependencies**: The existing approved occurrence pipeline and activity projection remain authoritative. Internal evidence is retained in pipeline artifacts but is not published to browsers.
- **Privacy and lifecycle**: No new personal data is collected. Immutable snapshot retention and existing expiry/rollback rules continue to apply.
- **Experience**: Current desktop and responsive web interactions must remain equivalent across required Chromium, WebKit, and Firefox checks.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST publish exactly one canonical public record per accepted distinct activity.
- **FR-002**: The system MUST retain every accepted session inline under exactly one public activity without publishing full occurrence records.
- **FR-003**: The system MUST publish mapped and off-map activities in the same canonical collection.
- **FR-004**: Public landmarks MUST reference activities and applicable venue groups by stable identity instead of embedding full event records.
- **FR-005**: A multi-venue activity MUST be referenceable by every applicable mapped landmark while appearing once in discovery results.
- **FR-006**: Search, category, date, price, placement, map-pill, detail, source-offer, and plan flows MUST evaluate the canonical activity and its sessions without recreating an occurrence catalogue.
- **FR-007**: Public activity records MUST exclude provenance evidence, extraction completeness, grouping decisions, raw occurrence membership, and other internal audit history.
- **FR-008**: Public activity records MUST retain the display fields, stable activity/session/venue-group/offer identities, schedules, availability, placement state, approved coordinates, and safe source links required by the UI.
- **FR-009**: The snapshot manifest MUST expose an activity reference and MUST NOT expose the removed occurrence-catalogue reference after cutover.
- **FR-010**: Publication MUST validate uniqueness, membership, reference integrity, counts, safe URLs, and approved geometry before activation.
- **FR-011**: The system MUST define stable identity and create/update/no-op/expire/review behavior for activity, session, venue-group, offer, and landmark references.
- **FR-012**: The system MUST isolate unresolved identities, carry forward their last safe state where applicable, and preserve the entire last approved state when the assembled refresh cannot be safely published.
- **FR-013**: The system MUST define testable loading, empty, missing-data, stale, unsupported-schema, and error states.
- **FR-014**: Removed-contract requests and activity loading failures MUST produce traceable reason codes and must not silently fall back to occurrence data.
- **FR-015**: The implementation MUST record comparable before-and-after transfer size, browser memory, UI-ready time, and frame-rate measurements.

### Key Entities

- **Public Activity Catalogue**: Versioned envelope containing unique public activities and aggregate counts.
- **Public Activity**: One discovery item with safe display fields, compact sessions, venue groups, source offers, placement, and lifecycle state.
- **Compact Session**: Stable schedule and availability choice belonging to exactly one activity and one or more venue groups.
- **Public Venue Group**: Activity-specific mapped or off-map location branch with safe location fields and session membership.
- **Landmark Activity Reference**: Lightweight relation from one mapped landmark to one activity and applicable venue group.
- **Source Offer**: Safe official-information or ticket URL scoped to an activity or selected sessions.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The browser-facing activity count equals the approved distinct-activity count, with zero duplicate activity identities.
- **SC-002**: One hundred percent of accepted sessions and safe source offers reconcile to exactly one published activity.
- **SC-003**: No browser-facing snapshot contains full occurrence records, internal evidence references, extraction audits, or grouping decisions.
- **SC-004**: Multi-venue, off-map, filtering, detail, offer, and planning acceptance scenarios pass with no user-visible regression.
- **SC-005**: Invalid activity or landmark references block activation and preserve the previously approved snapshot in every tested failure case.
- **SC-006**: Initial event-data transfer and parsed event object volume are materially lower than the measured occurrence-based baseline.
- **SC-007**: Required build, automated browser matrix, and performance regression gates pass before activation.

## Assumptions

- Existing activity identities and grouping decisions from feature 006 remain authoritative.
- All compact sessions are loaded with the activity catalogue so filtering remains immediate.
- A mapped multi-venue activity is visible at each applicable landmark but globally deduplicated in discovery.
- The schema changes immediately; no dual-read or legacy occurrence fallback is retained.
- Internal pipeline and normalization artifacts remain occurrence-oriented for reconciliation and auditability.
