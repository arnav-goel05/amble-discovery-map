# Phase 0 Research: What's Here Full-Product Baseline

## Decision 1: Evolve the existing single web application

**Decision**: Keep the framework-free browser ESM frontend, MapLibre/Deck.gl map stack,
same-origin Node HTTP service, and one production process. Make `main.js` and
`scripts/serve-app.cjs` thin composition roots and extract feature boundaries incrementally.

**Rationale**: The current product already implements the principal public flows and has
useful singleton UI and injected service/repository boundaries. A rewrite does not satisfy a
missing user requirement and would make geometry, interaction, and browser regressions more
likely.

**Alternatives considered**: React or another SPA framework; Express/Fastify; separate static
and API services; microservices. All were rejected for baseline scope and one-host operation.

## Decision 2: Keep SQLite behind domain repositories

**Decision**: Continue using Node's built-in SQLite with migrations, transactions, WAL, and
repository injection. Add admin and lifecycle storage through domain-specific repositories
under one durable root and one migration workflow.

**Rationale**: SQLite is appropriate for one host and the existing outbox/idempotency behavior
is already tested. Domain repositories preserve a future storage migration boundary.

**Alternatives considered**: PostgreSQL now; one undifferentiated repository; relying on an
undeclared transitive `better-sqlite3`. PostgreSQL is unnecessary, a shared repository blurs
ownership, and transitive runtime dependencies are unsafe.

## Decision 3: Use immutable approved snapshots with one atomic pointer

**Decision**: Publish landmarks, POIs, geometry references, freshness, coverage, and source
health into immutable versioned snapshot directories. Atomically replace one small active-
snapshot manifest only after every verification passes.

**Rationale**: Current per-file temporary renames and rollback handle ordinary exceptions but
can leave a mixed dataset after process death. A single pointer makes rollback and stale-data
display explicit.

**Alternatives considered**: Continue multi-file in-place publication; copy a partial resolved
subset. Both can expose inconsistent or incomplete production state.

## Decision 4: Treat event occurrence identity as the replacement key

**Decision**: Reconcile events by immutable source plus occurrence identity. Keep parent
listing identity and merged canonical identity as separate relationships, with a content hash
for no-op detection.

**Rationale**: Multiple performances from one listing can share a parent ID. Using the parent
as the stable replacement key causes later performances to overwrite earlier ones.

**Alternatives considered**: Parent listing ID; merged ID alone. Parent ID is not unique per
performance, while merged membership can change without the occurrence changing.

## Decision 5: Preserve deterministic venue recovery and add a durable review queue

**Decision**: Continue approved reuse, address enrichment, local index lookup, exact/spatial
matching, competing-candidate review, and two bounded authoritative recovery paths. Persist
remaining cases as evidence-hash-bound admin reviews. Approval validates the current candidate
and exports a mapping for a later pipeline run; it never publishes directly.

**Rationale**: OneMap building identity remains the publication authority, while OSM and
official addresses are useful geographic bridges. Hash binding prevents a decision from being
silently applied to changed evidence.

**Alternatives considered**: Publish nearest OSM coordinate; let the UI edit approved data;
unbounded web/agent retries. These weaken evidence, atomicity, or operational predictability.

## Decision 6: Enforce free-only providers in executable policy

**Decision**: Every source/provider definition carries an approved owner/domain and cost class
of `free` or `open`. Configuration validation fails closed for absent, paid, or unapproved
providers. Runs record provider and retrieval provenance. A provider that stops being free is
disabled until a free replacement is reviewed.

**Rationale**: Environment-variable names and documentation cannot prevent an accidental paid
request. The project owner explicitly prohibited paid services and paid fallbacks.

**Alternatives considered**: Documentation-only policy; cost alarms; allow paid emergency
fallbacks. None satisfies the prohibition.

## Decision 7: Keep weekly scheduling external

**Decision**: A fail-fast one-host wrapper acquires one lock, invokes the complete event and
restaurant pipeline commands sequentially, and records a combined terminal status. A free
local cron or systemd timer invokes that wrapper weekly. The web application exposes readiness
and run status but does not embed a scheduler.

**Rationale**: External scheduling is simpler to inspect and restart on one host. The pipeline
already owns locking, resumability, stage accounting, and finalization.

**Alternatives considered**: In-process cron; two unrelated schedules. The former couples web
uptime to refresh, while the latter cannot provide one combined lock/status contract.

## Decision 8: Cover the run date plus seven following days

**Decision**: Configure `windowDaysAfterStart` as 7, meaning an inclusive window containing
the run date and the following seven calendar dates. Capture the requested window on every
source-record envelope.

**Rationale**: This matches the approved wording and makes audit of filter application local to
each record rather than dependent on a separate run file.

**Alternatives considered**: Six days after start for seven total calendar dates. Rejected
because the agreed baseline says the following seven days.

## Decision 9: Use one password-authenticated admin session domain

**Decision**: Store the sole administrator's password hash in the deployment secret store.
Authenticate into an opaque server-side session with Secure, HttpOnly, SameSite=Strict cookies,
CSRF tokens, expiry, logout, and attempt throttling. Venue/photo reviews and revocations use
this session, not a browser-held operator secret.

**Rationale**: The current `X-Operator-Secret` routes are useful operational interfaces but do
not provide safe interactive login, session expiry, or CSRF protection.

**Alternatives considered**: Reuse the shared header secret; HTTP Basic; multiple accounts.
They do not meet the agreed private single-admin experience.

## Decision 10: Make privacy cleanup state-driven and transactional

**Decision**: Add explicit challenge-session terminal states and activity timestamps. Delete
related photo-verification records in the same transaction that completes, quits, times out,
or revokes the complete challenge session; individual mission completion is not the retention
boundary. Purge non-terminal abandoned session data after seven days. Set anonymous-plan
activity at creation and refresh it only when game creation succeeds; read-only plan retrieval
does not extend retention. Bound and sanitize Telegram delivery/idempotency records needed for
reliable retry.

**Rationale**: A fixed seven-day photo timestamp does not satisfy deletion when a task ends,
and current Telegram payload tables can retain related personal data indefinitely.

**Alternatives considered**: Shorten the fixed photo TTL only; periodic cleanup without
transactional terminal cleanup. Both retain data longer than agreed.

## Decision 11: Remove product telemetry

**Decision**: Stop writing and exposing product metric events and migrate away retained metric
rows. Keep only minimal live/readiness state, queue depth, and sanitized operational error logs
needed for reliability and security.

**Rationale**: Game lifecycle metrics are product telemetry even when aggregated. The owner
explicitly rejected analytics and telemetry.

**Alternatives considered**: Anonymous aggregates; opt-in analytics. Both exceed the baseline.

## Decision 12: Standardize stale result envelopes

**Decision**: Events, restaurants, and deals expose status, data, retrieval time, stale flag,
warning, and source health consistently. Only the last approved applicable result is reusable.
Expired deals are hidden rather than represented as current merely because their cache exists.

**Rationale**: Restaurant viewport fallback already handles stale data well, but deal and event
freshness is not a consistent user-visible contract.

**Alternatives considered**: Discard all stale data; silently serve cache. The former harms
availability and the latter misleads users.

## Decision 13: Preserve event-driven map rendering and benchmark changes

**Decision**: Keep one combined highlighted POI layer, viewport-bounded restaurant loading,
movement-only quality reduction, event-driven pill/direction updates, byte-range tiles, and
cache headers. Add cold/warm desktop/mobile benchmark profiles and progressive production
startup. Do not preload all geometry.

**Rationale**: These patterns directly address prior flicker and idle-work problems while
preserving final geometry quality.

**Alternatives considered**: Preload every tile; permanent low quality; continuous frame
loops. These increase startup cost, degrade final output, or waste idle CPU.

## Decision 14: Add one release gate and broaden browser coverage

**Decision**: Add `npm run verify` to compose the production build, event source/pipeline/UI,
POI separation, restaurant, plan/game, smoke, and relevant performance checks. Configure
automated desktop/mobile Chromium, WebKit, and Firefox projects as the required gate. Record
free local branded-browser or simulator smoke evidence only when readily available.

**Rationale**: Current focused suites are strong but fragmented. A repeatable engine matrix
provides a practical free release gate without depending on locally installed branded browsers.

**Alternatives considered**: Manual browser checks; keep independent commands only. Neither
provides a reliable completion gate.

## Decision 15: Isolate dependency upgrades

**Decision**: Do not combine broad Vite, MapLibre, Deck.gl, loaders.gl, or Cesium upgrades with
baseline contract work. Create separately benchmarked migrations if a current-browser defect
or security requirement makes an upgrade necessary.

**Rationale**: The stack is old, but simultaneous architecture and dependency changes make
regressions difficult to attribute.

**Alternatives considered**: Upgrade everything first. Rejected due to map/rendering risk and
the absence of a proven baseline blocker.
