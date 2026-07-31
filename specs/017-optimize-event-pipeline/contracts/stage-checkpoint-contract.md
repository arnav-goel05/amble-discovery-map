# Stage Checkpoint Contract 1.0

## Reuse preconditions

A stage or gate may be reused only when:

1. its checkpoint status is `success`;
2. the stage and contract versions match;
3. the canonical complete input manifest produces the same `inputHash`;
4. every output exists and matches its recorded hash and byte size;
5. the dependency graph contains no invalidated predecessor;
6. the current policy permits reuse;
7. reuse is recorded with a reason code and resource metrics.

## Invalidation

Any code, configuration, policy, adapter, execution context, upstream artifact, evidence,
command, or bounded environment change invalidates the affected checkpoint and downstream
dependants. A missing or unhashable input means “execute”, never “assume unchanged”.

## Atomicity

Checkpoint outputs are written to temporary paths, hashed, then atomically renamed before
the success record becomes visible. Interrupted or failed outputs are never reusable.

## Release gates

POI separation, build, event UI, and staged browser gates remain mandatory. Reuse changes
execution frequency, not the authoritative release barrier.
