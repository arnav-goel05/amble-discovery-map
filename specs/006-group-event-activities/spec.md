# Feature Specification: Group Event Activities

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-22

**Status**: Draft

**Input**: Group event occurrences into one user-facing activity, nest sessions under venue groups, preserve source offers, update ingestion/publication contracts and the Sites dashboard, validate without rerunning source collection, and converge until complete.

## Clarifications

### Session 2026-07-22

- Q: How should differing cross-source schedules for the same activity be handled? → A: Union all independently evidenced sessions and isolate only direct contradictions for review.

## User Scenarios & Testing

### User Story 1 - Discover Each Activity Once (Priority: P1)

As a visitor, I see one result for a distinct activity instead of repeated cards for every date, time, venue, or source listing.

**Why this priority**: Repeated sessions overwhelm discovery and make the number of things to do misleading.

**Independent Test**: Load a fixture containing one activity with multiple sessions and verify that discovery shows one activity card with an accurate schedule summary.

**Acceptance Scenarios**:

1. **Given** one recurring exhibition with 180 upcoming sessions, **When** the visitor searches or browses events, **Then** one activity is shown and its card reports the upcoming-session count or date summary.
2. **Given** two materially different productions with similar titles, **When** the visitor browses events, **Then** they remain separate activities.
3. **Given** a date filter, **When** an activity has at least one matching session, **Then** the activity appears once and exposes only relevant upcoming availability first.

---

### User Story 2 - Choose Venue and Session (Priority: P1)

As a visitor, I can open an activity and choose among its venues, dates, and times without losing the identity of an individual bookable session.

**Why this priority**: Grouping is only useful if exact booking and planning choices remain accessible and correct.

**Independent Test**: Open a grouped multi-venue fixture and verify venue groups, chronological sessions, keyboard/touch controls, and selected-session identity.

**Acceptance Scenarios**:

1. **Given** an activity at one venue on several dates, **When** its details open, **Then** sessions are listed chronologically under that venue.
2. **Given** an activity at multiple venues, **When** its details open, **Then** sessions are grouped by venue and each venue retains its mapping state.
3. **Given** many sessions, **When** the activity first opens, **Then** a concise initial set is shown with a clear way to reveal the remainder.

---

### User Story 3 - Use Trusted Event and Ticket Links (Priority: P2)

As a visitor, I can use the official information page or ticket provider associated with the activity or selected session without seeing duplicate source listings as duplicate activities.

**Why this priority**: Cross-source deduplication must preserve provenance and actionable booking options.

**Independent Test**: Load one activity represented by an official organizer, SISTIC, and Fever and verify one activity with distinct, labelled, provenance-backed source offers.

**Acceptance Scenarios**:

1. **Given** several sources for the same activity, **When** details open, **Then** one activity is shown with deduplicated and labelled source offers.
2. **Given** an offer that applies only to one session, **When** that session is selected, **Then** its relevant offer is shown without being applied to unrelated sessions.
3. **Given** a source URL that is missing or unapproved, **When** the activity renders, **Then** no fabricated or unsafe link is shown.

---

### User Story 4 - Inspect Accurate Pipeline Counts (Priority: P2)

As an operator, I can distinguish activities, sessions or occurrences, and source offers in pipeline reports and the Sites dashboard.

**Why this priority**: Operational totals currently label occurrence records as unique activities, obscuring the actual catalogue shape.

**Independent Test**: Build a dashboard payload from existing normalized artifacts and verify separate, reconcilable counts for activities, occurrences, venues, and offers.

**Acceptance Scenarios**:

1. **Given** 12,920 occurrence records representing 782 parent activities, **When** the dashboard loads, **Then** both counts are displayed with unambiguous labels.
2. **Given** grouping cannot be resolved safely, **When** reporting completes, **Then** the affected identities are counted as review rather than silently merged.
3. **Given** an existing completed run, **When** the projection is regenerated, **Then** no source pages are recollected and the approved snapshot is not replaced merely to update the dashboard.

### Edge Cases

- A single session appears on multiple sources with different ticket links.
- Two sources publish partially overlapping session schedules for the same activity.
- One activity uses multiple venue names that resolve to the same approved building.
- One activity truly moves between distinct venues and each venue has different sessions.
- A festival parent and its independently meaningful programme items must not be collapsed into one card.
- A session is cancelled, expired, held for date review, or unavailable from one source while sibling sessions remain active.
- An activity has selectable or anytime availability rather than enumerated sessions.
- A source offer applies to the activity generally rather than a single occurrence.
- A legacy record lacks a reliable parent activity identity.

## Scope and Constraints

- **In scope**: Activity-level grouping for public discovery and details; venue-grouped session presentation; activity- and session-scoped source offers; stable projection from existing normalized occurrences; accurate pipeline and dashboard counts; regression tests; existing-run projection without source recollection; deployment of the updated Sites dashboard.
- **Out of scope**: Re-scraping source websites, changing venue-authority policy, inventing missing sessions or URLs, changing event inclusion rules, user accounts, checkout, and replacing external ticketing systems.
- **Evidence and dependencies**: All public details and offers retain their source provenance. Existing normalized and approved artifacts may be reprojected, but source evidence is not fabricated or broadened.
- **Privacy and lifecycle**: Public discovery remains anonymous. Grouping does not introduce personal data or new retention. Expired sessions are removed individually; an activity expires only after it has no active or future session or flexible availability.
- **Experience**: Grouped discovery and details work with keyboard, touch, desktop, and mobile layouts in the browsers required by the constitution. Loading, empty, stale, missing-session, and review states remain explicit.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST expose a stable activity identity separately from venue, occurrence/session, merged-source, and source-offer identities.
- **FR-002**: The system MUST present each distinct activity once in event discovery while retaining every independently selectable or reconcilable occurrence.
- **FR-003**: The system MUST group an activity's occurrences by resolved venue when venue grouping is relevant and MUST keep distinct physical venues separate.
- **FR-004**: The system MUST order exact sessions chronologically and provide concise summaries for recurring, selectable, anytime, and large-session activities.
- **FR-005**: Date, venue, and search filters MUST match against occurrences but return each matching activity once.
- **FR-006**: The system MUST preserve source offers as provenance-backed, deduplicated links scoped to the whole activity or to the exact session(s) they support.
- **FR-007**: When sources for the same activity contain differing schedules, the system MUST union independently evidenced sessions and MUST isolate only direct contradictions about the same session for review.
- **FR-008**: The system MUST prevent similar but materially different productions, festival programme items, editions, casts, or independently bookable activities from being collapsed.
- **FR-009**: The system MUST define stable create, update, no-op, expire, and review behavior independently for activities, sessions, venue group membership, and source offers.
- **FR-010**: An expired or cancelled session MUST be removable without deleting active siblings; an activity MUST remain until no current/future session or flexible availability remains.
- **FR-011**: Unresolved grouping MUST hold or review only the affected identities and MUST preserve the last safe approved representation when applicable.
- **FR-012**: Publication artifacts MUST carry an explicit schema version and validate that activity membership, session identities, venue grouping, offer scope, and counts reconcile without loss or duplication.
- **FR-013**: Pipeline reports and dashboard payloads MUST separately report distinct activities, occurrences/sessions, venue groups, source offers, grouping reviews, and duplicate collapses using unambiguous labels.
- **FR-014**: The dashboard MUST update automatically from future finalized pipeline outputs and MUST be regenerable from an existing completed run without recollecting sources.
- **FR-015**: The public UI MUST provide loading, empty, missing-session, stale, held/review, and error behavior without presenting unavailable actions.
- **FR-016**: Grouping and projection decisions MUST emit sufficient structured logging to trace parent selection, membership, review decisions, and count reconciliation.
- **FR-017**: Existing occurrence-level mapping, venue resolution, date review, deduplication, and atomic publication protections MUST continue to operate without requiring a clean source run for this implementation.

### Key Entities

- **Activity**: The user-facing thing to do, with stable identity, shared descriptive fields, lifecycle, and memberships.
- **Venue Group**: A resolved or explicitly off-map place grouping the sessions of one activity at that location.
- **Occurrence/Session**: A stable, independently scheduled, expirable, and optionally bookable instance of an activity.
- **Source Offer**: A provenance-backed official-information or ticket link scoped to an activity or specific sessions.
- **Grouping Review**: A held decision for unsafe activity membership or conflicting evidence.
- **Activity Projection**: The validated publication and dashboard representation derived from accepted occurrences without recollection.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Fixtures containing repeated sessions render exactly one discovery result per expected activity and retain 100% of expected active session identities.
- **SC-002**: Activity, occurrence, venue-group, and source-offer totals reconcile exactly in publication validation and dashboard payload tests.
- **SC-003**: A visitor can reach any listed session and its applicable source offer from the activity detail in at most three interactions.
- **SC-004**: Date and venue filter tests return no duplicate activity cards and omit no activity with a matching active session.
- **SC-005**: Updating the Sites dashboard and regenerating the activity projection from the latest completed run performs zero source collection requests.
- **SC-006**: Grouping uncertainty, cancellation, expiry, and source-outage regression tests demonstrate that unrelated activities and sibling sessions remain publishable.
- **SC-007**: The production build and all relevant event pipeline, publication, discovery, dashboard, and accessibility interaction tests pass.
- **SC-008**: The activity projection for the current stored run completes within 10 seconds on the development machine and does not add continuous client polling or hidden rendering work.

## Assumptions

- The existing parent activity, parent listing, occurrence, and merged-source identities provide a migration base but require validated activity-level projection rather than being treated as interchangeable.
- One activity card is the default for repeated sessions; session identity remains the unit of booking, expiry, and exact schedule selection.
- Venue aliases already approved as the same OneMap building form one venue group; distinct buildings remain distinct groups.
- Existing normalized artifacts are sufficient for implementation validation and dashboard regeneration, so source collection will not be rerun.
- The existing Sites visual direction is retained; this feature changes information architecture, labels, and activity/session metrics rather than initiating a visual redesign.
