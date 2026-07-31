# Activity Projection Contract

The pipeline retains `normalized/events.json` as occurrence-level input and writes:

- `normalized/activities.json`: schema-versioned activity projection envelope
- `normalized/activity-grouping-reviews.json`: held grouping decisions

## Required invariants

1. Every projected occurrence identity appears in exactly one activity or one grouping review.
2. Activity, occurrence, session, venue-group, offer, and merged-event identities are non-empty and namespace-distinct.
3. Every session and venue-group membership refers to an occurrence belonging to the same activity.
4. Every offer has an approved HTTP(S) URL, source label, provenance, and valid activity/session scope.
5. Activities union independently evidenced sessions; direct contradictions are isolated in reviews.
6. Counts equal the corresponding unique record/member totals.
7. Input ordering does not change activity identities or sorted membership.
8. Projection performs no network requests and does not mutate input records.

## Dashboard payload additions

- `activityCount`
- `occurrenceCount`
- `sessionCount`
- `venueGroupCount`
- `sourceOfferCount`
- `groupingReviewCount`

`uniqueActivities` remains temporarily accepted as a compatibility alias for `activityCount`, but new UI text must use the explicit labels.

## Public UI contract

- Search/filter results contain one row per matching activity.
- Each result retains `occurrences`, `venueGroups`, `sessions`, `sourceOffers`, and a representative map selection.
- Date, venue, placement, category, price, and text matching are evaluated from member occurrences.
- Details present activity summary, venue-grouped sessions, and labelled offers. Missing actions are hidden rather than fabricated.
