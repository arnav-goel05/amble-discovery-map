# Feature Specification: Simplify Single-Session Event Details

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-29

**Status**: Draft

**Input**: User description: "When there is just one timing or date, do not show the Dates & venues selector card; keep it only for multiple timings or dates."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Read a concise single-session event (Priority: P1)

A visitor opening an event with exactly one approved date and time sees that information once in the event details instead of seeing a redundant schedule summary and a one-option selector.

**Why this priority**: A selector with only one option adds visual weight and implies a choice that does not exist.

**Independent Test**: Open an event with one session and verify that the Dates & venues card and session button are absent while the Date, Time, and Venue detail rows remain correct.

**Acceptance Scenarios**:

1. **Given** an activity with exactly one session, **When** its details open, **Then** the Dates & venues card is not displayed.
2. **Given** a single-session activity with approved date, time, and venue data, **When** the redundant card is omitted, **Then** the Date, Time, and Venue rows still display those values.
3. **Given** a single-session activity, **When** direct or conversational actions are evaluated, **Then** session-selection is unavailable because there is no alternative session.

---

### User Story 2 - Choose among multiple sessions (Priority: P2)

A visitor opening an event with multiple approved sessions sees unique date pills in the `Date` row and only the selected date's relevant time pills in the `Time` row.

**Why this priority**: The existing selector remains useful whenever a real schedule choice exists.

**Independent Test**: Open an activity with multiple dates and times, select a date, and verify that the Time row shows only that date's sessions while exact occurrence identity and session-specific details remain functional.

**Acceptance Scenarios**:

1. **Given** sessions on different dates, **When** event details open, **Then** the Date row displays one pill per unique date.
2. **Given** two sessions on the same date at different times, **When** that date is selected, **Then** the Time row displays both relevant time pills.
3. **Given** a visitor selects another session, **When** the selection changes, **Then** the selected control, Venue detail, and applicable source links update as before.
4. **Given** a visitor selects a different date, **When** the Date selection changes, **Then** its first occurrence becomes selected and the Time row is replaced with only that date's times.

### Edge Cases

- A merged activity has duplicate source records but only one canonical session.
- A session has an unverified or flexible schedule.
- A multi-session activity has several sessions at the same venue.
- A multi-session activity has session-specific ticket links.
- A single session has missing optional date, time, or venue data.

## Scope and Constraints _(mandatory)_

- **In scope**: Conditional schedule-choice presentation, placement inside the detail fields, and contextual eligibility of session selection.
- **Out of scope**: Changing approved schedules, source offers, schedule deduplication, or snapshot publication.
- **Evidence and dependencies**: The approved canonical session count determines whether a real schedule choice exists. Missing values remain unavailable.
- **Privacy and lifecycle**: Anonymous event discovery and existing data lifecycle behavior remain unchanged.
- **Experience**: The event panel becomes more concise on desktop and mobile while preserving existing keyboard, pointer, touch, and conversational behavior for genuine multi-session choices.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST omit the Dates & venues card when the selected activity contains exactly one canonical occurrence.
- **FR-002**: The system MUST continue to display the single occurrence's approved Date, Time, Venue, and related detail rows outside the omitted card.
- **FR-003**: The system MUST display separate `Date` and `Time` choice rows when a multi-session activity has complete date and time values.
- **FR-004**: Multi-session controls MUST preserve existing selected state, session switching, venue grouping, expansion, and session-specific source-link behavior.
- **FR-005**: Session-selection capability MUST be ineligible when the selected activity exposes fewer than two occurrences.
- **FR-006**: Direct and conversational session-selection eligibility MUST derive from the same current event-detail context.
- **FR-007**: The system MUST preserve existing loading, missing-data, stale, unsafe-link, and legacy event behavior.
- **FR-008**: Automated coverage MUST verify singleton omission, singleton field retention, same-date multi-time display, different-date multi-session display, and session-selection parity.
- **FR-009**: The Date row MUST deduplicate dates and the Time row MUST contain only occurrences belonging to the selected date.
- **FR-010**: Selecting a date MUST select its first occurrence by canonical order; selecting a time MUST select its exact occurrence.
- **FR-011**: Multi-session details with incomplete date or time values MUST use a combined `Dates & times` fallback so occurrence identity is not lost.

### Key Entities

- **Activity Detail**: The current event-detail presentation with its stable activity identity and normalized occurrences.
- **Occurrence**: A selectable approved session with stable identity, date, time, venue, and applicable references.
- **Schedule Choice State**: `single` when fewer than two occurrences are exposed and `multiple` when at least two are exposed.
- **Capability Contract**: Existing `event.selectoccurrence`, whose eligibility is derived from the current detail state and requires a genuine alternative occurrence.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of single-occurrence event details omit the redundant Dates & venues card.
- **SC-002**: 100% of single-occurrence event details retain their approved Date, Time, and Venue values when those values exist.
- **SC-003**: 100% of fully dated and timed multi-session activities expose linked Date and Time choice rows.
- **SC-004**: Direct and conversational session-selection are unavailable for singleton details and remain available for valid multi-session details.
- **SC-005**: Existing source-link, session-switching, event-planning, and production-build regression gates continue to pass.

## Assumptions

- "One timing/date" means one normalized canonical occurrence after existing activity and session reconciliation.
- The separate Date, Time, and Venue detail rows are the authoritative singleton presentation.
- Multiple sessions remain selectable even when they share a date or venue.
