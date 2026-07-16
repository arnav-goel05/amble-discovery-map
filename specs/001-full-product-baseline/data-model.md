# Data Model: What's Here Full-Product Baseline

All persisted structures carry a schema version. Times are ISO 8601 UTC unless a source
value is explicitly retained as raw evidence. Public event filtering uses Asia/Singapore.

## Source Record Envelope

Represents one immutable listing or detail record captured from an approved free source.

| Field | Rules |
|---|---|
| `schemaVersion` | Required supported contract version |
| `runId` | Required pipeline-run identity |
| `adapterId`, `adapterVersion` | Required checked-in source adapter |
| `sourceName`, `sourceUrl` | Required official source and canonical request URL |
| `retrievedAt` | Required capture time |
| `requestedWindow` | Required inclusive `start`, `end`, and `timezone` |
| `recordPointer` | Required immutable pointer into the captured response |
| `listingIdentity` | Required source listing identity |
| `detailIdentity` | Optional source detail identity |
| `payloadHash` | Required hash of the preserved source payload |
| `provenance` | Request method, page/cursor, response pointer, and parent listing reference |

Validation: the configured provider must be enabled and classified `free` or `open`; the
record pointer must resolve inside the same run; detail records must reference a captured
listing record; duplicate canonical detail URLs are captured once and referenced many times.

## Canonical Event Occurrence

Represents one normalized occurrence eligible for reconciliation.

| Field | Rules |
|---|---|
| `occurrenceId` | Stable key derived from source and immutable source occurrence identity |
| `parentListingId` | Source listing relationship; never the replacement key |
| `mergedEventId` | Canonical cross-source grouping identity |
| `sourceName`, `sourceEventId` | Required source attribution |
| `title` | Required normalized plain text |
| `startsAt`, `endsAt` | Nullable; known values must be valid and ordered |
| `allDay`, `timezone` | Required schedule interpretation |
| `venueId` | Required normalized venue-branch identity for physical events |
| `venueName`, `addressEvidence` | Preserved normalized value plus source evidence |
| `description`, `category`, `officialUrl` | Nullable optional content; never fabricated |
| `contentHash` | Hash of user-visible normalized content for no-op detection |
| `provenanceRefs` | One or more Source Record Envelope pointers |
| `reviewStatus` | `eligible`, `undated_review`, `invalid`, or `not_physical` |

Relationships: many occurrences may share a parent listing or merged event. Each eligible
physical occurrence belongs to exactly one Venue Branch.

## Venue Branch and Evidence

Represents all current occurrences that claim the same normalized physical venue.

| Field | Rules |
|---|---|
| `venueId` | Deterministic normalized-venue branch identity |
| `rawNames`, `normalizedName` | All source names and one normalized comparison form |
| `eventIds` | Exact partition of occurrence identities; no occurrence appears twice |
| `addressCandidates`, `postalCodes` | Saved source/official evidence |
| `coordinateCandidates` | Evidence coordinates with source and confidence, not publication identity |
| `evidenceHash` | Hash of all decision-relevant normalized evidence |
| `recoveryAttempts` | Bounded structured attempts and outcomes |
| `candidateBuildings` | OneMap candidates with GML identity, name, distance, tile evidence, and rejection reason |
| `resolutionStatus` | See Venue Resolution State below |

### Venue Resolution State

```text
pending
  -> approved_reuse
  -> candidate_matched
  -> needs_review
  -> not_mappable
  -> invalid

needs_review -> approved | rejected | deferred
approved -> candidate_matched on next validated pipeline reconciliation
rejected/deferred -> needs_review when new evidence changes the evidence hash
```

Only `approved_reuse` and `candidate_matched` may enter a publishable snapshot.
`not_mappable` is terminal only with an approved reason code. `needs_review` blocks
publication of the new snapshot.

## Approved Venue Mapping

Reusable evidence-backed link from venue evidence to one OneMap building.

| Field | Rules |
|---|---|
| `mappingId` | Stable approved mapping identity |
| `status` | `approved` or `retired` |
| `normalizedVenue`, `aliases` | Comparison form and accepted source names |
| `verifiedAddress` | Nullable but preserved when available |
| `coordinates` | Required longitude and latitude |
| `poiId`, `gmlId` | Required stable public POI and OneMap building identities |
| `acceptedGmlNames` | Required reviewed names |
| `sourceTiles` | Required tile paths and batch IDs across the approved geometry |
| `evidence` | Required authoritative evidence refs and decision rationale |
| `evidenceHash` | Required hash of approved decision inputs |
| `approvedAt`, `approvedBy` | Decision audit fields; `approvedBy` is the single admin principal |

Validation: all tile paths and batch IDs must exist; coordinates must be valid; aliases may
merge only when their approved GML/POI identity matches.

## Venue Review

Durable private-admin work item created only after bounded automated recovery.

| Field | Rules |
|---|---|
| `reviewId` | Opaque stable identity |
| `venueId`, `evidenceHash` | Required and immutable for a decision |
| `evidenceSnapshot` | Sanitized copy of venue evidence and attempts |
| `candidates` | Competing OneMap candidates and rejection/uncertainty reasons |
| `status` | `pending`, `approved`, `rejected`, `deferred`, or `superseded` |
| `decisionCandidateGmlId` | Required only for approval |
| `decisionReason` | Required for approval or rejection |
| `idempotencyKey` | Required unique mutation key |
| `createdAt`, `decidedAt` | Lifecycle timestamps |

An approval is rejected as stale if its evidence hash or selected candidate identity no
longer matches current validated evidence.

## Reconciliation Entry

Describes the intended mutation before public publication.

| Field | Rules |
|---|---|
| `entityType`, `entityId` | `event`, `landmark`, `poi`, or `snapshot` plus stable identity |
| `action` | `create`, `update`, `noop`, `expire`, or `review` |
| `previousHash`, `nextHash` | Required where applicable |
| `reasonCode` | Required deterministic classification reason |
| `evidenceRefs` | Source, venue, and previous-snapshot evidence |

Rules: `noop` performs no extraction or approved-data write; `expire` removes an event whose
final known date precedes the run window; a landmark/POI expires only when no current or
future event remains; undated events become `review`.

## Pipeline Run and Stage Handoff

| Field | Rules |
|---|---|
| `runId` | Time/window-bound identity |
| `manifestHash`, `configHash` | Immutable input identities |
| `window`, `timezone` | Inclusive run range |
| `sourceOutcomes` | Per-source counts, provenance, health, and error reason |
| `venueOutcomes` | Complete partition by resolution status |
| `stageOutcomes` | Resolve, highlight, pill, panel, verify, and publish status/evidence |
| `overallStatus` | `pending`, `continuation_required`, `success`, `partial`, `blocked`, or `failed` |
| `complete` | True only after terminal finalization |
| `nextAction` | Structured resumable command when continuation is required |
| `publicationDecision` | `publish`, `preserve_previous`, or `none` plus reason |

Each stage handoff carries schema version, run and venue identity, start/end times, status,
input/output hashes, evidence paths, and a bounded next action. A terminal `partial`,
`blocked`, or `failed` run cannot select `publish`.

## Approved Snapshot Metadata

Small versioned public contract referenced by one atomic active pointer.

| Field | Rules |
|---|---|
| `schemaVersion`, `snapshotId` | Required immutable identity |
| `publishedAt` | Required successful publication time |
| `coveredWindow` | Inclusive event coverage and timezone |
| `freshness` | `fresh` or `potentially_outdated` |
| `staleAfter` | Weekly freshness boundary |
| `sourceHealth` | Last successful time and status per required source |
| `landmarksRef`, `poisRef`, `tilesetRef` | Hash-bound files inside the same snapshot |
| `previousSnapshotId` | Rollback identity when one exists |
| `contentHash` | Hash over the entire manifest contract |

The active pointer contains only the active `snapshotId` and manifest hash. It changes by
atomic replacement after every referenced file passes validation. The existing approved
landmarks, POIs, and tiles are migrated into a compatibility-verified initial snapshot before
the public frontend is switched to this contract.

## Restaurant and Deal Result

### Restaurant

Stable free-source place identity, name, coordinates, optional address/cuisine/opening hours,
official website evidence, and source attribution. Missing optional fields remain null.

### Deal Evidence

Official restaurant page, matched current promotion text, validity dates when known,
retrieval time/method, content hash, and approval status. Expired deals are not current.

### Result Envelope

```text
schemaVersion
status: success | unavailable | error
data
fetchedAt
stale: boolean
warning: nullable string
source: provider identity and cost class
```

Only previously approved applicable data may be returned with `stale: true`.

## Anonymous Plan

| Field | Rules |
|---|---|
| `planId`, `schemaVersion` | Opaque public identity and contract version |
| `title`, `travelMode` | Validated public fields |
| `stops` | Ordered 1-20 normalized Event or Restaurant Stop snapshots |
| `createdAt`, `lastActivityAt`, `expiresAt` | Set at creation; only successful game creation refreshes activity; expiry is seven days later |
| `revokedAt` | Nullable terminal operator action |

Public editing stays in browser memory. Server persistence occurs for challenge launch and
continuation. Read-only plan retrieval never refreshes activity. A maintenance transaction
deletes inactive plans after seven days without deleting a still-valid active game snapshot.

## Game Snapshot and Player Session

Game Snapshot is immutable and contains plan relationship, theme, optional timer, expiry,
and ordered mission snapshots. Each mission contains source stop identity, place,
coordinates, schedule, official source, prompt, and snapshotted verification policy.

Player Session contains game/chat relationship, current mission, verification phase,
pause/timer state, score/history, storage version, and last activity. State transitions:

```text
active <-> paused
active/paused -> completed | timed_out | quit | revoked
```

All complete challenge-session terminal transitions clear the active-session pointer and
trigger related verification cleanup in the same transaction. Advancing or completing one
mission does not by itself trigger session-level deletion.

## Weekly Refresh Run

Represents one externally schedulable, fail-fast weekly operation across event and restaurant
data. Fields: run identity, lock identity, start/end times, event-run identity/status,
restaurant-run identity/status, active snapshot before/after, terminal status, reason codes,
and exact next action. The wrapper invokes complete domain pipelines sequentially; it does not
reinterpret their internal continuation or publication contracts.

## Verification Record

| Field | Rules |
|---|---|
| `submissionId` | Internal stable identity |
| `gameId`, `chatId`, `missionId` | Required task relationship |
| `fileUniqueId` | Telegram deduplication identity; no image bytes |
| `status` | `accepted`, `rejected`, `needs_review`, or `deleted` |
| `verifier`, `result` | Minimal decision evidence |
| `createdAt`, `deleteAfter` | Immediate terminal cleanup; otherwise at most seven days after abandonment |

Raw Telegram payload retention is minimized and time-bounded to the retry/idempotency need.

## Admin Principal and Session

There is exactly one logical principal. Its password hash is deployment configuration, not
application data.

Admin Session fields: opaque session ID hash, CSRF secret hash, created/last-activity/expiry
times, revocation time, and minimal security metadata. Cookie properties are Secure,
HttpOnly, SameSite=Strict, and scoped to the service. Sessions are revocable and rate-limited;
passwords and raw session/CSRF tokens are never persisted.

## Outbound Message and Delivery Claim

Durable Telegram reply containing update identity, sequence, sanitized chat destination,
payload, status, attempts, next attempt, lease owner/expiry, last error, and delivered time.
Unique update/sequence identity prevents duplicate replies. Operational cleanup removes
settled payloads after the documented retry/idempotency window.
