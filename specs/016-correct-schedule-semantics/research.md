# Research: Correct Event Schedule Semantics

## Decision 1: Model discrete dates as exact sessions

- **Decision**: Official enumerations produce one `exact` session per date. A bounding
  start/end pair is not itself a continuous schedule.
- **Rationale**: RFC 5545 represents discrete recurrence dates as occurrence lists
  (`RDATE`), not as an interval containing every intervening day. This also matches the
  source's user-visible ticket choices.
- **Rejected**: Treating the earliest and latest dates as a range; it creates false dates.

## Decision 2: Parse a bounded official grammar

- **Decision**: Add a pure parser for known official Singapore date/time shapes, including
  paired days with a shared month/year and concatenated full date/time clauses. It returns
  either validated exact sessions or a reason-coded non-match.
- **Rationale**: Bounded parsing is deterministic and testable. Native `Date.parse` is not
  used for human-readable source strings because browser implementations may differ.
- **Rejected**: An unbounded natural-language parser or an LLM recovery step; both add
  ambiguity and operational cost.

## Decision 3: Use explicit Singapore timestamps

- **Decision**: Normalize published boundaries to ISO 8601 timestamps carrying `+08:00`.
  Calendar filters construct their start/end in Asia/Singapore regardless of host timezone.
- **Rationale**: The events and product are Singapore-specific. Host-local dates would
  produce inconsistent results.
- **Rejected**: Bare human strings, bare dates interpreted by `Date.parse`, or browser-local
  midnight.

## Decision 4: Preserve ambiguity

- **Decision**: When a schedule cannot be safely expanded, retain its official display text
  as `selectable` or `unverified` with null claimable boundaries and a reason code.
- **Rationale**: Missing precision is safer than invented availability and remains visible
  to operators for recovery.
- **Rejected**: Dropping the event or fabricating daily sessions between bounds.

## Decision 5: Ground authority identity

- **Decision**: Authority references are extracted only from structured product IDs or
  official booking/product URLs. Shared authority allows precise evidence to supersede a
  redundant coarse envelope while retaining offers and provenance.
- **Rationale**: The Catch booking URL and SISTIC product alias are evidence of the same
  ticket product. Title similarity alone is not.
- **Rejected**: Inferring product IDs from arbitrary title or URL suffix similarity.

## Decision 6: Filter the projected venue's sessions

- **Decision**: Each map projection carries its venue-group ID and allowed session IDs.
  Date matching intersects those IDs before evaluating schedule boundaries, and result
  expansion exposes the matching subset.
- **Rationale**: A parent activity may have different sessions at different places.
- **Rejected**: Evaluating every session attached to the parent for every map projection.

## Decision 7: Repair without recollection

- **Decision**: A versioned repair reads the active internal catalogue and saved evidence,
  applies the same pure semantics, reprojects activities, verifies integrity, writes a new
  immutable snapshot, and optionally atomically activates it.
- **Rationale**: The required evidence already exists and the user explicitly asked not to
  recollect.
- **Rejected**: Running the complete source pipeline or mutating an existing snapshot.

## Explicit non-goal

Search tokenization and ranking are not changed. They can affect how users find an activity
by text but cannot establish whether it occurs on a selected date.
