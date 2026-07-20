# Quickstart Validation: Conversational Voice Map Assistant

## Purpose

Validate the feature end to end without spending against the OpenAI allowance. Automated tests use a
mock relay, deterministic transcript/audio fixtures, and approved candidate fixtures. A live provider
smoke is optional, owner-controlled, and never part of routine CI.

## Prerequisites

- Node.js 24 and installed project dependencies
- Feature 004 active in `.specify/feature.json`
- Generated discovery-area and transit-context fixtures with manifests
- No `OPENAI_API_KEY` is required for the default validation path

## Static and unit validation

```bash
npm run lint
npm run format:check
npm run test:voice
npm run verify:voice-actions
```

Expected outcomes:

- every public action has a unique valid contract and direct/voice equivalence fixture;
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
