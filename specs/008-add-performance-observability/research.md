# Research: Performance Observability

## Decision: Explicit opt-in before application import

- **Decision**: Parse `?performanceDiagnostics=1` in `app-entry.js` and dynamically load the
  diagnostics module before importing `main.js`.
- **Rationale**: Startup observers can see early milestones while an ordinary session loads
  no diagnostics module and creates no observers, timers, loops, or requests.
- **Alternatives considered**: Always-loaded dormant code adds bundle cost; mounting after
  the map loses startup evidence; a public control exposes a developer tool to users.

## Decision: Browser-native, lifecycle-owned runtime collection

- **Decision**: Use browser Performance APIs, motion-scoped animation-frame sampling, and a
  strict whitelist of numeric body/map counters. Retain every observer/listener/timer and
  remove it during disable, map removal, page hide, or HMR cleanup.
- **Rationale**: It covers network, responsiveness, frames, memory capability, and map
  workload without a telemetry SDK or permanent render loop.
- **Alternatives considered**: CDP is unavailable to the page; polling the entire DOM is
  costly and unsafe; body-dataset export can reveal selected content and coordinates.

## Decision: Local-only redacted snapshot

- **Decision**: Export a versioned snapshot below 100 KiB containing capability flags and
  aggregate samples only. Resource details retain a sanitized pathname at most, never
  origin, query, fragment, or application state.
- **Rationale**: Developers can attach actionable evidence to an issue while respecting the
  constitutional ban on analytics and avoiding identifiers or content.
- **Alternatives considered**: Remote collection is prohibited; arbitrary recursive
  redaction is brittle; local storage creates unnecessary retention.

## Decision: Pure profile-aware budget evaluator

- **Decision**: Add a dependency-free evaluator that validates budget configuration and
  benchmark reports, resolves declared metric paths, and returns one explicit evaluation
  per profile/metric.
- **Rationale**: Pass, breach, and unsupported behavior can be tested without launching a
  browser, while the benchmark remains a thin adapter.
- **Alternatives considered**: Inline conditions are difficult to test; an external schema
  library is unnecessary; relative-only gates can pass severe absolute degradation.

## Decision: Red-line guardrails, not optimization targets

- **Decision**: Check in deliberately loose per-profile maximum/minimum limits based on
  current and historical runs. `benchmark:frontend` reports them; `benchmark:release`
  enforces them.
- **Rationale**: Current runs vary and are already slow. Initial budgets should catch severe
  regression without pretending current performance is acceptable; optimization can lower
  thresholds later using repeated evidence.
- **Alternatives considered**: Tight aspirational limits would make the current release
  unusable; no budgets would preserve the current blind spot.

## Decision: Preserve existing correctness gates

- **Decision**: Keep area/context scenario gates and full-quality restoration checks separate
  from performance budget evaluation, while bumping the report schema. Retain the context
  gate at 10% and recalibrate the wide-area red line to 35% after repeated current-snapshot
  runs ranged from negligible contention to approximately 26%.
- **Rationale**: Visual correctness and cost are different release questions and both must
  remain visible.
- **Alternatives considered**: Folding all outcomes into one boolean obscures whether a
  failure is correctness, capability, or performance related.

## Decision: Deterministic privacy and lifecycle tests

- **Decision**: Inject clocks, observers, timers, animation scheduling, document state, and
  map events into the collector for unit tests; add one bounded browser integration suite
  and extend no-telemetry assertions.
- **Rationale**: The highest risks are hidden work, leaked state, and cleanup failures, all
  of which require direct deterministic proof.
- **Alternatives considered**: Browser-only testing is slower and less precise; snapshots of
  UI text do not prove observer cleanup or export privacy.
