# Data Model: Correct Event Schedule Semantics

## ScheduleEvidence

- `sourceId`: stable configured source
- `sourceEventId`: source-stable event or occurrence identity
- `displayText`: exact official schedule text
- `structured`: whether the source supplied explicit performances
- `authorityRefs[]`: grounded official product IDs/URLs
- `reasonCode`: parser or ambiguity outcome

## Schedule

- `kind`: `exact | range | recurring | selectable | unverified`
- `start`: strict ISO timestamp with explicit offset for `exact`/`range`
- `end`: strict ISO timestamp with explicit offset for `exact`/`range`
- `recurrence`: recurrence evidence, only when it will be expanded upstream
- `sessionRefs[]`: explicit child session identities when supplied
- `displayText`: retained official text
- `finalKnownOccurrence`: validated lifecycle bound, not a claim of daily availability
- `evidenceReasonCode`: reason-coded interpretation

### Invariants

1. `exact` describes one concrete occurrence.
2. `range` asserts continuous availability throughout its interval and requires explicit
   source evidence.
3. `recurring` is not date-filterable until expanded to exact session instances.
4. `selectable` and `unverified` do not claim arbitrary dates.
5. Published `start`/`end` values are strict ISO timestamps carrying an explicit offset.

## Session

- `sessionId`: stable identity derived from source occurrence and normalized schedule
- `schedule`: one typed schedule
- `venueGroupIds[]`: venue projections to which this session belongs
- `sourceIds[]` and `sourceEventIds[]`: preserved provenance
- `authorityRefs[]`: grounded product identity

## ProjectedVenueGroup

- `venueGroupId`: stable activity venue-group identity
- `sessionIds[]`: exact allowed session membership
- `approvedLocationId`: mapped POI when approved
- `publicPlacement`: mapped/off-map state

## Reconciliation rules

- A structured or parsed exact session outranks a coarse envelope only inside a group
  connected by grounded authority or previously approved parent membership.
- Equivalent exact sessions merge provenance and offers without losing source identity.
- A generic offsite projection is suppressed only when the same authority-linked session
  has a specific approved projection.
- Ambiguous conflicts are isolated for review.

## Lifecycle

- New precise evidence: `update` the affected schedule/session.
- Unchanged exact evidence: `no-op`.
- Unsupported new evidence: `review`, preserving the last safe approved identity.
- Expired final occurrence: existing expiry reconciliation applies.
- Unsafe repair: no activation; prior pointer remains unchanged.
