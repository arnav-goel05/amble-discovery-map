# Feature Specification: Parent-First Event Deduplication

**Working Branch**: `develop`

**Created**: 2026-07-26

**Status**: Approved

**Input**: Group matching source listings into one parent activity before reconciling their sessions, preserve every evidenced session and source offer, and repair the current approved snapshot without recollecting event sources.

## User Scenarios & Testing

### User Story 1 - See Each Activity Once (Priority: P1)

As an Amble user, I see one discovery activity for the same real-world event even when Catch.sg, SISTIC, Fever, Visit Singapore, or another approved source describes it differently.

**Why this priority**: Duplicate discovery cards and pills misstate the amount of available content and make the map harder to use.

**Independent Test**: Process fixtures where one source provides a date range and another provides individual sessions, then confirm that one activity contains the union of evidenced sessions and source offers.

**Acceptance Scenarios**:

1. **Given** a broad source listing and several matching dated sessions from another source, **When** grouping completes, **Then** one activity contains all non-duplicate sessions and both source offers.
2. **Given** two listings with normalized Singapore dates, compatible parent titles, and the same approved venue, **When** grouping completes, **Then** date formatting and timezone representation do not keep them separate.
3. **Given** two same-source surfaces with the same authoritative product identity, **When** grouping completes, **Then** one activity retains the strongest details and all independently evidenced sessions.

---

### User Story 2 - Preserve Genuine Distinctions (Priority: P2)

As an operator, I can trust that parent grouping does not collapse different productions, editions, venues, or sibling performances that lack sufficient common evidence.

**Why this priority**: Incorrect merging loses discoverable activities and can attach the wrong venue or ticket link.

**Independent Test**: Process fixtures with generic titles, different edition years, conflicting organizers, conflicting approved venues, and unrelated sibling performances, then confirm they remain separate or enter review.

**Acceptance Scenarios**:

1. **Given** two generic-title activities at different approved venues, **When** grouping completes, **Then** they remain separate.
2. **Given** strong parent evidence but conflicting approved venues, **When** grouping completes, **Then** the activity is isolated for grouping review rather than silently merged.
3. **Given** one parent activity with many genuine sessions, **When** grouping completes, **Then** each distinct session remains available under the single parent.

---

### User Story 3 - Repair Approved Listings Safely (Priority: P3)

As an operator, I can reproject the current approved event snapshot through the corrected grouping rules without repeating source collection or modifying the existing immutable snapshot.

**Why this priority**: The current public data should be corrected immediately while preserving evidence, rollback safety, and the weekly pipeline contract.

**Independent Test**: Run the repair against the current approved snapshot, verify reconciliation and referential integrity, and confirm the active pointer changes only after the new snapshot passes all gates.

**Acceptance Scenarios**:

1. **Given** the current approved snapshot, **When** repair runs, **Then** it reads the existing approved activities, sessions, venues, offers, and evidence without contacting source websites.
2. **Given** a successful repair, **When** verification completes, **Then** a new immutable snapshot becomes active and the prior snapshot remains available for rollback.
3. **Given** an unresolved unsafe grouping or failed integrity check, **When** repair runs, **Then** the current approved pointer remains unchanged and the affected identities are reported.

### Edge Cases

- Identical generic titles at different museums or venues remain distinct.
- A shared landing-page URL that represents multiple activities is not treated as a product identity.
- Equivalent date-only values are compared in the Singapore timezone.
- A range listing may bridge many sessions only when parent evidence identifies the same activity.
- Same-source duplicate pages may use different raw venue aliases that resolve to one approved place.
- Conflicting venue resolutions create review evidence rather than an automatic merge.
- Repeated source offers are deduplicated without losing distinct ticket providers.

## Scope and Constraints

- **In scope**: Parent-level candidate generation, safe parent grouping, session union, source-offer preservation, Singapore date normalization, canonical venue use, structured grouping review, observability, focused regression tests, and approved-snapshot reprojection.
- **Out of scope**: Source recollection, extractor changes, venue research, UI redesign, category changes, and unrelated performance work.
- **Evidence and dependencies**: Existing approved source URLs, source product identities, schedules, organizer evidence, descriptions, venue resolutions, and prior deduplication evidence remain authoritative. No new paid service is introduced.
- **Privacy and lifecycle**: The feature processes public event data only. Existing snapshot immutability, expiry, reconciliation, and rollback rules remain unchanged.
- **Experience**: Public event cards, pills, filters, and details retain their current behavior while showing one parent activity per real-world event.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST generate parent-activity candidates independently from occurrence-to-occurrence matching.
- **FR-002**: The system MUST merge compatible source parents before attaching their distinct sessions.
- **FR-003**: A parent merge MUST require a compatible normalized title plus strong corroboration from at least one of: common authoritative product identity, compatible organizer evidence, common approved venue with compatible schedule coverage, or prior approved grouping evidence.
- **FR-004**: The system MUST normalize schedule values to the Asia/Singapore timezone before date or interval comparison.
- **FR-005**: The system MUST allow a broad parent schedule to cover multiple independently evidenced sessions without treating the one-to-many relationship as an ambiguous sibling collision.
- **FR-006**: The system MUST preserve every distinct evidenced session and deduplicate only equivalent sessions within the merged parent.
- **FR-007**: The system MUST preserve and deduplicate all safe source offers with their source and applicable scope.
- **FR-008**: Same-source listings with equivalent parent evidence MUST be eligible for grouping even when their raw venue labels differ but resolve to the same approved venue.
- **FR-009**: A source product URL MAY be strong identity evidence only when it identifies one product; collection or editorial landing pages MUST NOT authorize a merge.
- **FR-010**: Conflicting edition, organizer, or approved-venue evidence MUST keep parents separate or create an isolated grouping review.
- **FR-011**: The system MUST emit deterministic decisions and counts for merged parents, preserved sessions, deduplicated offers, rejected candidates, and grouping reviews.
- **FR-012**: The weekly event pipeline MUST use the corrected parent-first grouping automatically.
- **FR-013**: A repair command MUST reproject the current approved snapshot without source collection and without modifying the source snapshot.
- **FR-014**: Repair MUST create a new immutable snapshot, verify all activity/session/venue/landmark/offer references, and atomically update the approved pointer only after all checks pass.
- **FR-015**: Repair failure MUST leave the current approved pointer and data unchanged and report actionable reasons.
- **FR-016**: Stable source identities, prior safe group membership, session identity, and venue evidence MUST be retained through grouping and repair.
- **FR-017**: Public output MUST contain no duplicate activity identities and every published session and source offer MUST reconcile to exactly one activity.
- **FR-018**: The change MUST include regression coverage for broad-range versus session grouping, date timezone equivalence, same-source duplicate surfaces, conflicting venues, generic titles, rollback, and idempotent repair.

### Key Entities

- **Source Parent**: One source's stable parent listing or product identity, with title, overall schedule coverage, organizer, venue evidence, source offers, and child sessions.
- **Parent Candidate**: A deterministic comparison between source parents with supporting and conflicting evidence.
- **Activity Group**: One public activity composed of one or more compatible source parents.
- **Session**: A distinct evidenced date, time, availability, and venue-group association retained under an activity.
- **Source Offer**: A provenance-backed official-information or ticket link attached to an activity or selected sessions.
- **Grouping Review**: An isolated unresolved parent comparison with evidence and reason codes.
- **Repair Snapshot**: A new immutable projection derived from the active approved snapshot.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All approved audit fixtures representing the same activity produce exactly one parent activity while retaining 100% of distinct evidenced sessions and safe source offers.
- **SC-002**: All generic-title, conflicting-edition, conflicting-organizer, and conflicting-venue fixtures remain separate or enter review with zero silent false merges.
- **SC-003**: Equivalent Singapore calendar dates match regardless of whether a source supplies ISO or human-readable formatting.
- **SC-004**: Running repair twice against the same source snapshot produces identical content and does not create an additional semantic change.
- **SC-005**: A failed repair leaves the approved snapshot pointer byte-for-byte unchanged.
- **SC-006**: The repaired snapshot has no duplicate activity IDs, no orphan sessions, venue groups, offers, or landmark references, and accounts for every input activity.
- **SC-007**: The current high-confidence duplicate audit set is consolidated or isolated with an explicit review reason; none remain silently duplicated.

## Assumptions

- The active approved snapshot contains sufficient provenance and session information to reproject activities without source recollection.
- Parent grouping is conservative: unresolved conflicting evidence is reviewed rather than merged.
- Existing venue approvals are reused and are not re-researched by this feature.
- The current UI already supports activities containing multiple sessions, venue groups, and source offers.
