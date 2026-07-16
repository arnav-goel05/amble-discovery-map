# Implementation Plan: What's Here Full-Product Baseline

**Branch**: `main` | **Feature ID**: `001-full-product-baseline` | **Date**: 2026-07-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-full-product-baseline/spec.md`

## Summary

Bring the existing What's Here map, event pipeline, restaurant discovery, anonymous
planning, and Telegram challenge code to the agreed public-production baseline without a
framework rewrite. Preserve the framework-free map UI and single-host Node service, but
formalize domain contracts, publish immutable approved snapshots through one atomic pointer,
add a session-authenticated private admin review domain, enforce free-only providers,
correct lifecycle retention, remove product telemetry, and establish one release gate and
cross-browser validation matrix.

## Technical Context

**Language/Version**: Node.js 24 or newer; browser JavaScript using ESM; server and
persistence modules currently use CommonJS, while pipeline tools use ESM

**Primary Dependencies**: Vite 2.6.x; MapLibre GL 1.15.x; Deck.gl 8.5.x; loaders.gl 3.x;
Three.js 0.161.x; Phosphor Icons 2.x; Playwright 1.55.x; Node built-in HTTP and SQLite

**Storage**: Durable local SQLite with migrations and WAL for plans, games, sessions,
admin sessions and reviews; checked-in approved event/venue snapshot and evidence
registries; ignored atomic JSON caches and per-run artifacts; ignored local venue index

**Testing**: Node test runner; Playwright browser tests; production build and smoke tests;
source-adapter, POI-separation, staged-publication, and frontend performance checks

**Target Platform**: One HTTPS production host serving a same-origin web application and API;
current generally available Chrome, Safari, Firefox, and Edge on the desktop/mobile operating
systems where each browser is officially available

**Project Type**: Framework-free web application with a same-process HTTP service,
executable data pipelines, and an optional Telegram integration

**Performance Goals**: No fixed startup deadline; no regression against the repeatable
frontend benchmark; no permanent idle pill/direction work; preserve event-driven rendering;
restore full 3D quality after map motion; keep restaurant results viewport-bounded

**Constraints**: Free services/APIs/open data only; anonymous public use; one private admin;
one host; no product analytics or telemetry; seven-day inactivity/abandonment retention;
task-end photo cleanup; weekly seven-day-forward data refresh; last-approved snapshot on
partial failure; approved artifacts only in Git

**Scale/Scope**: Singapore-wide event map; weekly event and restaurant refresh; at most 250
restaurants per viewport request and 20 stops per plan under the current boundaries; one
administrator; single-process background delivery and retention worker

## Constitution Check

*GATE: Passed before Phase 0 research and passed again after Phase 1 design.*

- **Evidence - PASS**: `contracts/event-pipeline.md` defines source provenance, official
  evidence, OneMap approval, missing-data behavior, and the manual review boundary.
- **Automation - PASS**: Deterministic collectors, normalizers, resolvers, reconciliation,
  verification, publication, retention, and provider-policy checks remain code-owned.
  Administrator decisions are structured, hash-bound inputs to later pipeline processing.
- **Identity and publication - PASS**: Occurrence identities are distinct from listing and
  merged identities. Immutable snapshot directories and one atomic active pointer prevent
  mixed publication; partial runs keep the previous pointer.
- **Boundaries - PASS**: Events, map rendering, restaurants, plans/games, admin, persistence,
  and external providers have separate services/adapters and versioned contracts.
- **Quality and security - PASS**: The plan adds a single release gate, recovery/privacy
  tests, browser projects, password/session/CSRF/rate-limit controls, provider allowlists,
  and URL/content protections.
- **UX and performance - PASS**: Existing singleton components and event-driven updates are
  preserved; shared tokens and state contracts apply Apple HIG-informed decisions; map
  changes require cold/warm desktop/mobile benchmarks.
- **Operations and privacy - PASS**: The design is single-host and free-only, removes product
  metrics, applies task-end and seven-day cleanup, exposes stale state, and separates
  approved artifacts from caches and runs.

No constitutional exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/001-full-product-baseline/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── event-pipeline.md
│   ├── http-api.md
│   └── ui-components.md
└── tasks.md                 # Created in the next Spec Kit phase
```

### Source Code (repository root)

```text
activity-scenes/             # Public feature controllers and singleton UI components
├── events/                  # Incremental extraction target for event UI responsibilities
├── restaurants/             # Map, list/detail, and API-client boundaries
├── planning/                # Plan state, rendering, routes, and API-client boundaries
├── admin/                   # Private login, review queues, and decision views
├── overlay-coordinator.js
└── map-location-focus.js

map-layers/                  # Deck.gl/MapLibre building and highlight adapter
data/                        # Versioned approved snapshot metadata and evidence registries
public/poi-tiles/            # Approved generated POI geometry required by the snapshot

scripts/
├── serve-app.cjs            # Thin HTTP composition root and static serving
├── event-pipeline.mjs       # Thin event-runner composition root after incremental split
├── *-api-plugin.cjs         # Same-origin plan, restaurant, and admin HTTP adapters
└── lib/
    ├── event-pipeline/      # Runner, state, verification, publication responsibilities
    ├── restaurant/          # Discovery, retrieval, policy, extraction, and cache boundaries
    ├── admin-service.cjs
    ├── admin-repository.cjs
    ├── plan-game-service.cjs
    ├── game-repository.cjs
    └── game-verification.cjs

skills/                      # Human/agent intervention protocols, not workflow engines
tests/                       # Node, browser, contract, staged-publication, and smoke tests
outputs/                     # Ignored runtime state, caches, local indexes, and run reports
```

**Structure Decision**: Evolve the existing single web project in place. Keep `main.js` and
`scripts/serve-app.cjs` as thin composition roots and extract coherent responsibilities only
when their current large modules are materially changed. Do not introduce a SPA framework,
web framework, microservice boundary, or database replacement for this baseline.

## Phase 0: Research Decisions

Research is consolidated in [research.md](research.md). The principal decisions are:

1. Retain vanilla ESM, MapLibre/Deck.gl, Node HTTP, and one-host SQLite.
2. Publish versioned immutable snapshots through an atomic active-snapshot manifest.
3. Key event replacement by source occurrence identity, not parent listing identity.
4. Add one cookie-session admin domain; do not extend secret-header tooling into a UI.
5. Enforce a checked-in `free`/`open` provider allowlist and fail closed.
6. Remove product metrics and keep only bounded, sanitized operational error/health data.
7. Make lifecycle cleanup transactional on complete challenge-session terminal states and
   time-bounded for abandoned sessions and inactive anonymous plans.
8. Add one release command, automated engine coverage, and free local actual-browser,
   simulator, or emulator validation for the declared support matrix.

## Phase 1: Design

### Domain boundaries

- **Public map shell** owns map startup, layer lifecycle, overlay coordination, and shared
  design tokens. It consumes one validated approved-snapshot manifest.
- **Events** owns search, filters, pills, panels, event navigation, selection, and visible
  stale state. It never edits geometry or generated data.
- **Event pipeline** owns source policy, capture, normalization, occurrence identity, venue
  branching, deterministic recovery, reconciliation, verification, reporting, and atomic
  snapshot publication.
- **Venue review** owns unresolved evidence snapshots and administrator decisions. Approval
  exports a validated mapping for the next pipeline reconciliation; it never writes public
  frontend data directly.
- **Restaurants** owns viewport discovery, official-site/deal evidence, free-provider policy,
  stale cache envelopes, markers, details, and plan handoff.
- **Planning and games** owns anonymous plan validation, immutable challenge snapshots,
  mission rules, Telegram idempotency/outbox, and lifecycle cleanup.
- **Administration** owns the sole admin principal, login sessions, CSRF/rate limiting,
  venue/photo review, and operational revocation. Public APIs cannot call admin services.
- **Persistence adapters** own SQLite migrations/transactions and atomic cache files. Domain
  services accept injected repositories and clocks.
- **Weekly refresh orchestration** owns the one-host lock, sequential complete event and
  restaurant commands, terminal status, and externally schedulable exit behavior. Scheduling
  remains outside the web process.

### Delivery sequence

1. Establish shared contracts, artifact policy, provider policy, the first compatibility-
   verified immutable snapshot, and release scaffolding.
2. Correct event occurrence identity, one-week filtering, partial-publication behavior, and
   immutable active-snapshot publication before adding new admin mutations.
3. Add the admin repository/service/session API and venue-review queue, then build the private
   UI and connect decisions back through pipeline validation.
4. Correct anonymous-plan, Telegram, and photo lifecycles and remove product telemetry.
5. Normalize restaurant/deal result envelopes, free-source enforcement, and stale UI.
6. Incrementally split only the large modules touched above and centralize design/state
   primitives without changing public behavior.
7. Add the fail-fast weekly refresh wrapper and free one-host scheduling example, expand
   actual-browser/mobile validation and performance benchmarks, run the full release gate,
   and productionize startup/error states and operator documentation.

### Migration and compatibility

- Add numbered, transaction-safe migrations for activity timestamps, admin sessions/reviews,
  and lifecycle indexes. Remove or stop writing product metric records through a documented
  migration; do not expose historical metrics through the admin API.
- Existing approved venue mappings remain valid only after current runtime validation of
  OneMap identity, tile evidence, and coordinates. Unresolved run-relative cache entries move
  to ignored operational state or the durable review queue.
- Existing public plan and restaurant endpoints remain compatible. New stale fields are
  additive. Admin secret-header endpoints may remain temporarily for non-UI operational use
  but cannot authorize the private UI and must have an explicit removal task.
- Existing approved landmarks, POIs, and tiles are migrated into the first versioned snapshot
  without changing stable IDs. The active pointer changes only after equivalence verification.
- Dependency upgrades are isolated from this baseline unless required for a verified current-
  browser defect; each upgrade receives its own benchmark and regression task.

### Verification strategy

- Unit/contract tests cover schema validation, provider rejection, identity/reconciliation,
  retention transitions, admin authentication/authorization, and stale envelopes.
- Integration tests cover full pipeline resume and atomic publication, SQLite restart and
  migration, Telegram retries/idempotency, venue approval re-entry, and restaurant fallback.
- Browser tests cover all public journeys and the private admin journey across automated
  desktop/mobile Chromium, WebKit, and Firefox. Free local branded browsers, iOS Simulator,
  or Android Emulator MAY add supporting evidence when available; missing combinations do
  not block release.
- Geometry and staged browser checks prove POI/background separation and restoration.
- Cold/warm desktop/mobile performance runs record startup milestones, transferred bytes,
  long tasks, heap, map-motion frames, idle work, and final-quality restoration.
- `npm run verify` becomes the only completion gate and composes focused existing commands
  without removing them.
- The externally scheduled weekly command runs the complete event pipeline followed by the
  complete restaurant refresh under one lock, records both outcomes, and fails without
  replacing approved data when either required refresh is incomplete.

## Complexity Tracking

No constitution violations or exceptional complexity are approved for this plan.
