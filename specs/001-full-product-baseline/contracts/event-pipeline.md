# Event Pipeline Contract

This contract formalizes the complete weekly run. Executable code owns all deterministic
steps; skills describe bounded intervention only.

## Invocation and terminal behavior

- The externally scheduled production command invokes the complete runner, not initialization
  only.
- A continuation exit returns one exact structured `next.command`; the caller executes that
  command without inferring a stage action.
- The run ends only with `complete: true` or a documented unresolved external blocker.
- Terminal status is `success`, `partial`, `blocked`, or `failed`. Only `success` can publish
  an active snapshot.
- A partial, blocked, or failed run verifies and reports its completed work but preserves the
  previous active snapshot.

## Window

The window timezone is Asia/Singapore. `windowDaysAfterStart: 7` means the run-date calendar
day plus the following seven calendar days, inclusive: eight represented calendar dates.
Every source envelope repeats the requested start, end, and timezone.

## Approved source definition

Each enabled source definition requires:

```text
name
adapterId
version
owner
officialDomains[]
costClass: free | open
listing contract
detail contract
definition hash
```

Configuration validation rejects absent/unapproved cost class, non-official domains,
unsupported request methods, invalid pointers, or duplicate adapter identities. Normal runs
use checked-in definitions and do not rediscover endpoints. A source that becomes paid is
disabled and makes the run non-publishable until the approved source set is healthy.

## Stage sequence

```text
initialize
-> collect each source with bounded timeout/retry/backoff
-> validate immutable listing/detail fixtures and accounting
-> normalize occurrences and deduplicate
-> reconcile expiry against the previous approved snapshot
-> branch every eligible physical occurrence by normalized venue
-> reuse approved venue mappings
-> enrich unresolved branches from saved/official address evidence
-> resolve through the local index and OneMap tile evidence
-> run two bounded authoritative recovery paths where still ambiguous
-> enqueue remaining needs_review cases for private admin
-> classify create/update/noop/expire/review
-> stage resolve/highlight/pill/panel results
-> verify schemas, hashes, geometry separation, build, and browser behavior
-> publish one immutable snapshot and atomic pointer only if fully publishable
-> finalize status and next actions
```

## Identity rules

- Source occurrence identity is the event replacement key.
- Parent listing identity groups occurrences but cannot replace them.
- Merged canonical identity groups matching cross-source content but may change membership.
- Content hashes determine no-op versus update.
- Venue branches form an exact partition of eligible physical occurrences.
- Approved venue aliases merge only after the same validated OneMap GML/POI identity.
- POI identity, tile paths, and batch IDs must be disjoint from background geometry in the
  published snapshot.

## Resolution outcomes

- `approved_reuse`: reusable mapping passed current evidence validation.
- `candidate_matched`: deterministic evidence selects exactly one valid OneMap building.
- `needs_review`: bounded recovery remains ambiguous; blocks new snapshot publication.
- `not_mappable`: an approved terminal reason proves no building highlight is applicable;
  safely accounted and does not itself block publication.
- `invalid`: source or branch invariant failed; blocks publication.

OSM, addresses, official-site coordinates, and search evidence may narrow geographic
candidates but cannot become the published building identity.

## Admin-decision handoff

The pipeline inserts or updates a Venue Review using `venueId + evidenceHash`. Admin approval
must select a candidate present in that evidence snapshot. The decision exports a proposed
Approved Venue Mapping. A later pipeline step revalidates current GML/tile/coordinate evidence
before accepting the mapping. The admin request never writes approved landmarks, POIs, or
tiles directly.

## Reconciliation rules

- `create`: stable entity absent from the previous snapshot.
- `update`: stable entity present with a changed content/evidence hash.
- `noop`: stable entity and hash unchanged; no extraction or approved-data write.
- `expire`: final known event date precedes the run window.
- `review`: no safe deterministic publication decision exists.

A landmark and POI remain while any current or future event remains. Undated events are held
for review. Background geometry excluded for a previous highlight is restored when its final
managed event expires.

## Snapshot commit gate

All conditions are required:

1. Required sources succeeded and every record satisfies accounting invariants. Every
   published event's official reference was successfully captured during the run and passes
   the approved redirect/domain and response-status policy.
2. Normalization has no invalid eligible record and occurrence identities are unique.
3. Every venue branch is matched, approved reuse, or safely `not_mappable`; no `needs_review`
   remains.
4. Reconciliation has no unexplained deletion, duplicate, or mixed identity.
5. POI tile/GML/batch evidence validates and is separated from the background.
6. Staged event UI contracts validate.
7. Production build and all relevant Node/browser checks pass.
8. Every immutable snapshot reference and hash resolves inside the staged snapshot.

On success, atomically replace the active pointer. On any failure, delete or retain the
staging area for diagnosis according to run policy and leave the previous pointer unchanged.

## Reporting

The terminal machine-readable and Markdown reports include source/record counts, occurrence
counts, every venue outcome, reconciliation action counts, verification results, active and
candidate snapshot IDs, publication decision, stale impact, unresolved reviews, failure
reason codes, and exact next actions. Executing finalization does not imply success.

## Weekly wrapper

The externally scheduled wrapper acquires one exclusive lock, runs the complete event command
through all continuations, then runs the complete restaurant refresh. It records one combined
status and exits non-zero when either required domain is partial, blocked, or failed. It never
copies artifacts from older runs and never changes an active approved snapshot merely to make
the wrapper succeed. A checked-in free single-host cron or systemd example invokes only this
wrapper.

## Artifact policy

Version controlled: approved venue mappings, approved public snapshot data/manifest, required
POI tiles, adapter definitions, schemas, and deterministic code.

Ignored runtime state: raw downloads, run directories, local venue index, unresolved cache,
temporary geometry, screenshots, intermediate reports, locks, and failed staging snapshots.
