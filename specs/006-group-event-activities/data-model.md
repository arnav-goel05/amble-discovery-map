# Data Model: Group Event Activities

## Activity projection envelope

- `schemaVersion`: `1.0`
- `runId`: originating run identity
- `generatedAt`: projection timestamp
- `counts`: occurrences, activities, venue groups, sessions, source offers, and reviews
- `records`: activity records

## Activity

- `activityId`: stable `activity:` identity, distinct from occurrence and merged-event identities
- `sourceParentActivityIds`: sorted source-level parent identities linked by accepted evidence
- `sourceParentListingIds`: sorted listing identities
- shared content: title, description, category, organizer, price, freshness, evidence
- `occurrenceIds`: all accepted member occurrences
- `venueGroups`: venue group records
- `sessions`: deduplicated session records
- `sourceOffers`: deduplicated, scoped offers
- `scheduleSummary`: exact count/range or flexible schedule label
- lifecycle: active while at least one active/future or flexible session remains

## Venue Group

- `venueGroupId`: stable identity derived from activity plus approved location or explicit off-map venue identity
- `activityId`
- venue label, address, placement/mapping state, approved location identity, coordinates when approved
- `occurrenceIds` and `sessionIds`

Distinct approved buildings remain separate. Approved aliases for one building share a group. Off-map groups use explicit off-map identity and never invent coordinates.

## Session / occurrence

- `sessionId`: stable session identity
- `occurrenceIds`: source occurrence members supporting the session
- exact/flexible schedule and availability
- `venueGroupIds`
- evidence/source references

Sessions are unioned. A direct contradiction about one stable session creates a review for that session while siblings remain eligible.

## Source Offer

- `offerId`: stable identity derived from canonical URL and source
- source label and canonical URL
- `scope`: `activity` or `sessions`
- `sessionIds`: populated for session scope
- provenance/evidence reference

## Grouping Review

- `reviewId`: stable evidence-based identity
- `activityCandidateIds`, `occurrenceIds`, and optional `sessionId`
- `reasonCode`: unknown parent, contradictory session schedule, contradictory session venue, or invalid offer scope
- evidence references
- `status`: `needs_review`

## State transitions

- New safe grouping → `create`
- Same identity and content → `no-op`
- Membership/content change → `update`
- One session ends/cancels → expire session; retain active siblings
- Last session ends and no flexible availability → expire activity
- Unsafe membership or direct conflict → review only affected membership/session
- Invalid assembled projection → preserve previous approved snapshot
