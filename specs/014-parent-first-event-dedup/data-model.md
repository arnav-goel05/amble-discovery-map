# Data Model: Parent-First Event Deduplication

## Source Parent Summary

Represents one stable source parent listing before cross-parent grouping.

| Field | Meaning |
|---|---|
| `parentKey` | Stable source plus parent activity/listing identity |
| `source` | Approved source name |
| `occurrenceIds` | Child occurrence identities |
| `normalizedTitle` | Markup-free canonical title |
| `titleGeneric` | Whether title evidence is too broad to authorize matching |
| `scheduleCoverage` | Normalized Singapore interval or flexible schedule state |
| `approvedLocationIds` | Approved canonical venue identities |
| `organizers` | Normalized organizer evidence |
| `productUrls` | Canonical single-product URLs |
| `priorActivityIds` | Existing stable public activity memberships |

## Parent Candidate

| Field | Meaning |
|---|---|
| `candidateId` | Deterministic identity derived from ordered parent keys |
| `parentKeys` | Two compared source parents |
| `supportingEvidence` | Title, schedule, venue, organizer, URL, or prior-group evidence |
| `conflictingEvidence` | Edition, organizer, venue, or schedule conflict |
| `decision` | `merged`, `kept_distinct`, or `needs_review` |
| `reasonCode` | Stable machine-readable outcome |

## Activity Group

| Field | Meaning |
|---|---|
| `activityId` | Stable selected activity identity |
| `sourceParentActivityIds` | Source parent activity identities |
| `sourceParentListingIds` | Source parent listing identities |
| `occurrenceIds` | All accepted occurrence identities |
| `sessions` | Deduplicated evidenced sessions |
| `venueGroups` | Approved or off-map session placement groups |
| `sourceOffers` | Deduplicated activity- or session-scoped links |
| `groupingDecision` | Strategy and parent membership evidence |

## Parent Grouping Review

| Field | Meaning |
|---|---|
| `reviewId` | Deterministic review identity |
| `reasonCode` | Conflict such as `parent_venue_conflict` |
| `parentKeys` | Affected parents |
| `occurrenceIds` | Affected occurrences |
| `evidence` | Structured supporting and conflicting values |
| `status` | `needs_review` |

## State Transitions

```text
source parents
  -> candidate generated
     -> merged
     -> kept distinct
     -> needs_review

active snapshot
  -> repair staged
     -> validation failed: pointer unchanged
     -> validation passed: optional atomic activation
```

## Validation Rules

- Every occurrence belongs to exactly one projected activity or one explicit grouping review.
- Every session belongs to exactly one activity and references existing venue groups.
- Every session-scoped offer references sessions within its activity.
- Parent keys and candidate decisions are deterministic for identical inputs.
- Generic titles cannot authorize a merge without stronger single-product or prior-approved evidence.
- Conflicting non-empty approved venue identities cannot be silently merged.
- Snapshot repair cannot overwrite an existing immutable snapshot with different content.
