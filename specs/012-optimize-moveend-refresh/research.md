# Research: Optimize Map-Move Event Refresh

## Decision: Cache the latest complete discovery result

**Rationale**: Event grouping depends on data and filters, while map movement changes only
viewport visibility, distance, placement, and ordering. Reusing the last complete result
removes the measured invariant work without changing grouping semantics.

**Alternatives considered**:

- Memoizing the whole filter function: rejected because a viewport refresh still needs an
  explicit contract and cache invalidation would be less clear.
- Debouncing the existing full refresh: rejected because it still performs unnecessary
  work and only changes when the stall occurs.
- Removing move-end refresh entirely: rejected because pills and nearest-first results
  would become stale.

## Decision: Keep a diagnostic-only legacy mode

**Rationale**: The same current build can execute both the old full-refresh path and the
new viewport-only path, producing a controlled timing comparison without reverting source
code or using different snapshots.

**Alternatives considered**:

- Compare only to an older report: retained as supporting evidence but not sufficient for
  the strongest paired measurement.
- Ship a user-facing switch: rejected because it adds unsupported product behavior.

## Decision: Test discovery invalidation and viewport reuse separately

**Rationale**: A regression that skips grouping on filter changes would be incorrect even
if it improves timing. Tests must prove map movement reuses the cache and filters replace
it.

**Alternatives considered**:

- FPS-only test: rejected because FPS cannot prove the causal work was removed and is
  sensitive to hardware variance.
