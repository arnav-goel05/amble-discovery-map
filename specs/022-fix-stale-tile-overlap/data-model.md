# Data Model: Eliminate Stale Highlight Overlap

## Active Background Object

- `objectKey`: stable R2 key, e.g. `optimized-tiles/3/5/1_0.b3dm`
- `localPath`: repository-local approved B3DM path
- `sha256`: expected local digest
- `byteLength`: expected local size
- `level`: detail suffix (`0` through `5`)
- `selectedGmlIds`: sorted unique approved identities that must be absent
- `owners`: sorted POI IDs associated with those identities
- `sourceSha256`: optional pristine digest evidence

Identity is `objectKey`. Multiple POIs may contribute owners and selected identities.

## Object Audit Result

- `objectKey`
- `status`: `matched`, `stale`, or `failed`
- `remoteSha256`, `remoteByteLength`
- `remoteState`: `current`, `pristine`, `intermediate`, `unknown`, or `unavailable`
- `retainedGmlIds`
- `affectedVenueIds`
- `error`: bounded code/message when failed

`matched` requires exact local byte parity. A stale result may have no overlap, but still blocks
release parity. `failed` always blocks success.

## Synchronization Run

- `schemaVersion`: `background-geometry-audit-v1`
- `releaseId`: deterministic digest of snapshot ID and ordered active object digests
- `snapshotId`
- `origin`
- `mode`: `audit` or `sync`
- `startedAt`, `completedAt`
- `objects`: ordered `Object Audit Result` records
- `summary`: checked/matched/stale/failed/retained/affected/uploaded/skipped totals
- `complete`: true only when every object is current and no selected identity remains

Transitions:

`pending -> matched`

`pending -> stale -> uploaded -> verified`

`pending|stale|uploaded -> failed`

A resumed run re-audits remote state; verified objects naturally become skipped matches.

## Background Geometry Release Descriptor

- `schemaVersion`: `background-geometry-release-v1`
- `releaseId`
- `snapshotId`
- `tilesetUrl`: root manifest URL with release query
- `objectCount`
- `manifestSha256`
- `verifiedAt`

The application consumes this descriptor. It is written only after all object uploads and the
published manifest verify. Changing it is the activation boundary for a deployed application.

## Versioned Tileset Manifest

The source `optimized-tiles/tileset.json` structure is preserved. Every active B3DM content URI
receives `?backgroundObject=<sha256>`. The manifest request receives
`?backgroundRelease=<releaseId>`. Non-active content URIs remain unchanged.
