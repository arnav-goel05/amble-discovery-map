# Research: Retire Honeycombers and ArtsEquator

## Decision 1: Preserve immutable history

**Decision**: Do not modify `data/snapshots/*` or completed historical specs such as `specs/002-add-web-event-sources/*`.

**Rationale**: These files describe earlier approved runs and decisions. Rewriting them would break provenance and reproducibility.

**Alternative rejected**: Global text deletion across the repository. It would erase valid historical evidence and violate immutable-snapshot policy.

## Decision 2: Remove current registrations rather than leave disabled adapters

**Decision**: Delete the two current source definitions, provider entries, adapter exports/modules, source-specific fixtures, and current docs.

**Rationale**: The requested outcome is retirement, not a temporary outage. Dormant registrations would remain selectable and create maintenance ambiguity.

**Alternative rejected**: Set `enabled: false` indefinitely. This would continue surfacing the sources in configuration and operational reports.

## Decision 3: Reconcile by current supported contributions

**Decision**: Filter previous event contributions against the current source-status set before constructing landmark output. Archive retired-only identities, retain supported contributions for mixed events, and record structured traces.

**Rationale**: The current catalogue reconciliation already stops carrying absent source contributions, but untouched landmark arrays can retain stale source-only events. A generic contribution-level rule solves this class of source retirement without venue-specific hardcoding.

**Alternative rejected**: Hard-code the two source names into landmark cleanup. That would not handle future source retirements and would violate domain-boundary guidance.

## Decision 4: Defensively sanitize dashboard payloads

**Decision**: Generate payloads only from current configured status and sanitize dashboard API reads/writes against the active source set.

**Rationale**: Existing Sites D1 data may still contain retired rows. Defensive filtering makes the dashboard correct before a fresh payload reaches it.

**Alternative rejected**: Update only fallback UI rows. API payload merging would reintroduce retired sources.

## Decision 5: Publish without recollection

**Decision**: After focused validation, derive a new immutable snapshot from the active approved snapshot, filter the retired sources, preserve the original freshness metadata, and atomically activate it without source collection.

**Rationale**: The owner explicitly requested no recollection. The approved data contains only two stale landmark copies from the retired sources, so an offline migration removes them safely without repeating external work.

**Alternative rejected**: A complete source rerun. It would repeat collection unnecessarily and was explicitly declined.
