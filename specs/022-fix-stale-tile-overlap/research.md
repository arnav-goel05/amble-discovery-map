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

## Decision 2: Stable object keys plus digest-versioned content requests

**Decision**: Replace stale objects at their existing R2 keys, but rewrite every active content
URI in the published root tileset to include its local SHA-256 as a query parameter.

**Rationale**: The Worker cache key includes the full request URL while R2 lookup strips the
query. A new digest query therefore bypasses stale edge entries without duplicating large B3DM
objects. The digest also makes the selected release observable and deterministic.

**Alternatives considered**:

- Immutable copies of all 443 changed objects: valid but needlessly duplicates gigabytes.
- Rely on cache expiry: rejected because B3DM responses can remain stale for seven days.
- Purge cache globally: rejected because it requires an additional privileged API boundary.

## Decision 3: Publish the manifest last

**Decision**: Upload stale B3DM objects, refetch and verify all active objects through their new
digest URLs, then upload the rewritten root tileset manifest. Update/deploy the application
release descriptor only after the manifest itself verifies.

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
