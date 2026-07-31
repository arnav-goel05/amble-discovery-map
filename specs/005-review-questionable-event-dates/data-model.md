# Data Model: Review Questionable Event Dates

## Date Quality Assessment

- `schemaVersion`: assessment contract version
- `policyVersion`: threshold/reason policy version
- `asOf`: Singapore run boundary used for comparisons
- `id`, `parentActivityId`, `title`, `sources`: stable event context
- `start`, `end`: selected source field, original value, and normalized instant when parseable
- `status`: `plausible` or `questionable`
- `reasons[]`: stable reason code and human-readable detail

Validation:

- A plausible assessment has zero reasons.
- A questionable assessment has one or more distinct stable reason codes.
- Date-only end boundaries cover the full Singapore calendar day.
- One assessment is produced per otherwise-eligible normalized occurrence.

## Date Review Item

- `schemaVersion`: artifact record version
- `reviewId`: deterministic hash of occurrence identity, evidence hash, and policy version
- `eventId`, `parentActivityId`: stable identity references
- `sourceName`, `sourceRecordRef`, `occurrenceIndex`: provenance
- `evidenceHash`: captured evidence identity
- `policyVersion`, `asOf`: reproducibility inputs
- `status`: `needs_review`
- `lifecycleState`: `held`
- `reasonCodes[]`: every applicable reason, sorted and unique
- `assessment`: complete date-quality assessment
- `event`: retained normalized event evidence

Validation:

- Duplicate `reviewId` values are invalid.
- The event cannot appear in both accepted events and date reviews.
- A record with several reasons contributes once to review identity totals.

## Date Quality Summary

- `assessed`: otherwise-eligible occurrences assessed
- `plausible`: occurrences allowed into deduplication
- `needsReview`: held occurrences
- `byReason`: overlapping reason counts
- `bySource`: deduplicated held count and overlapping reasons for each source

Invariant: `assessed = plausible + needsReview`.

## State Transitions

```text
otherwise eligible -> plausible -> deduplication/venue/publication
otherwise eligible -> questionable -> held/needs_review
held + corrected evidence -> plausible -> normal processing
held + changed questionable evidence -> new evidence-linked review identity
held + unchanged evidence -> same review identity
```
