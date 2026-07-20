# Tasks: Conversational Voice Map Assistant

**Input**: Design documents from `specs/004-conversational-voice-map/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, and
`quickstart.md`

**Branch**: Execute feature tasks on `develop`; do not create or switch branches unless the user
explicitly requests it.

**Tests**: Automated tests and the production build are required. Tests precede implementation in
each phase and must cover success, failure, recovery, privacy, budget, and lifecycle paths.

**Concurrency note**: The worktree contains another agent's changes. Re-read every existing target
immediately before editing, preserve unrelated diffs, avoid broad formatting, and sequence tasks that
touch `main.js`, `package.json`, `cloudflare/cloud-native-worker.mjs`, event/restaurant UI files, or
shared tests.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: May run in parallel after its phase prerequisites because it owns different files.
- **[Story]**: Maps implementation and tests to the independently testable user story.
- Every task names the exact file or files it owns.

## Phase 1: Setup

**Purpose**: Establish feature-owned configuration, directories, fixtures, and scripts without
changing application behavior.

- [x] T001 Create assistant module export boundaries in `activity-scenes/assistant/index.js`, `activity-scenes/location/index.js`, and `map-layers/map-context-layers.js`
- [x] T002 Add bounded realtime relay dependencies and feature test scripts without altering unrelated scripts in `package.json` and `package-lock.json`
- [x] T003 [P] Define the pinned model, cumulative `10_000_000` micro-USD cap, owner `Arnav`, session bounds, kill-switch defaults, and rate-card identity in `data/realtime-voice-policy.json`
- [x] T004 [P] Define authoritative URA/LTA dataset IDs, licences, refresh metadata, and generated output paths in `data/map-context-sources.json`
- [x] T005 [P] Create deterministic audio, transcript, provider-event, action, and approved-candidate fixtures in `tests/fixtures/voice/manifest.json` and `tests/fixtures/voice/*.json`
- [x] T006 Document server-only `OPENAI_API_KEY`, `REALTIME_ENABLED`, owner controls, and zero-spend test defaults in `docs/production-configuration.md`

---

## Phase 2: Foundational Infrastructure

**Purpose**: Implement the fail-closed provider, budget, relay, action, security, and mobile
boundaries required by every user story.

**⚠️ CRITICAL**: No user-story implementation begins until this phase passes.

### Provider exception and budget tests

- [x] T007 [P] Add tests proving the exact OpenAI exception is accepted only for feature 004 while every other paid provider still fails closed in `tests/provider-policy.test.mjs`
- [x] T008 [P] Add rate-card, limit, unknown-model, overflow, and disabled-policy tests in `tests/realtime-policy.test.mjs`
- [x] T009 [P] Add atomic reservation, concurrent admission, settlement, held-usage, cap, kill-switch, and no-personal-data tests in `tests/voice-budget.test.mjs`
- [x] T010 [P] Add D1 migration and repository contract tests for the singleton ledger and immutable reservations in `tests/voice-budget-repository.test.mjs`

### Provider exception and budget implementation

- [x] T011 Add the exact `openai-realtime` paid-exception entry without weakening existing free/open entries in `data/provider-policy.json`
- [x] T012 Implement a separate `assertPaidExceptionAllowed` path and preserve existing provenance behavior in `scripts/lib/provider-policy.mjs`
- [x] T013 Implement schema validation, integer micro-USD arithmetic, worst-case turn reservation calculation, and pinned-rate fail-closed behavior in `scripts/lib/realtime-policy.mjs`
- [x] T014 Create D1 tables, constraints, and indexes for the global ledger and reservations in `cloudflare/migrations/0003_voice_budget.sql`
- [x] T015 Implement pure atomic reservation and settlement transitions in `scripts/lib/voice-budget-ledger.mjs`
- [x] T016 [P] Implement the D1 budget repository and runtime kill-switch adapter in `cloudflare/voice-budget-repository.mjs`
- [x] T017 [P] Implement the Node local-development budget repository with isolated SQLite state in `scripts/lib/voice-budget-repository.cjs`

### Relay and protocol boundary

- [x] T018 [P] Add protocol tests for admission, browser message allowlists, bounded audio/text, sanitized server events, terminal cleanup, and modified-client rejection in `tests/realtime-relay.test.mjs`
- [x] T019 Implement shared relay message validation, session limits, provider event sanitization, and terminal-state cleanup in `scripts/lib/realtime-relay-protocol.mjs`
- [x] T020 Implement the server-owned OpenAI WebSocket session, disabled automatic responses, pre-turn reservations, trusted usage settlement, and tool-call bridge in `cloudflare/realtime-relay.mjs`
- [x] T021 Implement behaviorally equivalent local relay handling for development and tests in `scripts/realtime-voice-api-plugin.cjs`
- [x] T022 Integrate same-origin session admission and WebSocket upgrade routes without disturbing current API routes in `cloudflare/cloud-native-worker.mjs`
- [x] T023 Integrate the local relay middleware and shutdown lifecycle without disturbing current plugins in `scripts/serve-app.cjs` and `vite.config.cjs`

### Security, application command boundary, and mobile foundation

- [x] T024 [P] Add CSP, `Permissions-Policy`, same-origin, secret-leak, disabled-route, and body-limit regression tests in `tests/cloudflare-cloud-native.test.mjs` and `tests/production-baseline.test.mjs`
- [x] T025 Narrow microphone permission to self and preserve all other security headers in `scripts/lib/http-contract.cjs` and `cloudflare/cloud-native-worker.mjs`
- [x] T026 [P] Add JSON-schema, duplicate-ID, eligibility, argument, result, and direct/voice equivalence tests in `tests/assistant-action-registry.test.mjs`
- [x] T027 Implement the versioned action registry and closed-schema validation in `activity-scenes/assistant/action-registry.js` and `activity-scenes/assistant/action-gateway.js`
- [x] T028 [P] Add capability-based phone/tablet, audio, WebSocket, and text-fallback tests in `tests/device-support.test.mjs` and `tests/device-support.spec.mjs`
- [x] T029 Replace the blanket mobile rejection with capability-based full, degraded, and unsupported modes in `device-support.js` and `app-entry.js`

**Checkpoint**: Provider policy fails closed, budget reservations cannot exceed USD 10, modified
clients cannot create provider responses, secrets remain server-side, the shared action registry is
usable, and mobile can enter at least degraded direct/text mode.

---

## Phase 3: User Story 1 — Discover From a Vague Intent (Priority: P1)

**Goal**: Turn vague voice or text intent into grounded area recommendations with reasons,
trade-offs, refinements, and a no-paid-service local fallback.

**Independent Test**: With a mocked realtime stream and approved fixture candidates, a user asks for
a calm evening, receives valid areas and reasoning, refines to “livelier,” and opens a supported
candidate; unknown IDs and unsupported claims are rejected.

### Tests for User Story 1

- [x] T030 [P] [US1] Add discovery-result schema, unknown-ID, unsupported-claim, intent-refinement, confidence, and stable-order tests in `tests/assistant-discovery.test.mjs`
- [x] T031 [P] [US1] Add approved-candidate envelope tests across events, restaurants, plans, games, and empty/stale sources in `tests/assistant-candidates.test.mjs`
- [x] T032 [P] [US1] Add mocked vague voice, text refinement, clarification, no-result, provider-failure, and local-fallback browser journeys in `tests/voice-discovery.spec.mjs`

### Implementation for User Story 1

- [x] T033 [P] [US1] Implement normalized intent state, refinement transitions, and clarification rules in `activity-scenes/assistant/conversation-model.js`
- [x] T034 [P] [US1] Implement the approved candidate envelope, area grouping, grounded result validation, and create/update/no-op/review/expire reconciliation in `activity-scenes/assistant/discovery-model.js`
- [x] T035 [P] [US1] Implement the zero-cost keyword/constraint matcher over the same candidate envelope in `activity-scenes/assistant/local-discovery.js`
- [x] T036 [US1] Register bounded discovery and refinement tools with the relay and reject unknown result identities in `cloudflare/realtime-relay.mjs` and `scripts/realtime-voice-api-plugin.cjs`
- [x] T037 [P] [US1] Expose approved event candidates and stable selection callbacks without replacing literal filters in `activity-scenes/events/event-discovery-model.js` and `activity-scenes/esplanade-performance.js`
- [x] T038 [P] [US1] Expose current restaurant candidates and approved attributes without triggering new network research in `activity-scenes/restaurant-explorer.js` and `activity-scenes/restaurants/restaurant-map.js`
- [x] T039 [P] [US1] Expose current plan/game candidates through stable public controller state in `activity-scenes/plan-builder.js` and `activity-scenes/planning/plan-model.js`
- [x] T040 [US1] Implement assistant session orchestration, candidate refresh, grounded tool results, and paid/local fallback switching in `activity-scenes/assistant/assistant-controller.js`
- [x] T041 [US1] Implement the minimal conversation panel, reasoning/trade-off cards, clarification input, empty/error states, and direct result selection in `activity-scenes/assistant/assistant-view.js`
- [x] T042 [US1] Mount the assistant after approved snapshot and scene controllers are ready while preserving startup failure isolation in `main.js`

**Checkpoint**: User Story 1 is independently demonstrable with mocked voice and live direct/text
fallback. It is an internal development checkpoint, not a production release.

---

## Phase 4: User Story 2 — Explore Recommended Areas (Priority: P1)

**Goal**: Show official, ranked area highlights at wide zoom and drill from an area to its supported
places without coupling to the 3D building lifecycle.

**Independent Test**: From a Singapore-wide fixture view, a user identifies the top area, compares
reasons, selects it by touch or voice, sees contained places, refines intent, and observes stale
highlights removed.

### Tests for User Story 2

- [x] T043 [P] [US2] Add URA source, geometry, stable identity, spatial join, reconciliation, and staged-publication tests in `tests/discovery-area-assets.test.mjs`
- [x] T044 [P] [US2] Add layer ordering, wide-zoom visibility, confidence styling, selection, stale-removal, reduced-motion, and 3D isolation tests in `tests/discovery-area-layers.test.mjs`
- [x] T045 [P] [US2] Add touch, pointer, keyboard, and voice area drill-down journeys in `tests/area-discovery.spec.mjs`

### Implementation for User Story 2

- [x] T046 [P] [US2] Implement authoritative download, source hashing, WGS84 validation, and staged URA subzone generation in `scripts/build-discovery-areas.mjs`
- [x] T047 [US2] Generate and review the approved runtime area asset and provenance manifest in `data/discovery-areas.geojson` and `data/discovery-areas-manifest.json`
- [x] T048 [P] [US2] Implement the isolated MapLibre source/layer manager, confidence states, selection, and reconciliation in `map-layers/discovery-area-layers.js`
- [x] T049 [P] [US2] Implement pure area focus, comparison, candidate drill-down, and stale-selection transitions in `activity-scenes/assistant/area-controller.js`
- [x] T050 [US2] Connect discovery results and area actions to the assistant and map without changing `building-highlight-layers.js` in `activity-scenes/assistant/assistant-controller.js` and `main.js`
- [x] T051 [US2] Add accessible area labels, selected/uncertain styles, visual hierarchy, and reduced-motion behavior in `style.css`
- [x] T052 [US2] Extend the existing frontend benchmark with wide-zoom area-layer scenarios and a 10% regression gate in `scripts/benchmark-frontend-performance.mjs`

**Checkpoint**: User Stories 1 and 2 work together; area geometry is authoritative, independently
versioned, and does not disturb 3D tile rendering.

---

## Phase 5: User Story 3 — Control the Entire Application by Voice (Priority: P1)

**Goal**: Give every public first-release interface action a typed voice equivalent, contextual
reference resolution, and deterministic confirmation behavior.

**Independent Test**: The generated action inventory reaches 100% coverage; safe commands produce
the same observable state as direct UI; “the second one” resolves only against current context; and
consequential actions have zero effect until a later matching confirmation.

### Tests for User Story 3

- [x] T053 [P] [US3] Create the reviewed baseline inventory of map, tour, event, restaurant, plan, game, saved-content, navigation, and external actions in `specs/004-conversational-voice-map/contracts/public-action-inventory.md`
- [x] T054 [P] [US3] Add visible-order, focus, selection, active-overlay, stale-revision, ambiguous-reference, and ordinal-resolution tests in `tests/assistant-context.test.mjs`
- [x] T055 [P] [US3] Add reversible, consequential, compound-command, expiry, replay, interruption, argument-change, and model-self-confirmation tests in `tests/assistant-confirmation.test.mjs`
- [x] T056 [P] [US3] Add registry-to-inventory completeness and direct/voice observable-state parity tests in `tests/voice-action-coverage.test.mjs`
- [x] T057 [P] [US3] Add mocked end-to-end voice coverage for every action family in `tests/voice-action-coverage.spec.mjs`

### Implementation for User Story 3

- [x] T058 [P] [US3] Implement revisioned visible/focused/selected/overlay/filter/location/transit context snapshots in `activity-scenes/assistant/interface-context.js`
- [x] T059 [P] [US3] Implement single-use 25-second confirmation fingerprints and deterministic final-user-input acceptance in `activity-scenes/assistant/confirmation-controller.js`
- [x] T060 [P] [US3] Register map zoom, pan, rotate, focus, reset, tour, area, and layer-visibility actions in `activity-scenes/assistant/actions/map-actions.js`
- [x] T061 [P] [US3] Register event search, category, date, price, result, detail, reference, direction, and add-to-plan actions in `activity-scenes/assistant/actions/event-actions.js`
- [x] T062 [P] [US3] Register restaurant search, viewport, filters, result, deal, detail, direction, and add-to-plan actions in `activity-scenes/assistant/actions/restaurant-actions.js`
- [x] T063 [P] [US3] Register plan open, location, travel mode, add, remove, reorder, focus, and route actions in `activity-scenes/assistant/actions/plan-actions.js`
- [x] T064 [P] [US3] Register feature-tour, overlay, saved-content, game, and application navigation actions in `activity-scenes/assistant/actions/application-actions.js`
- [x] T065 [US3] Refactor direct map and tour controls to dispatch the shared commands while preserving DOM behavior in `activity-scenes/map-guidance-controls.js` and `activity-scenes/feature-tour.js`
- [x] T066 [US3] Refactor direct event controls and panels to dispatch shared commands while preserving current filters and stable identities in `activity-scenes/landmark-event-search.js`, `activity-scenes/landmark-event-panel.js`, and `activity-scenes/esplanade-performance.js`
- [x] T067 [US3] Refactor direct restaurant controls and details to dispatch shared commands while preserving viewport and deal behavior in `activity-scenes/restaurant-explorer.js` and `activity-scenes/restaurants/restaurant-detail.js`
- [x] T068 [US3] Refactor direct planning/game controls to dispatch shared commands while preserving route and persistence behavior in `activity-scenes/plan-builder.js` and `activity-scenes/planning/plan-view.js`
- [x] T069 [US3] Implement allowlisted model-tool proposal, action-result return, and context-specific tool exposure in `activity-scenes/assistant/assistant-controller.js` and `cloudflare/realtime-relay.mjs`
- [x] T070 [US3] Require confirmation for external navigation, destructive changes, precise-location sharing, and other consequential inventory entries in `activity-scenes/assistant/action-gateway.js`
- [x] T071 [US3] Implement a release verification script that fails when public UI actions lack registry and acceptance coverage in `scripts/verify-voice-action-coverage.mjs`

**Checkpoint**: Universal first-release action coverage is measurable and passing. The model proposes
intent only; deterministic application code owns validation, confirmation, and execution.

---

## Phase 6: User Story 4 — Speak Naturally in Public or Noisy Places (Priority: P2)

**Goal**: Deliver explicit voice activation, visible transcripts, text continuity, interruption,
push-to-talk fallback, privacy disclosure, and exhaustive cleanup.

**Independent Test**: A mobile user starts after disclosure, speaks through noise fixtures,
interrupts output, switches to text, denies/revokes permission, and ends through every terminal path
with clear states and no retained session content.

### Tests for User Story 4

- [x] T072 [P] [US4] Add conversation/transcript item identity, partial/final reconciliation, state transition, idle, duration, and response-limit tests in `tests/assistant-conversation.test.mjs`
- [x] T073 [P] [US4] Add audio bound, VAD, push-to-talk, interruption, playback cancellation, and media-track cleanup tests in `tests/assistant-audio.test.mjs`
- [x] T074 [P] [US4] Add microphone disclosure, permission denial/revoke, voice-to-text continuity, noisy MRT, Singlish/place-name, and pagehide browser journeys in `tests/voice-assistant.spec.mjs`
- [x] T075 [P] [US4] Add assertions that audio, transcript, context, and location never enter storage, caches, analytics, or logs in `tests/voice-privacy.test.mjs` and `tests/no-telemetry.test.mjs`

### Implementation for User Story 4

- [x] T076 [P] [US4] Implement explicit media acquisition, bounded chunks, push-to-talk, VAD state, track ownership, and terminal cleanup in `activity-scenes/assistant/audio-controller.js`
- [x] T077 [P] [US4] Implement the same-origin browser relay client, bounded protocol events, reconnect prohibition, cancellation, and audio playback queue in `activity-scenes/assistant/realtime-relay-client.js`
- [x] T078 [P] [US4] Implement transcript item reconciliation and conversation lifecycle transitions in `activity-scenes/assistant/conversation-model.js`
- [x] T079 [US4] Add disclosure, listening/processing/speaking/muted/stopped states, transcript, text input, push-to-talk, interruption, and confirmation UI in `activity-scenes/assistant/assistant-view.js`
- [x] T080 [US4] Implement semantic-VAD coordination with server-owned response creation and deterministic barge-in cancellation in `activity-scenes/assistant/assistant-controller.js`
- [x] T081 [US4] Implement stop, pagehide, idle, duration, permission, cap, disable, provider, network, and protocol terminal cleanup in `activity-scenes/assistant/assistant-controller.js` and `activity-scenes/assistant/realtime-relay-client.js`
- [x] T082 [US4] Add responsive voice controls, transcript layout, minimum touch targets, focus states, and reduced-motion behavior in `style.css`
- [x] T083 [US4] Add accurate OpenAI processing/retention disclosure and no-application-retention copy in `index.html` and `activity-scenes/assistant/assistant-view.js`

**Checkpoint**: Voice is usable but never mandatory; text and direct controls remain available, and
all terminal paths clear application-held session data.

---

## Phase 7: User Story 5 — Understand Location and MRT Context (Priority: P2)

**Goal**: Show a clear shared user location plus authoritative MRT stations and rail lines as visual
context, without affecting ranking unless explicitly requested.

**Independent Test**: A user distinguishes their point/accuracy from recommendations, sees fresh,
stale, denied, and unavailable states, views MRT lines/stations at suitable zooms, and proves that
toggling MRT visibility does not reorder results until transit is explicitly activated.

### Tests for User Story 5

- [x] T084 [P] [US5] Add station consolidation, line/station-name join, source hash, geometry simplification, reconciliation, and staged-publication tests in `tests/transit-assets.test.mjs`
- [x] T085 [P] [US5] Add permission, accuracy, freshness, coarse-area, exact-location minimization, and cleanup tests in `tests/location-model.test.mjs`
- [x] T086 [P] [US5] Add layer identity, ordering, zoom, selection separation, stale states, and transit-ranking-independence tests in `tests/transit-location-layers.test.mjs`
- [x] T087 [P] [US5] Add mobile location and MRT visual-context journeys, including explicit transit constraints, in `tests/transit-location.spec.mjs`

### Implementation for User Story 5

- [x] T088 [P] [US5] Implement authoritative LTA/URA download, station consolidation, source hashing, geometry validation/simplification, and staged output in `scripts/build-transit-context.mjs`
- [x] T089 [US5] Generate and review the approved transit runtime asset and provenance manifest in `data/transit-context.geojson` and `data/transit-context-manifest.json`
- [x] T090 [P] [US5] Implement the in-memory permission, location, accuracy, freshness, coarse-area, and cleanup model in `activity-scenes/location/location-model.js`
- [x] T091 [P] [US5] Implement explicit geolocation request/watch ownership and shared subscribers in `activity-scenes/location/location-controller.js`
- [x] T092 [P] [US5] Implement distinct point, accuracy circle, stale/denied/unavailable states, and focus actions in `map-layers/location-context-layers.js`
- [x] T093 [P] [US5] Implement MRT line/station sources, zoom hierarchy, labels, visibility, and focus actions in `map-layers/transit-context-layers.js`
- [x] T094 [US5] Refactor planning to consume shared location without duplicate prompts or persistence in `activity-scenes/plan-builder.js`
- [x] T095 [US5] Add coarse location and explicit transit-constraint state to discovery context without default ranking influence in `activity-scenes/assistant/discovery-model.js` and `activity-scenes/assistant/interface-context.js`
- [x] T096 [US5] Register location and MRT visibility/focus/constraint actions and integrate all context layers in `activity-scenes/assistant/actions/map-actions.js` and `main.js`
- [x] T097 [US5] Add visually distinct location, accuracy, MRT station/line, stale, selected, and wide-zoom styles in `style.css`
- [x] T098 [US5] Add government dataset attribution, licence, refresh, stale-data, and publication guidance in `docs/production-configuration.md` and `pull_data.md`

**Checkpoint**: All five user stories are independently testable and integrated. MRT remains visual
context unless the user explicitly requests a transit-aware recommendation.

---

## Phase 8: Polish and Cross-Cutting Release Gates

**Purpose**: Prove security, privacy, cost, compatibility, performance, documentation, and full
regression readiness without spending in routine tests.

- [x] T099 [P] Extend artifact policy to classify approved map assets, manifests, fixtures, and ignored downloads/caches in `scripts/verify-artifact-policy.mjs` and `tests/artifact-policy.test.mjs`
- [x] T100 [P] Add owner disable/status handling, D1 migration, secret binding, and relay deployment documentation in `docs/cloudflare-cloud-native.md` and `wrangler.cloud.jsonc`
- [x] T101 [P] Implement a default-mocked, owner-gated one-turn live smoke that refuses to run without an available reservation and explicit enablement in `scripts/smoke-realtime-voice.mjs`
- [x] T102 Add the voice-action coverage, map-asset validation, zero-spend fixture mode, and budget invariants to production verification in `scripts/verify-production-baseline.mjs`
- [x] T103 Run all feature unit and contract tests and record the passing command set in `specs/004-conversational-voice-map/quickstart.md`
- [x] T104 Run existing event, restaurant, plan, overlay, device, security, provider, no-telemetry, and publication regressions and record outcomes in `specs/004-conversational-voice-map/quickstart.md`
- [x] T105 Run the required desktop/mobile Chromium, WebKit, and Firefox voice/map matrix with mocked provider/audio and record outcomes in `specs/004-conversational-voice-map/quickstart.md`
- [x] T106 Run `npm run build`, `npm run lint`, and `npm run format:check` and record outcomes in `specs/004-conversational-voice-map/quickstart.md`
- [x] T107 Run wide-zoom area/MRT/location and active-conversation benchmarks, enforce the 10% regression gate, and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T108 Run `npm run verify`, inspect the production bundle for provider secrets, and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T109 Review every changed pre-existing file against the current dirty worktree, preserve unrelated agent edits, and document resolved overlaps in `specs/004-conversational-voice-map/quickstart.md`
- [ ] T110 Perform the optional owner-controlled live smoke only with Arnav's explicit enablement, then disable voice and record ledger totals without personal content in `specs/004-conversational-voice-map/quickstart.md`

---

## Phase 9: Audit Remediation

**Purpose**: Close the implementation gaps found during the post-implementation code and browser audit.

- [x] T111 Connect browser microphone PCM capture, browser VAD/push-to-talk, relay turn reservation, bounded audio streaming, commit, playback, mute, interruption, restart, and terminal cleanup in `activity-scenes/assistant/`
- [x] T112 Update the Cloudflare relay and provider fixture to the current GA Realtime audio/session/usage event contract and reject overlapping reservation state in `cloudflare/realtime-relay.mjs`, `scripts/lib/realtime-relay-protocol.mjs`, and `tests/realtime-relay.test.mjs`
- [x] T113 Route all 67 reviewed actions through production map, tour, event, restaurant, plan, saved-content, game, and navigation owners instead of verifier-only success stubs
- [x] T114 Render and enforce separate user confirmation before consequential actions, including an end-to-end delete-with-zero-prior-effect journey
- [x] T115 Apply MRT proximity only after an explicit transit request while keeping stations and lines as default visual context
- [x] T116 Make the new saved-content and game direct controls accessible above the map, interactive, closable, and shared with the voice dispatcher
- [x] T117 Re-run unit, relay, production-routing, build, lint, formatting, Chromium UI, and representative six-profile compatibility gates and record the results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T118 Constrain the Realtime assistant to Amble-only discovery and registered application control, derive capability answers from currently eligible tools, refuse general/open-web requests, require successful tool results before success claims, and cover the relay contract in `cloudflare/realtime-relay.mjs`, `tests/realtime-relay.test.mjs`, and `specs/004-conversational-voice-map/contracts/realtime-relay.md`
- [x] T119 Replace improvised general-assistant opening greetings with a tested, product-specific Amble introduction naming Singapore discovery, application search, map control, location, and MRT context in `cloudflare/realtime-relay.mjs` and `tests/realtime-relay.test.mjs`
- [x] T120 Replace the dark voice launcher and transcript-history panel with the selected frosted capsule, animated voice-state orb, inline live transcript, compact stop control, reduced-motion behavior, and focused browser coverage in `activity-scenes/assistant/assistant-view.js`, `public/brand/amble-voice-orb.png`, `style.css`, and `tests/voice-assistant.spec.mjs`

---

## Dependencies and Execution Order

### Phase dependencies

- **Setup (Phase 1)** has no dependencies.
- **Foundational (Phase 2)** depends on Setup and blocks every user story.
- **US1 (Phase 3)** depends on Foundational and establishes conversational discovery.
- **US2 (Phase 4)** depends on US1's suggested-area output and may reuse its candidate envelope.
- **US3 (Phase 5)** depends on the Foundational action registry. Its isolated action adapters can
  begin after Phase 2, but integrations touching shared scene files should follow US1/US2 integration.
- **US4 (Phase 6)** depends on the Foundational relay and can develop pure audio/transcript modules
  in parallel with US1–US3; shared assistant/controller integration follows US3.
- **US5 (Phase 7)** asset and location modules can begin after Setup, but discovery/action/main/style
  integration follows US2–US4.
- **Polish (Phase 8)** depends on all selected user stories. Because the accepted first release
  requires all five, production release depends on Phases 1–8.

### User-story completion graph

```text
Setup → Foundation → US1 → US2 ─┐
                     ├→ US3 ────┼→ Integrated release gates
                     ├→ US4 ────┤
                     └→ US5 ────┘
```

US3 action adapters, US4 media modules, and US5 asset generation are parallel branches after their
foundational prerequisites, but their edits to `main.js`, `style.css`, and existing scene files must
be serialized.

## Parallel Opportunities

### Setup and foundation

- T003–T005 own separate policy, source, and fixture files.
- T007–T010 are independent test-first tracks.
- T016 and T017 are separate Cloudflare and local repositories.
- T024, T026, and T028 are independent security, action, and device test tracks.

### User Story 1

```text
Parallel: T030 discovery tests, T031 candidate tests, T032 browser tests
Parallel after tests: T033 conversation model, T034 discovery model, T035 local fallback
Parallel adapters: T037 events, T038 restaurants, T039 planning/games
Then: T036 relay tools → T040 controller → T041 view → T042 bootstrap
```

### User Story 2

```text
Parallel: T043 asset tests, T044 layer tests, T045 browser tests
Parallel after T047: T048 layer manager and T049 area controller
Then: T050 integration → T051 styles → T052 benchmark gate
```

### User Story 3

```text
Parallel: T053–T057 inventory and tests
Parallel: T058 context, T059 confirmation, T060–T064 action-family adapters
Serialized shared-file refactors: T065 → T066 → T067 → T068
Then: T069 tool bridge → T070 confirmation coverage → T071 release verifier
```

### User Story 4

```text
Parallel: T072–T075 model, audio, browser, and privacy tests
Parallel after tests: T076 audio, T077 relay client, T078 transcript model
Then: T079 view → T080 interruption → T081 cleanup → T082 styles → T083 disclosure
```

### User Story 5

```text
Parallel: T084–T087 asset, location, layer, and browser tests
Parallel after assets: T090 location model, T091 controller, T092 location layer, T093 MRT layer
Then: T094 planner integration → T095 discovery context → T096 app integration → T097 styles
```

## Implementation Strategy

### Internal checkpoint first

1. Complete Setup and Foundational phases.
2. Complete US1 with mocked voice plus local text/direct fallback.
3. Validate US1 independently as an engineering checkpoint.
4. Do **not** publish it as the feature MVP: the user explicitly requires universal voice control,
   area highlights, mobile voice behavior, location, and MRT context in the first release.

### Incremental integration

1. Add US2 area visualization to the grounded discovery core.
2. Complete US3 action coverage before describing voice as universal.
3. Complete US4 media/privacy lifecycle and mobile interaction.
4. Complete US5 location/MRT context and ranking-independence proof.
5. Run every Phase 8 gate before enabling the paid service.

### Cost-safe development

- All automated and routine manual work uses mock provider/audio fixtures and spends USD 0.
- The runtime kill switches default to disabled.
- Only T110 can use the live provider, and only after explicit owner enablement and a successful
  server-side reservation.
- Increasing or resetting the cumulative USD 10 cap is outside these tasks and requires a new,
  explicit owner-approved policy change.

## Notes

- `[P]` means different files and no dependency on incomplete tasks, not permission to overlap dirty
  shared files.
- Story labels provide traceability to `spec.md`; setup, foundation, and polish intentionally have no
  story labels.
- Tests must fail for the intended reason before implementation begins.
- Generated government assets must be staged and reviewed; never overwrite approved assets after a
  failed download or validation.
- Never expose provider credentials, direct provider connections, arbitrary selectors/URLs, or paid
  fallback paths.
- Stop at each checkpoint to validate independently, but the accepted production scope requires all
  five stories.
