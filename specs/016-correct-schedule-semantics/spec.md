# Feature Specification: Correct Event Schedule Semantics

**Working Branch**: `develop`

**Created**: 2026-07-26

**Status**: Approved

**Input**: Preserve discrete event dates from authoritative source evidence, prevent broad
date envelopes from becoming false sessions, filter only the sessions relevant to the
selected Singapore calendar date and projected venue, and repair the current approved
snapshot without recollecting sources.

## User Scenarios & Testing

### User Story 1 - Trust Date Filters (Priority: P1)

As an Amble user, when I select a date I see an activity only when it has an evidenced
session on that Singapore calendar date.

**Why this priority**: A false date match tells users an event is available when it is not.

**Independent Test**: Process a fixture whose official schedule is “26 Jul & 2 Aug 2026”
and verify that 26 July and 2 August match while every intervening date does not.

**Acceptance Scenarios**:

1. **Given** an enumerated two-date schedule, **When** collection and normalization finish,
   **Then** two exact sessions are published and no continuous range is created.
2. **Given** the same activity and a 27 July filter, **When** discovery filtering runs,
   **Then** the activity does not match.
3. **Given** a date-filtered multi-session activity, **When** its result is opened, **Then**
   only sessions matching the selected date are marked as matching.

---

### User Story 2 - Preserve Authoritative Schedule Evidence (Priority: P2)

As an operator, I can distinguish an exact session, an explicit continuous range, a
recurring schedule, and a schedule whose dates are not yet safely extractable.

**Why this priority**: A start/end envelope is not proof that an event occurs every day
inside that envelope.

**Independent Test**: Normalize exact, enumerated, continuous, recurring, and ambiguous
fixtures and verify each receives the correct schedule kind and deterministic Singapore
timestamps.

**Acceptance Scenarios**:

1. **Given** structured performance rows, **When** the adapter normalizes them, **Then** each
   concrete performance is `exact` even when the parent has several performances.
2. **Given** an explicitly continuous source schedule, **When** it is normalized, **Then**
   and only then may it become `range`.
3. **Given** display text whose discrete dates cannot be parsed safely, **When** it is
   normalized, **Then** it is retained as `selectable` for review without invented
   boundaries.
4. **Given** two sources carrying the same grounded ticket-product identity, **When** their
   evidence is reconciled, **Then** the more precise session evidence supersedes the coarse
   envelope without discarding provenance or source offers.

---

### User Story 3 - Repair Current Listings Safely (Priority: P3)

As an operator, I can correct the active event snapshot using saved source and pipeline
evidence without repeating website collection.

**Why this priority**: The public data should be corrected immediately while preserving
immutable snapshots and rollback safety.

**Independent Test**: Repair the active snapshot from saved evidence, verify the known
enumerated-date cases, referential integrity, idempotence, and pointer rollback on failure.

**Acceptance Scenarios**:

1. **Given** the approved snapshot and its saved evidence, **When** repair runs, **Then** it
   creates a new immutable staged snapshot without network requests.
2. **Given** successful verification, **When** publication completes, **Then** the new
   snapshot becomes active and the previous snapshot remains available.
3. **Given** missing or contradictory required evidence, **When** repair runs, **Then** the
   affected schedule is held for review or the repair fails safely without changing the
   approved pointer.

### Edge Cases

- Dates use different month spellings, separators, weekday labels, or time formats.
- An event crosses midnight in Singapore.
- The browser runs in a timezone other than Asia/Singapore.
- One activity is projected to multiple venue groups but only one venue has the selected
  session.
- A source gives bounding start and end dates but no proof of daily availability.
- A recurring expression reaches the frontend without expanded occurrence instances.
- A generic “Offsite” venue conflicts with a specific approved venue for the same grounded
  source product.
- An invalid or non-ISO published boundary is rejected rather than parsed differently by
  different browsers.

## Scope and Constraints

- **In scope**: Schedule-kind contract, bounded parsing of source-published enumerated
  dates, grounded cross-source product identity, exact session preservation, Singapore
  timestamp normalization, projected-venue/date filtering, diagnostics, focused regression
  tests, and approved-snapshot repair from saved evidence.
- **Out of scope**: Source recollection, fuzzy search improvements, new event sources,
  venue research, category changes, dashboard redesign, and unrelated performance work.
- **Evidence and dependencies**: Structured source performances, official source schedule
  text, official booking URLs, saved raw responses, approved venue evidence, and existing
  source offers are authoritative. No paid or new external service is introduced.
- **Privacy and lifecycle**: The feature processes public event evidence only. Snapshot
  immutability, expiry, source-isolation, and rollback rules remain unchanged.
- **Experience**: Date filters behave consistently in supported browsers and browser
  timezones; existing cards, pills, panels, and empty states remain visually unchanged.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST represent schedules as one of `exact`, `range`, `recurring`,
  `selectable`, or `unverified`, with semantics documented at the adapter, normalized, and
  public boundaries.
- **FR-002**: A concrete structured performance MUST normalize to `exact` regardless of how
  many sibling performances its parent listing contains.
- **FR-003**: Enumerated official dates MUST produce separate exact sessions and MUST NOT be
  converted to a continuous range.
- **FR-004**: `range` MUST be used only when source evidence explicitly describes continuous
  availability throughout the interval.
- **FR-005**: Ambiguous or unsupported schedule text MUST remain `selectable` or `unverified`
  with its display evidence and MUST NOT receive invented start or end boundaries.
- **FR-006**: Published session boundaries MUST be strict ISO 8601 timestamps with an
  explicit Singapore offset, and frontend filtering MUST reject non-ISO boundaries.
- **FR-007**: Calendar-date filtering MUST compute day boundaries in `Asia/Singapore`
  independently of the browser or server timezone.
- **FR-008**: Filtering MUST evaluate only sessions belonging to the activity's projected
  venue group and MUST expose only the matching session identities as matches.
- **FR-009**: Recurring schedules MUST be expanded to explicit occurrence instances before
  date filtering; unexpanded recurrence MUST not claim an arbitrary selected date.
- **FR-010**: Cross-source authority identity MUST come from structured or official product
  identifiers and URLs; title suffixes or search-result similarity alone MUST NOT create
  authority identity.
- **FR-011**: Where shared grounded authority evidence links precise sessions to a coarse
  envelope, reconciliation MUST retain the precise sessions, suppress the redundant coarse
  envelope, and preserve all safe source offers and provenance.
- **FR-012**: A generic mobile or offsite venue MUST not create a second public venue
  projection when the same authority-linked session has a specific approved venue.
- **FR-013**: The weekly event pipeline MUST use the corrected adapter, normalization,
  reconciliation, and filtering contracts automatically.
- **FR-014**: The pipeline MUST log counts and reason codes for parsed enumerations,
  ambiguous/selectable schedules, rejected non-ISO boundaries, suppressed coarse
  envelopes, and filtered session matches.
- **FR-015**: A repair command MUST correct the current approved data from saved local
  evidence without source collection, stage a new immutable snapshot, and activate it only
  after referential and schedule-integrity checks pass.
- **FR-016**: Repair MUST be deterministic and idempotent; failure MUST leave the approved
  pointer and prior snapshot unchanged.
- **FR-017**: Stable activity, source offer, venue, and exact session identities MUST be
  retained where their real-world identity has not changed.
- **FR-018**: The change MUST include regression coverage for the known two-date event,
  structured multi-performance listings, ambiguous envelopes, projected venue filtering,
  non-Singapore process timezones, malformed boundaries, repair idempotence, and rollback.

### Key Entities

- **Schedule Evidence**: The official structured or display representation retained with
  provenance before semantic interpretation.
- **Schedule**: A typed statement of `exact`, `range`, `recurring`, `selectable`, or
  `unverified`, with validated boundaries where that kind permits them.
- **Session**: One explicit occurrence at one resolved venue group.
- **Authority Reference**: A grounded official product identifier or product URL shared by
  source records.
- **Projected Venue Group**: The venue-specific view of an activity and the session
  identities valid for that projection.
- **Schedule Repair Snapshot**: An immutable corrected projection derived from saved
  evidence and the active approved snapshot.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The “26 Jul & 2 Aug 2026” regression fixture produces exactly two exact
  sessions and zero matches on 27 July.
- **SC-002**: All structured multi-performance fixtures retain 100% of their concrete
  sessions as `exact`, with no false `selectable` classification.
- **SC-003**: Date-filter regression results are identical under Singapore, UTC, and
  non-Singapore American process timezones.
- **SC-004**: No enumerated-date fixture is published as `range`, and no malformed or
  non-ISO boundary is accepted by the frontend.
- **SC-005**: A multi-venue fixture returns only the selected date's sessions from its
  projected venue group and does not expose unrelated siblings as matches.
- **SC-006**: The repaired approved snapshot contains no orphan activity, session,
  venue-group, offer, or landmark references and preserves the previous immutable snapshot.
- **SC-007**: Running repair twice from the same evidence produces identical semantic
  output; a forced verification failure leaves the approved pointer byte-for-byte
  unchanged.
- **SC-008**: Production build and all focused adapter, normalization, reconciliation,
  discovery-filter, and snapshot tests pass.

## Assumptions

- Saved raw and normalized evidence is sufficient to correct the current known schedules
  without recollection.
- Conservative retention is preferred: unsupported schedule text is reviewable, not
  guessed or discarded.
- Existing source offers and approved venue evidence remain valid unless the schedule
  reconciliation exposes a direct contradiction.
- Search tokenization and ranking are a separate feature because they do not determine
  whether a session occurs on a selected date.
