# Research: Eliminate Stale Highlight Overlap

## Decision 1: Treat served bytes as the final authority

**Decision**: Compare every active remote B3DM response with the local approved object using
SHA-256, and parse the remote batch table whenever bytes differ.

**Rationale**: R2 ETags and content lengths are useful shortcuts but cannot prove which GML
identities are retained. Parsing all mismatches directly identifies the visual overlap and also
distinguishes pristine, intermediate, and unknown states.

**Alternatives considered**:

- Sample a few objects: rejected because the defect spans 443 objects and shared tiles.
- Trust ETag alone: rejected because validators may be absent, multipart, or cache-derived.
- Compare only against pristine sources: rejected because intermediate extraction states exist.

## Decision 2: Stable object keys plus a release-versioned root manifest

**Decision**: Replace stale objects at their existing R2 keys, keep each B3DM content URI clean,
record its expected SHA-256 and MD5 in tile metadata, and version only the root tileset request
through the checked-in release descriptor.

**Rationale**: deck.gl derives the tile type from the content URI extension, so a query appended
to `.b3dm` can make valid geometry fail type detection. The root release query selects a new
manifest, while embedded validators make the expected object bytes explicit and the R2-binding
gate proves backing-store parity without visitor-facing object requests.

**Alternatives considered**:

- Immutable copies of all 443 changed objects: valid but needlessly duplicates gigabytes.
- Put digest queries on individual B3DM URIs: rejected because it breaks deck.gl tile-type
  detection.
- Rely on cache expiry as verification: rejected because it cannot prove backing-store parity.
- Purge cache globally: rejected because it requires an additional privileged API boundary.

## Decision 3: Publish the manifest last

**Decision**: Upload stale B3DM objects, verify uploaded bodies through Wrangler's direct R2
control plane, prove unchanged objects through reliable inventory validators, then upload the
rewritten root tileset manifest. Update/deploy the application release descriptor only after the
manifest itself verifies through that same control-plane boundary.

**Rationale**: Until the final manifest switch, existing clients retain their previous coherent
view. A failed object upload cannot produce a successful release. Replacing an old background
object with a version that removes geometry is safe for an old highlight client.

**Alternatives considered**:

- Upload manifest first: rejected because clients could request assets not yet synchronized.
- Couple uploads to the event pipeline internally: deferred; the reusable release gate is first
  exposed as an explicit script and can then be invoked by the pipeline deployment stage.

## Decision 4: Derive scope from approved POIs and extraction manifests

**Decision**: Enumerate unique source tile paths from active `pois.json`, then obtain selected
GML identities and expected background hashes from each POI extraction manifest.

**Rationale**: The approved snapshot is the active identity owner, while extraction manifests
record the exact removal evidence and resulting object hash. Shared tiles are merged by object
key and retain every venue owner.

## Decision 5: Wrangler remains the credential boundary

**Decision**: Execute `wrangler r2 object put ... --remote --file ...` through a small injected
adapter with bounded concurrency and retries.

**Rationale**: Wrangler already owns authenticated access to `amble-3d-tiles`; the script need
not read, log, or persist credentials. An injected adapter makes interruption and failure paths
testable without network writes.

## Observed Baseline

- Active POIs: 136
- Unique active background objects: 665
- Remote/local byte matches: 222
- Stale remote objects: 443
- Stale objects retaining selected active GML identities: 443
- Affected venues: 79
- Clean venues: 57
- Affected spatial tile chains: 77
- National Stadium remote object: pristine 9,476,792-byte source; local approved object: empty
  464-byte B3DM

## Decision 6: Use release-aware R2 inventory, not public per-object probes

**Decision**: Routine CI, audit, synchronization preflight, and deployment compare expected
object keys, byte lengths, and reliable stored validators with one release-aware report from an
isolated read-only R2-binding Worker. Wrangler downloads only mismatches for identity inspection
and verifies only objects uploaded in the current run. Public per-object probes remain a bounded
manual diagnostic and stop immediately on rate limiting. Each operator invocation adds a bounded
verification identity to its cache key so a mutable-object check cannot reuse pre-upload evidence.

**Rationale**: The previous public `HEAD` fan-out exhausted the daily Worker request allowance.
R2 binding and S3/control-plane operations bypass edge cache and visitor-facing request fan-out.
Cloudflare documents R2 binding access as direct bucket access unaffected by cache, and exposes
object validators/checksums in `R2Object` metadata. Validators that cannot prove parity fail
closed.

**Alternatives considered**:

- Continue public `HEAD` requests at lower concurrency: rejected because concurrency changes
  latency, not total allowance consumption.
- Check only key presence and size: rejected because same-size stale content would pass.
- Download every object through Wrangler on every run: correct but needlessly transfers roughly
  121 GB and makes routine verification impractical.
