# Data Model: Source Retirement

## Supported Source Set

- `name`: canonical source display name
- `adapterId`: executable adapter identity when applicable
- `providerId`: approved provider-policy identity
- `status`: terminal status for the current run

Constraint: only sources present in current configuration may appear in a new run plan or current dashboard payload.

## Source Contribution

- `sourceName` or canonical source identity
- `sourceRecordId`
- `fields`
- `freshness`

Lifecycle:

- Present supported source + current record: retain as current.
- Present supported source + unavailable run: carry forward under existing stale rules.
- Present supported source + successful run removed record: archive under existing rules.
- Absent/retired source: do not carry forward.

## Published Event

- Stable identity fields (`identityAnchor`, `publishedEventId`, `occurrenceId`, `id`)
- `sourceContributions`
- `sources`
- schedule/lifecycle state
- optional mapped placement

Rules:

1. Retired-only event: archive and omit from current catalogue and landmark arrays.
2. Mixed event: remove retired contribution while preserving the stable event and supported contribution.
3. Unrelated supported event: unchanged.

## Landmark and POI

- Landmark contains current mapped events.
- POI supplies geometry and identity for its landmark.

Rule: after event reconciliation, remove a pipeline-managed landmark and POI only when no current or future event remains.

## Retirement Trace

- `eventId`
- `outcome`: `archived`
- `reasonCode`: `source_retired`
- `sourceRecordIds`

Aggregate counts are included in the staged frontend plan and operational logs.

## Dashboard Payload

- Summary totals
- `sources[]` current source rows
- outcome and field-completeness counts

Rule: only active current-source identifiers may contribute to rows and source-derived totals. Stored stale payloads are sanitized at the dashboard boundary.
