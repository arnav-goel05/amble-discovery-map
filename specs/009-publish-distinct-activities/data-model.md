# Data Model: Publish Distinct Activities

## Public Activity Catalogue

- `schemaVersion`: incompatible public contract version
- `snapshotId`, `generatedAt`
- `counts`: activities, sessions, venue groups, source offers, mapped activities, off-map activities
- `records`: unique Public Activity records

Validation: every count equals unique members; every record identity is unique; no occurrence or audit collection is present.

## Public Activity

- `activityId`
- display fields: title, description, category, organizer, price
- lifecycle/freshness
- `scheduleSummary`
- compact `sessions`
- public `venueGroups`
- safe `sourceOffers`

Excluded: raw occurrence IDs, parent-listing IDs, evidence references, field-completeness audits, grouping decisions, and reconciliation history.

## Compact Session

- `sessionId`
- schedule kind/start/end/recurrence/display text/final known occurrence
- availability
- `venueGroupIds`

Validation: unique within the catalogue; belongs to exactly one activity; every venue-group reference resolves within that activity.

## Public Venue Group

- `venueGroupId`, `activityId`
- label and optional address
- public placement and mapping status
- approved location identity and coordinates only when approved
- `sessionIds`
- optional off-map subtype

Validation: mapped groups require an approved landmark identity and valid coordinates; off-map groups must not claim coordinates.

## Public Source Offer

- `offerId`, source label, canonical HTTP(S) URL
- scope: activity or sessions
- `sessionIds` for session-scoped offers

Validation: every scoped session resolves within the activity.

## Public Landmark

- existing landmark identity, label, anchor, and area fields
- `activityRefs`: unique Landmark Activity References

The previous embedded `events` collection is absent.

## Landmark Activity Reference

- `activityId`
- `venueGroupIds` applicable to this landmark

Validation: the activity exists; every venue group belongs to it and maps to the containing landmark.

## State transitions

- Same activity/reference content: no-op
- Existing identity with changed sessions, venue groups, offers, or display content: update
- New safe activity/reference: create
- Last active/future session removed: expire activity and remove its references
- Unsafe grouping/location: hold or review only the affected identity
- Invalid assembled catalogue or dangling reference: reject candidate and preserve the active snapshot
