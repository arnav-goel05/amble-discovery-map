# Feature Specification: What's Here Full-Product Baseline

**Feature Branch**: `main` (no branch-creation hook configured)

**Created**: 2026-07-14

**Status**: Ready for planning

**Input**: Define the complete public-production baseline for What's Here, covering event
discovery on a 3D Singapore map, event details, anonymous planning, Telegram challenges,
restaurant and deal discovery, weekly data refresh, venue resolution, and private
administration.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover nearby events on the map (Priority: P1)

As a Singapore resident or tourist, I can explore current and upcoming events through
their real-world buildings on an interactive map without creating an account.

**Why this priority**: Location-based event discovery is the product's central value.

**Independent Test**: Open the public service on a supported desktop or mobile browser,
move around Singapore, and confirm that approved event locations and their event pills are
discoverable and remain correctly attached to their buildings.

**Acceptance Scenarios**:

1. **Given** approved events from the run date through the following seven days, **When** a user views
   their area, **Then** the corresponding buildings and event pills are visible.
2. **Given** several events at one location, **When** a user selects that location,
   **Then** every current event is available without overlapping duplicate highlights.
3. **Given** no approved event in the visible area, **When** the map is viewed,
   **Then** the normal building map remains visible without fabricated event markers.

---

### User Story 2 - Search, filter, and inspect event details (Priority: P1)

As a user, I can search and filter events and open a consistent detail panel containing the
information needed to decide whether to attend.

**Why this priority**: Discovery is useful only when users can narrow choices and understand
the result.

**Independent Test**: Search by event, venue, and date; apply each category filter; open a
result; and verify its title, schedule, venue, description, navigation controls, planning
action, and official link behavior.

**Acceptance Scenarios**:

1. **Given** matching events, **When** a user searches or applies a filter, **Then** only
   matching event locations and pills remain in the result set.
2. **Given** an event with an official link, **When** its panel opens, **Then** the link
   action is visible and opens the official source.
3. **Given** an event without an optional field or official link, **When** its panel opens,
   **Then** the field is empty or says "Not available" and no link action is shown.
4. **Given** multiple events at one venue, **When** the user uses the event navigation,
   **Then** the panel changes event without closing or losing the selected venue.

---

### User Story 3 - Build an anonymous outing plan (Priority: P2)

As a user, I can add events and restaurants to an ordered plan, review warnings and travel
estimates, and open the resulting route in Google Maps without an account.

**Why this priority**: Planning converts discovery into a usable outing.

**Independent Test**: Add an event and restaurant, reorder the stops, review route details,
remove a stop, and open the final route without signing in.

**Acceptance Scenarios**:

1. **Given** eligible event and restaurant results, **When** a user adds and reorders them,
   **Then** the plan preserves the chosen stop order.
2. **Given** a plan with schedule or restaurant-hour conflicts, **When** the plan is
   reviewed, **Then** the user sees actionable warnings before starting it.
3. **Given** a valid ordered plan, **When** the user opens the route, **Then** Google Maps
   receives the stops in the same order.
4. **Given** an inactive anonymous plan, **When** seven days pass without activity,
   **Then** it is deleted.

---

### User Story 4 - Play a Telegram challenge (Priority: P2)

As a user with a plan, I can start an optional Telegram challenge, follow ordered missions,
verify arrival or task completion, and receive a recap.

**Why this priority**: The game turns a route into the product's distinctive social
experience while remaining optional.

**Independent Test**: Start a challenge, complete missions using location and photo paths,
pause and resume, test a duplicate update, finish the game, and verify the recap and data
cleanup.

**Acceptance Scenarios**:

1. **Given** a reviewed plan, **When** the user starts a challenge, **Then** Telegram opens
   with an immutable mission order and clear readiness information.
2. **Given** a location submission, **When** it satisfies the snapshotted verification
   rules, **Then** the current mission advances exactly once.
3. **Given** an uncertain photo result, **When** automatic verification cannot decide,
   **Then** progress pauses for administrator review rather than being accepted.
4. **Given** a challenge session reaches `completed`, `timed_out`, `quit`, or `revoked`,
   **When** the terminal transition commits, **Then** related photo-verification data is
   deleted; a non-terminal abandoned session is deleted within seven days.

---

### User Story 5 - Discover restaurants and verified deals (Priority: P2)

As a user, I can reveal restaurants in the current map view, distinguish them clearly from
events, inspect available details, add a restaurant to my plan, and see a deal only when it
has official evidence.

**Why this priority**: Dining is a complementary part of an outing and must not overwhelm
the core event map.

**Independent Test**: Request restaurants for several map areas, select a marker, inspect
its details and evidence, add it to a plan, close the mode, and verify the event map remains
unchanged.

**Acceptance Scenarios**:

1. **Given** restaurant mode is off, **When** the user explores the map, **Then** restaurant
   results do not obscure event discovery.
2. **Given** restaurant mode is requested, **When** results load, **Then** a loading
   indicator appears without a separate temporary popup, followed by distinct selectable
   restaurant markers.
3. **Given** an officially evidenced deal, **When** its restaurant is selected, **Then** the
   deal and source are shown.
4. **Given** no official deal evidence, **When** its restaurant is selected, **Then** no
   deal is claimed.

---

### User Story 6 - Refresh and reconcile trusted data weekly (Priority: P1)

As the operator, I can run a complete weekly refresh that collects free authoritative
sources, covers the next seven days, reuses approved evidence, resolves eligible venues,
updates changed content, expires old content, verifies the result, and publishes it
atomically.

**Why this priority**: The public experience depends on repeatable, trustworthy data rather
than manual one-off edits.

**Independent Test**: Run a refresh against fixtures containing new, changed, unchanged,
expired, ambiguous, unavailable-source, and invalid records; verify every classification,
the final report, and the published or preserved snapshot.

**Acceptance Scenarios**:

1. **Given** unchanged approved data, **When** the refresh runs, **Then** it is classified
   as no-op and is neither re-researched nor rewritten.
2. **Given** an existing location with changed events, **When** the refresh runs, **Then**
   the highlight is reused and its events are updated by stable identity.
3. **Given** expired events, **When** reconciliation runs, **Then** expired events are
   removed and locations with remaining current or future events are preserved.
4. **Given** a partial or failed run, **When** finalization occurs, **Then** the last approved
   production snapshot remains active and the report lists unresolved work.

---

### User Story 7 - Review unresolved venues privately (Priority: P1)

As the sole administrator, I can sign in to a private interface, compare evidence for an
unresolved venue, approve or reject a candidate, and reuse that decision in future runs.

**Why this priority**: Ambiguous venues cannot be safely published without accountable
human adjudication.

**Independent Test**: Sign in, review competing candidates and evidence, approve one case,
reject another, sign out, and confirm that public users cannot access either the interface
or its actions.

**Acceptance Scenarios**:

1. **Given** an unauthenticated user, **When** the admin interface or action is requested,
   **Then** access is denied without revealing privileged data.
2. **Given** an unresolved venue after automated recovery, **When** the administrator
   reviews it, **Then** the interface presents the source venue, address evidence,
   geographic candidates, competing candidates, and reasons for uncertainty.
3. **Given** an approved decision, **When** the same evidence appears in a later run,
   **Then** the approved mapping is reused without repeated research.

---

### User Story 8 - Continue safely through external outages (Priority: P2)

As a user, I can continue using the last trustworthy dataset when a source is temporarily
unavailable and can tell that the information may be outdated.

**Why this priority**: A public service should degrade honestly instead of becoming empty
or publishing incomplete data.

**Independent Test**: Make each external source unavailable in turn and verify that the
last approved applicable data remains usable, receives a stale indication, and is replaced
only after a later verified refresh.

**Acceptance Scenarios**:

1. **Given** a source outage and approved prior data, **When** the app is used, **Then** the
   prior data remains visible with a potentially-outdated indication.
2. **Given** a source outage without approved prior data, **When** its feature is requested,
   **Then** the user sees a clear unavailable state and no invented results.

### Edge Cases

- An event has a date but no time, an end date but no start time, or no trustworthy date.
- A listing repeats the same detail URL or source identity across categories or pages.
- Two venue aliases resolve to different buildings or share only generic words.
- A venue describes a room, floor, tenant, outdoor area, or parent landmark rather than a
  standalone mapped building.
- A mapped building consists of several tiles or candidate geometries that could create
  duplicate opaque and highlighted layers.
- The map is moved rapidly while event pills, restaurants, filters, and panels are active.
- A location loses its final current event while background geometry is already loaded.
- A restaurant lacks an official website, blocks retrieval, or publishes expired deal text.
- A user closes or reloads the page during plan editing or challenge creation.
- Telegram sends duplicate, delayed, inaccurate, future-dated, or out-of-order updates.
- A task is abandoned and never emits a normal completion action.
- The sole administrator loses a session or submits the same decision twice.
- A weekly source becomes paid, changes its contract, or is unavailable for the entire run.

## Scope and Constraints *(mandatory)*

- **In scope**: Public 3D map discovery, event search and filters, event pills and panels,
  weekly event ingestion and venue resolution, restaurant and official-deal discovery,
  anonymous outing plans, Google Maps route handoff, Telegram challenges, private venue and
  uncertain-photo review, lifecycle cleanup, and production-safe refresh behavior.
- **Out of scope**: Public user accounts, profiles, paid data or fallback services, public
  plan-sharing pages, mandatory accessibility certification, product analytics, user
  tracking, daily database backups, multi-host deployment, and unsupported browsers.
- **Evidence and dependencies**: Data collection uses only free services, free APIs, and
  open data. Event and deal claims require official-source traceability. Geographic bridging
  may use approved open map data, but publication requires an approved OneMap building
  match. A service that ceases to be free is removed until a free replacement is approved.
- **Privacy and lifecycle**: Public discovery and planning are anonymous. Related Telegram
  photo-verification data is deleted when the task ends, or within seven days if abandoned.
  Inactive anonymous plans are deleted within seven days. No user analytics or product
  telemetry is collected.
- **Experience**: Current Chrome, Safari, Firefox, and Edge are supported on desktop and
  mobile. Apple Human Interface Guidelines inform decisions about hierarchy, spacing,
  feedback, touch interaction, and motion. Accessibility is best-effort rather than a
  release gate. No fixed initial-load deadline applies, but regressions must be detected.
- **Operations**: Initial production runs on one host. Approved event and venue data needed
  for reproducible deployment is version-controlled; temporary downloads, caches,
  intermediate runs, and routine reports are not.

## Requirements *(mandatory)*

### Functional Requirements

#### Public event discovery

- **FR-001**: The service MUST allow anonymous users to explore approved event locations on
  an interactive 3D Singapore map.
- **FR-002**: Each event highlight MUST correspond to exactly one approved mapped building
  identity and MUST NOT duplicate the normal building geometry as a second visible layer.
- **FR-003**: The service MUST preserve normal background buildings when no event highlight
  applies or when a highlight expires.
- **FR-004**: Event pills MUST show the complete event title in a compact, consistent form
  and remain associated with their location while the map moves or resizes.
- **FR-005**: Users MUST be able to search by event title, venue, and date.
- **FR-006**: Users MUST be able to filter events by supported categories within the
  currently relevant result set.
- **FR-007**: Selecting an event pill MUST open one singleton event panel rather than create
  venue-specific panel variants.
- **FR-008**: The event panel MUST show title, date or date range, time when known, venue,
  description, and an explicit unavailable state for missing optional content.
- **FR-009**: The official event-link action MUST appear only when an official link exists.
- **FR-010**: A location with multiple events MUST expose every current event through clear
  previous and next controls and an event position indicator.

#### Weekly event data and venue resolution

- **FR-011**: The event pipeline MUST run weekly and request events from the run date through
  the following seven days.
- **FR-012**: The pipeline MUST use only checked-in, approved definitions for free event
  sources and MUST NOT rediscover known source endpoints during a normal run.
- **FR-013**: Every collected record MUST retain source identity, official source URL,
  retrieval time, filter window, and normalization provenance.
- **FR-014**: The pipeline MUST normalize valid partial records and leave unavailable
  optional fields empty rather than reject or fabricate them.
- **FR-015**: The pipeline MUST assign stable identities to source events and deduplicate
  repeated listings before publication.
- **FR-016**: The venue resolver MUST first reuse an approved evidence-backed mapping, then
  use saved event address evidence and official venue evidence before geographic matching.
- **FR-017**: Geographic bridge data MAY narrow candidates but MUST NOT replace approval of
  the final OneMap building identity and geometry.
- **FR-018**: Automated recovery MUST review competing candidates and perform bounded
  resolution attempts before returning an unresolved outcome.
- **FR-019**: An unresolved venue MUST NOT appear publicly until the sole administrator
  approves it.
- **FR-020**: Approved aliases MUST merge only when evidence shows they resolve to the same
  building identity.
- **FR-021**: Reconciliation MUST classify every eligible item as create, update, no-op,
  expire, or review.
- **FR-022**: Reconciliation MUST reuse unchanged highlights, replace changed events by
  stable identity, remove expired events, and remove a managed location only after it has
  no current or future events.
- **FR-023**: Undated events MUST be preserved for review rather than deleted
  speculatively.
- **FR-024**: A new dataset MUST be staged, verified, and published atomically; partial or
  failed runs MUST leave the previous approved dataset active.

#### Anonymous plans and route handoff

- **FR-025**: Anonymous users MUST be able to add and remove eligible events and restaurants
  from a plan.
- **FR-026**: Users MUST be able to reorder plan stops and see the current stop count.
- **FR-027**: Plan review MUST show mission order, approximate route distance and travel
  time, schedule warnings, venue warnings, restaurant-hour gaps, and challenge readiness.
- **FR-028**: Users MUST be able to select an Explorer, Detective, or Food Trail challenge
  theme and an optional timer.
- **FR-029**: The route handoff MUST preserve the reviewed stop order in Google Maps.
- **FR-030**: Editing a plan MUST NOT require a public account or profile.
- **FR-031**: Plan data MUST be persisted only for challenge launch and continuation. Its
  activity timestamp MUST be set at creation and refreshed only by successful game creation;
  read-only plan retrieval MUST NOT extend retention.
- **FR-032**: Inactive anonymous plans MUST be deleted within seven days.
- **FR-033**: Starting a challenge MUST create an immutable snapshot so later source-plan
  changes cannot alter an active player's missions.

#### Telegram challenges

- **FR-034**: Challenge availability MUST be optional and its readiness MUST be visible
  before launch.
- **FR-035**: A player MUST be able to start, view status and route, pause, resume, skip,
  quit, and receive a recap.
- **FR-036**: Player sessions MUST survive an application restart during their valid
  lifetime.
- **FR-037**: Duplicate deliveries MUST NOT advance a mission or apply a manual decision
  more than once.
- **FR-038**: Location verification MUST reject stale, future-dated, insufficiently
  accurate, or geographically distant evidence with an actionable retry message.
- **FR-039**: Location verification MUST use approved building geometry when available and
  a documented coordinate-distance fallback otherwise.
- **FR-040**: Reused photo submissions within the same game MUST be rejected.
- **FR-041**: An uncertain photo result MUST pause progression for private administrator
  review and MUST NOT be automatically accepted.
- **FR-042**: Related photo-verification data MUST be deleted when the complete challenge
  session reaches `completed`, `timed_out`, `quit`, or `revoked`; an individual mission ending
  MUST NOT be treated as the session retention boundary. Non-terminal abandoned-session data
  MUST be deleted within seven days; image bytes MUST NOT be retained.
- **FR-043**: Temporary Telegram delivery failures MUST preserve due player replies for
  retry without processing the originating action twice.

#### Restaurants and official deals

- **FR-044**: Restaurant discovery MUST be user-initiated and limited to the map area
  relevant to the user's current view.
- **FR-045**: While restaurant discovery is running, its toolbar control MUST become a
  spinning progress indicator without opening a separate loading panel.
- **FR-046**: Restaurant markers MUST be visually distinct from event highlights and MUST
  provide a clear selected state.
- **FR-047**: Users MUST be able to close restaurant mode and remove its markers and panel
  without disturbing event state.
- **FR-048**: Restaurant details MUST identify the restaurant and show available cuisine,
  address, website, and verified deal evidence without inventing missing values.
- **FR-049**: A restaurant website MUST be accepted as official only when supported by the
  free source evidence or approved review.
- **FR-050**: A deal MUST be published only when matching promotion language is present on
  an official page and the evidence is current.
- **FR-051**: Restaurant and deal data MUST refresh weekly using only free sources and
  respecting publisher access rules.
- **FR-052**: Users MUST be able to add an eligible restaurant result to the same anonymous
  plan used for events.

#### Private administration

- **FR-053**: A private admin interface MUST support exactly one administrator account with
  password-based authentication.
- **FR-054**: Public users MUST be denied access to admin data and mutation actions.
- **FR-055**: Admin credentials MUST be managed outside version-controlled project data.
- **FR-056**: Venue review MUST present the unresolved input, verified address evidence,
  candidate building identities and locations, competing candidates, confidence reasons,
  and prior attempts.
- **FR-057**: The administrator MUST be able to approve, reject, or retain an unresolved
  venue for later review, and repeated submissions MUST be safe.
- **FR-058**: Approved venue and photo-review decisions MUST retain decision evidence and be
  reusable by later deterministic processing.

#### Reliability, privacy, and product constraints

- **FR-059**: Only free services, free APIs, and open data MUST be used; no paid fallback
  MAY be invoked.
- **FR-060**: A source that becomes paid MUST be disabled until a free replacement is
  approved.
- **FR-061**: When a source is unavailable, the service MUST preserve applicable last
  approved data and visibly mark it as potentially outdated.
- **FR-062**: When no approved fallback data exists, the service MUST show an unavailable
  state rather than invented or incomplete results.
- **FR-063**: The product MUST NOT collect user analytics, behavioral tracking, or product
  telemetry.
- **FR-064**: Operational records MUST be limited to information necessary for reliability
  and security and MUST avoid unnecessary personal data.
- **FR-065**: The initial production baseline MUST operate on one application host.
- **FR-066**: Automatic daily database backups are not required by this baseline.
- **FR-067**: Approved event and venue data required for reproducible deployment MUST be
  version-controlled.
- **FR-068**: Temporary downloads, caches, intermediate runs, and routine reports MUST NOT
  be treated as approved production artifacts.
- **FR-069**: Release validation MUST pass the automated desktop/mobile Chromium, WebKit,
  and Firefox matrix. Current branded Chrome, Safari, Firefox, and Edge installations,
  simulators, and emulators MAY provide additional evidence when freely available, but an
  unexercised branded-browser/device combination MUST NOT block release.
- **FR-070**: UI decisions MUST use Apple Human Interface Guidelines as a design reference
  while preserving consistent What's Here styling across supported browsers.
- **FR-071**: The service MUST provide consistent loading, empty, missing-data, stale,
  selected, disabled, and error states for every public workflow.
- **FR-072**: Accessibility improvements SHOULD be applied when practical but are not a
  release-blocking acceptance condition.
- **FR-073**: The service MUST avoid continuous idle rendering, polling, layout measurement,
  and animation work without a measured product need.
- **FR-074**: Rendering optimizations MAY reduce quality temporarily during movement but
  MUST restore full final visual quality after movement stops.
- **FR-075**: Performance-sensitive changes MUST be compared with a repeatable before-and-
  after measurement; no fixed initial-load deadline is imposed.
- **FR-076**: Every production change MUST pass the production build and all relevant
  automated tests before completion.
- **FR-077**: Relevant tests MUST cover success, failure, retry or recovery, lifecycle,
  privacy cleanup, and partial-publication paths in proportion to risk.
- **FR-078**: A pipeline report MUST distinguish complete success, safe partial completion,
  and failure and MUST list unresolved work and next actions.

### Key Entities

- **Source Record**: An immutable captured event or restaurant listing with source identity,
  official URL, retrieval time, requested window, and provenance.
- **Event**: A normalized activity with stable source identity, title, schedule, optional
  content, category, official link, and venue reference.
- **Venue Evidence**: Names, aliases, official address evidence, geographic candidates,
  confidence reasons, and an evidence hash used during resolution.
- **Approved Venue Mapping**: A reusable decision connecting venue evidence to one approved
  building identity, tile or geometry evidence, and coordinates.
- **Landmark**: A public map location containing one or more current or future events and
  its display and geometry state.
- **Restaurant**: A free-source place record with identity, location, available descriptive
  fields, official-website evidence, and optional verified deals.
- **Deal Evidence**: Current matching promotion content and retrieval provenance from an
  approved official restaurant page.
- **Plan**: An anonymous, ordered collection of event and restaurant stops with activity
  time and lifecycle expiry.
- **Game Snapshot**: An immutable challenge definition derived from a reviewed plan,
  including mission order, verification rules, theme, and optional timer.
- **Player Session**: One Telegram player's progress, idempotency state, and lifecycle for a
  game snapshot.
- **Verification Record**: Short-lived location or photo decision data, excluding photo
  bytes, linked to a task and its deletion deadline.
- **Admin Review**: An authenticated, idempotent decision with evidence, status, and reuse
  implications for an unresolved venue or uncertain photo.
- **Pipeline Run**: A weekly execution with source outcomes, stage classifications,
  verification results, publication decision, unresolved work, and terminal status.
- **Approved Snapshot**: The complete verified dataset currently eligible for public use.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can discover an event, open its complete available details, and add it
  to a plan without creating an account in every supported browser family.
- **SC-002**: 100% of published event locations have an approved building identity,
  coordinates, geometry evidence, and traceable venue evidence.
- **SC-003**: 100% of published event details and restaurant deals that make factual claims
  retain a working official-source reference at publication time.
- **SC-004**: A weekly successful event refresh covers the run date and following seven
  days and accounts for every eligible record as create, update, no-op, expire, or review.
- **SC-005**: Fixture-based reconciliation produces zero duplicate event identities, zero
  duplicate building layers, and zero removals of locations that retain a current or future
  event.
- **SC-006**: Incomplete refresh verification publishes zero partial records and leaves the
  previously approved snapshot unchanged in every tested failure stage.
- **SC-007**: A user can create, reorder, review, and route a mixed event-and-restaurant plan
  without an account, and inactive plan data is absent after seven days.
- **SC-008**: Duplicate Telegram updates and repeated manual decisions advance or mutate a
  challenge no more than once in all automated recovery tests.
- **SC-009**: Completed-task photo-verification data is deleted at task closure, abandoned-
  task data is absent after seven days, and retained photo bytes equal zero.
- **SC-010**: Public users cannot read or perform private admin actions, while the sole
  authenticated administrator can complete each review outcome.
- **SC-011**: During a simulated source outage, users either retain the last approved data
  with a visible stale indication or receive an explicit unavailable state; fabricated
  results equal zero.
- **SC-012**: Restaurant mode can be opened, used, and closed without changing the current
  event result set or leaving restaurant markers behind.
- **SC-013**: Every production change reports a passing production build and all relevant
  automated test suites before it is marked complete.
- **SC-014**: A repeatable performance check detects any regression introduced by a
  rendering-sensitive change, and full visual quality returns after map movement stops.
- **SC-015**: Weekly production collection invokes zero paid services and records zero
  product analytics or behavioral telemetry events.

## Assumptions

- Users have internet access and can optionally use Google Maps and Telegram when choosing
  those workflows.
- The service targets Singapore and the geographic evidence needed to match Singapore
  buildings remains available through approved free or open sources.
- Event and restaurant providers may omit optional fields; absence is acceptable when it is
  represented honestly.
- The sole administrator is trusted to adjudicate evidence and protect their credential.
- Weekly scheduling is operated externally; this baseline defines run behavior rather than
  a separate scheduling product.
- Operational logs needed to diagnose reliability or security issues are not product
  analytics and contain no unnecessary personal data.
- Backup and disaster-recovery automation may be added later through a separately approved
  specification.
