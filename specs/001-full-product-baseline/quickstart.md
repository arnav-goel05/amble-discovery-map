# Quickstart Validation: What's Here Full-Product Baseline

This guide describes the end-to-end evidence required after implementation. It does not
replace focused test output or a terminal pipeline report.

## Prerequisites

- Node.js 24 or newer and npm
- Current Playwright Chromium, WebKit, and Firefox browser binaries
- A writable durable local directory for application state
- Checked-in approved event/venue snapshot and POI tiles
- Local venue index assets for a real pipeline run; fixture tests do not require rebuilding
  the full index
- Server-only Telegram and administrator secrets only when validating those live paths

Do not configure a provider unless its checked-in definition is approved `free` or `open`.

## Install and build

```sh
npm ci
npm run build
```

Expected: the combined POI tileset builds, the production bundle completes, and no generated
run/cache artifact is added to the approved dataset.

## Run focused existing suites

```sh
npm run test:event-sources
npm run test:event-pipeline
npm run test:poi-separation
npm run test:event-ui
npm run test:restaurants
npm run test:plans
```

Expected: source contracts, occurrence identity, venue resolution, reconciliation, geometry
separation/restoration, public UI, restaurants, anonymous planning, Telegram idempotency,
privacy cleanup, and production smoke checks pass.

## Implementation checkpoints

- Foundation (T007-T018): passed on 2026-07-14 with 12/12 shared contract, provider-policy,
  and approved-snapshot tests; the production build passed; the initial 64-landmark/64-POI
  migration passed equivalence and hash validation; focused default, empty, and injected
  Chromium snapshot paths passed. The production `/api/snapshot` endpoint also returned the
  active `initial` snapshot with security and cache headers.
- Event discovery MVP (T019-T027): passed on 2026-07-14 with 6/6 reconciliation and geometry
  lifecycle tests, 64 POIs separated across 366 source tiles, focused desktop/mobile discovery
  browser coverage, stable full-title/multi-event pills, and a successful production build.
- Event search and details (T028-T036): passed on 2026-07-14 with 7/7 model/overlay tests,
  34 passing UI browser tests (2 staged-only tests skipped without a run directory), explicit
  missing-data states, validated optional links, singleton overlay coordination, and a
  successful production build.
- Private venue review (T055-T070): passed on 2026-07-14 through repository/API tests and the
  desktop/mobile Chromium, WebKit, and Firefox admin journeys. Local HTTP automation disables
  only the Secure cookie attribute; production remains Secure, HttpOnly, SameSite=Strict.
- Anonymous planning and Telegram challenge lifecycle (T071-T095): passed on 2026-07-14 with
  mixed-stop ordering and touch reordering, Google Maps order, immutable game snapshots,
  restart/idempotency behavior, seven-day cleanup, terminal photo cleanup, zero product
  telemetry, and private photo-review coverage.
- Restaurant discovery (T096-T108): passed on 2026-07-14 with free-provider/official-domain
  policy, fresh/stale/expired response contracts, viewport markers, singleton details, plan
  handoff, and complete close cleanup across the automated browser matrix.
- Stale-source recovery (T109-T116): passed on 2026-07-14 with prior-snapshot preservation,
  explicit no-prior-data states, bounded restaurant recovery, expired-deal suppression, and
  fresh in-place reconciliation.
- Automated release completion (T117-T123 and T125-T127): the production build, five weekly-wrapper tests, artifact
  audit, production smoke, and 276-case Chromium/WebKit/Firefox desktop/mobile matrix passed
  on 2026-07-14 (258 passed; 18 staged-only cases skipped without a run directory). Performance
  results and the responsibility audit are recorded in `docs/performance-baseline.md` and
  `docs/module-responsibility-audit.md`.

Actual branded-browser and OS observations are optional supporting evidence. The required
compatibility gate is the passing automated desktop/mobile Chromium, WebKit, and Firefox
matrix; unexercised branded combinations are recorded in `docs/browser-support.md` without
blocking release.

## Run the unified release gate

After the plan is implemented:

```sh
npm run verify
```

Expected: one command runs the production build and every relevant Node, browser, geometry,
pipeline, restaurant, planning, admin, privacy, and smoke suite. A failed sub-suite makes the
command fail; no “partial pass” is accepted as release-ready.

## Validate the public application

```sh
npm run serve -- --host 127.0.0.1 --port 4173
```

Use the automated browser matrix for the required validation. Optionally open
`http://127.0.0.1:4173` in any locally available branded browsers and verify:

1. The production shell appears without internal spike/warning text.
2. Approved buildings, event pills, search, category filters, event navigation, missing-data
   states, optional official links, and background geometry behave consistently.
3. Restaurant mode uses the toolbar spinner, viewport-bounded distinct markers, one detail
   panel, stale indication where applicable, and a complete close cleanup.
4. Events and restaurants enter one anonymous plan; reorder, warnings, and Google Maps route
   order remain correct.
5. Desktop and mobile layouts preserve map controls, touch targets, close actions, and overlay
   coordination.

## Validate the private admin journey

Provide a password hash and session secret through the server environment; never commit raw
credentials. Start the server and verify:

1. Public/unauthenticated requests cannot read or mutate admin resources.
2. Incorrect login attempts return a generic response and are throttled.
3. Successful login sets a protected session cookie; mutation without the CSRF token fails.
4. A pending venue review displays the evidence hash, official address evidence, candidates,
   GML/tile evidence, competing candidates, and recovery attempts.
5. Approval with a stale hash fails without mutation; a valid idempotent approval is recorded
   once and indicates that pipeline reconciliation is required.
6. An uncertain photo can be accepted/rejected once, but a terminal/deleted task cannot be
   revived by review.
7. Logout invalidates the server session and all later admin requests fail.

## Validate weekly refresh behavior with fixtures

Use deterministic fixtures containing:

- multiple occurrences under one listing;
- new, updated, unchanged, expired, undated, and not-mappable events;
- reusable approved venues and one genuinely ambiguous venue;
- a required source outage;
- a process interruption during snapshot staging.

Expected:

- the event window is the Singapore run date plus the following seven calendar days, for
  eight represented calendar dates;
- each record retains source adapter/version, retrieval time, window, and record pointer;
- all occurrences survive independently and reconcile by occurrence identity;
- no-op entities are not re-extracted or rewritten;
- ambiguous evidence creates one hash-bound admin review;
- partial/outage/interrupted runs preserve the prior active snapshot;
- a fully verified rerun atomically activates exactly one new snapshot.
- the one-host weekly wrapper locks once, completes the event pipeline before the restaurant
  refresh, records both statuses, and fails safely when either domain is incomplete.

For an authorized real weekly refresh, follow `AGENTS.md` and
`skills/event-pipeline-runner/SKILL.md` exactly. A continuation response is not a failure and
must be executed until the command returns `complete: true` or a genuine documented blocker.

Validate the checked-in free cron/systemd example in a disposable user account and confirm
that overlapping invocations do not start a second refresh.

### Weekly event pipeline checkpoint (T037-T054)

Verified on 2026-07-14:

- `npm run test:event-sources`: Catch.sg and SISTIC approved adapters passed.
- `npm run test:event-pipeline`: 71/71 tests passed, including staged browser publication.
- Source, reconciliation, and publication contract suites: 18/18 tests passed.
- `npm run test:poi-separation`: 64 POIs across 366 tiles passed.
- `npm run build`: production build passed.

The unresolved runtime cache was migrated to ignored operational state; immutable publication
uses `data/snapshots/<run-id>/` and changes `data/approved-snapshot.json` only after every gate
passes.

## Validate stale-source behavior

Make each external source unavailable in a controlled test:

- Approved prior event/restaurant data remains visible with `potentially outdated` and last-
  checked context.
- A source without approved prior data shows an unavailable state.
- An expired restaurant deal is not presented as current.
- No failure path invokes an unapproved or paid provider.

## Validate retention and no-telemetry behavior

Using an injected clock and isolated state directory:

1. Complete, quit, time out, and revoke separate complete challenge sessions. Related photo-
   verification records disappear in the same terminal operation, while completing an
   individual mission does not prematurely delete session-level data.
2. Leave a challenge session abandoned and a plan inactive. Advance seven days and run maintenance;
   both are deleted without affecting a still-active challenge.
3. Confirm plan creation sets activity, successful game creation refreshes it, and read-only
   plan retrieval does not extend retention.
4. Replay Telegram updates and outbound failures; each mission advances once and replies
   remain retryable during the bounded operational window.
5. Confirm retained image bytes are zero.
6. Confirm product metric writes, metric tables exposed to the application, and metric API
   fields are absent. Operational logs contain no chat IDs, coordinates, photo IDs, secrets,
   or source query credentials.

## Validate performance

```sh
npm run benchmark:frontend
```

Record cold and warm desktop/mobile profiles before and after rendering-sensitive work.
Compare readiness milestones, request/byte counts, long tasks, heap, movement frame timing,
idle pill/direction updates, tile counts, and full-quality restoration. There is no fixed
startup deadline, but unexplained regressions block the affected change.

## Artifact audit

Before completion, inspect version-control status. Expected tracked additions are source,
tests, schemas/contracts, approved registries/snapshot data, and required POI tiles. Raw
downloads, local indexes, pipeline runs, restaurant caches, failed staging directories,
screenshots, and routine reports remain ignored.
