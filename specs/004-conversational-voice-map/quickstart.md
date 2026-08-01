# Quickstart Validation: Conversational Voice Map Assistant

## Current validation — Deterministic native routing (2026-08-01)

1. Commit native audio and verify the relay waits for the matching final transcript without
   creating `voice__classifyrequest` or accepting provider-proposed facets.
2. Submit “Can you find me free events to do over the weekend?” and verify only `price:free` and
   `when:this-weekend`, an empty residual query, and one atomic revision.
3. Submit “search events for romantic exhibitions this weekend” and verify only the explicit
   `romantic` keyword remains alongside recognized What/When facets.
4. Run the action-vocabulary matrix, `npm run test:voice`, scoped ESLint/Prettier, and
   `npm run build:ci`. Saved/game actions remain unavailable until their connector exists.

Forced-classification sections below are retained as historical evidence and are superseded.

## Current validation — Relay-owned transcript and forced classification

The relay has no per-session user-turn, assistant-response-count, maximum-duration, or idle-expiry
limit. A native-audio turn reserves response and transcription work before `turn.ready`, limits
accepted PCM audio to 60 seconds, and then starts transcription and one forced classification
response from the same committed buffer.

1. Verify the acknowledged provider configuration enables `gpt-realtime-whisper`, contains exactly
   `voice__classifyrequest` with forced tool choice, and its closed arguments contain only `domain`
   and `eventQuery`—never an utterance.
2. Deliver the final transcript and classification in both orders. Verify routing occurs exactly
   once only after both match the active provider input item.
3. Verify “find events today at Marina Bay Sands” proposes one `event.applyquery` whose `text` is the
   relay-owned final transcript and whose bounded proposal preserves both explicit filters.
4. Verify missing, failed, delayed, duplicate-conflicting, stale-item, interrupted, and timed-out
   transcript/classification paths mutate nothing and clean up all reservations. Verify an empty
   active transcript mutates nothing, settles its known reservation, and requests one fixed retry
   without disabling admission.
5. Run the focused policy, budget, relay, diagnostic, capability, browser, formatting, and build
   gates. A live provider call is optional and requires the existing owner authorization and
   bounded-spend controls.

## 2026-07-31 — Relay-owned transcript/classification convergence

- The Realtime session now enables `gpt-realtime-whisper`. Native audio reserves transcription and
  response work independently before `turn.ready`, accepts at most 60 seconds of 24 kHz mono PCM,
  and starts transcription and the forced classification response from the same commit.
- The forced tool no longer accepts an utterance. The relay binds the provider input item, joins one
  final transcript with one closed classification in either completion order, and routes exactly
  once using the transcript-owned text. Empty, failed, missing, stale-item, conflicting duplicate,
  oversized, and terminal paths mutate nothing and clean up.
- Focused relay, policy, budget, and diagnostic validation passed 86/86 tests. The complete voice
  and shared-capability suite passed 253/253 tests. Capability coverage verified 64 version-2
  capabilities, 61 direct/conversational parity cases, and all 17 contract/result/environment
  checks.
- All 33 affected Chromium voice journeys passed. The broader voice-UI command was stopped after
  three unrelated area-discovery cases repeatedly failed to load the ignored local 3D tileset; no
  voice journey had failed, and the scoped voice matrix subsequently passed in full.
- ESLint, scoped Prettier, `git diff --check`, and the production build passed. The build retained
  only the existing third-party direct-`eval`, large-chunk, and output-preparation warnings.
- No live provider call or paid spend was used: the local runtime spending switch remained disabled,
  so verification used the checked-in provider contract and deterministic relay boundary.

## 2026-07-30 — Single native event-query path

- Native audio now exposes `event.applyquery` as its only event discovery/filter mutation tool.
  `event.search`, individual event filter mutations, and legacy setters remain registered for
  direct application controls but are withheld from the Realtime model.
- The atomic tool description requires the complete spoken event request and explicitly covers
  both one filter and several filters. Other eligible event interactions, such as selecting a
  result, remain available.
- The two new test-first fixtures failed against the previous dual-path projection and passed after
  the scoped change. The complete relay suite passed 39/39 and the full voice/shared-capability
  suite passed 214/214.
- Capability verification passed for 64 version-2 capabilities and 61 direct/conversational parity
  cases; the 17 contract/result/environment checks also passed.
- ESLint, scoped Prettier, `git diff --check`, and the production build passed. The build retained
  only the repository's existing third-party direct-`eval`, large-chunk, and output-preparation
  timing warnings.
- No event-pipeline run, live provider call, or paid spend was used.

## 2026-07-30 — Transcript-independent native audio

- The relay no longer configures, reserves, waits for, or settles a separate input-transcription
  service. It reserves the reviewed response envelope before accepting microphone audio, commits
  the native audio buffer, and immediately emits `response.create`.
- Native-audio turns expose the three foundational queries plus only capability IDs currently
  eligible in authoritative interface context. Provider tool proposals still pass through the
  existing registry schemas, context revision, confirmation, gateway execution, and result
  validation. Typed turns retain deterministic interpretation and connector-family scoping.
- Missing, failed, duplicate, and late transcription-event fixtures cannot block, duplicate,
  terminate, or otherwise control the native response.
- The checked-in policy contains no transcription model, transcription rate, or input-transcription
  reservation. A worst-case turn now reserves only the existing `121,920` micro-USD response
  envelope; historical ledger rows remain readable for reconciliation.
- Focused policy, relay, and scoping validation passed 45/45 tests. The complete voice and shared
  capability suite passed 212/212 tests, and the affected Chromium voice journey passed 15/15
  cases.
- ESLint, scoped Prettier and diff checks, and the production build passed. The build retained only
  the repository's existing dependency `eval`, large-chunk, and output-preparation timing warnings.
  No live provider call or paid spend was used.

## 2026-07-27 — Phase 13 convergence

- Consequential provider calls now use the complete browser-owned protocol:
  `capability.proposed` → `confirmation.pending` → relay-validated
  `confirmation.required` → matching decision → terminal capability result/completion. Rejection,
  expiry, interruption, context drift, and matching replay release or reuse only the identity-bound
  call; the model cannot create or approve a confirmation.
- Obvious typed and spoken commands now delay provider response creation until the browser returns a
  schema-valid `deterministic.result`. Provider acknowledgement therefore follows the actual shared
  gateway outcome and cannot pre-announce success.
- Turn scoping uses registered connector ownership, including overlay navigation, location,
  transit, and discovery-area families. The deterministic capability remains excluded and
  unrelated families are not re-expanded.
- Browser messages are serialized per session, eliminating a text/reservation ordering race.
  Identical terminal provider call replays return the stored result without another application
  execution; conflicting replay identity fails closed.
- `npm run test:voice` passed 211/211 tests. Focused relay, confirmation, lifecycle, scoping, and
  browser-client suites passed.
- The no-retry affected browser matrix passed 90/90 voice-assistant journeys across Chromium,
  WebKit, and Firefox desktop/mobile. The broader Chromium voice/discovery pass completed 38 tests;
  one initial tileset-load timeout passed on retry and then passed independently without retry.
- `npm run verify:voice-actions` verified 64 version-2 capabilities and 61 direct/conversational
  parity cases. `npm run verify:voice-capabilities` passed 17/17 contract/result/environment suites.
- Repository ESLint, scoped Prettier and diff checks, and the production build passed. Build output
  retained only the pre-existing dependency `eval` and large-chunk warnings.
- No additional paid smoke was needed for this convergence. The completed owner-controlled T079
  evidence below already used `gpt-realtime-2.1-mini`, verified deterministic zoom, rejected
  consequential navigation with zero effect, dependent follow-up health, server-only credentials,
  terminal cleanup, and a disabled/settled isolated ledger. Phase 13 protocol ordering is covered
  deterministically at the relay/browser boundary.

## 2026-07-27 — Phase 12 mini model and deterministic routing

- The reviewed policy and relay now use only `gpt-realtime-2.1-mini`; no fallback model field or
  connection attempt exists.
- Reviewed mini rates reduce the conservative per-turn reservation from `177,768` to `67,240`
  micro-USD (`17,000` transcription plus `50,240` response). The cumulative USD 10 cap, disabled
  defaults, and all admission safeguards are unchanged.
- Obvious `zoom in`, `zoom out`, MRT line/station visibility, and free-event commands are
  interpreted locally and executed through the shared capability gateway. The routed capability
  is excluded from that turn's provider tools.
- Provider tools are rebuilt per response from the three foundational queries plus only the
  request- and interface-state-relevant connector families. Audio response creation waits for the
  final transcript so the same scope applies to spoken turns.
- Focused TDD proof: 46 policy, relay, budget, interpreter, and scoping tests passed.
- Full deterministic voice proof: `npm run test:voice` passed 207 tests.
- Cloud/runtime proof: the focused cloud-native, policy, relay, interpreter, and scoping suite
  passed 49 tests.
- Capability proof: `npm run verify:voice-actions` verified 64 version-2 capabilities and 61
  direct/conversational parity cases; `npm run verify:voice-capabilities` passed all 17 contract,
  result, and environment-parity tests.
- Browser proof: the Chromium desktop test confirmed a final spoken `zoom in` transcript changes
  the real map through the application gateway.
- Quality proof: ESLint passed; all changed Phase 12 files pass Prettier; the production Vite build
  passed. The existing third-party direct-eval and large-chunk warnings are unchanged.
- No paid live smoke was run for this revision. T079 remains the separate pre-existing live-provider
  acceptance task and was not required to implement or deterministically verify these three
  approved changes.

## Owner-controlled Phase 12 live smoke — 2026-07-27

Arnav explicitly approved reusing the existing server-side OpenAI key. The smoke used
`gpt-realtime-2.1-mini`, the real application relay, a full local application configuration, and
an isolated temporary budget database. Production D1, production configuration, active snapshot
pointers, and pipeline artifacts were not changed. No secret, audio, transcript, provider body,
coordinates, or other conversation content was recorded.

- Provider WebSocket connection, protocol-1.1 admission, and the live mini-model response path
  succeeded.
- A bounded same-session text request for deterministic `zoom in` changed the actual map through
  the shared capability gateway. The live model returned assistant text/audio, the session returned
  to listening, and the browser made zero requests to an OpenAI origin.
- A second bounded response emitted live audio, the browser-owned interrupt control sent
  `response.cancel`, and the relay returned to listening with no held reservation.
- An approved attribution-reference command displayed the browser-owned consequential confirmation.
  Rejecting it produced zero external-open effect, and explicit voice stop emitted `session.stop`.
- The final isolated ledger was disabled with `5,599` spent micro-USD, `0` reserved/held micro-USD,
  and `9,994,401` micro-USD unused beneath the USD 10 cap. The temporary database was moved to Trash
  after shutdown.
- The rejection journey exposed a remaining lifecycle defect: after rejection, the shared action
  gateway retained its internal pending-confirmation lock and emitted
  `dependent_call_blocked`/“awaiting confirmation” on subsequent capability work. The rejection
  itself remained zero-effect, but the gateway was not healthy for a dependent follow-up.

The pending-confirmation lifecycle was subsequently corrected and covered by a regression test.
Gateway release is bound to the exact confirmation ID and fingerprint; stale or mismatched releases
do not unlock dependent calls. Rejection, expiry, interruption, and session stop now clear the
matching gateway lock.

The final bounded rerun passed the complete T079 journey:

- The real `gpt-realtime-2.1-mini` provider returned an assistant response, while deterministic
  `zoom in` changed the actual map through the shared capability gateway.
- Browser-owned interruption returned the session to listening.
- Rejecting an approved attribution reference produced zero external-open effects, and a dependent
  direct `zoom out` succeeded immediately afterward. No page error, `dependent_call_blocked`,
  `ActionRegistryError`, or awaiting-confirmation console error occurred.
- Explicit stop returned the UI to `Voice stopped`; browser inspection observed zero requests to an
  OpenAI origin.
- The fresh isolated ledger settled at `4,401` spent micro-USD, `0` reserved/held micro-USD, and
  `9,995,599` micro-USD unused beneath the USD 10 cap. The zero-spend synthetic-microphone setup
  attempt and this final ledger were both disabled; their temporary databases were moved to Trash
  after server shutdown.
- Post-fix deterministic validation passed 208 voice tests, 17 capability-contract tests, the
  64-capability/61-parity action verifier, lint, scoped Prettier/diff checks, and a production build.

T079 is complete. Production D1, production configuration, active snapshot pointers, and shared
pipeline artifacts were not changed.

## Purpose

Validate the feature end to end without spending against the OpenAI allowance. Automated tests use a
mock relay, deterministic transcript/audio fixtures, and approved candidate fixtures. A live provider
smoke is optional, owner-controlled, and never part of routine CI.

## Prerequisites

- Node.js 24 and installed project dependencies
- Feature 004 design available under `specs/004-conversational-voice-map/`; changing the repository's
  active Spec Kit pointer is not required to run validation
- Generated discovery-area and transit-context fixtures with manifests
- No `OPENAI_API_KEY` is required for the default validation path

## Static and unit validation

```bash
npm run lint
npm run format:check
npm run test:voice
npm run verify:voice-actions
npm run verify:voice-capabilities
```

Expected outcomes:

- every public action has a unique valid contract and direct/voice equivalence fixture;
- `app.inspect`, `catalog.search`, and `catalog.get` return bounded schema-valid results;
- each state-changing command returns affected stable IDs and a refreshed context revision;
- direct interactions and assistant commands update the same context coordinator;
- local, test, preview, and production adapters pass the same contract-parity fixtures;
- empty saved/game surfaces and unrelated account connectors are absent from eligible tools;
- unknown targets, model-generated URLs/selectors, and stale context revisions fail closed;
- consequential actions have zero effect before a matching later confirmation;
- concurrent reservations never make `spent + reserved` exceed `10_000_000` micro-USD;
- missing usage, unknown rates/models, disable, and cap exhaustion hold reservations and stop work;
- no audio, transcript, exact location, or context appears in ledger rows or routine/production
  logs; explicitly activated local content diagnostics retain only permitted sanitized content;
- successful turns emit ordered allowlisted phase timing, stalled responses terminate at the
  configured deadline, and no response watchdog survives completion or cleanup;
- map-asset identities, geometry, provenance, and reconciliation validate.

## Voice reliability tracing and watchdog validation — 2026-07-29

Run with mocked provider transport and an injected deterministic scheduler:

```bash
node --test tests/realtime-policy.test.mjs tests/realtime-relay.test.mjs
npm run test:voice
```

Validate:

1. An audio turn emits `audio_committed`, `response_requested`, `response_created`, `first_audio`,
   and `response_done` in order without a transcription phase.
2. Opening and text turns begin at `response_requested` and omit the inapplicable audio phase.
3. Every emitted record has only the contract allowlist and a one-way session identifier; fixtures
   containing transcript text, prompts, tool arguments, provider payloads, coordinates, and secret
   sentinels never appear in serialized logs.
4. A response that never completes expires at 30 seconds, sends `response.cancel`, records
   `response_timeout`, terminates through the standard unavailable lifecycle, and leaves no active
   watchdog or reusable pending reservation.
5. `response.done`, browser interruption, provider failure, and explicit stop clear the watchdog
   exactly once. Phase 22 additionally verifies that the former idle and duration thresholds no
   longer terminate a healthy session.
6. No provider request contains `max_output_tokens`; the watchdog does not alter response content or
   the intrinsic provider/model response maximum.

## Build and browser matrix

```bash
npm run build
PLAYWRIGHT_FULL_MATRIX=1 playwright test -c playwright.config.mjs \
  tests/voice-assistant.spec.mjs \
  tests/voice-action-coverage.spec.mjs \
  tests/voice-discovery.spec.mjs \
  tests/area-discovery.spec.mjs \
  tests/transit-location.spec.mjs \
  tests/device-support.spec.mjs \
  --project chromium-desktop \
  --project chromium-mobile \
  --project webkit-desktop \
  --project webkit-mobile \
  --project firefox-desktop \
  --project firefox-mobile
```

Exercise these mocked journeys:

1. Start voice after disclosure, ask vaguely for a calm evening, see ranked subzones with grounded
   reasons/trade-offs, refine to “livelier,” and open a contained place.
2. Use “open the second one,” then change the visible order and prove stale ordinal context asks for
   clarification rather than opening the wrong result.
3. Execute reversible zoom/filter/open actions immediately; verify external navigation, deletion,
   precise-location sharing, and other consequential fixtures wait for matching confirmation.
4. Switch between audio and text, interrupt speech, deny microphone access, remain active beyond
   the former idle and duration thresholds, and terminate via stop, page navigation, network error,
   provider error, kill switch, and budget cap.
5. Identify the user point and accuracy circle; verify denied/stale states; show MRT stations and
   lines without changing recommendation order until transit is explicitly requested.
6. Cover all registered event, restaurant, planning, game, map, tour, saved-content, and navigation
   actions through the same command gateway as direct UI.
7. Search for approved events and restaurants, inspect the returned stable IDs and truncation
   metadata, refine the query, retrieve details, and select a returned target without relying on a
   success-only UI mutation.
8. Change event filters, restaurant results, map state, overlays, and plan stops through direct
   controls while voice is active; verify every change advances authoritative context before the
   assistant handles a dependent reference.
9. Run shared fixtures through local and Cloudflare adapters and compare capability IDs, versions,
   kinds, schemas, eligibility, results, and observable state.

## Target architecture amendment — 2026-07-26

Before implementation is accepted, validate the connector matrix in
`contracts/capability-connector-architecture.md`:

1. The twelve application connector families wrap existing domain owners and contain no duplicate
   business rules.
2. Realtime, browser audio, budget, and deterministic non-voice application access remain
   infrastructure adapters rather than application-domain connectors.
3. In-app Realtime tools are function tools generated from the shared capability registry.
4. A disabled MCP descriptor projector derives from the registry, but no MCP server, listener,
   route, client, credential, runtime dependency, or external connector is present.
5. Saved/game tools become eligible only when real data and matching direct controls exist.
6. Protocol `1.1` rejects mismatched clients and validates every capability result before returning
   it to the provider.
7. Event multi-value/placement filters, filter removal, occurrence selection, session expansion,
   and map attribution all pass direct/conversational parity fixtures.
8. Consequential calls remain bound to one call/fingerprint through confirmation and execution;
   replay, expiry, rejection, and context change have no duplicate effect.
9. Every embedded argument/result schema compiles under Draft 2020-12, every returned result
   validates against both the common envelope and its capability-specific schema, and catalogue
   pagination/provenance invariants pass semantic validation.
10. Direct and voice event sentences use the same deterministic interpreter and atomic
    `event.applyquery` executor; canonical sentence, phrase ordering, residual query, result count,
    and one resulting context revision match.
11. Ambiguous, stale, and invalid compound event proposals change no query or filter state.
12. Online voice failure displays “Voice service is currently unavailable. Please try again
    later.”, stops capture/playback, clears the voice session and pending work, performs no offline
    voice handoff, and leaves ordinary composer/search/direct controls usable.

## Planned deterministic voice-composer and MCP-foundation validation

Use approved mocked option catalogues and no live provider calls:

1. Submit “free concerts this weekend near Marina Bay” through the direct composer and connected
   voice. Assert identical canonical What/When/Where/Price phrases, residual query, results, and one
   changed context revision.
2. Verify unmatched meaningful words remain in the existing event keyword query.
3. Starting from a composed query, test “make it free,” “change it to tomorrow,” and “remove the
   location”; assert unrelated phrases remain unchanged.
4. Supply overlapping options that require clarification and assert bounded current-catalogue
   choices with zero mutation.
5. Change the option catalogue or context after interpretation and assert the stale proposal
   commits nothing.
6. Make one part of a compound request invalid and assert there is no partial query/filter update.
7. Exercise the typed event interpreter boundary and fixtures for future restaurant, plan, and map
   registration without adding new domain connectors.
8. Compile every MCP foundation projection and compare capability ID, version, kind,
   argument/result schemas, eligibility, confirmation class, and gateway outcome with the source
   registry.
9. Inspect application routes, listeners, dependencies, environment bindings, and production
   bundle to prove no MCP transport/runtime/credential exists.
10. Simulate provider, admission, kill-switch, cap, and transport failures and assert the exact
    unavailable message, terminal cleanup, no local voice handoff, explicit retry, and unaffected
    ordinary event composer/direct controls.

## Existing regression and performance gates

```bash
npm run test:unit
npm run test:event-ui
npm run test:restaurants
npm run test:plans
npm run benchmark:frontend
npm run verify
```

The benchmark must show no more than the plan's allowed regression, and map visual checks must prove
that area, MRT, and location layers do not disturb 3D tile refinement or overlay ordering.

## Optional owner-controlled live smoke

Run only after Arnav explicitly enables both kill switches, confirms the pinned rate card and
available reservation, and places `OPENAI_API_KEY` in the server secret store. Record only ledger
totals and public error codes—never audio, transcript, provider bodies, or coordinates.

Validate one bounded turn, interruption, one safe action, one rejected consequential action, and
explicit stop. Confirm the provider key is absent from the browser bundle/network responses, the
reservation settles from trusted usage, and the cumulative ledger remains within USD 10. Disable
voice immediately after the smoke. Do not run live-provider tests in CI.

### Provider-valid configuration smoke

Before creating any response, the relay sends a provider-only capability projection whose function
names contain only letters, digits, underscores, or hyphens. Canonical application capability IDs
remain dotted everywhere else. The relay waits for a matching `session.updated` acknowledgement
before continuing; missing, stale, duplicate, mismatched, or provider-error events terminate the
session instead of silently falling back to provider defaults.

For a bounded validation, exercise only the opening response and one typed follow-up. Confirm that:

1. every `session.update` has one matching `session.updated`;
2. no provider `error` event occurs;
3. all provider tool names match `^[a-zA-Z0-9_-]+$`;
4. the opening welcome appears only in `response.create.instructions`, never in a persistent
   conversation item; and
5. the session returns to listening after each response and stops explicitly.

Inspect the owner-only local audit only when all development audit gates are active. Never make this
paid smoke part of CI or a routine test command.

## Implementation validation record — 2026-07-18

> Historical evidence only. This record predates the 2026-07-26 constitution-v2.4.0 amendment and
> does not satisfy the capability-query, connector-parity, protocol-1.1, context-resynchronization,
> or new schema gates. A fresh post-amendment validation record is required.

All provider/audio validation below was mocked and spent USD 0.

- Feature contracts: `npm run test:voice` passed 80 tests; `npm run verify:voice-actions`
  verified all 67 reviewed actions and direct/voice parity cases. Focused area/transit asset and
  layer suites also passed. The server relay suite passed 11/11, including GA Realtime event
  mapping and fail-closed overlapping-turn reservation handling.
- Browser compatibility: the full mocked Chromium feature suite passed 25/25 after remediation.
  Consequential confirmation and microphone-revocation journeys passed on Chromium, WebKit, and
  Firefox desktop and mobile profiles (12/12 when the two Chromium cases affected by six-worker 3D
  rendering contention were rerun with the repository's required single worker).
- Existing UI: the post-fix event discovery/UI run passed 30/30. `npm run test:restaurants` passed
  22 pipeline tests and 4 browser tests. Plan unit tests passed 25/25, plan browser tests passed 7/7,
  and the production build passed. The final affected-owner browser regression combined event,
  restaurant, and plan coverage and passed 38/38. Overlay, provider, publication, and no-telemetry
  focus tests passed 27/27.
- Build and style: `npm run build` and `npm run lint` passed. `npm run format:check` cannot run
  locally without its required `CI_BASE_SHA`; a direct Prettier check over every Feature 004 file
  and touched integration file passed. `git diff --check` passed.
- Performance: `npm run benchmark:release` passed all gates. The latest report is
  `outputs/performance-baseline/2026-07-18T095356010Z`; the active area/MRT/location/conversation
  setup remained within the 10% same-page startup-overhead threshold.
- Production verification: build, 67-action production routing, 29 zero-spend budget/relay
  contracts, and 11 authoritative map-asset tests passed. The full `npm run verify` reached 438/439
  Node contracts, then stopped in the concurrently edited Feature 002 expiry pipeline because its
  nested event UI gate timed out waiting for an external 3D tile readiness attribute. This is
  outside Feature 004. A separate `dist` scan found no OpenAI key or credential-shaped provider
  value.
- A pre-existing plan production-smoke assertion expects `main.<hash>.js`, while the current Vite
  build emits `main-<hash>.js`; its build and browser stages pass, and this unrelated helper mismatch
  remains for the owning workstream.

### Concurrent-work review

Feature 004 was integrated on the existing dirty `develop` worktree without resetting, staging, or
replacing other work. Shared-file overlaps were reviewed in `main.js`, activity scenes, Cloudflare
worker/configuration, package scripts, production verification, HTML/CSS, and benchmark code.
Feature 002 source-adapter, event-pipeline, snapshot, registry, fixture, and spec changes were
preserved. Audit remediation was limited to Feature 004 runtime paths and the existing public
control owners required by its 67-action inventory.

### Live-smoke status

T110 was intentionally not run: Arnav did not explicitly enable a live provider smoke in this goal.
`scripts/smoke-realtime-voice.mjs` remains fail-closed unless both runtime switches, owner identity,
server secret, policy/rate-card match, endpoint, and a budget reservation are explicitly present.
The ledger total for this implementation run is USD 0.

## Application-scope remediation — 2026-07-20

> Historical behavior: the statement below that only two tools are exposed before context describes
> protocol 1.0. Target protocol 1.1 exposes the three foundational read capabilities and no
> state-changing command before authoritative context.

The Realtime session now identifies itself strictly as Amble's application guide, refuses unrelated
general-chat and open-web requests, describes only actions eligible in the current revisioned
interface context, and waits for a successful typed-tool result before claiming an application
change succeeded. Before the first context update, only the two grounded discovery tools are
exposed.

Validation used mocked provider/audio and spent USD 0: `npm run test:voice` passed 83 tests,
`npm run verify:voice-actions` verified all 67 production-routed actions, focused ESLint and Prettier
checks passed, and `npm run build` completed successfully. The local development server was restarted
with the new relay contract at `http://127.0.0.1:5173/`.

The follow-up opening-turn regression fixes the welcome copy as a product-specific Amble
introduction rather than allowing an improvised general-assistant greeting. Its focused relay test
passes without a live provider call.

## Frosted voice capsule — 2026-07-20

The voice launcher now matches the map's frosted controls. During ordinary listening, processing,
speaking, and muted states it remains a compact capsule containing the animated Amble orb, current
state, latest transcript, and stop control. The larger content region appears only for first-use
disclosure, errors, or consequential confirmations. Reduced-motion users receive the same state
changes without continuous animation.

Mocked validation passed: 83 voice/unit tests, all 7 desktop voice-assistant browser journeys, the
compact-listening geometry assertion, focused ESLint and Prettier checks, and the production build.
The build retained the repository's existing dependency `eval` and large-chunk warnings.

## Constitution-v2.4 post-amendment validation — 2026-07-26

All Realtime/provider behavior in this validation record is mocked; no live provider call or spend
occurred.

- Core capability gate (T071): `npm run test:voice` passed 176/176 tests.
  `npm run verify:voice-actions` verified 63 active version-2 capabilities and 60
  direct/conversational parity cases. `npm run verify:voice-capabilities` passed 16/16 schema,
  registry, result-envelope, fixture, and environment-parity tests under protocol 1.1.
- Mobile location/transit parity (T064): the protocol-1.1 direct/voice context-revision journey
  passed 2/2 on Chromium mobile and 4/4 across WebKit and Firefox mobile. Each location,
  MRT-station, and MRT-line visibility change published an independent revision; exact coordinates,
  accuracy, and timestamps were absent from every assistant context, and presentation visibility
  did not activate transit ranking.
- Mocked browser matrix (T073): all 76 desktop/mobile journeys are green on each of Chromium,
  WebKit, and Firefox (228 effective cases). The Chromium full run passed 74/76 before the settled
  event-context observer and a bounded restaurant-panel wait were rerun 4/4; the WebKit full run
  passed 73/76 before its settled event/device scope reran 4/4; Firefox's corrected discovery,
  event, and mobile-zoom scopes all reran green, reconciling to 76/76. Runs used one worker and zero
  retries. Clarification and no-match preserve same-session text while the online session remains
  active. The newly amended terminal provider-failure behavior requires a fresh post-amendment
  rerun: it must clear the voice session and leave the separate ordinary composer/direct controls
  available. Mobile-hidden direct zoom controls are treated as non-applicable while protocol zoom
  remains covered.
- Concurrent-work audit (T077): every changed pre-existing Feature 004 target was reviewed against
  the dirty `develop` worktree. Performance-diagnostic bootstrap/scripts from Features 011–013 were
  preserved; Features 014/016 event-pipeline, repair, snapshot, source-adapter, and schedule/session
  work were preserved without Feature 004 rewrites. Feature 015's event search/model/style/tests,
  including its newly approved autocomplete/classifier revision, remain excluded shared ownership;
  Feature 004 integrates only through their preserved public dispatch/filter projection. No conflict
  markers, unmerged paths, whitespace errors, or clear overwrite were found. `main.js`, shared event
  surfaces, `tests/voice-action-coverage.spec.mjs`, `style.css`, and `package-lock.json` remain
  mixed-owner staging hotspots covered by the final cross-feature gates.
- Domain regressions (T072): 152/152 focused Node contracts passed across event publication,
  restaurant pipeline/source/recovery, plan/game/model, overlays, device/provider/relay policy,
  no-telemetry, privacy, and budget behavior. The finalized Feature 015 event discovery/UI suites
  passed 51/51 on Chromium desktop, and the eight corrected sentence-composer cases passed 48/48
  across Chromium, WebKit, and Firefox desktop/mobile with one worker, zero retries. Restaurant UI
  passed 4/4 after `restaurant.closeresults` was constrained to its public empty argument schema and
  focus restoration was derived from the authoritative overlay; its connector/pipeline/overlay
  scopes passed 41/41 and the confirmation/serialization/parity scope passed 13/13.
- Build and style (T074): `npm run build`, `npm run lint`,
  `CI_BASE_SHA=HEAD npm run format:check`, and `git diff --check` passed. Because the repository
  wrapper compares committed revisions and therefore had no files to inspect against `HEAD`, a
  direct Prettier check also passed across all Feature 004 runtime, contract, script, and test paths.
  The production build retained only the existing dependency `eval` and large-chunk warnings.
- Performance (T075): `npm run benchmark:release` passed every command and regression gate. The
  fresh report is `outputs/performance-baseline/2026-07-26T090037042Z`; the active
  area/MRT/location/conversation setup measured a 0.107% startup-overhead regression, below the
  enforced 10% ceiling.

## Deterministic event voice and disabled MCP foundation — 2026-07-26

All provider/audio behavior remained mocked and incurred USD 0. No MCP transport was enabled.

- Shared event interpretation (T080–T091): the checked-in `DomainInterpretation` and
  `EventApplyQueryResult` schemas compile as closed Draft 2020-12 contracts. The focused
  interpreter, classifier, option, discovery, connector, and atomic-controller run passed 54/54.
  Replace, refine, remove, residual query, ambiguity, stale catalogue/context, invalid compounds,
  deterministic phrase ordering, result counts, and zero-mutation failure behavior are covered.
  The direct sentence composer and connected assistant now both invoke the same
  `event.applyquery` command. Voice-originated application publishes one context revision and the
  composer renders that authoritative post-command state.
- Terminal online-voice failure (T089–T091): the full mocked voice suite passed 199/199. Provider,
  relay, admission, budget, and kill-switch failures stop microphone capture and playback, clear
  pending capability/confirmation/context/session state, and show exactly “Voice service is
  currently unavailable. Please try again later.” Retry creates a fresh online session. There is no
  offline voice or disconnected text-to-local-assistant handoff; ordinary composer/search/direct
  controls remain available.
- Disabled MCP foundation (T092–T098): the neutral projector, Realtime view, disabled MCP view, and
  fixture gateway boundary passed 6/6. The action verifier now proves 64 active v2 capabilities and
  61 direct/conversational parity cases, requires `event.applyquery` and canonical composer state,
  compares Realtime/MCP schema and policy projection, requires every MCP descriptor to remain
  disabled, and rejects MCP dependencies, routes, listeners, or credential configuration.
- Browser evidence (T082, T091, T100): direct sentence application, voice sentence mirroring, one
  revision per atomic voice command, stale/ambiguous zero-mutation behavior, and terminal provider
  failure passed on Chromium desktop. The focused direct-composer, voice-composer, and unavailable
  journeys passed 18/18 across desktop/mobile Chromium, WebKit, and Firefox with one worker and zero
  retries.
- Build and inspection (T099–T101): `npm run build`, `npm run lint`, scoped Prettier, and
  `git diff --check` passed. A production-bundle scan covered 17 HTML/JS/CSS files and found zero
  credential-shaped provider secrets and zero protocol-1.0 voice-client declarations. The MCP
  verifier found no active MCP runtime surface. The focused performance run completed successfully
  at `outputs/performance-baseline/2026-07-26T114703719Z`.
- Production and compatibility completion (T076, T101): a fresh `npm run verify` completed with
  exit code 0. It passed the production build, capability/protocol/MCP/security/budget checks,
  746/746 Node tests, POI/background separation, 102/102 event-discovery cases, 204/204 event-UI
  cases, 24/24 restaurant cases, and 393 broader browser cases across desktop/mobile Chromium,
  WebKit, and Firefox. Three unrelated area/map-render timing cases passed on their configured
  retry and were reported as flaky, not failed. Publication verification completed, and the
  performance baseline was written to
  `outputs/performance-baseline/2026-07-26T160240661Z`. The production bundle contains no
  credential-shaped provider secret and no protocol-1.0 voice client. Feature 004's scoped files
  pass Prettier and diff checking; the repository-wide formatter continues to list unrelated
  pre-existing shared-worktree files, which were not rewritten.
- Version-1 compatibility removal (T078): after the complete gate passed, the capability registry's
  generated v1 action projection and the action registry's capability-adaptation entry point were
  removed. The runtime `executeAction` alias now uses the same v2 capability gateway as direct and
  conversational calls, and the exported assistant protocol is 1.1. Post-removal verification
  passed 199/199 voice tests, 17/17 capability-contract tests, 6/6 MCP projection tests, both action
  verifiers, a fresh production build, and 12/12 focused direct/voice composer cases across all six
  browser profiles. Snapshot, POI geometry, pipeline outputs, and the active snapshot pointer were
  not repaired, restored, or regenerated for Feature 004.

## Historical owner-controlled live-smoke attempt — 2026-07-27 (superseded)

Arnav explicitly approved using the existing server-side OpenAI key and the pinned USD 10
no-reset budget. The attempt ran against an isolated local HTTPS Worker and isolated local D1
ledger; production configuration, production D1, the active snapshot pointer, and shared pipeline
artifacts were not changed. No audio, transcript, provider body, coordinates, or secret value was
recorded.

- Live admission initially exposed a workerd-only incompatibility in runtime AJV schema
  compilation. Replacing that dynamic-code path with the deterministic workerd-safe schema
  interpreter allowed protocol-1.1 admission to return `201`.
- Bounded provider turns returned text and audio completion events. Explicit stop worked, and a
  speaking response was interrupted through the browser-owned control, which emitted
  `response.cancel`.
- Browser inspection observed zero requests to an OpenAI origin. The existing API key remained
  server-side and was absent from browser traffic.
- The authoritative browser context advertised 63 eligible capabilities, including
  `map.zoomin`. Multiple bounded plain-language zoom requests nevertheless produced assistant
  speech without a capability proposal, so the safe action did not execute. A live rejected
  consequential-action journey was therefore not attempted: the prerequisite live tool-call path
  was not reliable enough to treat that result as meaningful.
- Final isolated ledger totals were `592304` spent micro-USD and `321536` held/reserved micro-USD,
  or USD `0.913840` combined exposure against the USD 10 cap. Four response reservations settled
  from trusted usage; two interrupted/terminal responses remained conservatively held for audit.
- The isolated ledger was disabled immediately after the attempt, the temporary Worker was
  stopped, and its temporary runtime configuration was removed.
- Post-attempt validation passed 199/199 voice tests, 17/17 capability-contract tests, the
  64-capability/61-parity action verifier, production build, lint, scoped Prettier, and
  `git diff --check`.

This initial attempt was incomplete at the time. It is superseded by the successful
“Owner-controlled Phase 12 live smoke” record near the top of this document; T079 is complete.

## Constitution-v2.5 uncapped-response validation — 2026-07-29

No live provider call or paid spend was used.

This historical validation predates and is superseded for audio-turn accounting by the
2026-07-30 native-audio validation above.

- The checked-in policy schema is `1.1` and contains no application `maxOutputTokens` setting.
- Realtime `session.update` and every `response.create` omit `max_output_tokens`, allowing the
  provider/model intrinsic response maximum.
- Admission reserves against the documented 4,096-token provider maximum only for accounting:
  `81,920` micro-USD output, `121,920` micro-USD total response, and `138,920` micro-USD for a
  worst-case transcription-plus-response turn.
- `node --test tests/realtime-policy.test.mjs tests/realtime-relay.test.mjs` passed 31/31 tests.
- `npm run test:voice` passed the complete 211/211 voice and shared-capability tests.
- Scoped Prettier validation passed, and `npx vite build` completed successfully with only the
  repository's existing dependency `eval` and large-chunk warnings.

## Voice reliability tracing and watchdog implementation — 2026-07-29

No live provider call or paid spend was used.

This historical validation predates and is superseded for audio phase ordering by the 2026-07-30
native-audio validation above.

- The checked-in policy now independently pins a 30-second response deadline while continuing to
  omit `max_output_tokens` from provider requests.
- The Worker and local relay emit only the closed privacy-safe phase record. Tests prove transcript,
  audio, prompt/provider identifiers, exact-coordinate sentinels, secrets, and raw turn/session IDs
  cannot enter serialized records.
- Audio turns trace commit and transcription before response creation; text and opening turns begin
  at response request. Successful response completion and browser cancellation clear the watchdog.
- A deterministically stalled response sends `response.cancel`, records `response_timeout`, holds
  the pending reservation conservatively, emits the exact standard voice-unavailable error before
  the terminal browser reason, and leaves no active session or watchdog.
- `node --test tests/realtime-policy.test.mjs tests/realtime-relay.test.mjs` passed 35/35 tests.
- `npm run test:voice` passed the complete 211/211 voice and shared-capability tests.
- Scoped Prettier validation passed, and `npm run build` completed successfully with only the
  repository's existing dependency `eval`, large-chunk, and Vite output-preparation timing warnings.

## Explicit local content-diagnostic validation — 2026-07-29

No live provider call or paid spend is required. Start the local development server explicitly:

```bash
NODE_ENV=development REALTIME_CONTENT_DEBUG=true npm run dev
```

The active terminal may then show sanitized `voice.content_debug` records for all four relay
directions. Stop the process after debugging and do not redirect or tee this output to a file.
Without both exact startup values, routine local operation emits only privacy-safe phase records.
Vite preview and the Cloudflare Worker cannot construct the content logger even if an environment
flag is present.

Validate deterministically:

```bash
node --test tests/realtime-content-debug.test.mjs tests/realtime-policy.test.mjs tests/realtime-relay.test.mjs tests/no-telemetry.test.mjs
npm run test:voice
npm run build
```

Expected proof:

1. Transcripts, server prompts, valid tool arguments/results, and non-sensitive provider/browser
   fields appear in the explicit local diagnostic fixture.
2. Nested credentials, authorization/cookies/tokens/passwords/secrets/signing material, raw session
   IDs, JSON-encoded secret fields, and raw/encoded audio never reach the injected logger.
3. Default, production, preview, browser-requested, and malformed activation attempts cannot enable
   content diagnostics.
4. The implementation contains no file, database, cache, browser-storage, analytics, or remote
   transport sink, and late provider events after terminal cleanup emit no diagnostic record.
5. Existing privacy-safe phase records and response-watchdog behavior remain unchanged.

Validation completed with zero provider calls and USD 0 spend:

- Focused content-debug, policy, relay, and no-telemetry validation passed 51/51 tests.
- The complete voice/shared-capability suite passed 212/212 tests.
- Scoped Prettier and `git diff --check` passed.
- `npm run build` completed successfully. It retained only the repository's existing dependency
  `eval`, large-chunk, and Vite output-preparation timing warnings.
- Spec Kit convergence checked FR-054–FR-058, SC-028–SC-029, the Phase 16 plan decisions, and
  constitution v2.6.0 and found no remaining implementation gap.

## Bounded persistent local voice-audit validation — 2026-07-30

No live provider call or paid spend is required. Persistence is active only with all local gates:

```bash
NODE_ENV=development REALTIME_CONTENT_DEBUG=true REALTIME_CONTENT_AUDIT=true npm run dev
```

Sanitized JSONL appears under `outputs/realtime-content-audit/`. Routine content-debug mode without
`REALTIME_CONTENT_AUDIT=true` remains process-only. Preview, production, browser messages, URLs,
headers, and admission payloads cannot activate either content path.

Validate deterministically:

```bash
node --test tests/realtime-content-debug.test.mjs tests/assistant-realtime-client.test.mjs tests/realtime-relay.test.mjs
npm run test:voice
npm run build
```

Expected proof:

1. Persistent activation requires the development adapter, development environment, explicit
   content-debug mode, and the separate audit flag.
2. Files are JSONL, owner-only, below 5 MiB, limited to five, and cleaned after seven days.
3. Nested secrets, authorization material, raw session identities, and raw or encoded audio are
   absent from persistent bytes.
4. Repeated large static configuration becomes compact fingerprint records after its first
   permitted copy; a single oversized record becomes a bounded marker.
5. Provider transcript content is recorded only if emitted. Native-audio user speech is never
   inferred or synthesized when no user-transcription event exists.
6. `user`, `pagehide`, and `permission` terminal causes are preserved, while invalid browser causes
   fail closed.
7. Audit I/O failure emits a safe bounded warning and does not alter the voice lifecycle.

Validation completed with zero provider calls and USD 0 spend:

- Focused content-audit, relay-protocol, and browser-client validation passed 56/56 tests.
- The complete voice/shared-capability suite passed 212/212 tests.
- Privacy/no-telemetry and realtime-policy validation passed 16/16 tests.
- ESLint, scoped Prettier, and `git diff --check` passed.
- `npm run build` completed successfully. It retained only the repository's existing dependency
  `eval`, large-chunk, and Vite output-preparation timing warnings.
- Spec Kit convergence checked FR-065–FR-073, SC-035–SC-041, all User Story 9 acceptance
  scenarios, the bounded-audit plan decisions, and constitution v2.7.0 and found no remaining
  implementation gap.

## Provider-valid configuration validation — 2026-07-30

Arnav explicitly authorized live testing with the existing local provider configuration. One
bounded local session used the real relay and `gpt-realtime-2.1-mini` for the opening response and
one typed follow-up, then stopped explicitly.

- The live provider accepted two `session.update` messages and returned two matching
  `session.updated` acknowledgements.
- Both responses completed and returned to listening. The opening transcript exactly matched
  `AMBLE_WELCOME_MESSAGE`; the follow-up remained within Amble's current capabilities.
- The persistent audit recorded zero provider `error` events, zero invalid provider tool names, and
  no persistent conversation item containing the welcome.
- The two trusted-usage settlements were 5,295 and 4,578 micro-USD, or USD 0.009873 total.
- Focused relay/alias/audit validation passed 56/56 tests. The complete voice suite passed 213/213;
  capability/action verification passed for 64 v2 capabilities and 61 direct/conversational parity
  cases; the affected Chromium browser matrix passed 39/39; lint, scoped Prettier, and the
  production build passed.
- The repository formatting wrapper was not independently runnable because it requires the CI-only
  `CI_BASE_SHA`; direct Prettier validation of every changed Feature 004 file passed instead.
- The production build emitted only the existing third-party direct-`eval` and bundle-size
  warnings. No new provider, browser, protocol, build, or lint failure remained.

## Forced native ingress and progressive disclosure validation — 2026-07-30

No live provider call or paid spend was used.

- Native audio now begins with one forced, provider-only `voice.submitutterance` tool instead of
  the recorded 56 application tools. Its closed argument contains the complete model-heard
  utterance and is bounded to 500 characters.
- Single- and multi-filter event requests route directly to one atomic `event.applyquery`
  proposal. The representative “find events today at Marina Bay Sands” case preserved both
  constraints, used one context revision, exposed neither `app.inspect` nor `catalog.search`, and
  required two provider responses after audio commit instead of the recorded three.
- Non-deterministic requests expose at most 15 currently eligible tools from one connector
  family. The restaurant fixture exposed all 13 eligible restaurant actions—not one action—while
  excluding event, map, application-state, and broad catalogue tools. Mixed event/restaurant
  requests and unsupported requests expose no action menu and ask for clarification.
- Final responses expose zero tools. Missing, malformed, duplicate, stale, overlapping, and
  unacknowledged stages fail closed through the existing cleanup path.
- Per-session turn, response-count, maximum-duration, and idle-expiry limits are absent. Seven
  consecutive deterministic turns remained active after simulated 70-second gaps and beyond the
  former five-minute session duration. A simulated fourth provider stage in one user turn stopped
  with `protocol` before another effect.
- Each provider stage retains independent budget admission, configuration acknowledgement,
  trusted-usage settlement, the 30-second response watchdog, interruption, privacy-safe
  diagnostics, and terminal cleanup. A denied stage reservation stops before `turn.ready`.
- Focused ingress, routing, ambiguity, lifecycle, and protocol validation passed 61/61 tests. The
  complete voice/shared-capability suite passed 215/215 tests, and action coverage verified 64
  v2 capabilities with 61 direct/conversational parity cases.
- The affected Chromium browser matrix passed 41/41 journeys. ESLint, direct Prettier validation
  of all changed files, `git diff --check`, and the production build passed. The build retained
  only the existing third-party direct-`eval` and bundle-size warnings.

## Live revision regression and automated utterance matrix — 2026-07-30

No additional live provider call or paid spend was used.

- The local audit showed that forced ingress captured the complete request and selected
  `event.applyquery`, but proposed `baseContextRevision: 0` against authoritative application
  revision `4`; the browser correctly returned `stale_context`.
- Native routing now always binds the gateway's authoritative application revision while retaining
  the event composer's catalogue revision. A regression fixture deliberately keeps the composer at
  revision `0` and the application at revision `9`, then requires the proposal to use revision `9`.
- Automated matrices cover date plus location, type/date/location/price combinations, event
  follow-ups, restaurant and map routing, mixed-domain clarification, unsupported requests,
  rolling date windows, map-area placement, and mystery locations.
- The observed wording “find events today nearby in my area” now produces both `when:today` and
  `where:near-me` rather than leaving the location as residual text.
- Focused routing, relay, interpretation, and event-query validation passed 83/83 tests. The
  complete voice/shared-capability suite passed 228/228; action coverage verified 64 v2
  capabilities with 61 direct/conversational parity cases; all 17 capability-verification tests
  passed.
- All 41 affected Chromium browser journeys passed. One unrelated map-tileset readiness check was
  flaky on its first attempt and passed on its automatic retry. ESLint, scoped Prettier,
  `git diff --check`, and the production build passed with only the existing third-party
  direct-`eval` and bundle-size warnings.

## Voice event-facet classifier validation

The implementation is complete when deterministic tests prove all of the following without a live
provider call:

- Forced native ingress still creates one provider response and one forced tool, now returning the
  complete utterance, `domain`, and a closed event-facet proposal.
- Natural compound requests classify What, When, Where, and Price together; generic “events”
  creates no category restriction; request boilerplate is absent from residual search.
- Every proposed label and evidence span is verified against the current bounded catalogue and
  utterance before `event.applyquery`; unknown, conflicting, malformed, or stale proposals mutate
  nothing.
- Unresolved location wording produces one focused clarification rather than residual text or a
  guessed Near me filter.
- Typed and direct event queries make no provider request and preserve the deterministic
  classifier's existing results.
- Relay, event integration, capability parity, privacy/audit, browser journeys, lint, formatting,
  build, and Spec Kit convergence pass.

# Same-response voice event facets validation (2026-07-30)

- The forced ingress response now carries the exact utterance, domain, and current-catalogue event
  facet proposal in one provider response; no additional provider request or spend was introduced.
- Pure verifier and event integration, relay, context, connector, and client tests passed.
- Complete voice suite: 242/242 passed.
- Capability gates: 64 direct/conversational parity cases and 17 protocol capability tests passed.
- Affected Chromium event/voice journeys, scoped lint/formatting, and production build passed.
- No live provider call and no event-pipeline run were used for this deterministic validation.

## Sixteen-case live reliability loop (2026-07-30)

- Final machine report:
  `outputs/live-voice-matrix/matrix-2026-07-30T162201586Z.json`.
- All 16/16 independent owner-authorized attempts passed in one uninterrupted run: typed help,
  typed map/restaurant/event commands, native map and repeated transit commands, repeated
  restaurant discovery, unsupported input, compound and refining event queries, repeated
  category/price/location requests, ambiguity, and repeated event execution.
- Every passing action used the expected capability and arguments, produced the expected
  application outcome, returned one grounded response, resumed listening, and had no protocol
  stop, timeout, crash, or unsupported mutation.
- Regressions added during convergence cover bounded ingress shape normalization, deterministic
  domain verification, optional event facets and refinement, typed tool-stage preamble buffering,
  structured result narration, asymmetric browser/server payload limits, and socket isolation.
- Fixed speech is now buffered and transcript-validated. One malformed provider response is
  discarded and retried within the existing three-stage turn guard; it is never played to the
  browser.
- Final local budget ledger after the acceptance run recorded `4,289,631` micro-USD spent and
  `2,211,560` micro-USD held/reserved under the existing USD 10 cap. Held amounts came from
  deliberately failed protocol reproductions and were not silently released.
- The complete voice suite passed 250/250. Action coverage passed for 64 capabilities and 61
  direct/conversational parity cases; all 17 protocol capability tests passed. ESLint and
  `git diff --check` passed.
- The affected Chromium matrix completed with all 41 journeys passing; three unrelated
  area-tileset readiness cases passed on their automatic retry. The production build passed with
  only the existing third-party direct-`eval` and large-chunk warnings.

## Grounded capability dialogue amendment — 2026-08-01

- Capability-result speech now distinguishes completed changes, no-ops, empty results,
  unavailable actions, failures, clarification, and confirmation-required states without the
  generic “Done in Amble” fallback.
- Event, restaurant, map/area, plan/location, tour, navigation/external, foundational query, and
  target-neutral fallback dialogue is deterministic and backed only by validated arguments,
  result data, or refreshed connector state.
- Event top-three narration offers to add an event only when the authoritative result explicitly
  reports available plan capacity.
- Focused Node coverage passed 87/87 tests; the event voice composer and browser-owned exact-effect
  confirmation journeys passed 2/2 Chromium desktop tests.
- Action coverage verified 64 version-2 capabilities and 61 direct/conversational parity cases;
  capability coverage passed all 17 contract/result/environment suites; the complete voice suite
  passed 257/257 tests. Scoped ESLint, `git diff --check`, and the production build passed; the
  build retained only the existing third-party direct-eval and chunk-size warnings.

## Empty-recognition admission safety amendment — 2026-08-01

- A provider-completed empty transcript for the active item now settles its bounded transcription
  usage and requests exactly one fixed retry response without proposing a capability, mutating the
  application, stopping the session as a protocol violation, or disabling later admission.
- Mismatched item identities, conflicting duplicate transcripts, missing completions, and actual
  provider failures retain their strict bounded failure behavior.
- The focused relay suite passed 61/61, the complete voice suite passed 257/257, both capability
  verification gates passed (64 capabilities, 61 parity cases, 17 protocol suites), scoped ESLint,
  `git diff --check`, and the production build passed. After restoring the previously tripped local
  ledger, a fresh localhost admission returned HTTP 201 and the ledger remained enabled.

## Deterministic follow-up dialogue amendment — 2026-08-02

- Amble now creates one revision-bound, single-use pending dialogue only when grounded
  event, restaurant, or plan evidence supports an eligible next action. Sole-candidate yes/pronoun
  replies and unique ordinal/name replies resolve the exact stored target; multi-candidate yes,
  mixed conditions and stale context mutate nothing and clarify. Elapsed time alone does not
  invalidate an offer while the same authoritative results remain current.
- Rejection, interruption, unrelated intent, context change, and session cleanup invalidate the
  offer. Resolution consumes it before the ordinary canonical capability proposal. Consequential
  capabilities still enter browser-owned confirmation and no conversational reply can approve the
  effect.
- Restaurant context now preserves bounded approved names instead of exposing IDs as labels, and
  plan context includes bounded currently addable target IDs so every prompt can name its evidence.
- Focused relay/context/connector coverage passed 82/82 tests; the complete voice suite passed
  257/257; the complete unit suite, both capability gates (64 capabilities, 61 parity cases, 17
  protocol suites), full ESLint, `git diff --check`, and the production build passed. The affected
  Chromium dialogue/state matrix passed 30/30 including exact restaurant follow-up identity and
  listening-after-playback behavior. No live provider call or additional paid spend was used.

## Production voice UI suppression — 2026-08-02

- Production builds now fail closed with the complete assistant voice shell hidden unless
  `VITE_VOICE_UI_ENABLED=true` is explicitly supplied. Development keeps the voice shell visible
  by default, and malformed configured values remain disabled.
- The Cloudflare relay gate remains independent and `wrangler.cloud.jsonc` now defaults
  `REALTIME_ENABLED=false`, so hiding the frontend is not treated as the server-side security
  boundary.
- Policy unit coverage passed 3/3. The production-policy Chromium fixture passed 1/1 with the shell
  hidden and inert while direct event search remained available; the development WebSocket voice
  fixture passed 1/1 with the shell visible and functional.
- Full local CI, both voice capability gates (64 capabilities, 61 parity cases, and 17 protocol
  suites), `git diff --check`, formatting validation, and the production build passed. The voice UI
  matrix passed 34/34 applicable journeys with the production-only fixture intentionally skipped
  in its default development run. No live provider call or paid provider spend was used.
