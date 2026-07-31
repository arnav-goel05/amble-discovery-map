# Research: Review Questionable Event Dates

## Decision: Assess after base eligibility, before deduplication

**Rationale**: Commercial, online-only, overseas, and otherwise excluded records should keep
their stronger terminal reason. Date quality matters for records that would otherwise proceed;
holding them before dedup prevents unreliable schedules from merging or splitting identities.

**Alternatives considered**: Assessment during source extraction would duplicate policy in
every adapter. Assessment after dedup or venue resolution would allow unreliable schedules to
affect identity and waste venue work.

## Decision: Store reviews in a separate normalized artifact

**Rationale**: `normalized/date-reviews.json` retains full evidence while keeping held records
out of accepted events and venue branches. It also gives accounting and operators a stable,
explicit queue contract without repurposing venue-review tables.

**Alternatives considered**: Keeping held records in `normalized/events.json` would continue
to expose them to deduplication. Reusing the venue review database would mix unrelated domain
decisions and require an admin UI redesign.

## Decision: Use one shared pure policy

**Rationale**: The standalone CLI and live normalizer must classify the same record identically.
The pure module can return all overlapping reason codes plus one deduplicated outcome.

**Alternatives considered**: Reimplementing checks inside the normalizer would drift from the
audit command and violate the deterministic contract.

## Decision: Treat long intervals as review, not rejection

**Rationale**: Multi-year exhibitions can be legitimate, while extreme ranges can also reflect
container dates or extraction errors. Review preserves evidence without publishing or deleting.

**Alternatives considered**: Automatic exclusion risks losing legitimate programmes; automatic
acceptance leaves known ambiguity unresolved.

## Decision: Corrected evidence clears review through current-run reconciliation

**Rationale**: Review identity is deterministic from the stable occurrence identity and evidence
hash. Each run's artifact is authoritative for active date reviews; absent prior IDs are
superseded operationally while immutable older runs remain auditable.

**Alternatives considered**: Permanent cross-run review storage adds a second database workflow
without a current product need.
