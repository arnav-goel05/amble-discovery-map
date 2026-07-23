# Research: Publish Distinct Activities

## Canonical public boundary

- **Decision**: Publish one `activities.json` and make landmarks reference activities and venue groups.
- **Rationale**: The existing internal projector already establishes stable activity/session/venue/offer identity. A single asset removes network duplication and permits mapped and off-map discovery through one index.
- **Alternatives considered**: Embedding activities per landmark duplicates multi-venue activities. Keeping occurrence assets plus summaries retains the transfer and parsing problem.

## Session delivery

- **Decision**: Include compact sessions inline with every activity.
- **Rationale**: Existing filters and planning need immediate access to schedule, price/availability, and venue membership. The accepted 12,916 sessions are substantially smaller when audit and repeated event content are removed.
- **Alternatives considered**: Lazy session requests reduce initial bytes but complicate filters, error states, caching, and details.

## Multi-venue presentation

- **Decision**: Reference an activity from every applicable mapped landmark, while globally deduplicating discovery by activity identity.
- **Rationale**: Users must see the activity wherever it occurs without receiving duplicate discovery cards.
- **Alternatives considered**: A representative landmark hides valid venues and gives misleading map coverage.

## Schema rollout

- **Decision**: Perform an immediate, versioned cutover from `eventsRef` to `activitiesRef`.
- **Rationale**: The user explicitly rejected a compatibility period. Atomic snapshot activation and fail-closed validation bound the risk.
- **Alternatives considered**: Dual contracts preserve cached clients but retain old assets and complicate removal.

## Public redaction

- **Decision**: Exclude occurrence membership, evidence references, extraction completeness, grouping decisions, and internal reconciliation history.
- **Rationale**: Stable public IDs allow server-side tracing without forcing every visitor to download operational evidence.
- **Alternatives considered**: Publishing audit history aids ad-hoc browser debugging but materially increases data and exposes internal paths.

## Migration scope

- **Decision**: Change only publication and consumption; keep occurrence-level pipeline stages intact.
- **Rationale**: Occurrences are required for source identity, expiry, deduplication, venue resolution, and reconciliation. The performance problem exists at the public boundary.
- **Alternatives considered**: Converting the internal pipeline to activities would collapse required source and lifecycle distinctions.
