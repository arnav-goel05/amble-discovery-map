# Contract: Current Source Retirement

## Input

- Previous approved catalogue and landmark events
- Current normalized events
- Current run source statuses, whose keys define supported sources
- Current run window start

## Output guarantees

1. No event supported only by an absent source appears in current event or landmark output.
2. A mixed-source event remains when at least one current supported contribution remains.
3. Unavailable configured sources continue to use existing isolated stale carry-forward behavior.
4. Removed identities emit an `archived` trace with `reasonCode: source_retired`.
5. Empty pipeline-managed landmarks and POIs are removed only after current/future event evaluation.
6. Dashboard payloads contain only configured current sources.
7. Historical approved snapshots are never inputs to destructive in-place modification; publication creates a new immutable snapshot and atomically swaps the active pointer.

## Failure behavior

- If retirement produces an internally inconsistent catalogue/landmark pair, verification fails and the last approved snapshot remains active.
- If an unrelated configured source is unavailable, only that source's still-valid identities may be carried stale.
- A stale Sites payload is filtered at its API boundary and cannot reintroduce retired rows.
