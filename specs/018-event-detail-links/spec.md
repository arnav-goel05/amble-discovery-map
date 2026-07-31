# Feature Specification: Expose Canonical Event Details

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-29

**Status**: Draft

**Input**: User description: "Fix event details that exist in approved event data but are not exposed in the frontend, including the missing source link for FunVee Singapore: Day Tour by Open-Top Bus, using Spec Kit."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Open source and ticket links from map details (Priority: P1)

A visitor who opens an event directly from a map highlight can see and open every applicable approved source or ticket link for the selected activity and session.

**Why this priority**: Source links are required evidence for published events and are the visitor's route to authoritative details or ticket purchase.

**Independent Test**: Open the FunVee activity from the Marina Square map highlight and verify that "Fever Singapore" is a working external link to the approved Fever listing.

**Acceptance Scenarios**:

1. **Given** a mapped activity with an activity-wide approved source offer, **When** a visitor opens its details from the map, **Then** the source name appears as a link to the approved URL.
2. **Given** an activity with multiple approved source offers, **When** a visitor opens its details, **Then** every applicable offer appears once with its source label.
3. **Given** a source offer that applies only to selected sessions, **When** a visitor changes the selected session, **Then** only links applicable to that session are displayed.
4. **Given** a missing or unsafe source URL, **When** the details render, **Then** no unsafe link is exposed and the interface accurately reports that no link is available.

---

### User Story 2 - See complete canonical schedules and details (Priority: P2)

A visitor opening an event from a map highlight sees the same approved sessions, dates, times, venues, and descriptive fields that are available when opening the event through search.

**Why this priority**: Different entry points must not show contradictory or incomplete event details.

**Independent Test**: Open a canonical multi-session activity from both a map highlight and search, then compare its session count, selectable dates and venues, separate date and time fields, and descriptive details.

**Acceptance Scenarios**:

1. **Given** a canonical activity with multiple sessions, **When** it is opened directly from its map highlight, **Then** all approved sessions and their venue associations are available.
2. **Given** a session with an exact start time, **When** its details render, **Then** the date and time are presented in their corresponding fields.
3. **Given** approved venue, address, category, price, organizer, or description values, **When** details render, **Then** each available value is shown without fabrication.
4. **Given** an optional detail is absent from approved data, **When** details render, **Then** the field remains "Not available."

---

### User Story 3 - Preserve direct and conversational event-action parity (Priority: P3)

A visitor using direct controls or the conversational interface receives the same eligible event-reference actions for the currently selected activity.

**Why this priority**: Event references are an existing shared application capability and must not drift between direct and conversational entry points.

**Independent Test**: Open an event with an approved source offer and verify that the direct link and the conversational `event.openreference` action resolve the same reference identity and URL; verify both become unavailable when no valid reference exists.

**Acceptance Scenarios**:

1. **Given** an approved source offer displayed in event details, **When** interface context is published, **Then** the same stable reference identity is eligible for the conversational open-reference action.
2. **Given** no valid applicable source offer, **When** interface context is published, **Then** neither the direct interface nor conversational action exposes an external reference.

### Edge Cases

- Multiple sources publish the same activity with different approved URLs.
- An activity-wide link and a session-specific link coexist.
- A session references a venue group that is missing or no longer mapped.
- An offer contains an unsupported or malformed URL scheme.
- A canonical activity contains no sessions or only an unverified schedule.
- Legacy event fixtures still provide a direct event URL instead of canonical source offers.

## Scope and Constraints _(mandatory)_

- **In scope**: Event-detail projection and presentation for approved source offers, sessions, date, time, venue, address, category, price, organizer, description, and shared open-reference eligibility across map and search entry points.
- **Out of scope**: Collecting new organizer websites, changing approved event content, altering venue resolution, republishing the event snapshot, or redesigning the event panel.
- **Evidence and dependencies**: Only approved catalogue fields and validated HTTP(S) source-offer URLs may be displayed. Source links remain source or ticket listings and are not relabeled as organizer websites.
- **Privacy and lifecycle**: Event discovery remains anonymous. This feature introduces no personal data, persistence, or retention changes.
- **Experience**: Existing responsive panel behavior, external-link safety, accessible labels, and supported desktop/mobile browser behavior must be preserved.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST display every valid approved source offer applicable to the selected activity or session when event details are opened from a map highlight.
- **FR-002**: The system MUST preserve source labels, stable offer identities, URL, activity/session scope, and session coverage when projecting approved event data into event details.
- **FR-003**: The system MUST expand canonical activities into their approved sessions and venue associations for direct map-detail presentation.
- **FR-004**: The system MUST derive separate date and time display values from approved schedule data when those values are available.
- **FR-005**: The system MUST display approved venue, address, category, price, organizer, and description values consistently across map and search entry points.
- **FR-006**: The system MUST continue to display "Not available" for optional details that are absent and MUST NOT infer or fabricate them.
- **FR-007**: The system MUST accept existing legacy event-detail inputs during the transition without weakening URL validation.
- **FR-008**: The system MUST reject malformed links and URL schemes other than HTTP(S) from direct and conversational event-reference actions.
- **FR-009**: The existing versioned open-reference capability MUST use the same stable reference identities and current eligibility for direct and conversational entry points.
- **FR-010**: Event-detail context MUST publish the current selected activity, selected session, applicable reference identities, and routability after the panel opens or the selected session changes.
- **FR-011**: Automated coverage MUST verify canonical activity-wide offers, session-specific offers, multiple sessions, missing details, unsafe URLs, legacy compatibility, and map/search parity.
- **FR-012**: Local, test, preview, and production event-detail projections MUST consume the same approved activity contract.

### Key Entities

- **Activity**: An approved event or experience with stable identity, descriptive fields, sessions, venue groups, and source offers.
- **Session**: A scheduled occurrence with stable identity, approved schedule, availability, and one or more venue-group associations.
- **Venue Group**: The approved public placement, label, address, and coordinates associated with sessions.
- **Source Offer**: A validated source or ticket reference with stable identity, source label, URL, scope, and applicable session identities.
- **Event Detail Context**: The selected activity and session state exposed to direct controls and conversational actions.
- **Capability Contract**: The existing `event.openreference` command reads current event-detail context, accepts a stable event and reference identity, and produces the same observable external-navigation eligibility as the direct link.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of valid approved source offers in the active event catalogue are exposed when their applicable activity or session is opened through either map or search.
- **SC-002**: Map and search entry points present identical session counts and applicable source-reference sets for every canonical activity in automated parity coverage.
- **SC-003**: 100% of exact schedules with a published start time show both a date and a separate time value.
- **SC-004**: No malformed or non-HTTP(S) source link becomes actionable in automated success and failure scenarios.
- **SC-005**: The FunVee Marina Square regression displays the approved Fever source link instead of "Not available."

## Assumptions

- The active approved catalogue remains the authoritative source for public event details.
- A source offer points to the publishing or ticket source; it is not necessarily the event organizer's official website.
- Existing visual styling and panel information architecture are sufficient.
- Unknown availability values do not become a new user-facing field as part of this fix.
