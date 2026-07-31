# Optimization Evidence

## Category A — Canonical equivalence and checkpoint foundation

**Status**: activated.

### Output parity

- Canonical comparison ignores only approved volatile metadata and set ordering.
- A placement decision change is detected at its exact path.
- Ordered session arrays remain ordered and are not normalized as sets.
- Existing comparison summary behavior remains covered.

### Resource proof

The focused checkpoint test executes the fixture stage once. A second invocation with the
same complete input contract performs zero executor calls and reports one gate reuse and
zero external requests. Output tampering, configuration change, timezone change, and
geographic-provider change all prevent reuse.

| Metric                       | First execution | Exact-input retry |
| ---------------------------- | --------------: | ----------------: |
| Executor calls               |               1 |                 0 |
| External requests in fixture |               1 |                 0 |
| Checkpoint cache hits        |               0 |                 1 |
| Gate reuse count             |               0 |                 1 |

### Focused tests

`node --test tests/event-pipeline-optimization.test.mjs tests/event-pipeline-comparison.test.mjs`

- 10 passed
- 0 failed

### Existing regression

`npm run test:event-pipeline`

- 101 passed
- 0 failed
- Duration: 117.3 seconds

### Activation decision

Retained. Canonical comparison behavior is stricter than the prior count summary, the
existing pipeline behavior remains green, and exact-input retry demonstrably eliminates
executor work without permitting stale or tampered output reuse.

## Category B — Persistent recovery reuse and review isolation

**Status**: activated.

### Resource proof

Cross-run fixtures execute one search for the first negative or recovered outcome and zero
searches for an exact-input retry. Near-event negatives expire on day 7, undated/later
negatives expire on day 30, and a configured adapter-language change executes again.

| Scenario             | First run searches | Exact retry searches | After invalidation/expiry |
| -------------------- | -----------------: | -------------------: | ------------------------: |
| Near-event not found |                  1 |                    0 |                         1 |
| Recovered venue      |                  1 |                    0 |    1 after adapter change |

Terminal `needs_review` branches remain safely accounted and do not prevent unrelated safe
frontend work. No approval, evidence, or placement rule changed.

### Tests

- Focused optimization, venue recovery, and source contracts: 70 passed, 0 failed.
- The final combined regression, including the previously affected UI path: 216 passed,
  0 failed.

## Category C — Incremental frontend assets and exact-input gate reuse

**Status**: activated.

### Resource proof

- A 112-POI fixture selects exactly 12 changed POIs for extraction and retains 100 no-op
  POIs by immutable existing reference.
- A retry preserves staged assets and reuses them only when the complete input manifest and
  recursive directory hash match.
- Tampering any generated file invalidates the asset checkpoint.
- POI separation passes for 136 POIs across 818 tiles.
- Production build passes.
- Exact-input gate receipts execute once and reuse thereafter; failed gates are never
  reusable, and code/config/environment/artifact changes invalidate.

### Focused regression

- Optimization/comparison/recovery focused suite: 20 passed, 0 failed.
- Frontend snapshot/planner focused suite: 8 passed, 0 failed.
- POI separation: passed.
- Production build: passed.
- Staged frontend integration, including event UI and browser publication gates: passed.
- Production build: passed in 21.18 seconds.
- POI/background separation: passed for 136 POIs across 818 tiles.

## Category D — Idempotent finalization and observability

**Status**: activated.

### Resource proof

- Identical admin or dashboard payload/destination/contract executes once and then reuses
  the successful content receipt.
- Changed payload or destination executes again.
- Failed delivery is recorded but never reused.
- Finalized timestamp is stable across retry.
- Bounded `resource-metrics.json` reports checkpoint execution/reuse, missing-venue recovery,
  registered artifact bytes, missing-venue recovery, and delivery reuse without storing
  credentials or page bodies.

### Tests

- Focused optimization/dashboard/comparison/recovery: 25 passed, 0 failed.
- Finalization, reconciliation, snapshot, dashboard, and frontend planner regression:
  10 passed, 0 failed.

## Final convergence

**Status**: complete.

### Canonical parity

The final saved-run comparison reported zero differences across all ten protected surfaces:
source accounting, normalization, exclusions, deduplication, venue outcomes, published
events, activities, landmarks, POIs, and the combined tileset. The report is stored at
`/tmp/event-pipeline-017-final-equivalence.json` for this workspace session.

### Final verification

| Check                              |                       Result |
| ---------------------------------- | ---------------------------: |
| Combined event-pipeline regression |         216 passed, 0 failed |
| Production build                   |        Passed, 21.18 seconds |
| POI/background separation          | Passed, 136 POIs / 818 tiles |
| Canonical protected surfaces       | 10 equivalent, 0 differences |
| Diff whitespace validation         |                       Passed |

### Retained measurable reductions

| Category                                            |      Before |         After for an unchanged retry |
| --------------------------------------------------- | ----------: | -----------------------------------: |
| Exact-input checkpoint executor calls               |           1 |                                    0 |
| Recovery research calls                             |           1 | 0 until declared expiry/invalidation |
| POIs selected for extraction in the 112-POI fixture |         112 |                                   12 |
| Unchanged POIs selected for extraction              |         100 |                                    0 |
| Identical admin/dashboard delivery executions       | 1 per retry |                                    0 |

Every retained category preserves the existing evidence, inclusion, mapping, deduplication,
review, rollback, and publication rules. No new event-, venue-, organizer-, source-name-, or
Singapore-specific orchestration branch was introduced.

### Full live-run decision

A complete live-source run is not necessary for activation. Saved-run canonical comparison,
focused invalidation and recovery fixtures, the isolated staged publication integration,
the complete regression set, the production build, and geometry separation collectively
prove the changed contracts. Recollection would introduce live-provider variation and
external cost without proving an uncovered requirement.

### Known boundary

Manual authoritative research remains necessary when automated evidence cannot establish a
single building. The optimization isolates a terminal `needs_review` identity from unrelated
safe publication work; it does not weaken the existing two-source evidence requirement or
automatically approve ambiguous venues.
