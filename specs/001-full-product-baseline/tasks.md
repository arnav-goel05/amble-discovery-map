# Tasks: What's Here Full-Product Baseline

**Input**: Design documents from `specs/001-full-product-baseline/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`,
`quickstart.md`

**Tests**: Required. Write the story tests first, confirm that new assertions fail for the
intended reason, then implement. Every completed phase must pass its focused tests and the
production build when it changes bundled code.

**Organization**: User-story phases follow business priority: P1 discovery and trusted data
first, then P2 planning, games, restaurants, and resilience.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Safe to execute in parallel because the task owns different files and has no
  dependency on an incomplete task in the same phase.
- **[Story]**: Maps the task to a user story in `spec.md`.
- Every task names the exact file or directory it changes.

## Phase 1: Setup and release scaffolding

**Purpose**: Establish artifact, browser, fixture, configuration, and command scaffolding used
by all later phases without changing product behavior.

- [x] T001 Update `.gitignore` and the Git index to remove already tracked event runs, restaurant caches, local venue indexes, routine screenshots/reports, and database sidecars while preserving approved data and required POI assets
- [x] T002 Add a fail-fast command-suite runner with child exit propagation in `scripts/run-command-suite.mjs` and its focused tests in `tests/command-suite.test.mjs`; do not add the final `verify` command yet
- [x] T003 [P] Define automated desktop/mobile Chromium, WebKit, and Firefox projects with reusable server settings in `playwright.config.mjs`; actual-browser release evidence is handled separately
- [x] T004 [P] Create deterministic clock, temporary-state, source-record, venue, snapshot, plan, and restaurant fixture factories in `tests/helpers/baseline-fixtures.mjs`
- [x] T005 [P] Document server-only administrator, Telegram, storage, and free-provider configuration without real secrets in `.env.example` and `docs/production-configuration.md`
- [x] T006 [P] Add approved-versus-runtime artifact audit fixtures in `tests/fixtures/artifact-policy/README.md`

**Checkpoint**: Test and release scaffolding is present; no public behavior has changed.

---

## Phase 2: Foundational contracts and shared boundaries

**Purpose**: Implement versioned contracts, free-provider policy, snapshot loading, common
HTTP/UI boundaries, and shared design tokens required by every story.

**⚠️ CRITICAL**: Complete this phase before starting a user-story implementation.

### Tests

- [x] T007 [P] Add failing contract tests for source envelopes, occurrences, venue evidence/reviews, snapshots, result envelopes, and lifecycle timestamps in `tests/baseline-contracts.test.mjs`
- [x] T008 [P] Add failing free/open allowlist and paid-provider rejection tests in `tests/provider-policy.test.mjs`
- [x] T009 [P] Add failing active-snapshot loading, hash validation, missing-pointer, and stale-metadata tests in `tests/approved-snapshot.test.mjs`

### Implementation

- [x] T010 Implement versioned runtime validators and stable reason-code errors for shared entities in `scripts/lib/contracts/baseline-contracts.mjs`
- [x] T011 Implement fail-closed free/open provider validation and provenance helpers in `scripts/lib/provider-policy.mjs`
- [x] T012 Add approved owner/domain/cost classifications for event and restaurant providers in `data/provider-policy.json`
- [x] T013 Implement immutable snapshot manifest validation and atomic active-pointer reads in `scripts/lib/approved-snapshot.mjs`
- [x] T014 Implement same-origin JSON envelopes, bounded-body parsing, public error mapping, and security headers in `scripts/lib/http-contract.cjs`
- [x] T015 [P] Implement a shared browser API client that understands fresh, stale, unavailable, and error envelopes in `activity-scenes/shared/api-client.js`
- [x] T016 [P] Extract shared color, typography, spacing, radius, touch-target, motion, loading, stale, and error tokens into `styles/design-tokens.css` and import them from `style.css`
- [x] T017 Create `scripts/migrate-approved-snapshot.mjs`, migrate existing approved landmarks/POIs/tiles without stable-ID changes into `data/snapshots/initial/`, and atomically create `data/approved-snapshot.json` only after equivalence validation
- [x] T018 Wire shared HTTP helpers and the initial approved snapshot into `scripts/serve-app.cjs` and `main.js`, run `tests/baseline-contracts.test.mjs`, `tests/provider-policy.test.mjs`, `tests/approved-snapshot.test.mjs`, and `npm run build`, then record the foundational checkpoint in `specs/001-full-product-baseline/quickstart.md`

**Checkpoint**: Shared contracts are versioned and validated, paid providers fail closed, one
approved snapshot can be loaded safely, and the production build passes.

---

## Phase 3: User Story 1 — Discover nearby events on the map (Priority: P1) 🎯 MVP

**Goal**: Anonymous users can see approved event buildings and compact full-title pills while
normal buildings remain correct and duplicate geometry is impossible.

**Independent Test**: Inject a validated fixture snapshot, open the map on desktop and mobile,
move/zoom/resize it, and verify approved highlights/pills, multiple-event locations, empty
areas, POI/background separation, and final-quality restoration.

### Tests

- [x] T019 [P] [US1] Add failing browser coverage for anonymous startup, complete compact pill titles, anchor updates, multi-event landmarks, empty snapshots, and mobile map controls in `tests/event-discovery.spec.mjs`
- [x] T020 [P] [US1] Add failing geometry tests for one approved building identity, no double opaque/highlight layer, and background restoration in `tests/poi-background-lifecycle.test.mjs`
- [x] T021 [P] [US1] Add failing unit tests for stable landmark reconciliation and unchanged-hash no-op behavior in `tests/event-map-reconciliation.test.mjs`

### Implementation

- [x] T022 [US1] Make `main.js` consume only the validated active snapshot contract while preserving the injected-snapshot test boundary
- [x] T023 [US1] Reconcile combined highlighted POI geometry by stable snapshot/POI identity and prevent background/POI batch overlap in `map-layers/building-highlight-layers.js`
- [x] T024 [US1] Preserve full event titles in compact pills and reconcile add/update/noop/remove by stable identity in `activity-scenes/landmark-event-pill.js`
- [x] T025 [US1] Keep pill and direction positioning event-driven on move, zoom, resize, selection, and reconciliation in `activity-scenes/landmark-event-pill.js` and `activity-scenes/landmark-direction-indicator.js`
- [x] T026 [US1] Replace the internal spike warning/startup copy with a progressive production map shell and explicit snapshot loading/error states in `index.html`, `main.js`, and `style.css`
- [x] T027 [US1] Run `node --test tests/event-map-reconciliation.test.mjs tests/poi-background-lifecycle.test.mjs`, `npm run test:poi-separation`, `npx playwright test -c playwright.config.mjs tests/event-discovery.spec.mjs`, and `npm run build`

**Checkpoint**: User Story 1 is independently usable as the public event-map MVP.

---

## Phase 4: User Story 2 — Search, filter, and inspect event details (Priority: P1)

**Goal**: Users can narrow events and inspect one consistent, complete, honest detail panel.

**Independent Test**: Search by title/venue/date, combine search with categories, open single
and multiple-event venues, navigate with icons, verify optional-link behavior and unavailable
fields, then filter out the selection and confirm all state clears.

### Tests

- [x] T028 [P] [US2] Add failing unit tests for normalized title/venue/date search, category composition, selection removal, and multiple-event ordering in `tests/event-discovery-model.test.mjs`
- [x] T029 [P] [US2] Extend browser tests for panel singleton behavior, complete display contract, unavailable fields, optional official links, icon navigation, position indicator, close, and mobile layout in `tests/event-ui.spec.mjs`
- [x] T030 [P] [US2] Add failing overlay-coordination tests for event, restaurant, and plan mutual exclusion in `tests/overlay-coordinator.test.mjs`

### Implementation

- [x] T031 [US2] Extract pure event search/filter/selection reconciliation into `activity-scenes/events/event-discovery-model.js`
- [x] T032 [US2] Make search controls consume the shared model and reconcile one filtered identity set in `activity-scenes/landmark-event-search.js`
- [x] T033 [US2] Enforce the singleton panel display contract and missing-data/link rules in `activity-scenes/landmark-event-panel.js`
- [x] T034 [US2] Implement icon-only previous/next/close actions with accessible names and stable event position in `activity-scenes/landmark-event-panel.js`
- [x] T035 [US2] Align event panel, pill, search, empty, selected, and error styling with shared tokens in `style.css`
- [x] T036 [US2] Run `node --test tests/event-discovery-model.test.mjs tests/overlay-coordinator.test.mjs`, `npm run test:event-ui`, and `npm run build`

**Checkpoint**: User Stories 1 and 2 provide complete anonymous event discovery and details.

---

## Phase 5: User Story 6 — Refresh and reconcile trusted data weekly (Priority: P1)

**Goal**: The weekly event pipeline covers the run date plus seven following days, preserves
provenance, reuses approved work, resolves safely, reconciles by occurrence identity, and
publishes only a fully verified immutable snapshot.

**Independent Test**: Run fixtures containing new, changed, unchanged, expired, undated,
not-mappable, ambiguous, duplicate-detail, multi-occurrence, source-outage, retry, and
interrupted-publication cases; verify accounting and the active pointer after each run.

### Tests

- [x] T037 [P] [US6] Add failing inclusive +7-day/eight-calendar-date window, per-record provenance, free-source rejection, timeout/retry/backoff, duplicate-detail capture, and official event-reference status/redirect/domain tests in `tests/event-source-contract.test.mjs`
- [x] T038 [P] [US6] Add failing multi-occurrence replacement, merged-identity change, no-op, update, expiry, undated-review, and landmark-retention tests in `tests/event-reconciliation.test.mjs`
- [x] T039 [P] [US6] Add failing partial/source-outage/needs-review commit rejection, safe not-mappable accounting, atomic-pointer, crash/restart, stale-metadata, and rollback tests in `tests/event-publication.test.mjs`
- [x] T040 [P] [US6] Extend staged browser coverage for candidate snapshot injection, background separation, pills, panels, stale status, and previous-snapshot preservation in `tests/event-pipeline-staged.spec.mjs`

### Implementation

- [x] T041 [US6] Change the inclusive horizon to seven days and record free-source owner/domain policy in `data/event-pipeline-config.json` and `pull_data.md`
- [x] T042 [US6] Add bounded request timeout, retry/backoff, policy validation, per-record adapter/version/retrieval/window/listing provenance, and official event-reference status/redirect/domain validation in `scripts/event-source-collector.mjs`
- [x] T043 [US6] Preserve immutable occurrence IDs separately from parent listing and merged IDs in `scripts/event-normalizer.mjs`
- [x] T044 [US6] Reconcile by source occurrence identity and content hash without collapsing sibling performances in `scripts/reconcile-event-content.mjs`
- [x] T045 [US6] Keep approved reuse, evidence-hash cache, local enrichment/index resolution, competing candidates, and two bounded recovery paths while emitting durable review inputs in `scripts/event-pipeline.mjs`
- [x] T046 [US6] Split runner state, commit eligibility, terminal accounting, and report generation from the oversized orchestrator into `scripts/lib/event-pipeline/run-state.mjs` and `scripts/lib/event-pipeline/reporting.mjs`
- [x] T047 [US6] Implement immutable versioned snapshot staging, manifest hashes, atomic active-pointer swap, crash recovery, and previous-pointer rollback in `scripts/event-frontend-snapshot.mjs`
- [x] T048 [US6] Require source success, complete venue accounting, no pending review, geometry separation, build, and browser verification before commit in `scripts/event-pipeline.mjs`
- [x] T049 [US6] Emit active snapshot freshness, coverage, last-source-success, stale-after, and previous-snapshot metadata in `data/approved-snapshot.json` and the staged snapshot manifest
- [x] T050 [US6] Make `success`, `partial`, `blocked`, and `failed` reports distinguish publication from finalization and list exact next actions in `scripts/event-pipeline.mjs`
- [x] T051 [US6] Update the executable pipeline guidance for full-run, free-source, review-blocking, occurrence identity, and atomic-publication behavior in `AGENTS.md`, `skills/event-pipeline-runner/SKILL.md`, and `skills/event-pipeline-runner/references/pipeline-contract.md`
- [x] T052 [US6] Migrate unresolved run-relative cache entries from `data/venue-resolution-cache.json` to ignored `outputs/event-pipeline/venue-resolution-cache.json`, update readers in `scripts/event-pipeline.mjs`, and retain only approved evidence mappings in `data/venue-alias-registry.json`
- [x] T053 [US6] Prove the pipeline can use `data/snapshots/initial/` as its previous snapshot and publish the next immutable snapshot without changing stable landmark/POI IDs in `tests/event-publication.test.mjs`
- [x] T054 [US6] Run `npm run test:event-sources`, `npm run test:event-pipeline`, the new source/reconciliation/publication tests, `npm run test:poi-separation`, staged Playwright tests, and `npm run build`

**Checkpoint**: User Story 6 can refresh trustworthy data and can never publish a partial
snapshot.

---

## Phase 6: User Story 7 — Review unresolved venues privately (Priority: P1)

**Goal**: One authenticated administrator can adjudicate evidence-hash-bound venue cases;
public users cannot access them, and decisions return through pipeline validation.

**Independent Test**: Exercise failed/throttled login, authenticated session and CSRF,
pending review list/detail, valid approval, rejection, defer, duplicate decision, stale hash,
logout, public denial, restart persistence, and subsequent pipeline reuse.

### Tests

- [x] T055 [P] [US7] Add failing repository migration, session expiry/revocation, review state, idempotency, and restart tests in `tests/admin-repository.test.mjs`
- [x] T056 [P] [US7] Add failing login/logout, cookie flags, CSRF, throttling, public denial, venue decision, stale-hash, and error-contract tests in `tests/admin-api.test.mjs`
- [x] T057 [P] [US7] Add failing desktop/mobile private admin login, queue, evidence comparison, decision, stale refresh, empty, error, and logout flows in `tests/admin-ui.spec.mjs`
- [x] T058 [P] [US7] Add failing pipeline integration tests proving admin approval is revalidated and never publishes directly in `tests/venue-review-integration.test.mjs`

### Implementation

- [x] T059 [US7] Add transaction-safe admin session, login-attempt, venue-review, and idempotency migrations in `scripts/lib/admin-repository.cjs`
- [x] T060 [US7] Implement password-hash verification, opaque sessions, CSRF validation, expiry, logout, and throttling in `scripts/lib/admin-auth-service.cjs`
- [x] T061 [US7] Implement venue review creation, pagination, detail, approve/reject/defer, stale-hash validation, and mapping export in `scripts/lib/admin-service.cjs`
- [x] T062 [US7] Implement session and venue-review routes from the HTTP contract in `scripts/admin-api-plugin.cjs`
- [x] T063 [US7] Mount the admin API with public/admin middleware separation and no browser use of `X-Operator-Secret` in `scripts/serve-app.cjs` and `vite.config.js`
- [x] T064 [US7] Insert or supersede one durable venue review per `venueId + evidenceHash` after bounded recovery in `scripts/event-pipeline.mjs`
- [x] T065 [US7] Revalidate approved candidate GML/tile/coordinate evidence and export approved mappings only during pipeline reconciliation in `scripts/resolve-venues-locally.mjs`
- [x] T066 [US7] Build the private route shell, authenticated session bootstrap, review list/detail, and logout in `activity-scenes/admin/admin-app.js` and `admin.html`
- [x] T067 [US7] Build evidence/candidate comparison and explicit approve/reject/defer controls in `activity-scenes/admin/venue-review.js`
- [x] T068 [US7] Apply shared tokens and Apple HIG-informed hierarchy, feedback, touch targets, and responsive behavior in `styles/admin.css`
- [x] T069 [US7] Document credential rotation, session invalidation, review operation, and pipeline re-entry in `docs/admin-operations.md`
- [x] T070 [US7] Run `tests/admin-repository.test.mjs`, `tests/admin-api.test.mjs`, `tests/admin-ui.spec.mjs`, `tests/venue-review-integration.test.mjs`, `npm run test:event-pipeline`, and `npm run build`

**Checkpoint**: Ambiguous venues have a secure accountable review path and still cannot bypass
pipeline verification.

---

## Phase 7: User Story 3 — Build an anonymous outing plan (Priority: P2)

**Goal**: Users can build and route a mixed event/restaurant plan without an account, with
seven-day inactivity deletion for persisted challenge-ready plans.

**Independent Test**: Add, deduplicate, remove, and reorder mixed stops; review route/warnings;
open Google Maps in order; create a challenge-ready plan; advance inactivity by seven days;
and verify deletion without affecting an active game.

### Tests

- [x] T071 [P] [US3] Add failing pure plan-state tests for mixed stops, stable deduplication, reorder/remove, warnings, and route ordering in `tests/plan-model.test.mjs`
- [x] T072 [P] [US3] Extend repository/API tests for `lastActivityAt`, sliding seven-day expiry, transactional purge, active-game protection, and 404/410 behavior in `tests/plan-game.test.mjs`
- [x] T073 [P] [US3] Extend desktop/mobile planner tests for anonymous editing, warnings, readiness, Google Maps order, and no premature persistence in `tests/plan-builder.spec.mjs`

### Implementation

- [x] T074 [US3] Extract in-memory plan state, validation, deduplication, ordering, and warnings into `activity-scenes/planning/plan-model.js`
- [x] T075 [US3] Extract plan rendering and shared action-event consumption from the large controller into `activity-scenes/planning/plan-view.js` and `activity-scenes/plan-builder.js`
- [x] T076 [US3] Preserve exact stop order in route handoff and validate coordinate/source data in `activity-scenes/plan-routes.js`
- [x] T077 [US3] Set persisted anonymous-plan activity at creation, refresh it only after successful game creation, and ensure read-only plan retrieval never extends the seven-day expiry in `scripts/lib/plan-game-service.cjs`
- [x] T078 [US3] Add `last_activity_at`, expiry indexes, and orphan-safe plan purge operations in `scripts/lib/game-repository.cjs`
- [x] T079 [US3] Run plan purge from the existing bounded maintenance worker and preserve active immutable games in `scripts/plan-game-api-plugin.cjs`
- [x] T080 [US3] Run `node --test tests/plan-model.test.mjs`, `npm run test:plans`, and `npm run build`

**Checkpoint**: Anonymous planning is complete and retained only for the agreed lifecycle.

---

## Phase 8: User Story 4 — Play a Telegram challenge (Priority: P2)

**Goal**: Optional Telegram challenges remain idempotent and restart-safe while deleting
related verification data at task end or after seven days of abandonment.

**Independent Test**: Start a challenge, exercise location/photo paths, duplicate updates,
pause/resume/skip, uncertain review, retry outage, complete/quit/timeout/revoke transitions,
restart, and all cleanup deadlines.

### Tests

- [x] T081 [P] [US4] Add failing complete challenge-session cleanup tests for completed, timed-out, quit, revoked, skipped-final, and manually accepted terminal transitions, plus a test proving individual mission completion does not trigger session cleanup, in `tests/telegram-privacy.test.mjs`
- [x] T082 [P] [US4] Add failing abandoned-session, raw-update minimization, bounded delivery retention, active-game preservation, and restart tests in `tests/telegram-retention.test.mjs`
- [x] T083 [P] [US4] Add failing zero-product-metric write/schema/API tests and sanitized operational-log tests in `tests/no-telemetry.test.mjs`
- [x] T084 [P] [US4] Extend browser/API challenge readiness and immutable mission snapshot coverage in `tests/plan-builder.spec.mjs`

### Implementation

- [x] T085 [US4] Define complete challenge-session `completed`, `timed_out`, `quit`, and `revoked` transitions and one transactional session-terminal hook, distinct from individual mission advancement, in `scripts/lib/plan-game-service.cjs`
- [x] T086 [US4] Delete related photo submissions/fingerprints and clear active session pointers in the same terminal transaction in `scripts/lib/game-repository.cjs`
- [x] T087 [US4] Assign seven-day abandonment deadlines and purge abandoned verification/session data without harming active tasks in `scripts/lib/game-repository.cjs`
- [x] T088 [US4] Minimize stored Telegram update/delivery payloads and add bounded settled-record cleanup in `scripts/lib/game-repository.cjs`
- [x] T089 [US4] Remove `metric_events`, metric writes, metric summaries, and product-metric diagnostics through a numbered migration in `scripts/lib/game-repository.cjs` and `scripts/lib/plan-game-service.cjs`
- [x] T090 [US4] Limit readiness/diagnostics to health, storage, and queue state and sanitize operational errors in `scripts/plan-game-api-plugin.cjs`
- [x] T091 [US4] Preserve webhook secret validation, rate limiting, durable outbox leases, duplicate-update claims, and bounded retry in `scripts/plan-game-api-plugin.cjs`
- [x] T092 [US4] Route uncertain photo decisions through the session-authenticated admin service and reject decisions for terminal/deleted tasks in `scripts/admin-api-plugin.cjs`
- [x] T093 [US4] Add the private uncertain-photo queue and decision view in `activity-scenes/admin/photo-review.js`
- [x] T094 [US4] Update consent, retention, outage, and no-telemetry operations guidance in `docs/plan-and-telegram.md`
- [x] T095 [US4] Run `tests/telegram-privacy.test.mjs`, `tests/telegram-retention.test.mjs`, `tests/no-telemetry.test.mjs`, `tests/admin-ui.spec.mjs`, `npm run test:plans`, and `npm run build`

**Checkpoint**: Challenge behavior is reliable, private, and free of product telemetry.

---

## Phase 9: User Story 5 — Discover restaurants and verified deals (Priority: P2)

**Goal**: User-triggered viewport restaurant discovery is distinct, evidence-backed,
free-only, stale-aware, and isolated from event state.

**Independent Test**: Open restaurant mode across fresh/stale/unavailable viewports, inspect
official and missing deals, add a result to a plan, close the mode, and verify markers/panel
cleanup plus unchanged event state.

### Tests

- [x] T096 [P] [US5] Add failing provider allowlist, official-domain, direct-fetch-first, robots, provenance, expired-deal, and paid-provider rejection tests in `tests/restaurant-source-policy.test.mjs`
- [x] T097 [P] [US5] Extend service tests for the common fresh/stale/stale-overlap/unavailable restaurant and deal envelopes in `tests/restaurant-pipeline.test.mjs`
- [x] T098 [P] [US5] Extend browser tests for toolbar-only spinner, no loading popup, distinct markers, selected state, shared panel styling, plan handoff, stale labels, and complete close cleanup in `tests/restaurant-ui.spec.mjs`

### Implementation

- [x] T099 [US5] Add approved free/open policy fields and remove any unapproved fallback from `data/restaurant-pipeline-config.json`
- [x] T100 [US5] Enforce provider policy, official domains, robots, provenance, and expired-deal rejection in `scripts/lib/restaurant-pipeline-core.cjs`
- [x] T101 [US5] Standardize viewport, website, and deal responses on the common result envelope in `scripts/lib/restaurant-service.cjs`
- [x] T102 [US5] Extract restaurant API requests and envelope parsing into `activity-scenes/restaurants/restaurant-api.js`
- [x] T103 [US5] Extract marker reconciliation, selection, and viewport lifecycle into `activity-scenes/restaurants/restaurant-map.js`
- [x] T104 [US5] Extract singleton detail content, official evidence, stale state, and plan action into `activity-scenes/restaurants/restaurant-detail.js`
- [x] T105 [US5] Reduce `activity-scenes/restaurant-explorer.js` to a composition controller using the extracted restaurant modules
- [x] T106 [US5] Replace the restaurant toolbar icon with a spinner during requests, remove loading-popup creation, and preserve event state on close in `activity-scenes/restaurant-explorer.js`
- [x] T107 [US5] Update free-source and stale/expired-deal operating rules in `docs/restaurant-voucher-pipeline.md`
- [x] T108 [US5] Run `tests/restaurant-source-policy.test.mjs`, `tests/restaurant-pipeline.test.mjs`, `tests/restaurant-ui.spec.mjs`, `tests/plan-builder.spec.mjs`, and `npm run build`

**Checkpoint**: Restaurant discovery is usable without paid sources or event-map interference.

---

## Phase 10: User Story 8 — Continue safely through external outages (Priority: P2)

**Goal**: Users retain the last approved applicable data with honest stale context, or receive
a clear unavailable state when no approved fallback exists.

**Independent Test**: Fail each event and restaurant source independently with and without
approved prior data, cross the stale boundary, restore the source, and verify stale indicators,
no invented results, no paid fallback, and replacement only after complete verification.

### Tests

- [x] T109 [P] [US8] Add failing public snapshot source-outage, stale-boundary, recovery, and no-prior-data API tests in `tests/stale-snapshot.test.mjs`
- [x] T110 [P] [US8] Add failing desktop/mobile global freshness indication and unavailable-state browser tests in `tests/stale-data-ui.spec.mjs`
- [x] T111 [P] [US8] Add failing restaurant stale-deal validity and recovery-order integration tests in `tests/restaurant-stale-recovery.test.mjs`

### Implementation

- [x] T112 [US8] Expose only the active approved snapshot and sanitized freshness/source-health envelope from `scripts/approved-snapshot-api-plugin.cjs`
- [x] T113 [US8] Mount the snapshot API and preserve the active pointer through source failures in `scripts/serve-app.cjs`
- [x] T114 [US8] Add one restrained global potentially-outdated indicator and explicit unavailable state in `activity-scenes/snapshot-status.js` and `style.css`
- [x] T115 [US8] Reconcile recovered fresh snapshots without reloading unchanged components in `main.js` and `activity-scenes/esplanade-performance.js`
- [x] T116 [US8] Run `tests/stale-snapshot.test.mjs`, `tests/restaurant-stale-recovery.test.mjs`, `tests/stale-data-ui.spec.mjs`, `tests/provider-policy.test.mjs`, and `npm run build`

**Checkpoint**: External outages degrade honestly without erasing or corrupting approved data.

---

## Phase 11: Polish and cross-cutting release completion

**Purpose**: Prove the complete baseline across browsers, performance, artifacts, security,
documentation, and one production release command.

- [x] T117 [P] Add cold/warm desktop/mobile profiles and final-quality restoration assertions to `scripts/benchmark-frontend-performance.mjs`
- [x] T118 [P] Add release artifact-policy verification for tracked approved data versus ignored runtime data in `scripts/verify-artifact-policy.mjs`
- [x] T119 [P] Add failing tests for one weekly lock, overlapping-run rejection, complete event continuation, configured restaurant refresh coverage, combined terminal status, and safe partial failure in `tests/weekly-refresh.test.mjs`
- [x] T120 Implement the fail-fast sequential weekly wrapper and versioned combined status in `scripts/run-weekly-refresh.mjs` using checked-in coverage from `data/weekly-refresh-config.json`
- [x] T121 Add a free single-host cron and systemd timer example plus lock/status/recovery instructions in `deploy/whats-here-weekly.cron`, `deploy/whats-here-weekly.service`, `deploy/whats-here-weekly.timer`, and `docs/weekly-operations.md`
- [x] T122 [P] Add a production admin/session/snapshot/restaurant/plan/weekly-status smoke scenario in `scripts/smoke-production-baseline.mjs`
- [x] T123 Wire all focused Node, browser, source, geometry, privacy, weekly-refresh, artifact, smoke, build, and relevant performance checks into `npm run verify` in `package.json`
- [x] T124 Validate the automated desktop/mobile Chromium, WebKit, and Firefox matrix as the required compatibility gate; document any available branded-browser/device observations in `docs/browser-support.md` as optional non-blocking evidence
- [x] T125 Record before/after cold/warm desktop/mobile performance results and explain any accepted tradeoff in `docs/performance-baseline.md`
- [x] T126 Remove transitional browser-admin `X-Operator-Secret` support after session-authenticated flows pass, retaining only explicitly documented non-browser operations in `scripts/plan-game-api-plugin.cjs` and `docs/admin-operations.md`
- [x] T127 Audit touched modules against the <400-line responsibility guideline and extract only remaining coherent mixed responsibilities in `scripts/event-pipeline.mjs`, `scripts/lib/restaurant-pipeline-core.cjs`, `activity-scenes/restaurant-explorer.js`, and `activity-scenes/plan-builder.js`
- [ ] T128 Execute every scenario in `specs/001-full-product-baseline/quickstart.md` and update expected output where the implemented contract is more precise without weakening requirements
- [x] T129 Run `npm run verify`, confirm `git status` contains no runtime cache/run artifacts, and record final requirement-to-test evidence in `specs/001-full-product-baseline/checklists/requirements.md`

**Checkpoint**: The full baseline passes the constitution, specification, contracts, automated
engine matrix, performance comparison, artifact policy, and unified release gate.

---

## Dependencies and execution order

### Phase dependencies

```text
Setup (Phase 1)
  -> Foundation (Phase 2)
      -> US1 Event map (Phase 3)
          -> US2 Event details (Phase 4)
      -> US6 Trusted weekly pipeline (Phase 5)
          -> US7 Private venue review (Phase 6)
      -> US3 Anonymous planning (Phase 7)
          -> US4 Telegram challenge (Phase 8)
      -> US5 Restaurants (Phase 9)

US1 + US5 + US6
  -> US8 Outage behavior (Phase 10)

All user stories
  -> Polish/release (Phase 11)
```

### User-story independence

- **US1** depends only on Foundation and can be tested with an injected approved snapshot.
- **US2** depends on US1's stable event selection/pill boundary.
- **US6** depends only on Foundation and can be tested entirely with pipeline fixtures.
- **US7** depends on US6's evidence-hash review handoff but not on the public event panel.
- **US3** depends only on Foundation and can use fixture event/restaurant stops.
- **US4** depends on US3's persisted plan and immutable game snapshot.
- **US5** depends only on Foundation and can be tested with fixture viewport/service results.
- **US8** integrates the active event snapshot and restaurant fallback, so it depends on US1,
  US5, and US6.

### Within each story

1. Add contract/unit/browser assertions and confirm new failures.
2. Implement pure models and repositories.
3. Implement services and pipeline rules.
4. Implement HTTP/UI adapters.
5. Run focused suites and the production build.
6. Do not proceed past a checkpoint with unexplained failures.

## Parallel execution examples

### US1

```text
T019 event-discovery browser tests
T020 geometry lifecycle tests
T021 reconciliation unit tests
```

### US2

```text
T028 event-discovery model tests
T029 event-panel browser tests
T030 overlay coordinator tests
```

### US6

```text
T037 source/window/provenance tests
T038 occurrence/reconciliation tests
T039 atomic-publication tests
T040 staged browser tests
```

### US7

```text
T055 admin repository tests
T056 admin API/security tests
T057 admin browser tests
T058 venue-review pipeline integration tests
```

### US3 / US4 / US5

```text
US3: T071 plan model, T072 repository/API, T073 planner browser
US4: T081 privacy transitions, T082 retention/restart, T083 no telemetry, T084 browser/API
US5: T096 provider/evidence, T097 service envelopes, T098 browser UI
```

### US8

```text
T109 snapshot outage API tests
T110 stale UI browser tests
T111 restaurant stale recovery tests
```

## Implementation strategy

### MVP first

1. Complete Setup and Foundation.
2. Complete US1 and its checkpoint.
3. Deploy only to a controlled preview; the public-production baseline still requires the
   trusted pipeline and remaining release phases.

### Production-critical increment

1. Add US2 for complete event decisions.
2. Complete US6 so weekly data cannot partially publish.
3. Complete US7 so unresolved venues have a secure adjudication path.
4. Run all P1 checks before adding P2 workflows.

### Complete baseline

1. Deliver US3 and US4 as the anonymous planning/game vertical slice.
2. Deliver US5 restaurant discovery independently.
3. Integrate stale behavior through US8.
4. Complete Phase 11 and release only after `npm run verify` passes.

## Notes

- Approved venue decisions are data, but venue-specific behavior is never hardcoded in code.
- A passing finalization command is not proof of successful publication.
- A `needs_review` venue blocks a new active snapshot; a validated `not_mappable` outcome is
  safely accounted without a public highlight.
- Do not combine broad dependency upgrades with these tasks unless a verified supported-
  browser or security defect requires a separate benchmarked migration.
- Commit after each completed checkpoint or coherent task group; never commit runtime runs,
  caches, local indexes, screenshots, or secrets.
