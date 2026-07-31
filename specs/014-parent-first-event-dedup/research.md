# Research: Parent-First Event Deduplication

## Decision 1: Group source parents inside activity projection

- **Decision**: Keep occurrence normalization and occurrence reconciliation unchanged; add parent candidate generation to the existing activity projection.
- **Rationale**: Occurrences remain necessary for expiry, schedule identity, venue branching, and provenance. The defect is that public activity grouping currently depends entirely on accepted occurrence bridges.
- **Alternatives considered**: Replacing occurrence deduplication was rejected because it would broaden lifecycle risk and require a clean pipeline run.

## Decision 2: Compare normalized Singapore calendar intervals

- **Decision**: Parse supported ISO and source-human date forms into Asia/Singapore calendar boundaries before comparing parent coverage.
- **Rationale**: Native parsing treats ISO date-only values as UTC but source-human dates as local time, creating an artificial eight-hour difference.
- **Alternatives considered**: Expanding every zero-width interval by one day was rejected because it hides malformed timestamps and can merge adjacent events.

## Decision 3: Separate parent ambiguity from sibling ambiguity

- **Decision**: A broad parent range may link to a parent containing many sessions. Sibling ambiguity is evaluated only when two distinct parents compete for the same evidence, not when one parent legitimately owns several sessions.
- **Rationale**: The current occurrence rule rejected 575 of 610 candidates because a broad SISTIC range overlapped several Catch sessions.
- **Alternatives considered**: Disabling sibling protection globally was rejected because genuinely distinct performances must remain separate.

## Decision 4: Use indexed candidate keys

- **Decision**: Build candidate buckets from normalized non-generic titles and canonical single-product URLs, then corroborate with approved venue, schedule coverage, organizer, and prior membership.
- **Rationale**: This avoids an all-pairs comparison while supporting both cross-source and same-source parent duplicates.
- **Alternatives considered**: Global fuzzy-title comparison was rejected for performance and false-positive risk.

## Decision 5: Product URLs require product scope

- **Decision**: Exact canonical URLs are strong evidence only when they are detail/product URLs. Known collection and editorial landing pages remain weak provenance.
- **Rationale**: Fever product URLs identify one product, while the Visit Singapore all-happenings landing page represents many unrelated activities.
- **Alternatives considered**: Treating every equal URL as identity was rejected because it would merge unrelated editorial cards.

## Decision 6: Conflicting approved venues produce review

- **Decision**: Strongly matching parents with different approved venue identities are not silently merged. Emit a grouping review with both identities.
- **Rationale**: A duplicate card is safer than attaching an activity to an incorrect building, and the constitution requires evidence before location publication.
- **Alternatives considered**: Selecting the higher-precedence source's venue was rejected because source precedence is not geographic evidence.

## Decision 7: Repair by immutable reprojection

- **Decision**: Read the active snapshot's internal events, project activities with the new rules, rebuild public landmark references, stage a new immutable snapshot, validate it, and activate only when requested.
- **Rationale**: The snapshot already retains the required occurrences and evidence, so source collection adds cost without improving this correction.
- **Alternatives considered**: Mutating `activities.json` in place and rerunning the complete pipeline were both rejected.
