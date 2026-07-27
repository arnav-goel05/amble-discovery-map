# Tasks: Conversational Voice Map Assistant — Shared Capability Migration

**Input**: Design documents from `specs/004-conversational-voice-map/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, and
`quickstart.md`

**Branch**: Execute feature tasks on `develop`; do not create or switch branches unless the user
explicitly requests it.

**Baseline**: The protocol-1.0 voice implementation and its historical T001–T120 work are recorded
in `quickstart.md`. This checklist contains the remaining constitution-v2.4.0, capability-contract
2.0, and relay-protocol-1.1 migration work. It does not require completed functionality to be
rewritten unless a task below names that migration.

**Tests**: Automated tests and the production build are required. Test tasks precede their
implementation tasks and cover success, failure, unavailable, replay, cleanup, privacy, and
environment-parity behavior in proportion to risk.

**Concurrency note**: Other agents are editing this worktree. Re-read every existing target
immediately before editing, preserve unrelated diffs, avoid broad formatting, and serialize tasks
that touch `main.js`, `package.json`, `cloudflare/cloud-native-worker.mjs`,
`cloudflare/realtime-relay.mjs`, `activity-scenes/assistant/assistant-controller.js`,
`activity-scenes/landmark-event-search.js`, or shared browser tests.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: May run in parallel after its phase prerequisites because it owns different files.
- **[Story]**: Maps implementation and tests to the independently testable user story.
- Every task names the exact file or files it owns.

## Phase 1: Setup

**Purpose**: Establish migration fixtures, commands, and rollout documentation without changing
runtime semantics.

- [x] T001 Add the Draft 2020-12 schema compiler dependency and `verify:voice-capabilities` command without changing unrelated scripts in `package.json` and `package-lock.json`
- [x] T002 [P] Create bounded protocol-1.1 capability, result, catalogue, context, confirmation, and parity fixtures in `tests/fixtures/voice/capability-contracts.json`, `tests/fixtures/voice/capability-results.json`, and `tests/fixtures/voice/environment-parity.json`
- [x] T003 [P] Document the atomic protocol-1.1 client/Worker rollout, protocol-1.0 incompatibility, kill-switch procedure, and rollback sequence in `docs/production-configuration.md`

---

## Phase 2: Shared Capability Foundation

**Purpose**: Replace the success-only action bridge with one typed query/command registry, validated
results, authoritative context coordination, and protocol-1.1 transport shared by every story.

**⚠️ CRITICAL**: No amended user-story task begins until this phase passes.

### Tests for the shared foundation

- [x] T004 [P] Add Draft 2020-12 compilation, closed-root, bounded-branch, duplicate-ID, connector-ID, eligibility, argument, and capability-specific result tests in `tests/assistant-capability-contract.test.mjs`
- [x] T005 [P] Add common result-envelope, changed/revision, stable-target, public-error, and double-validation tests in `tests/assistant-capability-result.test.mjs`
- [x] T006 [P] Add canonical snapshot, state-digest, monotonic revision, direct-control subscription, no-op, and dependent-call blocking tests in `tests/assistant-context-coordinator.test.mjs`
- [x] T007 [P] Add shared-fixture capability ID, version, kind, schema, eligibility, result, and observable-state parity tests for local, test, preview, and production adapters in `tests/assistant-connector-parity.test.mjs`
- [x] T008 [P] Replace protocol-1.0 expectations with protocol-1.1 admission, foundational-query exposure, capability proposal/result/completion, schema failure, stale revision, and tool-refresh ordering tests in `tests/realtime-relay.test.mjs`

### Implementation for the shared foundation

- [x] T009 Implement reusable Draft 2020-12 contract compilation and common/specific result validation in `activity-scenes/assistant/capability-result.js`
- [x] T010 Implement the versioned query/command registry, connector registration, contextual eligibility, one-way version-1 compatibility projection, and single runtime executor ownership in `activity-scenes/assistant/capability-registry.js`
- [x] T011 Implement canonical assistant-relevant snapshots, connector subscriptions, state digests, monotonic revisions, and wait-for-publication semantics in `activity-scenes/assistant/context-coordinator.js`
- [x] T012 Implement query/command proposal validation, stable-target checks, result validation, confirmation delegation, and dependent-call serialization in `activity-scenes/assistant/action-gateway.js`
- [x] T013 [P] Implement the aggregate application-state connector and bounded snapshot projection in `activity-scenes/assistant/connectors/application-state-connector.js`
- [x] T014 [P] Implement the approved-catalog connector interface, ordered provenance vector, composite catalogue revision, and registered candidate-provider lifecycle in `activity-scenes/assistant/connectors/approved-catalog-connector.js`
- [x] T015 Generate the legacy version-1 compatibility view from compatible version-2 commands and remove its ability to register or own executors in `activity-scenes/assistant/action-registry.js` and `activity-scenes/assistant/actions/action-definition.js`
- [x] T016 Migrate assistant bootstrap exports and controller construction to the capability registry, context coordinator, result validator, and connector lifecycle in `activity-scenes/assistant/connectors/index.js`, `activity-scenes/assistant/queries/index.js`, `activity-scenes/assistant/index.js`, and `activity-scenes/assistant/assistant-controller.js`
- [x] T017 Upgrade admission and browser protocol validation from exact version 1.0 to exact version 1.1 in `scripts/lib/realtime-relay-protocol.mjs` and `cloudflare/cloud-native-worker.mjs`
- [x] T018 Implement protocol-1.1 function-tool generation, foundational-query admission, validated capability-call ordering, refreshed tool/context publication, and protocol-failure cleanup in `cloudflare/realtime-relay.mjs`
- [x] T019 Implement behaviorally equivalent protocol-1.1 tool and fixture handling in the local development relay in `scripts/realtime-voice-api-plugin.cjs`

**Checkpoint**: The same registry and schemas run locally and in the Worker; query results are
bounded and validated; changed commands cannot complete before a newer authoritative context
revision exists.

---

## Phase 3: User Story 1 — Discover From a Vague Intent (Priority: P1) 🎯 MVP

**Goal**: Let Amble inspect and search approved application data, discuss real returned records, and
produce grounded recommendations, clarifications, refinements, or no-match responses.

**Independent Test**: With approved fixtures and no live provider spend, a vague request returns
bounded differentiated area recommendations with supported reasons/trade-offs; refinement retains
intent; unknown claims fail closed; empty evidence yields a clarification or no-match result.

### Tests for User Story 1

- [x] T020 [P] [US1] Add bounded `app.inspect`, `catalog.search`, and `catalog.get` schema, pagination, provenance, stable-ID, allowlisted-field, unknown-ID, and exact-location exclusion tests in `tests/assistant-catalog-query.test.mjs`
- [x] T021 [P] [US1] Extend discovery tests for `recommendations`, `clarification`, and `no_match` modes, non-empty trade-offs, supplied-attribute claims, composite catalogue revisions, and deterministic non-voice text/direct access in `tests/assistant-discovery.test.mjs`
- [x] T022 [P] [US1] Add mocked search/get/refine/select browser journeys proving the assistant receives result records rather than success-only UI mutations in `tests/voice-discovery.spec.mjs`

### Implementation for User Story 1

- [x] T023 [P] [US1] Implement the bounded canonical application inspection query in `activity-scenes/assistant/queries/app-inspect.js`
- [x] T024 [P] [US1] Implement deterministic approved catalogue search, type filters, maximum-20 pages, cursors, totals, truncation, and projected attributes in `activity-scenes/assistant/queries/catalog-search.js`
- [x] T025 [P] [US1] Implement allowlisted details for at most ten registered stable target IDs in `activity-scenes/assistant/queries/catalog-get.js`
- [x] T026 [US1] Register the three foundational queries and validate catalogue pagination/provenance invariants in `activity-scenes/assistant/connectors/application-state-connector.js` and `activity-scenes/assistant/connectors/approved-catalog-connector.js`
- [x] T027 [US1] Migrate candidate collection and discovery validation to catalogue query results and the three explicit discovery modes in `activity-scenes/assistant/discovery-model.js`
- [x] T028 [US1] Migrate the zero-cost typed-search matcher—not an offline voice assistant—to the same approved catalogue projection and result validator in `activity-scenes/assistant/local-discovery.js`
- [x] T029 [US1] Feed validated bounded query results and discovery outcomes into the active conversation without full-catalogue session injection in `activity-scenes/assistant/assistant-controller.js`

**Checkpoint**: User Story 1 is independently usable with voice, text, or deterministic local
fallback and never performs open-web research.

---

## Phase 4: User Story 2 — Explore Recommended Areas on the Map (Priority: P1)

**Goal**: Give area recommendations and their direct controls the same map/discovery connector
semantics, observable outcomes, and authoritative context updates.

**Independent Test**: A user can select, open, compare, dismiss, and refine approved areas by direct
control or assistant command; both paths produce the same selected/highlighted state and remove
stale recommendations.

### Tests for User Story 2

- [x] T030 [P] [US2] Add discovery-area connector eligibility, stable area target, confidence, compare, dismiss, stale-removal, and direct/assistant parity tests in `tests/assistant-discovery-area-connector.test.mjs`
- [x] T031 [P] [US2] Add map camera, area, and layer command observable-result and context-revision tests in `tests/assistant-map-connector.test.mjs`
- [x] T032 [P] [US2] Extend area browser journeys with direct-versus-voice state parity and stale-context clarification in `tests/area-discovery.spec.mjs`

### Implementation for User Story 2

- [x] T033 [P] [US2] Implement approved recommendation snapshot, area eligibility, select/open/compare/dismiss executors, and context patches in `activity-scenes/assistant/connectors/discovery-area-connector.js`
- [x] T034 [P] [US2] Implement camera, target focus, reset, and named-layer command delegation with observable outcomes in `activity-scenes/assistant/connectors/map-connector.js`
- [x] T035 [US2] Refactor area cards and map controls to call the registered discovery/map executors while preserving rendering behavior in `activity-scenes/assistant/area-controller.js` and `activity-scenes/map-guidance-controls.js`
- [x] T036 [US2] Subscribe area and map state to the context coordinator and publish stale-selection removal before dependent references run in `activity-scenes/assistant/assistant-controller.js` and `main.js`

**Checkpoint**: Area exploration is independently testable and direct controls no longer bypass the
assistant-relevant authoritative state.

---

## Phase 5: User Story 3 — Control the Entire Application by Voice (Priority: P1)

**Goal**: Complete all active application connectors, missing event/attribution controls, contextual
references, and single-use confirmation while withholding empty conditional content.

**Independent Test**: Every eligible public direct control has one version-2 command, uses the same
executor as voice, reaches the same observable success/failure/unavailable state, and consequential
effects occur exactly once only after matching confirmation.

### Tests for User Story 3

- [x] T037 [P] [US3] Add event multi-value/placement filter, individual removal, occurrence selection, session expansion, legacy-alias, and direct/assistant parity fixtures in `tests/assistant-event-connector.test.mjs`
- [x] T038 [P] [US3] Add restaurant, plan, overlay-navigation, attribution, tour, and conditional-content eligibility/result parity fixtures in `tests/assistant-domain-connectors.test.mjs`
- [x] T039 [P] [US3] Extend contextual-reference tests for query-result order, direct-control revisions, ambiguity, changed visible order, and stale proposals in `tests/assistant-context.test.mjs`
- [x] T040 [P] [US3] Extend confirmation tests for one call/fingerprint, accepted-to-executed transition, replay idempotency, conflicting replay failure, expiry, rejection, interruption, and context invalidation in `tests/assistant-confirmation.test.mjs`
- [x] T041 [P] [US3] Replace action-only coverage assertions with capability inventory, shared-executor, result-schema, conditional-eligibility, protected-lifecycle, and direct/conversational parity assertions in `tests/voice-action-coverage.test.mjs` and `tests/voice-action-coverage.spec.mjs`

### Implementation for User Story 3

- [x] T042 [P] [US3] Implement approved event snapshot/query state and all `event.*` command contracts, including missing filter/occurrence/session controls and version-1 aliases, in `activity-scenes/assistant/connectors/event-connector.js` and `activity-scenes/events/event-discovery-model.js`
- [x] T043 [P] [US3] Implement current viewport/results/filter/deal state and all `restaurant.*` command contracts in `activity-scenes/assistant/connectors/restaurant-connector.js`
- [x] T044 [P] [US3] Implement ordered stops, travel mode, route eligibility, add/remove/reorder/focus, and confirmed route commands in `activity-scenes/assistant/connectors/plan-connector.js`
- [x] T045 [P] [US3] Implement overlay state, approved attribution references, assistant navigation, and target/link-kind external routing in `activity-scenes/assistant/connectors/overlay-navigation-connector.js`
- [x] T046 [P] [US3] Implement feature-tour availability, step state, and shared start/previous/next/finish executors in `activity-scenes/assistant/connectors/tour-connector.js`
- [x] T047 [P] [US3] Define the saved/game extension adapter but keep it unregistered when real data or matching direct controls are absent in `activity-scenes/assistant/connectors/conditional-content-connector.js`
- [x] T048 [US3] Refactor event direct controls to the shared executor and expose filter-token, occurrence, and session-expansion state in `activity-scenes/landmark-event-search.js` and `activity-scenes/landmark-event-panel.js`
- [x] T049 [US3] Refactor restaurant direct controls to the shared executor and authoritative connector subscription in `activity-scenes/restaurant-explorer.js` and `activity-scenes/restaurants/restaurant-detail.js`
- [x] T050 [US3] Refactor plan direct controls to the shared executor and authoritative connector subscription in `activity-scenes/plan-builder.js` and `activity-scenes/planning/plan-view.js`
- [x] T051 [US3] Refactor attribution, overlay, feature-tour, assistant-open/close, and approved external links to their shared executors in `activity-scenes/map-guidance-controls.js`, `activity-scenes/feature-tour.js`, and `activity-scenes/assistant/assistant-view.js`
- [x] T052 [US3] Implement immutable consequential-call fingerprints, same-call execution, terminal replay storage, and conflicting replay rejection in `activity-scenes/assistant/confirmation-controller.js`
- [x] T053 [US3] Migrate runtime dispatch from action-family success stubs to connector results and preserve `visible: false` delegation in `activity-scenes/assistant/runtime-action-dispatcher.js`
- [x] T054 [US3] Update the release verifier to compile every contract, reconcile the inventory, reject duplicate executors or orphan direct controls, and run environment-parity fixtures in `scripts/verify-voice-action-coverage.mjs`

**Checkpoint**: All eleven active connector families are registered, `conditional-content` is absent
when empty, and 100% of eligible public controls pass observable direct/assistant parity.

---

## Phase 6: User Story 4 — Speak Naturally in Public or Noisy Places (Priority: P2)

**Goal**: Move the browser conversation to protocol 1.1 while keeping transcript/text continuity and
protecting consent, push-to-talk, confirmation, and local lifecycle controls from model invocation.

**Independent Test**: A mobile user can switch between speech and text, interrupt/mute/unmute/stop
locally, and complete every terminal path with no model-invoked consent/confirmation and no retained
session content.

### Tests for User Story 4

- [x] T055 [P] [US4] Add protocol-1.1 browser-client proposal/result/completion ordering, tool-refresh wait, mismatch, reconnect prohibition, and cleanup tests in `tests/assistant-realtime-client.test.mjs`
- [x] T056 [P] [US4] Add protected consent/confirmation and deterministic local stop/mute/unmute/interrupt routing tests in `tests/assistant-session-lifecycle.test.mjs`
- [x] T057 [P] [US4] Update mocked desktop/mobile voice journeys to protocol 1.1 and prove transcript/text continuity, barge-in, permission denial/revoke, cap, kill switch, and terminal cleanup in `tests/voice-assistant.spec.mjs`

### Implementation for User Story 4

- [x] T058 [P] [US4] Implement deterministic browser-local `session.stop`, `session.mute`, `session.unmute`, and `session.interrupt` routing while excluding consent and confirmation in `activity-scenes/assistant/session-lifecycle-router.js`
- [x] T059 [US4] Upgrade admission, capability proposal/result/completion, confirmation identity, protocol mismatch, and terminal cleanup handling to protocol 1.1 in `activity-scenes/assistant/realtime-relay-client.js`
- [x] T060 [US4] Bind local lifecycle routing, protected consent controls, transcript/text continuity, and capability-call blocking into the conversation controller in `activity-scenes/assistant/assistant-controller.js`
- [x] T061 [US4] Update disclosure, confirmation, mute, stop, interrupt, transcript, and text controls to preserve their protected browser-owned behavior in `activity-scenes/assistant/assistant-view.js`

**Checkpoint**: Voice and text share one protocol-1.1 conversation, while lifecycle safety does not
depend on the model completing another tool call.

---

## Phase 7: User Story 5 — Understand Location and MRT Context (Priority: P2)

**Goal**: Expose coarse location and MRT context through dedicated connectors, preserve privacy, and
ensure visibility never silently becomes a ranking constraint.

**Independent Test**: Direct and assistant toggles can both show and hide location/MRT layers;
location context excludes exact coordinates; and recommendation order changes only after an
explicit transit constraint.

### Tests for User Story 5

- [x] T062 [P] [US5] Add location availability, permission/freshness, coarse projection, exact-coordinate exclusion, focus, and direct/assistant parity tests in `tests/assistant-location-connector.test.mjs`
- [x] T063 [P] [US5] Add transit asset availability, station/line visibility in both directions, explicit constraint, ranking independence, and parity tests in `tests/assistant-transit-connector.test.mjs`
- [x] T064 [P] [US5] Update mobile location/MRT browser journeys to protocol 1.1 and verify direct/voice context revisions in `tests/transit-location.spec.mjs`

### Implementation for User Story 5

- [x] T065 [P] [US5] Implement coarse location snapshot, permission/freshness eligibility, focus delegation, and privacy-preserving context patches in `activity-scenes/assistant/connectors/location-connector.js`
- [x] T066 [P] [US5] Implement approved MRT state, station/line visibility delegation, and explicit transit-constraint context in `activity-scenes/assistant/connectors/transit-connector.js`
- [x] T067 [US5] Subscribe the shared location controller to authoritative context without persisting or transmitting exact coordinates in `activity-scenes/location/location-controller.js` and `activity-scenes/assistant/context-coordinator.js`
- [x] T068 [US5] Route both `visible: true` and `visible: false` map-layer commands to location/transit owners and keep visibility separate from ranking intent in `activity-scenes/assistant/connectors/map-connector.js` and `activity-scenes/assistant/discovery-model.js`

**Checkpoint**: Location and transit are authoritative, privacy-bounded application context and
remain visually useful without becoming implicit recommendation evidence.

---

## Phase 8: Polish and Cross-Cutting Release Gates

**Purpose**: Prove the amended architecture, security, privacy, cost, compatibility, performance,
and rollout without routine live-provider spend.

- [x] T069 [P] Add protocol-1.1 and capability-parity gates to production verification in `scripts/verify-production-baseline.mjs`
- [x] T070 [P] Update the capability inventory version and record any implementation-discovered contract correction without adding a second registry in `specs/004-conversational-voice-map/contracts/public-action-inventory.md`
- [x] T071 Run `npm run test:voice`, `npm run verify:voice-actions`, and `npm run verify:voice-capabilities` and record the fresh post-amendment results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T072 Run event, restaurant, plan, overlay, device, security, provider, no-telemetry, budget, and publication regressions and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T073 Run the mocked desktop/mobile Chromium, WebKit, and Firefox voice/discovery/area/transit/action matrix and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T074 Run `npm run build`, `npm run lint`, `npm run format:check`, and `git diff --check` and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T075 Run the area/MRT/location/active-conversation frontend benchmark, enforce the 10% regression ceiling, and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T076 Run `npm run verify`, inspect the production bundle for secrets and protocol-1.0 voice clients, and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T077 Review every changed pre-existing file against the concurrent dirty worktree and document preserved overlaps in `specs/004-conversational-voice-map/quickstart.md`
- [x] T078 Remove the generated version-1 compatibility view only after T071–T077 and T080–T101 pass, then rerun capability, protocol, browser, and deployment verification in `activity-scenes/assistant/action-registry.js`, `activity-scenes/assistant/actions/action-definition.js`, and `specs/004-conversational-voice-map/quickstart.md`
- [x] T079 Perform the optional owner-controlled live protocol-1.1 smoke only after Arnav explicitly enables it, then disable voice and record non-personal ledger totals in `specs/004-conversational-voice-map/quickstart.md`

---

## Phase 9: User Story 6 — Shared Event Sentence Interpretation

**Goal**: Make the direct event composer and connected voice use one deterministic interpreter and
one atomic authoritative sentence-level command.

**Independent Test**: The approved event-sentence corpus produces identical canonical composer
state and results through direct and voice entry; ambiguity, stale revisions, and invalid compound
requests produce zero mutation.

- [x] T080 [P] [US6] Add closed schema-compilation and semantic fixtures for `DomainInterpretation`, `EventApplyQueryResult`, phrase ordering, bounded clarification choices, and stale revisions in `tests/assistant-domain-interpreter.test.mjs` and `tests/assistant-capability-contract.test.mjs`
- [x] T081 [P] [US6] Add direct/voice parity fixtures for recognized What/When/Where/Price phrases, residual query preservation, replace/refine/remove modes, catalogue changes, ambiguity, and all-or-nothing compound application in `tests/assistant-event-query-integration.test.mjs`
- [x] T082 [P] [US6] Add mocked desktop/mobile Chromium, WebKit, and Firefox journeys for “free concerts this weekend near Marina Bay,” visual sentence mirroring, phrase refinement/removal, clarification, stale proposals, and single-revision atomicity in `tests/voice-assistant.spec.mjs` and `tests/event-ui.spec.mjs`
- [x] T083 [US6] Extract a pure event query interpreter over Feature 015's classifier and option catalogue, returning only `applicable`, `clarification_required`, or `unsupported` proposals with no side effects, in `activity-scenes/assistant/interpreters/event-query-interpreter.js` and `activity-scenes/events/event-query-classifier.js`
- [x] T084 [US6] Add an authoritative atomic event composer-state owner that validates base context/catalogue revisions and commits replace/refine/remove proposals as one transaction in `activity-scenes/events/event-query-controller.js` and `activity-scenes/events/event-discovery-model.js`
- [x] T085 [US6] Register `event.applyquery` with closed bounded arguments and `event-apply-query-result.schema.json`, preserve `event.setfilter`/`event.removefilter`, and expose canonical composer state through the existing event connector in `activity-scenes/assistant/connectors/event-connector.js` and `activity-scenes/assistant/capability-registry.js`
- [x] T086 [US6] Route direct composer submission and phrase edits through the shared interpreter/executor and render only authoritative post-command canonical state in `activity-scenes/landmark-event-search.js`
- [x] T087 [US6] Add a bounded domain intent router that selects the event interpreter and defines non-executing registration seams for restaurant, plan, and map interpreters in `activity-scenes/assistant/interpreters/domain-intent-router.js`
- [x] T088 [US6] Route connected voice and same-session text event utterances through the domain router, capability gateway, and refreshed context before follow-up turns in `activity-scenes/assistant/assistant-controller.js` and `activity-scenes/assistant/interface-context.js`
- [x] T089 [P] [US6] Add exact unavailable-message, mic/playback stop, session/pending-state cleanup, explicit-retry, no-offline-voice-handoff, and unaffected ordinary composer/direct-control fixtures in `tests/realtime-relay.test.mjs`, `tests/assistant-session-lifecycle.test.mjs`, and `tests/voice-assistant.spec.mjs`
- [x] T090 [US6] Make provider, relay, admission, budget, and kill-switch failures terminate the voice session with “Voice service is currently unavailable. Please try again later.” and remove the local conversational fallback path in `activity-scenes/assistant/realtime-relay-client.js`, `activity-scenes/assistant/assistant-controller.js`, and `activity-scenes/assistant/assistant-view.js`
- [x] T091 [US6] Run the focused interpreter, event connector, event UI, relay, and six-browser mocked matrix and record direct/voice parity, atomicity, cleanup, and zero-spend evidence in `specs/004-conversational-voice-map/quickstart.md`

---

## Phase 10: User Story 7 — Disabled MCP Projection Foundation

**Goal**: Prove that the v2 registry is transport-neutral without exposing an MCP server or adding a
second business backend.

**Independent Test**: Every eligible contract projects deterministically and fixture invocations
return through the shared gateway, while production inspection finds no MCP network/runtime surface.

- [x] T092 [P] [US7] Add projection fixtures that compare capability ID, version, kind, description, argument/result schemas, eligibility, confirmation class, and structured gateway results across direct, Realtime, and disabled MCP views in `tests/assistant-mcp-foundation.test.mjs`
- [x] T093 [US7] Implement one deterministic transport-neutral descriptor projector over registered version-2 capability contracts in `activity-scenes/assistant/protocol-adapters/capability-descriptor-projector.js`
- [x] T094 [US7] Refactor Realtime function-tool generation to consume the shared descriptor projector without changing protocol-1.1 behavior in `activity-scenes/assistant/protocol-adapters/realtime-function-adapter.js`, `activity-scenes/assistant/capability-registry.js`, and `cloudflare/realtime-relay.mjs`
- [x] T095 [US7] Implement the disabled MCP foundation projection and fixture-only gateway invocation adapter with no listener, route, client, credential, SDK, or direct connector execution in `activity-scenes/assistant/protocol-adapters/mcp-foundation-adapter.js`
- [x] T096 [US7] Add bounded non-authoritative caller-origin metadata for `direct`, `voice`, `same_session_text`, and `mcp_fixture` without changing gateway policy or results in `activity-scenes/assistant/action-gateway.js` and `activity-scenes/assistant/capability-result.js`
- [x] T097 [P] [US7] Extend inventory/schema verification to require `event.applyquery`, canonical composer-state coverage, MCP projection parity, disabled-by-default status, and absence of MCP transport/runtime/credentials in `scripts/verify-voice-action-coverage.mjs` and `scripts/verify-production-baseline.mjs`
- [x] T098 [US7] Update the public inventory and implementation evidence after the projector contracts are proven without adding a second registry in `specs/004-conversational-voice-map/contracts/public-action-inventory.md` and `specs/004-conversational-voice-map/quickstart.md`

---

## Phase 11: Post-Amendment Release Gates

**Purpose**: Re-prove the full voice architecture after event-composer integration and the disabled
MCP foundation land.

- [x] T099 [P] Run `npm run test:voice`, focused event classifier/discovery/UI suites, schema compilation, capability/action coverage, and MCP projection fixtures and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T100 Run the mocked desktop/mobile Chromium, WebKit, and Firefox event-voice, unavailable-service, discovery, action-parity, location, and transit matrix and record results in `specs/004-conversational-voice-map/quickstart.md`
- [x] T101 Run build, lint, format, production verification, dependency/route/listener/secret inspection, performance gates, and concurrent-work review; preserve unrelated Feature 014–016 snapshot/pipeline state and record results in `specs/004-conversational-voice-map/quickstart.md`

---

## Phase 12: Mini Realtime Model, Deterministic Commands, and Turn Tool Scoping

**Purpose**: Use the approved lower-cost Realtime model without fallback, execute obvious
application commands through the shared gateway, and expose only request-relevant capability
families to the model.

### Tests first

- [x] T102 [P] Pin `gpt-realtime-2.1-mini`, its reviewed rate card, and the absence of any model fallback in `tests/realtime-policy.test.mjs`, `tests/realtime-relay.test.mjs`, and `tests/voice-budget.test.mjs`
- [x] T103 [P] Specify deterministic interpretation for zoom, MRT-layer, and free-event requests in `tests/assistant-obvious-command-interpreter.test.mjs`
- [x] T104 [P] Specify request- and interface-state-scoped capability families, including transcript-before-response ordering for audio, in `tests/assistant-capability-turn-scope.test.mjs` and `tests/realtime-relay.test.mjs`

### Implementation

- [x] T105 Update the reviewed Realtime policy and relay validation to use only `gpt-realtime-2.1-mini` with no fallback in `data/realtime-voice-policy.json`, `scripts/lib/realtime-policy.mjs`, and `cloudflare/realtime-relay.mjs`
- [x] T106 Implement a bounded, side-effect-free obvious-command interpreter in `activity-scenes/assistant/interpreters/obvious-command-interpreter.js`
- [x] T107 Route recognized typed and final spoken commands through the existing capability gateway in `activity-scenes/assistant/assistant-controller.js`
- [x] T108 Implement per-turn connector-family selection in `activity-scenes/assistant/capability-turn-scope.js` and apply it before each model response in `cloudflare/realtime-relay.mjs`
- [x] T109 Update the specification, plan, research, data model, and relay contract for the three approved architecture changes only in `specs/004-conversational-voice-map/`
- [x] T110 Run the focused voice tests, capability verification, lint, formatting, and production build; record evidence without running a paid live smoke in `specs/004-conversational-voice-map/quickstart.md`

---

## Dependencies and Execution Order

### Phase dependencies

- **Setup (Phase 1)** has no dependencies.
- **Shared Foundation (Phase 2)** depends on Setup and blocks every amended user story.
- **US1 (Phase 3)** depends on the capability registry, result validator, context coordinator, and
  foundational connectors from Phase 2.
- **US2 (Phase 4)** depends on US1's validated recommendation output.
- **US3 (Phase 5)** depends on Phase 2; connector modules T042–T047 may start in parallel with
  US1/US2 after Phase 2, but direct-control and shared-controller edits T048–T054 must be serialized
  after overlapping US1/US2 edits.
- **US4 (Phase 6)** depends on the protocol-1.1 relay from Phase 2 and the consequential-call state
  machine from US3.
- **US5 (Phase 7)** depends on the shared context coordinator and map connector; its isolated
  connector tests/modules may start after Phase 2, while integration follows US2 and US3.
- **US6 (Phase 9)** depends on the Feature 015 deterministic classifier and the Phase 2/US3
  capability gateway, event connector, and context coordinator. T080–T082 define failing coverage
  before T083–T090 implementation; T091 closes the story.
- **US7 (Phase 10)** depends on the version-2 registry and result gateway. T092 fails first,
  T093–T096 implement projection and metadata, and T097–T098 prove policy/inventory parity.
- **Post-Amendment Gates (Phase 11)** depend on US6 and US7. T099–T101 are sequential. T078 remains
  blocked until both the original and post-amendment gates pass. T079 additionally requires explicit
  owner enablement and is not part of routine mocked completion.

### User-story completion graph

```text
Setup → Shared Foundation → US1 → US2 ─┐
                          ├→ US3 ──────┼→ US4 ─┐
                          └→ US5 ──────┴───────┼→ Original gates ─┐
                                              ├→ US6 ────────────┼→ Post-amendment gates
                                              └→ US7 ────────────┘
```

## Parallel Opportunities

### Setup and shared foundation

```text
Parallel: T002 fixtures and T003 rollout documentation
Parallel tests: T004–T008
Then: T009 result validation → T010 registry → T011 context → T012 gateway
Parallel connectors: T013 application state and T014 approved catalogue
Then: T015 compatibility view → T016 bootstrap
Serialized protocol files: T017 → T018 → T019
```

### User Story 1

```text
Parallel tests: T020–T022
Parallel queries: T023–T025
Then: T026 connector registration → T027 discovery model → T028 non-voice matcher → T029 controller
```

### User Story 2

```text
Parallel tests: T030–T032
Parallel connectors: T033 discovery areas and T034 map
Then: T035 direct controls → T036 integration
```

### User Story 3

```text
Parallel tests: T037–T041
Parallel connector modules: T042–T047
Serialized shared owners: T048 → T049 → T050 → T051
Then: T052 confirmation → T053 dispatcher → T054 verifier
```

### User Story 4

```text
Parallel tests: T055–T057
Then: T058 lifecycle router → T059 relay client → T060 controller → T061 view
```

### User Story 5

```text
Parallel tests: T062–T064
Parallel connectors: T065 location and T066 transit
Then: T067 context subscription → T068 map/discovery integration
```

### User Story 6

```text
Parallel failing tests: T080–T082 and T089
Then: T083 interpreter → T084 atomic owner → T085 capability
Then: T086 direct composer → T087 router → T088 assistant/context → T090 failure lifecycle
Then: T091 focused and browser evidence
```

### User Story 7

```text
Failing projection tests: T092
Then: T093 shared projector → T094 Realtime adapter → T095 disabled MCP adapter
Then: T096 caller metadata
Parallel verification/docs: T097–T098
```

## Implementation Strategy

### MVP first

1. Complete Setup and Shared Foundation.
2. Complete US1 with mocked Realtime plus ordinary deterministic text/direct access.
3. Validate US1 independently as the grounded conversational MVP.
4. Do not describe voice as universal or enable production Realtime until US2–US5 and every release
   gate are complete.

### Incremental delivery

1. Add US2 area exploration over the validated query/result foundation.
2. Complete US3 connector and direct-control parity before advertising universal app control.
3. Complete US4 protocol/lifecycle migration atomically with the Worker.
4. Complete US5 location/transit privacy and ranking-independence proof.
5. Run the full Phase 8 gate with mocked provider/audio at USD 0.
6. Complete US6 event-composer parity and terminal unavailable behavior.
7. Complete US7's disabled MCP projection foundation without enabling a transport.
8. Run the full post-amendment Phase 11 gate at USD 0.

### Cost-safe execution

- Routine implementation and validation use deterministic fixtures and spend USD 0.
- Both runtime kill switches remain disabled during migration and automated tests.
- Only T079 may contact the live provider, and only with explicit owner enablement and a successful
  server-side reservation.
- Increasing or resetting the cumulative USD 10 cap is outside this task list and requires a new
  explicit owner-approved policy change.

## Notes

- `[P]` means different files and no dependency on incomplete tasks; it does not authorize
  overlapping edits to a dirty shared file.
- Tests must fail for the intended contract gap before implementation begins.
- The provider receives only the three bounded foundational queries before authoritative context;
  it never receives an unbounded full catalogue.
- Function tools expose the in-app registry. Implement only the disabled MCP contract-projection
  foundation; do not implement an MCP server/listener/client, authorization surface, runtime
  dependency, or unrelated account connector.
- Consent and confirmation remain browser-owned; the model cannot invoke or approve them.
- Never expose provider credentials, arbitrary selectors/URLs, exact location, raw source payloads,
  paid fallback paths, or empty conditional capabilities.

---

## Phase 13: Convergence

**Purpose**: Close the audited protocol, capability-reachability, deterministic-result, expiry, and
failure-message gaps before Feature 004 is considered complete.

### Tests first

- [x] T111 [P] Add an end-to-end protocol-1.1 consequential-call fixture covering `capability.proposed` → browser-owned `confirmation.required` → matching accept/reject/expiry/interruption → terminal capability result/completion with no unresolved relay call in `tests/realtime-relay.test.mjs`, `tests/assistant-realtime-client.test.mjs`, and `tests/voice-assistant.spec.mjs` per FR-014, FR-023, FR-037, and Constitution IV (partial)
- [x] T112 [P] Add turn-scope reachability fixtures for every registered eligible connector family, including all `navigation.*` capabilities under overlay/navigation utterances and interface state, in `tests/assistant-capability-turn-scope.test.mjs` and `tests/realtime-relay.test.mjs` per FR-009, FR-029, FR-049, and Constitution IV (contradicts)
- [x] T113 [P] Add deterministic-command result-ordering fixtures for successful, ineligible, and failed typed/spoken commands so provider acknowledgement cannot precede or misstate the validated gateway outcome in `tests/assistant-obvious-command-interpreter.test.mjs`, `tests/realtime-relay.test.mjs`, and `tests/voice-assistant.spec.mjs` per FR-013, FR-028, and FR-048 (partial)
- [x] T114 [P] Add automatic confirmation-expiry release and one exact online-service-unavailable message fixtures for usage-limit, kill-switch, provider, and network failures in `tests/assistant-capability-gateway.test.mjs`, `tests/assistant-confirmation.test.mjs`, `tests/assistant-session-lifecycle.test.mjs`, and `tests/voice-assistant.spec.mjs` per FR-015, FR-027, SC-006, and T090 (contradicts)

### Implementation and proof

- [x] T115 Implement the complete consequential-call state machine across the relay, browser client, controller, gateway, and confirmation controller so accept, reject, expiry, interruption, context change, and replay terminally resolve one call in `cloudflare/realtime-relay.mjs`, `scripts/lib/realtime-relay-protocol.mjs`, `activity-scenes/assistant/realtime-relay-client.js`, `activity-scenes/assistant/assistant-controller.js`, `activity-scenes/assistant/action-gateway.js`, and `activity-scenes/assistant/confirmation-controller.js` per FR-014, FR-023, FR-037, and Constitution IV (partial)
- [x] T116 Replace prefix-only turn scoping with registered connector-family metadata and cover navigation/overlay requests without re-expanding unrelated tool families in `activity-scenes/assistant/capability-turn-scope.js` and `cloudflare/realtime-relay.mjs` per FR-009, FR-029, and FR-049 (contradicts)
- [x] T117 Synchronize deterministic gateway outcomes with response creation, catch execution failures, and give the model only a validated success/failure acknowledgement context in `activity-scenes/assistant/assistant-controller.js`, `activity-scenes/assistant/realtime-relay-client.js`, `scripts/lib/realtime-relay-protocol.mjs`, and `cloudflare/realtime-relay.mjs` per FR-013, FR-028, and FR-048 (partial)
- [x] T118 Automatically expire and release matching pending confirmations before dependent execution while preserving identity-bound rejection and replay safety in `activity-scenes/assistant/action-gateway.js`, `activity-scenes/assistant/assistant-controller.js`, and `activity-scenes/assistant/confirmation-controller.js` per FR-015 and SC-006 (partial)
- [x] T119 Normalize every online admission/runtime failure to “Voice service is currently unavailable. Please try again later.” while preserving terminal cleanup and ordinary direct/text access in `activity-scenes/assistant/assistant-controller.js`, `activity-scenes/assistant/assistant-view.js`, `activity-scenes/assistant/realtime-relay-client.js`, `scripts/realtime-voice-api-plugin.cjs`, and `cloudflare/cloud-native-worker.mjs` per FR-027 and T090 (contradicts)
- [ ] T120 Run the focused protocol/scoping/lifecycle suites, full voice tests, six-browser affected journeys, capability/action verifiers, lint, scoped formatting, production build, and a bounded owner-controlled model-proposed consequential smoke if the existing live authorization remains valid; update `specs/004-conversational-voice-map/quickstart.md` with accurate evidence and rerun Spec Kit convergence per SC-004–SC-025 (partial)
