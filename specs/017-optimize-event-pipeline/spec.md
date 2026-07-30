# Feature Specification: Optimize Event Pipeline

**Working Branch**: `develop`

**Created**: 2026-07-27

**Status**: Complete

**Input**: Optimize the complete event pipeline end to end so it uses current resources efficiently, preserves output quality, and remains general rather than case-specific. Implement and validate coherent optimization categories rather than isolated changes, proceeding only when results remain equivalent.

## Clarifications

### Session 2026-07-27

- Q: Which parts of the pipeline are included? → A: The complete event lifecycle from collection through extraction, normalization, venue resolution, deduplication, reconciliation, geometry/assets, verification, publication, and dashboard delivery. Browser runtime and map-rendering performance are excluded.
- Q: What counts as identical results? → A: Canonical data equality is required for identities, fields, evidence, and decisions after excluding documented volatile metadata and ordering. Unchanged geometry and assets must retain their hashes; changed assets must pass structural and visual parity.
- Q: How long may a venue-not-found result be reused? → A: Invalidate immediately when relevant evidence, policy, adapter, or country context changes. Otherwise expire after seven days for events within 30 days and after 30 days for later or undated events.
- Q: How much multi-country architecture should this feature introduce now? → A: Do not introduce country-specific architecture now. Keep every optimization scalable through general contracts, configuration, stable extension points, and no new Singapore-, source-, event-, venue-, or organizer-specific hardcoding.
- Q: What performance evidence is required to activate an optimization? → A: Require canonical output parity plus a measurable reduction in the category's targeted waste, such as external calls, bytes, repeated stages, or blocking time. Report total runtime, but do not impose a fixed total-runtime threshold.

## User Scenarios & Testing

### User Story 1 - Preserve Trusted Results While Removing Repeated Work (Priority: P1)

As the pipeline operator, I can run an optimized weekly refresh that produces the same safe event, venue, map, review, and publication decisions while avoiding work whose validated inputs and outputs have not changed.

**Why this priority**: Efficiency is valuable only if the product continues to publish the same evidence-backed results and preserves the same failure isolation and rollback guarantees.

**Independent Test**: Replay a representative saved run through the current and optimized paths, compare all defined equivalence surfaces, and confirm that unchanged stages are reused while every changed or uncertain stage still executes.

**Acceptance Scenarios**:

1. **Given** unchanged validated inputs for a completed stage, **When** the optimized pipeline resumes or retries, **Then** it reuses that stage only when the complete input contract matches and records why reuse was safe.
2. **Given** any relevant input, policy, code, configuration, evidence, or dependency change, **When** reuse is evaluated, **Then** the affected stage and its downstream dependants are invalidated and executed normally.
3. **Given** an optimization candidate, **When** its focused parity suite reports any unexplained output difference, **Then** that category is not activated and the prior behavior remains authoritative.

---

### User Story 2 - Complete Weekly Work Without Synchronous Waste (Priority: P2)

As the pipeline operator, I can complete safe automated work without waiting for unrelated manual reviews, repeated failed lookups, duplicate report delivery, or successful gates that have already been proven for identical inputs.

**Why this priority**: The latest run spent substantial time on serial ambiguity handling and repeated verification rather than new event processing.

**Independent Test**: Run saved fixtures containing approved, unresolved, not-mappable, unchanged, and failed-gate branches; verify that safe branches reach publication, affected branches remain isolated, and repeated invocations do not repeat external or generated work unnecessarily.

**Acceptance Scenarios**:

1. **Given** a genuinely ambiguous new venue, **When** automated recovery cannot prove one building, **Then** only that identity is held for review and unrelated safe identities continue.
2. **Given** a prior evidence-backed recovery outcome whose reuse contract remains valid, **When** the same evidence is encountered, **Then** the outcome is reused without another external lookup.
3. **Given** a release gate failure, **When** the failure is corrected without changing other gate inputs, **Then** only invalidated gates rerun and publication still waits for the complete authoritative gate set.
4. **Given** an unchanged finalized report, **When** finalization is retried, **Then** external report delivery is not repeated.

---

### User Story 3 - Keep Optimizations General and Extensible (Priority: P3)

As the product owner, I can extend the pipeline later without first removing event, venue, source, organizer, or Singapore-specific shortcuts introduced by this optimization work.

**Why this priority**: Optimizations that depend on one source, one city, or one venue format would create future migration cost and inconsistent quality.

**Independent Test**: Execute generalized fixtures with different source, timezone, geographic-evidence, and policy configuration values and confirm that optimization behavior is selected through contracts rather than conditional event or venue names.

**Acceptance Scenarios**:

1. **Given** different declared timezone, source, geographic-evidence, and policy values, **When** the same optimized stage executes, **Then** it consumes those values through its contract rather than Singapore-specific branches.
2. **Given** a new source adapter, **When** it satisfies the common source and evidence contracts, **Then** it can join the pipeline without changing general orchestration rules.
3. **Given** a source-specific retrieval strategy, **When** it is selected, **Then** the choice is declared and evidence-driven rather than hardcoded to individual event, venue, or organizer names.

### Edge Cases

- A cache entry matches the event URL but not the current content, policy, adapter, execution context, or evidence version.
- A stage succeeded before a code or configuration change occurred during the same run.
- One independent source is slow, rate-limited, blocked, or returns records in a different order.
- A prior negative venue recovery becomes stale after an organizer publishes a location.
- An unresolved venue belongs to an otherwise valid activity that also has an approved venue group.
- A geometry update changes one POI while hundreds of other POIs remain unchanged.
- A browser or shared-capability gate fails for code unrelated to newly collected event data.
- Two semantically equivalent outputs differ only in ordering, timestamps, run identifiers, or storage layout.
- A future deployment lacks the exact geographic provider capabilities used by the current deployment.
- A retry starts after an interrupted write or from a partially populated run directory.

## Scope and Constraints

- **In scope**: Collection, detail extraction, missing-field recovery, normalization, eligibility/date quality, local venue preparation, venue resolution, deduplication, lifecycle reconciliation, event/POI geometry and generated assets, release verification, atomic publication, admin review reconciliation, dashboard delivery, checkpointing, cache invalidation, focused performance evidence, and general extension contracts.
- **Out of scope**: Browser runtime/map-rendering optimization, changing editorial inclusion rules, lowering evidence requirements, automatically approving ambiguous venues, changing deduplication meaning merely to improve counts, replacing free/open geographic dependencies with paid services, and a full live-source run after every category.
- **Evidence and dependencies**: Existing official-source and TinyFish evidence rules remain authoritative. Reuse must be grounded in complete versioned input contracts. Existing OneMap/OSM evidence remains the current geographic implementation; optimization boundaries must not prevent a different conforming provider from being introduced by a separately scoped feature.
- **Privacy and lifecycle**: The feature processes public event and venue evidence only. Existing expiry, review, rollback, immutable snapshot, and generated-artifact retention rules remain unchanged.
- **Experience**: Published event pills, panels, searches, activities, sessions, POIs, geometry, and dashboard outcomes must remain equivalent under the agreed comparison contract.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST establish a versioned baseline and optimized-run comparison contract covering source accounting, invalid and excluded records, accepted occurrences, date reviews, activities, sessions, venue groups, source offers, deduplication decisions, venue outcomes, POIs, landmarks, generated geometry, verification gates, publication decisions, and dashboard summaries.
- **FR-002**: The equivalence rule MUST require canonical equality for identities, fields, evidence, decisions, relationships, and user-visible content after excluding only documented volatile metadata and ordering. Unchanged geometry and assets MUST retain their hashes; intentionally changed assets MUST pass structural and visual parity before activation.
- **FR-003**: Every reusable stage result MUST declare the complete inputs that determine its output, including applicable code, configuration, policy, adapter, execution context, evidence, dependency, and upstream artifact versions.
- **FR-004**: Reuse MUST occur only when all declared inputs match; otherwise the stage and all affected downstream stages MUST be invalidated.
- **FR-005**: Stage execution, reuse, invalidation, waiting, external calls, bytes read/written, generated artifacts, and gate duration MUST be reason-coded and measurable without logging credentials or unbounded page content.
- **FR-006**: The pipeline MUST retain one authoritative verification barrier containing every existing required safety, build, event UI, browser, geometry, and rollback gate, and MUST publish only after that barrier succeeds.
- **FR-007**: A retry MUST preserve successful stage outputs whose complete inputs remain unchanged and rerun only failed or invalidated work.
- **FR-008**: Unresolved manual venue research MUST not synchronously block unrelated safe identities; affected identities MUST be held or carried forward under existing evidence and lifecycle rules.
- **FR-009**: Reusable recovery outcomes MUST be keyed by evidence and policy inputs rather than event, venue, organizer, or source-name exceptions.
- **FR-010**: A negative recovery outcome MUST be invalidated immediately when its source evidence, recovery policy, adapter, geographic context, or other declared input changes. With unchanged inputs, it MUST expire after seven days when the event begins within 30 days and after 30 days when the event is later or undated.
- **FR-011**: Independent source collection MAY execute concurrently only when rate limits, deterministic output ordering, atomic per-source state, and failure isolation are preserved.
- **FR-012**: Retrieval strategy selection MUST be source-contract configuration based on measured field completeness and failure behavior; it MUST NOT contain individual event, venue, or organizer exceptions.
- **FR-013**: Intermediate storage MAY change only if all evidence, stable identities, lifecycle relationships, and comparison surfaces can be reconstructed without loss.
- **FR-014**: Generated geometry and asset reuse MUST be content-addressed or equivalently immutable, and unchanged POIs and background assets MUST not be re-extracted or rewritten.
- **FR-015**: Finalization, admin reconciliation, publication, and dashboard delivery MUST be idempotent and repeat an external side effect only when its complete content or destination contract changed.
- **FR-016**: The pipeline MUST execute against an immutable code, configuration, and policy identity so concurrent workspace changes cannot alter an in-progress run silently.
- **FR-017**: Optimization work MUST be organized into coherent categories with focused tests written before implementation, followed by existing relevant regression tests and baseline comparison before the next category begins.
- **FR-018**: A complete live pipeline run MUST be avoided unless saved-evidence, focused integration, staged snapshot, and existing regression evidence cannot prove an end-to-end requirement.
- **FR-019**: This feature MUST NOT introduce a new country abstraction or live second-country integration. Every optimization contract MUST remain extensible through declared inputs and MUST NOT add Singapore-, source-, event-, venue-, or organizer-specific conditions to general orchestration.
- **FR-020**: Stable identities MUST remain unambiguous across sources, parent listings, occurrences, activities, venue groups, POIs, and immutable snapshots, and optimization keys MUST retain any existing locale or country context already present in their inputs.
- **FR-021**: Existing evidence, inclusion, date quality, venue approval, deduplication, expiry, review isolation, rollback, and publication quality rules MUST remain unchanged unless a separately approved specification changes them.
- **FR-022**: Each optimization category MUST record before/after duration, external requests, cache reuse, bytes or artifacts affected, equivalence outcome, regressions, and the decision to retain or reject the optimization.
- **FR-023**: Convergence MUST inspect the complete specification after implementation and append remaining work until no missing, partial, contradictory, or unjustified optimization remains.

### Key Entities

- **Pipeline Run Identity**: Immutable identity of the execution window, code, configuration, policy, adapter set, execution context, and input manifests.
- **Stage Input Contract**: Versioned declaration of every input capable of changing one stage's output.
- **Stage Checkpoint**: Immutable result, output references, input hash, status, timing, resource counts, and invalidation reason.
- **Equivalence Baseline**: Approved comparison source containing canonical decisions, identities, evidence references, geometry expectations, and allowed volatile fields.
- **Recovery Cache Entry**: Evidence-hash and policy-version keyed positive or negative outcome with provenance and freshness state.
- **Execution Context**: Declared timezone, geographic evidence providers, identity namespace, locale rules, and source set consumed by general stages.
- **Optimization Evidence**: Before/after measurements, parity comparison, regression results, and activation decision for one coherent category.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every activated optimization category reports zero unexplained differences across all agreed equivalence surfaces.
- **SC-002**: A retry after one failed release gate reruns only that gate and any explicitly invalidated dependants; successful unchanged extraction, geometry, build, and UI gates are reused.
- **SC-003**: An unchanged evidence-backed venue or recovery outcome causes zero repeated external research calls.
- **SC-004**: A run with one new ambiguous venue completes all unrelated safe branches without waiting for manual research and leaves the affected identity explicitly held for review.
- **SC-005**: A candidate with twelve changed POIs and at least one hundred unchanged POIs writes or extracts geometry only for the changed set and its proven affected background dependencies.
- **SC-006**: Repeated finalization of unchanged content performs no duplicate publication, admin-queue mutation, or dashboard delivery.
- **SC-007**: Generalized fixtures using different declared source, timezone, geographic-evidence, and policy values pass cache, checkpoint, reconciliation, and publication contract tests without event-name, venue-name, organizer-name, or Singapore-specific conditions in general orchestration.
- **SC-008**: Every optimization category completes its focused and existing relevant regression suites before another category begins.
- **SC-009**: The final convergence pass reports no outstanding specified work and no constitution violation.
- **SC-010**: Every activated category preserves canonical output and measurably reduces at least one declared target—external calls, bytes, repeated stages, generated artifacts, or blocking time—without increasing another protected resource beyond its documented tolerance. Total runtime is recorded but is not a fixed pass/fail threshold.

## Assumptions

- The active approved snapshot and the latest completed full-run artifacts are suitable saved-evidence baselines.
- Existing source, event, venue, POI, and snapshot identities remain the authority for equivalence testing.
- External providers may remain variable; performance comparisons will separate active processing, provider waiting, human review, and retry time.
- Existing tests can be extended with deterministic saved fixtures instead of repeatedly calling live providers.
- Browser runtime and map-rendering performance remain governed by their existing performance features and are not changed here.
- Adding a live second country or a new country-provider architecture is out of scope; scalability is demonstrated by general contracts, configuration-driven behavior, and the absence of new case-specific branches.
