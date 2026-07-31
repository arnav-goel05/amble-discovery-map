# Feature Specification: Performance Observability

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Add relevant observability so application heaviness can be understood clearly, test it, and converge until complete."

## User Scenarios & Testing

### User Story 1 - Diagnose a Heavy Session (Priority: P1)

A developer can opt into a compact diagnostic view while using the map and see which
runtime costs are high without opening several browser tools or changing normal user
behavior.

**Why this priority**: The team first needs trustworthy evidence about whether network,
main-thread, memory, frame, or map-layer work is responsible for perceived heaviness.

**Independent Test**: Open the application with diagnostics enabled, move the map, and
verify that the view reports startup, network, responsiveness, memory support, frame, and
map-layer signals while the normal application remains usable.

**Acceptance Scenarios**:

1. **Given** diagnostics are explicitly enabled, **When** the application loads and the
   map is moved, **Then** the diagnostic view reports current measurements with units,
   freshness, support status, and budget state.
2. **Given** diagnostics are not enabled, **When** a normal user opens the application,
   **Then** no diagnostic interface, continuous diagnostic sampling, or telemetry upload
   is active.
3. **Given** a browser does not expose a measurement such as JavaScript heap, **When**
   diagnostics are enabled, **Then** the view marks that signal unsupported rather than
   displaying zero or failing.

---

### User Story 2 - Compare Release Performance (Priority: P2)

A developer can run one repeatable command and receive a machine-readable and readable
report that explains startup, transfer, responsiveness, memory, motion, and map workload
for defined scenarios.

**Why this priority**: Repeatable evidence is required to detect regressions and compare
future optimizations.

**Independent Test**: Run the bounded release benchmark and verify that it produces a
complete report, evaluates explicit budgets, identifies the largest resources, and exits
unsuccessfully when a controlled fixture exceeds an enforced budget.

**Acceptance Scenarios**:

1. **Given** a supported local build, **When** the release benchmark runs, **Then** every
   scenario reports startup milestones, transfer by resource group, largest resources,
   long tasks, frame timings, memory support, and map tile/layer counts.
2. **Given** an enforced budget is exceeded, **When** the report is finalized, **Then** the
   exceeded metric, measured value, threshold, profile, and severity are recorded and the
   command fails.
3. **Given** a measurement is unavailable, **When** the report is finalized, **Then** it
   records an explicit unsupported state without silently passing that budget.

---

### User Story 3 - Inspect a Portable Snapshot (Priority: P3)

A developer can export the current diagnostic measurements as a bounded snapshot for
comparison or issue reporting without including personal or content data.

**Why this priority**: A portable snapshot makes a performance report actionable while
preserving the product's prohibition on analytics.

**Independent Test**: Export a diagnostic snapshot and verify its schema, size, provenance,
redaction rules, and consistency with the visible measurements.

**Acceptance Scenarios**:

1. **Given** diagnostics are enabled, **When** a snapshot is exported, **Then** it contains
   versioned aggregate performance signals, environment capability flags, and capture time.
2. **Given** the application has location, search, event, or conversation state, **When** a
   snapshot is exported, **Then** exact location, query text, event content, conversation
   content, credentials, and identifiers are absent.

### Edge Cases

- Measurements collected before a map layer exists remain pending and update when the
  corresponding milestone is reached.
- Background tabs and reduced-motion sessions are identified so throttled frame results
  are not presented as ordinary foreground motion results.
- A resource with an unknown transfer size is counted as a request but not treated as zero
  bytes.
- Repeated enable/disable actions do not create duplicate observers, animation loops, or
  timers.
- Diagnostic rendering does not recursively count its own updates as application work.

## Scope and Constraints

- **In scope**: Opt-in local runtime diagnostics, portable redacted snapshots, expanded
  automated benchmark reports, explicit per-profile budgets, deterministic tests, and
  operational documentation.
- **Out of scope**: Product analytics, session replay, user tracking, remote performance
  collection, third-party monitoring services, alerting infrastructure, and performance
  optimization itself.
- **Evidence and dependencies**: Reuse browser performance capabilities and existing map
  instrumentation. No paid service, external analytics SDK, or new hosted dependency is
  permitted.
- **Privacy and lifecycle**: Measurements remain in the current browser unless a developer
  explicitly exports them. Routine benchmark reports remain ignored local artifacts.
  Diagnostic snapshots MUST exclude personal, location, search, event, plan, restaurant,
  and conversation content.
- **Experience**: Diagnostics are hidden by default, keyboard-accessible when enabled, and
  compact enough not to prevent normal desktop or mobile map testing.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST provide an explicit developer-only activation mechanism for
  runtime diagnostics and remain inactive during ordinary use.
- **FR-002**: Runtime diagnostics MUST report startup milestones, first and largest
  resource costs, transfer totals by resource group, long-task count and duration, frame
  rate and frame-time distribution, memory capability and usage when supported, and active
  map tile/layer workload.
- **FR-003**: Every measurement MUST include a unit or state, capture freshness, and one of
  `healthy`, `warning`, `over_budget`, `pending`, or `unsupported`.
- **FR-004**: Runtime instrumentation MUST be lifecycle-safe: activating it repeatedly MUST
  not duplicate observers or sampling loops, and disabling it MUST release its continuous
  work.
- **FR-005**: The diagnostic interface MUST clearly distinguish foreground motion samples,
  background-tab throttling, reduced-motion behavior, and unsupported browser capabilities.
- **FR-006**: The benchmark MUST emit a versioned machine-readable report and a concise
  human-readable report for each defined profile.
- **FR-007**: Budget definitions MUST be explicit, version-controlled, profile-aware, and
  report measured value, threshold, direction, and severity for every evaluation.
- **FR-008**: Enforced benchmark execution MUST fail when an enforced budget is exceeded or
  when a required measurement is unavailable.
- **FR-009**: The benchmark MUST retain visual-quality restoration checks while adding
  absolute evaluations for transfer, memory, startup, long tasks, and motion.
- **FR-010**: Developers MUST be able to export a bounded, versioned diagnostic snapshot
  matching the current visible measurements.
- **FR-011**: Runtime and exported diagnostics MUST NOT transmit or contain analytics,
  credentials, exact or coarse user location, search text, selected content, event details,
  restaurant details, plan data, or conversation data.
- **FR-012**: Diagnostic failures MUST not prevent the normal application from starting or
  functioning.
- **FR-013**: Automated tests MUST cover activation, inactive behavior, measurement
  updates, unsupported capabilities, cleanup, budget pass/fail behavior, report schema,
  and redaction.
- **FR-014**: Documentation MUST explain activation, metric meaning, budget interpretation,
  snapshot export, known browser limitations, and the privacy boundary.

### Key Entities

- **Performance Sample**: A timestamped aggregate measurement with metric name, value,
  unit, support state, freshness, and budget state.
- **Performance Snapshot**: A bounded, versioned collection of samples and capability
  flags captured from one explicitly enabled diagnostic session.
- **Performance Budget**: A versioned profile-specific threshold with comparison direction,
  severity, enforcement status, and metric identity.
- **Benchmark Report**: A versioned set of scenario results, resource attribution,
  environment description, budget evaluations, and overall pass/fail state.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An enabled diagnostic session displays all required supported signal groups
  within two seconds of the corresponding measurement becoming available.
- **SC-002**: An ordinary session creates zero diagnostic observers, diagnostic animation
  loops, periodic diagnostic timers, or diagnostic network requests.
- **SC-003**: A diagnostic snapshot contains no prohibited personal or application-content
  fields and remains below 100 KiB.
- **SC-004**: Every benchmark profile evaluates 100% of its declared budgets and identifies
  unsupported required measurements explicitly.
- **SC-005**: A controlled threshold breach causes the enforced benchmark to fail and names
  the exact profile and metric in both report formats.
- **SC-006**: All new diagnostic behavior passes deterministic unit tests, browser tests,
  lint, and the production build.
- **SC-007**: Runtime diagnostic overhead, measured with the diagnostic view enabled and
  idle, adds no more than one periodic visual update per second and no continuous work
  after it is disabled.

## Assumptions

- Diagnostics are intended for developers and release operators, not public users.
- Existing benchmark scenarios remain the canonical repeatable environments.
- Browser-provided memory values are optional capabilities rather than cross-browser
  guarantees.
- Initial budgets protect against severe regression and make current costs visible; actual
  performance reduction is a separate feature.
