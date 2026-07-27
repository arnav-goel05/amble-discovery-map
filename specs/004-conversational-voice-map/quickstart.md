# Quickstart Validation: Conversational Voice Map Assistant

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
- no audio, transcript, exact location, or context appears in ledger rows or logs;
- map-asset identities, geometry, provenance, and reconciliation validate.

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
4. Switch between audio and text, interrupt speech, deny microphone access, and terminate via stop,
   page navigation, idle timeout, duration limit, network error, provider error, kill switch, and cap.
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

## Owner-controlled live-smoke attempt — 2026-07-27

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

T079 remains incomplete. The live provider-to-capability proposal path must be corrected and the
safe-action plus rejected-consequential-action journeys rerun before this smoke can be marked
passed.
