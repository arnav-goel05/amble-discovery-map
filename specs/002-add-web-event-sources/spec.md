# Feature Specification: Expand Singapore Event Discovery

**Working Branch**: `develop`

**Created**: 2026-07-17

**Updated**: 2026-07-18

**Status**: Ready for planning

**Input**: Expand Singapore activity discovery through Fever Singapore, Visit Singapore,
Singapore Film Society, Roots/HAN, Honeycombers, ArtsEquator, and Time Out Singapore;
integrate them with Catch.sg and SISTIC; retain all active and future activities exposed by
the configured source surfaces; support off-map activities; deduplicate across every source;
and make collection, review, and publication traceable and failure-safe. The approved policy
record is maintained in [policy-review.md](policy-review.md).

## Clarifications

### Session 2026-07-18

- Q: What qualifies for inclusion? → A: Include genuine active or future Singapore events
  and activities, including book-anytime experiences; exclude expired listings, pure
  promotions, and ordinary admission to standard attractions unless a special programme is
  offered.
- Q: How should schedules be handled? → A: Preserve exact, ranged, recurring, selectable,
  anytime, and unverified schedules without restricting ingestion to the current week.
- Q: Must every activity map to one building? → A: No; valid secret, mobile, broad-area, and
  unresolved multi-location activities remain discoverable off-map.
- Q: Can editorial sources authorize publication? → A: First seek direct corroboration, but
  sufficiently detailed and consistent Honeycombers, ArtsEquator, or Time Out evidence may
  publish independently.
- Q: How should duplicates be handled? → A: Publish one logical activity with all compatible
  source provenance while keeping distinct sessions, venues, editions, and uncertain matches
  separate.
- Q: When may a building be highlighted? → A: Only when reliable evidence identifies one
  compatible OneMap building; units map to the parent building.
- Q: What should block publication? → A: Isolate source, event, deduplication, and venue
  uncertainty; preserve the entire prior snapshot only when the assembled release is unsafe.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover Active Singapore Activities (Priority: P1)

As a resident or visitor, I can discover genuine active and future Singapore events and
activities from all configured sources, including scheduled, recurring, selectable-date,
and book-anytime experiences, so useful options are not discarded by a weekly date filter.

**Why this priority**: Broad, accurate activity coverage is the feature's primary user value.

**Independent Test**: Process representative records for every enabled direct source and
verify that all reachable records receive an explained include, review, exclude, or archive
outcome, with active and future eligible activities retained regardless of week.

**Acceptance Scenarios**:

1. **Given** a genuine physical Singapore activity is active or future, **When** it is
   collected, **Then** it remains eligible whether it has an exact date, recurrence,
   selectable schedule, or intentional anytime availability.
2. **Given** ordinary admission to Universal Studios or Bird Paradise, **When** it is
   assessed, **Then** it is excluded, while a seasonal or special programme at the same
   attraction is included.
3. **Given** a pure promotion with no distinct activity, an online-only listing, an overseas
   occurrence, or an activity whose final known occurrence has passed, **When** it is
   assessed, **Then** it is explicitly excluded or archived rather than silently lost.
4. **Given** a date-dependent activity has no reliable schedule, **When** normalization
   completes, **Then** it is retained as `schedule_unverified` for review without an invented
   date.
5. **Given** Roots/HAN remains unavailable because its source contract is not reliable,
   **When** collection runs, **Then** it is reported as unavailable, is not fetched, and does
   not fabricate or reuse unapproved records.

---

### User Story 2 - Discover Activities Without Exact Buildings (Priority: P1)

As a user, I can discover valid secret-location, mobile, broad-area, and multi-location
activities outside the building map, so unusual things to do are not hidden merely because
they cannot yet be attached to one OneMap building.

**Why this priority**: The product goal values unusual activities, many of which intentionally
lack a conventional fixed venue.

**Independent Test**: Supply exact-building, unit-level, secret, mobile, broad-area,
multi-location, and conflicting-location fixtures and verify the correct mapped, off-map, or
review state and user-facing placement.

**Acceptance Scenarios**:

1. **Given** reliable evidence identifies one Singapore building, **When** venue resolution
   completes, **Then** the activity has mapped public placement and approved mapping status.
2. **Given** a unit is inside a uniquely identified parent building, **When** it is resolved,
   **Then** the parent building is highlighted and the unit remains visible as venue detail.
3. **Given** a secret or not-yet-announced venue, **When** it is published, **Then** it appears
   in a dedicated `Secret / Location TBA` off-map view and later moves onto the map under the
   same activity identity when authoritative venue information appears.
4. **Given** a multi-location activity has reliable venue-to-session pairings, **When** it is
   normalized, **Then** it has separate venue occurrences under one parent activity;
   otherwise it appears once in a `Multiple locations` off-map view.
5. **Given** a mobile route or broad outdoor area has an authoritative meeting point,
   **When** it is processed, **Then** the meeting point may be mapped and the route or area is
   retained; without such a point, the activity remains off-map.
6. **Given** location evidence conflicts or several OneMap buildings remain plausible,
   **When** resolution ends, **Then** no building is guessed; an activity with reliable
   Singapore scope and usable general location remains off-map with pending mapping review,
   while an activity whose Singapore scope or usable location is itself uncertain is held.

---

### User Story 3 - Benefit From Curated Editorial Discovery (Priority: P1)

As a user looking for distinctive things to do, I can see eligible activities discovered by
Honeycombers, ArtsEquator, and Time Out even when no separate organizer page exists, provided
the editorial evidence is detailed, current, and internally consistent.

**Why this priority**: Editorial sources contribute the unusual activities that direct
ticketing sources often miss.

**Independent Test**: Process editorial detail pages and roundups with direct corroboration,
editorial-only sufficient evidence, incomplete entries, conflicting authority, promotions,
and repeated activities; verify the expected evidence state and publication outcome.

**Acceptance Scenarios**:

1. **Given** an editorial discovery matches an already-collected direct or official source,
   **When** confirmation completes, **Then** the direct evidence supplies current facts and
   the editorial discovery remains attached as provenance without duplication.
2. **Given** one editorial source provides a specific current Singapore activity, usable
   schedule or anytime state, enough evidence for mapped or off-map public placement, and no
   material contradiction, **When** no direct source is available, **Then** it may publish as
   `editorial_authoritative`.
3. **Given** several compatible editorial sources describe the same activity, **When** they
   are reconciled, **Then** one activity is published with every compatible source retained;
   repetition is treated as corroboration, not organizer ownership.
4. **Given** an editorial record is vague, promotional-only, materially contradictory, or
   missing required activity, schedule, or Singapore-scope evidence, **When** it is assessed,
   **Then** it is retained for review or excluded with an explicit reason.
5. **Given** a roundup contains reliably bounded activity entries, **When** it is parsed,
   **Then** each activity becomes an independently assessed candidate.

---

### User Story 4 - See One Logical Activity (Priority: P1)

As a user, I see one logical activity rather than duplicate copies from Catch.sg, SISTIC,
ticket types, categories, or new sources, while distinct sessions, venues, editions, and
performances remain available.

**Why this priority**: Expanded coverage is useful only when overlapping sources do not
degrade discovery with duplicate representations.

**Independent Test**: Supply exact repeats, direct/editorial overlaps, title variations,
ticket categories, selectable sessions, venue aliases, different editions, generic titles,
and weak similarities and verify deterministic merge and non-merge outcomes.

**Acceptance Scenarios**:

1. **Given** repeated source records or category/ticket variants describe one activity,
   **When** same-source reconciliation runs, **Then** one source activity remains with the
   repeated metadata retained.
2. **Given** compatible records across any configured sources describe the same activity,
   **When** cross-source reconciliation completes, **Then** one published activity retains all
   source contributions.
3. **Given** records differ materially by edition, year, organizer, schedule, or venue,
   **When** compared, **Then** they remain separate unless stronger evidence proves a match.
4. **Given** a match is plausible but insufficient, **When** deduplication completes, **Then**
   the records remain separate and a possible-duplicate review item is recorded.
5. **Given** a previously merged activity gains or loses a source or venue becomes known,
   **When** it is refreshed, **Then** its stable published identity is updated rather than
   replaced or duplicated.

---

### User Story 5 - Operate and Publish Safely (Priority: P2)

As the pipeline operator, I can trace every record and publish independently safe updates
without allowing an isolated outage or review item to block unrelated activities, while an
unsafe assembled release never replaces approved production data.

**Why this priority**: Expanded collection must remain diagnosable, resumable, and safe to
operate every week.

**Independent Test**: Exercise success, source outage, malformed record, incomplete source
accounting, location review, possible duplicate, interruption/resume, stale carry-forward,
release-wide validation failure, and atomic-activation failure fixtures.

**Acceptance Scenarios**:

1. **Given** one existing source is unavailable, **When** a run reconciles, **Then** its
   still-active approved source contributions are carried forward as stale while compatible
   current contributions may update the same merged activity and safe updates may publish.
2. **Given** a source is unavailable on its first run, **When** collection completes, **Then**
   nothing from it publishes, its outage is reported, and safe sources continue.
3. **Given** one activity or location has a material conflict, **When** finalization runs,
   **Then** only the affected identity or branch is held while unrelated safe records remain
   eligible.
4. **Given** source accounting is incomplete, **When** reconciliation runs, **Then** no
   deletion or replacement from that source is applied and its prior safe records are
   retained where still active.
5. **Given** the assembled snapshot is invalid, internally inconsistent, unsafe,
   unverifiable, or cannot activate atomically, **When** publication is attempted, **Then**
   the complete previous approved snapshot remains active.
6. **Given** a completed run, **When** an operator reads its reports, **Then** every encountered
   record is traceable to mapped publication, off-map publication, carry-forward, review,
   exclusion, or archive without exposing credentials.

### Edge Cases

- A listing repeats across categories, carousels, pagination, ticket tiers, editorial
  roundups, and multiple sources.
- A page combines an ordinary attraction ticket with a distinct seasonal programme.
- An open-ended activity has selectable slots but no final date.
- An event changes from secret venue to a known venue after publication.
- A film programme contains several screenings across several cinemas, with some but not all
  screening-to-cinema pairings available.
- A mall, campus, or venue complex contains several OneMap buildings under similar names.
- A source-provided coordinate disagrees with an official postal address.
- An editorial article is current but its linked organizer page has been removed.
- Two unrelated activities share a generic title, venue, and day.
- A source changes layout mid-pagination, rate-limits retrieval, challenges automation, or
  returns oversized, partial, or malformed content.
- A source outage occurs after some new records were collected but before completeness can
  be proven.
- A stale review item remains after its source record was replaced or its conflict resolved.

## Scope and Constraints *(mandatory)*

- **In scope**: Maintain Catch.sg and SISTIC; integrate Fever Singapore, Visit Singapore,
  Singapore Film Society, Roots/HAN, Honeycombers, ArtsEquator, and Time Out Singapore;
  retrieve bounded public source surfaces; retain all exposed active and future eligible
  activities; normalize schedule, placement, and mapping states; split reliable multi-location
  occurrences; support mapped and off-map discovery; corroborate or independently qualify
  editorial evidence; deduplicate within and across all sources; resolve exact buildings;
  isolate review and outage impact; publish atomically; and produce structured operational
  accounting and logs.
- **Out of scope**: ArtEvents.sg in this iteration; unbounded general-web discovery;
  historical listings whose final occurrence has passed; online-only and physically
  overseas activities; continuously available general admission to permanent fixed
  attractions without a distinct named, seasonal, limited, facilitated, or participatory
  programme; pure promotions without an underlying activity; circumventing authentication,
  CAPTCHAs, access controls, robots rules, or source restrictions; paid collection services;
  automatically guessing ambiguous buildings; and treating search snippets, directories,
  user-generated map listings, social posts, or generic homepages as sole evidence.
- **Source roles**: Catch.sg, SISTIC, Fever Singapore, Visit Singapore, and Singapore Film
  Society provide direct source evidence. Honeycombers, ArtsEquator, and Time Out provide
  trusted editorial evidence that first seeks direct corroboration but may authorize a
  sufficiently evidenced activity independently. Roots/HAN remains explicitly unavailable
  until its source contract is revalidated.
- **Evidence and dependencies**: Collection uses only approved free retrieval capability.
  Every activity retains its source page and evidence state. Event authority and exact
  building authority are evaluated separately. Missing optional values remain unavailable.
- **Privacy and lifecycle**: Only public activity and venue information is collected. No
  attendee, purchaser, account, or personal contact data is collected. Credentials remain
  server-side. Routine captures, caches, traces, and reports remain untracked; approved
  versioned evidence follows the existing snapshot and registry lifecycle.
- **Experience**: The public experience supports mapped activities plus dedicated off-map
  discovery for secret/location-TBA and multiple-location records, with date views such as
  this week, this month, later, and anytime. Required desktop/mobile Chromium, WebKit, and
  Firefox coverage remains the release compatibility gate.
- **Run cadence and coverage**: Collection runs weekly and covers at least the run date
  through the following seven days, while retaining all active and future eligible records
  exposed by each configured bounded source surface.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define all nine configured sources independently with a direct,
  editorial, or unavailable role and deterministic bounded collection rules.
- **FR-002**: Collection MUST use only an approved free retrieval capability and MUST fail
  closed before network access when its credential, policy, destination, or free-use status
  is invalid.
- **FR-003**: Roots/HAN MUST remain visible as explicitly unavailable, MUST NOT be fetched,
  and MUST NOT contribute fabricated or copied historical records until revalidated.
- **FR-004**: Every enabled source MUST account for every encountered listing or reliably
  bounded roundup entry across all reachable configured pages, without repeated canonical
  records causing duplicate captures.
- **FR-005**: Every processed record MUST retain immutable source evidence, canonical link,
  stable source identity, retrieval time, source version, and terminal outcome sufficient to
  reproduce its interpretation.
- **FR-006**: Source interpretation MUST preserve available title, description, organizer,
  schedule, sessions, availability, venue, address, coordinates, category, price, access
  restrictions, and official links without inventing missing values.
- **FR-007**: Every genuine active or future physical Singapore event or activity exposed by
  a configured source MUST remain eligible regardless of whether it is scheduled, recurring,
  selectable-date, or book-anytime.
- **FR-008**: Ordinary standard-attraction admission—whose primary product is continuously
  offered general entry to a permanent fixed attraction during its normal operating schedule
  and adds no distinct named programme, seasonal overlay, limited run, facilitated workshop,
  tour, or participatory experience—MUST be excluded. Pure promotions without a distinct
  activity, online-only listings, overseas occurrences, and expired activities MUST be
  excluded or archived with an explicit reason. A selectable entry time alone does not turn
  ordinary admission into a special programme; a genuinely distinct special or seasonal
  programme at the same attraction MUST remain eligible.
- **FR-009**: Exact dates, ranges, recurrences, selectable sessions, intentional anytime
  availability, and final known dates MUST remain distinct schedule states and MUST NOT be
  flattened into fabricated occurrences.
- **FR-010**: A date-dependent record with no reliable schedule MUST be retained as
  `schedule_unverified`; an intentionally open-ended record MUST be retained as `anytime`.
- **FR-011**: Only Singapore physical or hybrid occurrences MAY enter the physical discovery
  experience; mixed Singapore/overseas records MUST retain only their Singapore occurrences.
- **FR-012**: Every eligible activity MUST receive independent public-placement
  (`mapped`, `off_map`, or `none`) and mapping-status (`approved`, `not_required`, or
  `pending_review`) values independently of its event-evidence, lifecycle, and freshness.
- **FR-013**: Reliable multi-location venue-to-session pairings MUST become distinct venue
  occurrences under one parent activity; unresolved pairings MUST remain one off-map
  multiple-location activity.
- **FR-014**: Secret/location-TBA, unresolved multiple-location, mobile, and broad-area
  activities MUST remain discoverable in dedicated off-map views and MUST move to a mapped
  state under the same stable identity when sufficient evidence appears.
- **FR-015**: A building highlight MUST require compatible venue-name, address, postal-code,
  coordinate when available, and OneMap building evidence sufficient to identify one logical
  building without material conflict.
- **FR-016**: A unit number MUST map to its verified parent building while remaining visible
  as venue detail; a complex with several plausible buildings MUST enter location review.
- **FR-017**: Reliable Singapore activities without compatible building geometry MUST remain
  off-map. A plausible building ambiguity with reliable Singapore scope and usable general
  location MUST remain off-map with `pending_review` mapping status. A conflict that makes
  Singapore scope or the usable general location uncertain MUST use public placement `none`
  and be held. No ambiguous case may receive a guessed building.
- **FR-018**: Within one source, specific activity/detail evidence MUST take precedence over
  its schedule selector, individual listing entry, and general guide or category text in that
  order; unresolved equally specific conflicts MUST enter review.
- **FR-019**: Source-specific rules MAY interpret website structure and terminology but MUST
  NOT override shared inclusion, schedule, location, evidence, or expiry rules through a
  keyword alone.
- **FR-020**: Editorial discoveries MUST first attempt reuse of an already-collected direct
  record or an explicit compatible official page before relying on editorial-only evidence.
- **FR-021**: An editorial-only record MAY publish as `editorial_authoritative` only when it
  identifies a specific current Singapore activity, has a usable schedule or anytime state,
  has enough location evidence to assign mapped or off-map public placement under FR-012 and
  FR-017, contains more than a pure promotion, and has no material internal contradiction.
- **FR-022**: Editorial roundups MUST expand into independently assessed candidates where
  entry boundaries are reliable; insufficient or conflicting editorial evidence MUST retain
  an explicit review or exclusion outcome.
- **FR-023**: Source-record, parent-activity, session-or-venue-occurrence, and published-event
  identities MUST remain separate and stable.
- **FR-024**: Same-source repetitions, categories, and ticket variants describing one
  activity MUST collapse without losing their non-identity metadata.
- **FR-025**: Compatible records across Catch.sg, SISTIC, and every new source MUST merge into
  one published activity with every contribution retained as provenance.
- **FR-026**: Title or raw venue similarity alone MUST NOT authorize a merge; distinct
  editions, organizers, schedules, sessions, and venues MUST remain separate, and uncertain
  matches MUST remain distinct with an audited possible-duplicate outcome.
- **FR-027**: A changed schedule, source membership, venue state, or evidence level MUST
  update the existing stable activity identity instead of creating a replacement duplicate.
- **FR-028**: Each source, activity, occurrence, venue branch, and review item MUST end with a
  terminal accounted outcome and an exact reason code.
- **FR-029**: An unavailable or incomplete source MUST NOT apply unproven deletions or
  replacements; its still-active approved source contributions MUST be carried forward as
  stale while safe contributions from complete sources remain eligible for publication. A
  merged activity's freshness MUST be derived from its contributing fields/sources without
  preventing compatible current evidence from updating the same activity.
- **FR-030**: The assembled snapshot MUST be staged and activated atomically only after
  release-wide data consistency, identity, geometry, build, security, and browser gates pass;
  a release-wide failure MUST preserve the complete previous approved snapshot.
- **FR-031**: Structured privacy-safe reporting MUST trace every encountered record through
  collection, interpretation, schedule/placement/mapping state, editorial evidence, deduplication,
  review, reconciliation, and terminal publication outcome, including reused, retried,
  carried-forward, and stale states without exposing secrets.
- **FR-032**: Collection and reconciliation MUST be resumable and idempotent with bounded
  pagination, timeouts, retries, redirects, response sizes, and recovery attempts.
- **FR-033**: External retrieval MUST validate destinations and redirects, restrict public
  domains and response size, respect source access rules, and keep credentials server-side.
- **FR-034**: Automated tests MUST cover every source contract and all agreed inclusion,
  schedule, placement, mapping, editorial-authority, deduplication, freshness, review, atomic
  rollback, logging-redaction, and lifecycle outcomes.
- **FR-035**: Operational documentation MUST explain source roles, policy reason codes,
  schedule, placement, mapping, lifecycle, and freshness states, evidence levels,
  deduplication, review, safe resume, reports, and release-wide rollback.
- **FR-036**: The public experience MUST provide one representation per published logical
  activity and accessible mapped, secret/location-TBA, multiple-location, loading, empty,
  stale, missing-data, and error states.

### Key Entities

- **Event Source Definition**: Versioned direct, editorial, or unavailable source contract
  containing its domains, bounded entry points, interpretation rules, identity, and policy.
- **Source Record**: One stable listing, detail page, or bounded roundup entry with immutable
  evidence and a terminal outcome.
- **Parent Activity**: The overall event, experience, exhibition, production, or programme.
- **Activity Session**: A scheduled, recurring, selectable, or anytime availability unit
  belonging to a parent activity.
- **Venue Occurrence**: One location-specific manifestation of an activity or session.
- **Published Event**: The single user-facing activity assembled from compatible source
  contributions while preserving its sessions and venue occurrences.
- **Schedule State**: Exact, ranged, recurring, selectable, anytime, or unverified schedule
  evidence and its final known occurrence.
- **Public Placement**: Mapped, off-map, or none; controls where an active activity appears.
- **Mapping Status**: Approved, not required, or pending review; records whether building
  resolution is complete without determining event validity or public placement by itself.
- **Lifecycle State**: Active, held, archived, or excluded event lifecycle.
- **Freshness State**: Current or stale, derived from source/field contributions and
  independent of mapped/off-map placement.
- **Source Contribution Freshness**: Per-source and per-displayed-field refresh status used to
  derive an activity's freshness without preventing current compatible evidence from updating
  the merged activity.
- **Editorial Evidence State**: Directly corroborated, editorial-authoritative, incomplete,
  conflicting, or excluded evidence outcome.
- **Deduplication Decision**: Audited merge, distinct, repeat, or possible-duplicate outcome.
- **Review Item**: Scoped event-evidence, schedule, identity, deduplication, or location issue
  with lifecycle and resolution history.
- **Source Run Status**: Per-source terminal state, accounting, retry/resume information,
  stale carry-forward effect, and continuation details.
- **Snapshot Manifest**: Immutable staged catalogue containing source contributions,
  carried-forward identities, validation results, and atomic activation outcome.
- **Operational Trace Record**: Privacy-safe lineage record connecting run, source, entity,
  stage, action, evidence, reason, timing, and terminal outcome.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Representative complete fixtures for every configured source reconcile 100% of
  encountered listings and bounded roundup entries to a terminal outcome without unexplained
  record loss.
- **SC-002**: Active and future fixture records outside the current week, including anytime
  activities, achieve 100% expected retention, while expired, pure-promotion, ordinary
  attraction-admission, online-only, and overseas fixtures achieve 100% expected exclusion or
  archive outcomes.
- **SC-003**: Location fixtures produce 100% expected mapped, off-map, and review outcomes,
  with zero building highlights created from ambiguous or conflicting evidence.
- **SC-004**: Editorial fixtures publish 100% of sufficiently evidenced direct-corroborated
  and editorial-only activities, retain 100% of supporting provenance, and publish zero
  insufficient or materially conflicting records automatically.
- **SC-005**: In a duplicate corpus spanning all configured sources, every confirmed
  duplicate collapses to one logical activity and zero distinct editions, sessions, or venue
  occurrences are incorrectly merged.
- **SC-006**: Re-running or resuming identical evidence produces byte-equivalent normalized
  identities and no duplicate source records, activities, sessions, venue occurrences,
  review items, pills, or highlights.
- **SC-007**: Every tested isolated source, activity, deduplication, and venue failure affects
  only its scoped identities, while every tested release-wide validation or activation
  failure leaves the complete previous approved snapshot unchanged.
- **SC-008**: Operators can trace 100% of encountered fixture records to mapped publication,
  off-map publication, stale carry-forward, review, exclusion, or archive, and redaction tests
  expose zero credential or authorization values.
- **SC-009**: Representative maximum-size fixtures remain within every configured pagination,
  timeout, retry, response-size, redirect, and recovery bound with no unbounded loop.
- **SC-010**: Required desktop/mobile Chromium, WebKit, and Firefox tests show one
  representation per published logical activity and no regression in mapped, off-map,
  loading, empty, stale, missing-data, or error states.

## Assumptions

- “All possible data available” means every active and future eligible record reachable
  through the configured bounded public source surfaces, not unlimited historical or
  general-web crawling.
- Weekly execution remains the operational cadence and the current seven-day period remains
  a minimum required coverage subset, not an ingestion cutoff.
- Catch.sg, SISTIC, Fever Singapore, Visit Singapore, and Singapore Film Society are direct
  sources for their public records.
- Honeycombers, ArtsEquator, and Time Out are trusted editorial sources that may publish
  independently when their evidence satisfies FR-021.
- Roots/HAN remains unavailable until an operator revalidates its changed source contract.
- The existing event pipeline, admin review, map, snapshot, and browser-test boundaries are
  extended rather than replaced with a parallel system.
- Exact building approval and activity publication are separate decisions; a valid activity
  may publish off-map.
