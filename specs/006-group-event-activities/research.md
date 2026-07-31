# Research: Group Event Activities

## Decision 1: Preserve occurrences and add a projection

- **Decision**: Keep normalized occurrence records as the ingestion, expiry, venue-resolution, and reconciliation unit; generate a separate activity projection.
- **Rationale**: Occurrences carry exact schedules and mapping branches. Collapsing them in ingestion would break sibling replacement and expiry.
- **Alternatives considered**: Replacing `events.json` with activities was rejected because downstream venue and lifecycle stages require occurrence identities.

## Decision 2: Use evidence bridges for cross-source grouping

- **Decision**: Group same-source siblings by explicit parent activity identity. Link source parent identities across sources only when an accepted occurrence-level dedup cluster contains both parents.
- **Rationale**: This reuses already-approved deduplication evidence and avoids unsafe title-only activity merges.
- **Alternatives considered**: Fuzzy title-only grouping was rejected as too likely to collapse editions, casts, festival items, or similarly named activities.

## Decision 3: Union sessions and isolate direct conflicts

- **Decision**: Union independently evidenced sessions. If the same stable session identity has incompatible schedule or venue evidence, hold that session membership in a grouping review while unrelated sessions continue.
- **Rationale**: This implements the approved clarification and maximizes valid availability without blocking an entire activity.
- **Alternatives considered**: Intersections hide valid sessions; holding the whole activity violates per-identity isolation.

## Decision 4: Scope offers explicitly

- **Decision**: Deduplicate source links by canonical URL and source, recording whether each applies to an activity or named session identities.
- **Rationale**: Official information pages often cover an activity while ticket pages may target a performance. Explicit scope prevents misleading links.
- **Alternatives considered**: A flat reference list was rejected because it cannot express session-specific ticket availability.

## Decision 5: Derive UI grouping from the activity projection contract

- **Decision**: The public discovery model groups all mapped and off-map occurrences by stable activity identity, filters at occurrence level, and returns one activity result with a representative map target.
- **Rationale**: It provides one discovery card without losing map focus, precise filters, or plan selection.
- **Alternatives considered**: Grouping only inside each landmark was rejected because multi-venue and off-map occurrences would remain duplicated.

## Decision 6: Reproject stored data without collection

- **Decision**: Provide a CLI that reads an existing run's normalized occurrence artifact and writes only activity projection artifacts. Dashboard generation calls the same pure function when the artifact is absent.
- **Rationale**: It validates current data and updates metrics without external requests or a clean run.
- **Alternatives considered**: Re-running normalization was rejected because it would rewrite more state than necessary; re-running collection is explicitly out of scope.

## Decision 7: Retain the Sites visual system

- **Decision**: Update metric labels and add compact activity/session/offer breakdowns within the existing white, bright-accent, fixed-viewport dashboard.
- **Rationale**: The user approved the current visual direction; this is an information-model correction rather than a redesign.
- **Alternatives considered**: A new dashboard route or visual concept would add scope without improving grouping validation.
