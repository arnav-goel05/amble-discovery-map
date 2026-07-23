# Public Activity Snapshot Contract

## Manifest

The immutable manifest exposes:

- `landmarksRef`
- `poisRef`
- `tilesetRef`
- `activitiesRef`

It does not expose `eventsRef`. Each referenced artifact is included in `artifactHashes` and the manifest content hash.

## Activity catalogue

```json
{
  "schemaVersion": "1.0",
  "snapshotId": "stable-snapshot-id",
  "generatedAt": "ISO-8601 timestamp",
  "counts": {
    "activities": 0,
    "sessions": 0,
    "venueGroups": 0,
    "sourceOffers": 0,
    "mappedActivities": 0,
    "offMapActivities": 0
  },
  "records": []
}
```

Each record follows [data-model.md](../data-model.md). Internal evidence and full occurrence records are forbidden.

## Landmark contract

Each landmark contains `activityRefs`, not `events`:

```json
{
  "id": "approved-location-id",
  "label": "Venue",
  "anchor": { "lat": 1.0, "lng": 103.0 },
  "activityRefs": [
    {
      "activityId": "activity:stable",
      "venueGroupIds": ["venue-group:stable"]
    }
  ]
}
```

## API metadata

`/api/snapshot` returns `activitiesRef` and omits `eventsRef`. Asset responses retain the existing success envelope and immutable caching behavior.

## Required invariants

1. Activity, session, venue-group, and offer identities are unique.
2. Every session belongs to one activity.
3. Every session/offer/landmark reference resolves.
4. Mapped venue groups agree with an approved landmark and coordinates.
5. Off-map venue groups have an accepted subtype and no fabricated geometry.
6. Aggregate counts equal unique member totals.
7. Public payloads contain no evidence or audit fields.
8. Invalid candidates never replace the active snapshot.
