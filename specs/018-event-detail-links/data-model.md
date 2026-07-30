# Data Model: Expose Canonical Event Details

## Activity

- `activityId`: stable identity
- `title`, `description`, `category`, `organizer`, `price`: optional approved display fields
- `sessions`: ordered collection of Session records
- `venueGroups`: collection of Venue Group records
- `sourceOffers`: collection of Source Offer records
- `scheduleSummary`: approved aggregate schedule label

Validation:

- The title and stable identity are required for a renderable canonical activity.
- Missing optional fields remain null and render as unavailable.

## Session

- `sessionId`: stable occurrence identity
- `schedule.kind`: exact, multiple, anytime, unverified, or another approved kind
- `schedule.start`, `schedule.end`: optional ISO-8601 boundaries
- `schedule.displayText`: optional approved source-facing label
- `availability`: approved availability state
- `venueGroupIds`: referenced venue-group identities

Validation:

- A referenced venue group must belong to the same activity.
- A valid start may provide the date and time presentation when explicit text is absent.
- A session with no resolvable venue group uses the existing location-unavailable behavior without fabricated placement.

## Venue Group

- `venueGroupId`: stable identity
- `label`, `address`: approved optional display values
- `approvedLocationId`: optional mapped landmark identity
- `coordinates`: optional approved map position
- `publicPlacement`, `mappingStatus`, `offMapSubtype`: placement state
- `sessionIds`: session membership

## Source Offer

- `offerId`: stable reference identity
- `source`: source-facing label
- `url`: validated HTTP(S) target
- `scope`: `activity` or `sessions`
- `sessionIds`: applicable sessions when scope is session-specific

Validation:

- Invalid URLs do not become references.
- Activity-wide offers apply to every projected session.
- Session-scoped offers apply only when `sessionIds` contains the selected session.
- Duplicate identity/URL pairs render once.

## Normalized Event Detail

- `activityId`, `occurrenceId`: stable selected identities
- `title`, `description`, `category`, `organizer`, `price`
- `date`, `time`, `venue`, `address`, `locationType`
- `anchor`, `landmarkId`
- `references`: applicable validated reference records
- `occurrences`, `venueGroups`, `sourceOffers`, `sessionCount`, `scheduleSummary`: grouped panel state

State transitions:

1. Panel closed.
2. Panel opens and projects current canonical activities.
3. An activity and occurrence are selected.
4. Applicable references are published in panel context.
5. Session selection changes and reference eligibility is recalculated.
6. Panel closes and the context no longer exposes detail actions.
