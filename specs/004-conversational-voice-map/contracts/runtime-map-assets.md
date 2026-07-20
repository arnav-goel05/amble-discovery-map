# Runtime Map Asset Contract

## Discovery areas

`data/discovery-areas.geojson` is a `FeatureCollection` of approved URA subzones. Every feature has:

- stable `areaId` from `SUBZONE_C`;
- `areaName`, `planningAreaCode`, `planningAreaName`, and `regionName` from the source;
- Polygon or MultiPolygon geometry in WGS84;
- `sourceDatasetId`, `sourceObservedAt`, and `sourceFeatureHash`.

The generator rejects missing/duplicate identities, invalid geometry, out-of-Singapore coordinates,
empty names, and unexplained feature loss. Candidate-to-area joins are deterministic and unresolved
coordinates enter review rather than receiving a guessed area.

## Transit context

`data/transit-context.geojson` contains two feature classes:

- `station`: consolidated stable station identity, approved name, display coordinate, contributing
  exit identities, source dates, and line references when supported;
- `rail_line`: simplified MultiLineString/LineString geometry, rail type, source identity, source
  date, and simplification tolerance.

Station identity must not be inferred solely from proximity when source names conflict. Unknown
line membership remains empty. Geometry may be simplified for rendering but the manifest records the
source and runtime hashes and the maximum allowed deviation.

## Manifest and publication

Each asset has a sibling manifest with:

- `schemaVersion`, `assetId`, and `status`;
- source dataset IDs, authoritative URLs, licence, observation timestamps, and source hashes;
- generator version, generated timestamp, feature counts, runtime content hash, and validation
  report;
- reconciliation result: `create`, `update`, `noop`, or `review`.

Generators stage output outside the approved path. Publication replaces an asset and manifest only
after schema, identity, geometry, provenance, build, map render, and performance checks pass. A
download or validation failure preserves the last approved assets and marks them stale where the UI
can communicate that state.

## Presentation rules

- Area layers render only ranked recommended areas and never imply unsupported precision.
- MRT layers are visible context and do not enter recommendation ranking unless
  `transitConstraintActive` is true because of an explicit user request.
- Location point and accuracy circle use a different visual language from area, station, and place
  layers.
- All three managers expose stable focus/select/visibility actions to the action registry and keep
  the 3D building tile lifecycle independent.
