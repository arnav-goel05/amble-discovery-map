# Tasks: Expand Singapore Event Discovery

**Input**: Design documents in `specs/002-add-web-event-sources/`

**Branch**: Execute all tasks on `develop`; do not create or switch branches unless the user
explicitly requests it.

**Baseline**: Historical tasks T001–T080 implemented and verified the original seven-source
pipeline. This list starts at T081 and contains only the approved policy delta.

**Tests**: Required by FR-034 and the constitution. Write each listed test before its
corresponding implementation and confirm that it fails for the intended missing behavior.

## Phase 1: Setup and Migration Fixtures

**Purpose**: Establish versioned delta fixtures and migration evidence without changing live
runtime data.

- [x] T081 Add v3 activity, schedule, evidence, location, publication, and prior-snapshot migration fixture manifests in `tests/fixtures/event-sources/README.md`
- [x] T082 [P] Add mapped, secret-TBA, multiple-location, mobile-route, broad-area, anytime, selectable-session, and stale-carry-forward fixture data in `tests/fixtures/event-sources/policy-v3/manifest.json`
- [x] T083 [P] Add direct/editorial/unavailable source-role and editorial-sufficiency fixture data in `tests/fixtures/event-sources/authority/policy-v3-manifest.json`

---

## Phase 2: Foundational Contracts and Schema Migration

**Purpose**: Versioned contracts shared by all five user stories.

**Critical**: No user-story implementation begins until this phase passes.

### Tests

- [x] T084 [P] Add failing direct/editorial/unavailable role, enabled/disabled state, v2 migration, and bounded-source validation tests in `tests/event-source-contract.test.mjs`
- [x] T085 [P] Add failing v3 parent-activity, schedule, session, venue-occurrence, evidence, public-placement, mapping-status, lifecycle, and freshness contract tests in `tests/event-pipeline.test.mjs`
- [x] T086 [P] Add failing v2 approved-snapshot migration into orthogonal placement/mapping/lifecycle/freshness fields and stable-identity compatibility tests in `tests/event-publication.test.mjs`
- [x] T087 [P] Add failing new reason-code, trace-schema, accounting, stale-state, and redaction tests in `tests/event-pipeline.test.mjs`

### Implementation

- [x] T088 Update all nine definitions to direct/editorial/unavailable roles, enabled/disabled state, and editorial policy v2 while retaining Roots unavailability in `data/event-pipeline-config.json`
- [x] T089 Extend source-definition migration and validation for the new role/state contract in `scripts/verify-event-source-adapters.mjs`
- [x] T090 Add pure shared inclusion, schedule, editorial-sufficiency, public-placement, mapping-status, lifecycle, and freshness primitives in `scripts/lib/event-sources/activity-policy.mjs`
- [x] T091 Extend normalized artifact schema and v2 migration for parent activities, schedule states, sessions, and venue occurrences in `scripts/event-normalizer.mjs`
- [x] T092 Extend immutable snapshot schema/migration with independent public-placement, mapping-status, lifecycle, freshness, and field/source contribution freshness in `scripts/lib/approved-snapshot.mjs`
- [x] T093 Extend trace validation and reporting vocabularies for evidence, schedule, off-map, carry-forward, hold, and rollback outcomes in `scripts/lib/event-sources/trace.mjs` and `scripts/lib/event-pipeline/reporting.mjs`

**Checkpoint**: Old approved data migrates deterministically and every new state validates
before behavior changes.

---

## Phase 3: User Story 1 - Discover Active Singapore Activities (Priority: P1)

**Goal**: Retain all active/future scheduled or anytime activities and narrowly exclude only
the approved non-activity cases.

**Independent Test**: All direct-source policy fixtures receive the expected eligible,
schedule-review, exclusion, or archive outcome without a weekly ingestion cutoff.

### Tests

- [x] T094 [P] [US1] Add failing active/future exact, range, recurring, selectable, anytime, unverified, expired, promotion, online, and overseas normalization tests in `tests/event-pipeline.test.mjs`
- [x] T095 [P] [US1] Add failing behavioral ordinary-admission versus named/special/seasonal/facilitated-programme tests proving no attraction-title hardcoding in `tests/event-source-contract.test.mjs`
- [x] T096 [P] [US1] Add failing Fever detail-only, open-date, selectable-date, waitlist, unrelated-page-text, and special-attraction fixtures/tests in `tests/event-source-contract.test.mjs`
- [x] T097 [P] [US1] Add failing Visit Singapore guide-entry, SFS member-only, Catch.sg, and SISTIC future-horizon regression tests in `tests/event-source-contract.test.mjs`

### Implementation

- [x] T098 [US1] Replace weekly-window eligibility with active/future lifecycle and finite recurrence handling in `scripts/lib/event-sources/activity-policy.mjs` and `scripts/event-normalizer.mjs`
- [x] T099 [US1] Restrict Fever classification to its individual listing/detail evidence and retain open-date, selectable, waitlist, and valid special-programme activities in `scripts/lib/event-sources/fever.mjs`
- [x] T100 [P] [US1] Extract individual Visit Singapore guide happenings without discarding valid future activities in `scripts/lib/event-sources/visit-singapore.mjs`
- [x] T101 [P] [US1] Retain SFS access restrictions and screening schedules as metadata rather than exclusions in `scripts/lib/event-sources/singapore-film-society.mjs`
- [x] T102 [US1] Remove collection-window data loss while preserving bounded traversal, terminal accounting, and explicit archive outcomes in `scripts/event-source-collector.mjs`
- [x] T103 [US1] Reconcile final-known-date expiry and preserve anytime/unverified lifecycle states in `scripts/reconcile-event-content.mjs`

**Checkpoint**: Direct sources retain every active/future eligible activity and never invent a
schedule.

---

## Phase 4: User Story 2 - Discover Activities Without Exact Buildings (Priority: P1)

**Goal**: Publish valid mapped and off-map activities with correct session and venue identity.

**Independent Test**: Exact-building, unit, secret, multi-location, route, broad-area,
geometry-missing, and conflicting-location fixtures reach the expected user-facing state.

### Tests

- [x] T104 [P] [US2] Add failing parent/session/venue-occurrence identity and reliable/unreliable multi-location split tests in `tests/event-reconciliation.test.mjs`
- [x] T105 [P] [US2] Add failing mapped/approved, off-map/not-required, off-map/pending-review, held/pending-review, parent-unit, secret, multi-location, route, broad-area, and geometry tests in `tests/event-map-reconciliation.test.mjs`
- [x] T106 [P] [US2] Add failing mapped/off-map frontend projection and no-fake-coordinate tests in `tests/event-discovery-model.test.mjs`
- [x] T107 [P] [US2] Add failing mapped, Secret / Location TBA, Multiple locations, anytime, stale, keyboard, touch, empty, and error browser tests in `tests/event-discovery.spec.mjs` and `tests/event-ui.spec.mjs`

### Implementation

- [x] T108 [US2] Build stable parent activities, finite sessions, and venue occurrences and split only reliable venue-session pairs in `scripts/event-normalizer.mjs`
- [x] T109 [US2] Assign public placement independently from mapping status, keeping reliable Singapore activities off-map during exact-building review and holding only unusable location/scope conflicts in `scripts/event-pipeline.mjs`
- [x] T110 [US2] Preserve exact OneMap/parent-building approval while returning independent placement/mapping outcomes for intentional off-map, reviewable ambiguity, and unusable conflicts in `scripts/resolve-venues-locally.mjs`
- [x] T111 [US2] Project independent placement, mapping, lifecycle, freshness, schedules, sessions, and venue occurrences into approved frontend data in `scripts/event-frontend-snapshot.mjs`
- [x] T112 [US2] Extend discovery filtering and selection semantics for mapped and off-map activities in `activity-scenes/events/event-discovery-model.js`
- [x] T113 [US2] Add mapped, Secret / Location TBA, and Multiple locations views plus this-week, this-month, later, and anytime filters beside search in `activity-scenes/landmark-event-search.js`
- [x] T114 [US2] Style responsive off-map views, state labels, focus, touch targets, loading, empty, stale, and error behavior in `style.css`

**Checkpoint**: A valid activity is discoverable even without one exact building, and map
highlights remain evidence-safe.

---

## Phase 5: User Story 3 - Benefit From Curated Editorial Discovery (Priority: P1)

**Goal**: Corroborate editorial activities when possible and publish sufficient editorial-only
evidence when no direct record exists.

**Independent Test**: Direct-corroborated, several-editorial, one-sufficient-editorial,
incomplete, conflicting, promotional, and later-upgrade fixtures receive exact evidence states.

### Tests

- [x] T115 [P] [US3] Add failing direct reuse, direct corroboration, editorial-only sufficiency, multi-editorial corroboration, conflict, and evidence-upgrade tests in `tests/event-authority-confirmation.test.mjs`
- [x] T116 [P] [US3] Add failing Honeycombers, ArtsEquator, and Time Out detail/roundup tests proving valid activities survive guide and evergreen containers in `tests/event-source-contract.test.mjs`
- [x] T117 [P] [US3] Add failing editorial publication, provenance, missing-optional-field, off-map, and accounting tests in `tests/event-pipeline.test.mjs`

### Implementation

- [x] T118 [US3] Replace mandatory outbound authority with direct-reuse-first and deterministic editorial-sufficiency assessment in `scripts/lib/event-sources/authority-confirmation.mjs`
- [x] T119 [P] [US3] Remove broad editorial-container exclusions while preserving bounded entry splitting and pure-promotion rejection in `scripts/lib/event-sources/honeycombers.mjs` and `scripts/lib/event-sources/time-out-singapore.mjs`
- [x] T120 [P] [US3] Retain identifiable attendable arts programmes while excluding standalone non-attendable opportunities in `scripts/lib/event-sources/arts-equator.mjs`
- [x] T121 [US3] Promote sufficient editorial evidence into normalized parent activities while preserving evidence level, primary attribution, and every contribution in `scripts/event-source-collector.mjs` and `scripts/event-normalizer.mjs`
- [x] T122 [US3] Report editorial evidence levels and upgrades without double-counting unique activities in `scripts/lib/event-pipeline/reporting.mjs`

**Checkpoint**: Trusted editorial sources contribute unusual activities without fabricated
authority or duplicate events.

---

## Phase 6: User Story 4 - See One Logical Activity (Priority: P1)

**Goal**: Deduplicate every source and new schedule, placement, and mapping state while preserving distinct
sessions, venues, editions, and stable published identities.

**Independent Test**: All-source exact/variant/anytime/off-map fixtures produce deterministic
merge or distinct outcomes and retain all provenance.

### Tests

- [x] T123 [P] [US4] Add failing same-source category/ticket repeat and all-source direct/editorial merge tests in `tests/event-deduplication.test.mjs`
- [x] T124 [P] [US4] Add failing anytime, secret, multiple-location, generic-title, sibling-session, distinct-edition, and uncertain-match tests in `tests/event-deduplication.test.mjs`
- [x] T125 [P] [US4] Add failing prior-anchor stability across evidence, source-membership, schedule, and location-state changes in `tests/event-reconciliation.test.mjs`

### Implementation

- [x] T126 [US4] Extend candidate evidence and safe merge rules for parent activities, sessions, venue occurrences, anytime, and off-map states in `scripts/lib/event-sources/deduplicate.mjs`
- [x] T127 [US4] Collapse category/ticket repeats without collapsing sibling sessions or venue occurrences in `scripts/event-normalizer.mjs`
- [x] T128 [US4] Preserve published anchors while updating source membership, evidence level, sessions, and location state in `scripts/reconcile-event-content.mjs`
- [x] T129 [US4] Ensure frontend reconciliation emits one logical result with multiple sessions/venue occurrences and no duplicate pills/highlights in `activity-scenes/events/event-map-reconciliation.js`

**Checkpoint**: One logical activity appears once, with every legitimate child occurrence and
source contribution preserved.

---

## Phase 7: User Story 5 - Operate and Publish Safely (Priority: P2)

**Goal**: Isolate source/event/location uncertainty, carry forward stale identities safely,
and retain release-wide atomic rollback.

**Independent Test**: Isolated outage/review fixtures publish unrelated safe updates, while
invalid assembled-release fixtures preserve the entire prior snapshot.

### Tests

- [x] T130 [P] [US5] Add failing contribution-level stale carry-forward, mixed current/stale merged activity, existing/first-run outage, incomplete accounting, malformed isolation, and expiry tests in `tests/event-publication.test.mjs`
- [x] T131 [P] [US5] Add failing isolated event/location/dedup review and superseded admin-queue reconciliation tests in `tests/event-pipeline.test.mjs` and `tests/admin-repository.test.mjs`
- [x] T132 [P] [US5] Add failing schema, accounting, identity, geometry, security, build/browser, and atomic-activation release-wide rollback tests in `tests/event-publication.test.mjs`
- [x] T133 [P] [US5] Add failing per-source contribution versus unique-event reporting, field/source freshness derivation, stale reason, terminal lineage, and redaction tests in `tests/event-pipeline.test.mjs`

### Implementation

- [x] T134 [US5] Add complete/incomplete/unavailable per-source reconciliation, contribution-level stale carry-forward, and compatible current-field updates in `scripts/reconcile-event-content.mjs`
- [x] T135 [US5] Assemble orthogonal lifecycle, placement, mapping, freshness, safe updates, holds, and archives into one immutable candidate snapshot in `scripts/lib/approved-snapshot.mjs`
- [x] T136 [US5] Replace catalogue-wide source/venue review blocking with scoped identity outcomes while retaining release-wide gates in `scripts/event-pipeline.mjs`
- [x] T137 [US5] Extend exact continuation and terminal states for isolated incomplete/unavailable sources and release-wide rejection in `scripts/lib/event-pipeline/run-state.mjs`
- [x] T138 [US5] Reconcile only current evidence-hash review items and supersede recovered, replaced, or expired items in `scripts/lib/admin-repository.cjs`
- [x] T139 [US5] Emit per-identity carry-forward/hold/archive traces and release-wide validation/activation results in `scripts/event-pipeline.mjs` and `scripts/lib/event-pipeline/reporting.mjs`
- [x] T140 [US5] Align weekly wrapper success/stale/release-failure status with the v3 publication contract in `scripts/run-weekly-refresh.mjs`

**Checkpoint**: Isolated uncertainty stays isolated; unsafe assembled releases never activate.

---

## Phase 8: Documentation, Performance, and Release Evidence

**Purpose**: Align runtime contracts and prove the complete feature before a live run.

- [x] T141 [P] Update inclusion, schedule, editorial evidence, off-map, deduplication, carry-forward, and release-wide rollback rules in `skills/event-pipeline-runner/references/source-adapters.md` and `skills/event-pipeline-runner/references/pipeline-contract.md`
- [x] T142 [P] Update stage handoffs, continuations, terminal accounting, and snapshot activation in `skills/event-pipeline-runner/references/stage-handoffs.md` and `skills/event-pipeline-runner/references/executable-orchestrator.md`
- [x] T143 [P] Update operator status, stale carry-forward, review categories, troubleshooting, and rollback guidance in `docs/weekly-operations.md` and `specs/002-add-web-event-sources/quickstart.md`
- [x] T144 Update approved/off-map/stale artifacts versus ignored captures and traces in `scripts/verify-artifact-policy.mjs`
- [x] T145 Run focused source, policy, evidence, location, deduplication, reconciliation, publication, reporting, redaction, and discovery-model tests named in `specs/002-add-web-event-sources/quickstart.md`
- [x] T146 Run the production build and required desktop/mobile Chromium, WebKit, and Firefox event matrix for `tests/event-pipeline-staged.spec.mjs`, `tests/event-discovery.spec.mjs`, and `tests/event-ui.spec.mjs`
- [x] T147 Record before/after frontend performance evidence with `npm run benchmark:release` and fix any material policy-view regression in `activity-scenes/landmark-event-search.js` or `style.css`
- [x] T148 Run `npm run verify`, inspect `git status --short`, and record final fixture/build/browser/performance evidence in `specs/002-add-web-event-sources/quickstart.md`
- [x] T149 Run one complete bounded live event pipeline through `complete: true`, audit per-source/unique-event/off-map/review/stale/archive counts and traces, and record only approved reproducible outputs under `data/snapshots/`

---

## Dependencies and Execution Order

### Phase dependencies

- Setup (T081–T083) starts immediately.
- Foundation (T084–T093) depends on setup and blocks all user stories.
- US1 (T094–T103), US2 test design (T104–T107), and US3 adapter test design
  (T115–T117) may proceed after foundation.
- US2 implementation depends on the v3 normalized contract from US1/Foundation.
- US3 implementation depends on the v3 evidence contract from Foundation.
- US4 depends on the selected US1–US3 identity/evidence/location behavior.
- US5 depends on stable v3 reconciliation inputs from US1–US4.
- Release evidence depends on all selected stories.

### User story graph

```text
Setup -> Foundation -> US1 activity lifecycle -------┐
                    -> US2 off-map/location ----------┼-> US4 identity/dedup -> US5 publication safety -> Release
                    -> US3 editorial evidence --------┘
```

### Parallel opportunities

- T082–T083 create independent fixture sets.
- T084–T087 cover independent foundational contracts.
- T094–T097 split shared/source-specific activity policy tests.
- T104–T107 split identity, geography, projection, and browser tests.
- T115–T117 split evidence, adapter, and pipeline tests.
- T123–T125 split deduplication and lifecycle tests.
- T130–T133 split isolation, review, rollback, and reporting tests.
- T141–T143 update distinct runtime documentation owners.

## Parallel Examples

### User Story 1

```text
T094 + T095 + T096 + T097: shared and source-specific failing policy tests
T100 + T101: Visit Singapore and SFS adapter updates after tests fail
```

### User Story 2

```text
T104 + T105 + T106 + T107: identity, location, model, and browser tests
T112 + T114: discovery-model logic and styles after the UI contract is fixed
```

### User Story 3

```text
T115 + T116 + T117: evidence, source, and pipeline tests
T119 + T120: independent editorial adapter updates
```

### User Story 5

```text
T130 + T131 + T132 + T133: isolation, review, rollback, and reporting tests
T137 + T138: run-state and review-queue implementation after shared reconciliation is defined
```

## Implementation Strategy

### MVP

Complete Setup, Foundation, and US1 first. This corrects current data loss from weekly/open-date
filters without yet changing publication or UI behavior.

### Incremental delivery

1. Versioned schema and migration foundation.
2. Active/future and anytime activity lifecycle.
3. Parent/session/venue identities plus off-map discovery.
4. Editorial corroboration and editorial-only sufficiency.
5. All-state deduplication and stable anchors.
6. Per-identity reconciliation with release-wide atomic rollback.
7. Documentation, complete gates, then one bounded live run.

## Notes

- `[P]` means safe parallel work only after prerequisite phases.
- Off-map publication never authorizes an unverified building highlight.
- Editorial authority for an activity never automatically proves its map building.
- An incomplete source cannot apply delete/replace decisions from partial output.
- Raw evidence, traces, caches, checkpoints, and routine reports remain untracked.
- Preserve unrelated user changes and the untracked screen recordings.

## Phase 9: Convergence

- [x] T150 CRITICAL constrain rendered pagination and redirect destinations to each source's approved domains, enforce response-size limits before fully buffering content, and add boundary regression tests per Constitution V, FR-002, FR-033, and SC-009 (contradicts)
- [x] T151 Add exact Universal Studios and Bird Paradise ordinary-admission regressions and make standard-attraction exclusion behavioral without rejecting distinct programmes per FR-008 and US1/AC2 (partial)
- [x] T152 Classify unreliable date phrases such as TBA, to-be-confirmed, and coming-soon as held `schedule_unverified` across direct and editorial paths with regression coverage per FR-009, FR-010, FR-021, and US1/AC4 (partial)
- [x] T153 Require organizer compatibility or explicit stronger evidence before cross-source deduplication and test same-title, same-schedule, same-building events from different organizers per FR-026 and SC-005 (partial)
- [x] T154 Wire already-collected direct records and compatible editorial peers into production editorial confirmation before outbound authority retrieval, with collector integration tests per FR-020 and US3/AC1-US3/AC3 (partial)
- [x] T155 Add dedicated mobile-route and broad-area off-map views with keyboard, touch, empty, and discovery-model coverage per FR-014, FR-036, and SC-010 (partial)
- [ ] T156 Re-run focused tests, build, browser/performance gates, `npm run verify`, and one fresh bounded live pipeline on the final code; audit and document terminal source, deduplication, placement, review, archive, gate, and publication outcomes per SC-001-SC-010 and plan: final live verification (partial)

## Phase 10: Visit Singapore Listing Contract Repair

- [x] T157 Add failing TinyFish fresh selector-scoping, Visit Singapore embedded-card extraction, and inline listing-record accounting regressions in `tests/event-source-contract.test.mjs`
- [x] T158 Respect checked-in TinyFish format, freshness, and selector options without changing the default transport contract in `scripts/lib/event-sources/tinyfish-fetch.mjs`
- [x] T159 Parse every Visit Singapore `stb-event-and-festivals` card as a distinct stable source record and stop treating navigation or generic guide headings as listing events in `scripts/lib/event-sources/visit-singapore.mjs`
- [x] T160 Integrate listing-native records with rendered collection/provenance/accounting, update the Visit Singapore source contract, and run focused verification in `scripts/event-source-collector.mjs`, `data/event-pipeline-config.json`, and `tests/event-source-contract.test.mjs`

## Phase 11: Fever Listing Contract Repair

- [x] T161 Add failing Fever selected-card extraction, carousel deduplication, listing-evidence fallback, and `Date and time` label regressions in `tests/event-source-contract.test.mjs`
- [x] T162 Parse Fever plan-card identity and metadata and merge missing listing fields behind detail evidence in `scripts/lib/event-sources/fever.mjs` and `scripts/lib/event-sources/rendered-adapter-utils.mjs`
- [x] T163 Carry per-detail listing evidence through rendered collection with structured fallback logging and update the bounded Fever TinyFish selector contract in `scripts/event-source-collector.mjs` and `data/event-pipeline-config.json`
- [x] T164 Run focused tests, production build, and a fresh complete live pipeline; audit Fever and release-wide source, exclusion, deduplication, placement, and review counts from terminal artifacts

## Phase 12: Visit Singapore Event-Link Repair

- [x] T165 Add failing regressions proving authoritative listing CTAs become per-event source links, retain listing fallback evidence, and reject unsafe outbound redirects in `tests/event-source-contract.test.mjs`
- [x] T166 Preserve authoritative outbound CTA provenance through the generic rendered collector and merge Visit Singapore card evidence behind organizer-detail evidence in `scripts/event-source-collector.mjs` and `scripts/lib/event-sources/visit-singapore.mjs`
- [x] T167 Run focused contract tests and replay the saved Visit Singapore listing capture, retrieving only required organizer detail pages and auditing link/record outcomes without restarting unrelated sources

## Phase 13: Mobile Occurrence Classification Convergence

- [x] T168 Add focused normalizer regressions for an authoritative no-address cycling/walking tour, a multi-stop hop-on/hop-off route, a fixed venue whose title contains “tour”, and independently classified occurrences sharing one published venue label per FR-014, FR-019, US2/AC5, and SC-003 (partial)
- [x] T169 Infer `mobile_route` from sufficiently strong activity-level evidence only when no single usable meeting point is available, apply placement before venue resolution without venue-specific hardcoding, and run only the focused normalizer, reconciliation, and map-reconciliation tests per FR-012, FR-014, FR-019, and Constitution VII (partial)

## Phase 14: Time Out Multi-Surface Discovery

- [x] T170 Add failing Time Out regressions for bounded weekend, current-month, art, and concert sections; homepage month-route discovery; cross-surface URL collapse; and traversal accounting in `tests/event-source-contract.test.mjs`
- [x] T171 Extend bounded rendered-source traversal to checked-in and adapter-discovered listing surfaces with approved-domain validation, a shared ceiling, deterministic ordering, and trace logging in `scripts/event-source-collector.mjs` and `scripts/verify-event-source-adapters.mjs`
- [x] T172 Generalize the Time Out adapter and checked-in definition for weekly, weekend, dynamically discovered monthly, art-exhibition, and concert roundups while excluding navigation/recommendation zones in `scripts/lib/event-sources/time-out-singapore.mjs` and `data/event-pipeline-config.json`
- [x] T173 Run focused source-contract and adapter validation tests plus the production build without launching the complete live pipeline
