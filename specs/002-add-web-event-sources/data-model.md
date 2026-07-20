# Data Model: Expand Singapore Event Discovery

## Identity hierarchy

```text
SourceListingAppearance
  -> SourceRecord
      -> ParentActivity
          -> ActivitySession
              -> VenueOccurrence
                  -> PublishedEvent

SourceRecord -> EvidenceAssessment
VenueOccurrence -> LocationAssessment
PublishedEvent <- DeduplicationDecision
PublishedEvent -> ReconciliationOutcome -> SnapshotManifest
```

Source records remain provenance. Parent, session, venue-occurrence, and published identities
must not be collapsed into one key.

## EventSourceDefinition

Versioned checked-in source contract.

| Field                            | Type              | Rules                                                             |
| -------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `name`                           | string            | Unique display name                                               |
| `adapterId`, `version`           | string            | Required; version changes when interpretation changes             |
| `providerId`, `owner`, `domains` | string / string[] | Source identity and validated destinations                        |
| `evidenceRole`                   | enum              | `direct`, `editorial`, or `unavailable`                           |
| `operatingState`                 | enum              | `enabled` or `disabled`                                           |
| `collectionOrder`                | integer           | Unique deterministic run/report order                             |
| `retrieval`                      | object            | Approved free provider and bounded request rules                  |
| `listing`                        | object            | Entry URLs, canonical patterns, pagination bounds, terminal rules |
| `identityRule`                   | object            | Stable source-record identity strategy                            |
| `editorialPolicy`                | object/null       | Corroboration and sufficiency rules for editorial sources         |
| `unavailableReason`              | string/null       | Required when disabled/unavailable                                |

### Validation

- Direct and editorial sources may be enabled; unavailable sources must be disabled.
- Editorial sources require a versioned sufficiency policy.
- Disabled sources remain in deterministic accounting and perform no retrieval.
- Catch.sg and SISTIC retain stable source identities during schema migration.

## SourceListingAppearance

One observed card, row, category repeat, or bounded roundup entry.

Fields: `appearanceId`, `sourceName`, `pageRef`, `ordinal`, `rawPointer`, `discoveredUrl`,
`canonicalListingKey`, `seenAt`.

Repeated appearances remain countable even when they collapse to one source record.

## SourceRecord

The stable source-level processing unit.

| Field                           | Type        | Rules                                                      |
| ------------------------------- | ----------- | ---------------------------------------------------------- |
| `sourceRecordId`                | string      | Qualified stable source identity                           |
| `appearanceIds`                 | string[]    | One or more observed appearances                           |
| `canonicalUrl`                  | URL         | Validated event/activity/detail page or parent article URL |
| `itemKey`                       | string/null | Stable bounded roundup entry key when applicable           |
| `evidenceRole`                  | enum        | Direct or editorial                                        |
| `rawRefs`                       | string[]    | Immutable evidence pointers                                |
| `adapterVersion`, `payloadHash` | string      | Reproducibility and change detection                       |
| `claims`                        | object      | Extracted values without fabrication                       |
| `terminalOutcome`, `reasonCode` | string      | Exactly one accounted result                               |

Identity must not depend on roundup ordinal alone.

## EvidenceAssessment

Determines whether one or more source records establish a publishable activity.

| Field                    | Type     | Rules                                                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `assessmentId`           | string   | Evidence inputs plus policy version                                                              |
| `sourceRecordIds`        | string[] | Direct and/or editorial contributors                                                             |
| `primaryEvidenceId`      | string   | Deterministic current-fact source                                                                |
| `evidenceLevel`          | enum     | `direct`, `direct_corroborated`, `editorial_authoritative`, `incomplete`, `conflict`, `excluded` |
| `compatibility`          | object   | Activity identity, schedule, Singapore scope, organizer, and location comparisons                |
| `decision`, `reasonCode` | string   | Publish, review, or exclude outcome                                                              |
| `evidenceRefs`           | string[] | Source and comparison evidence                                                                   |

Rules:

- Compatible direct evidence is primary when available.
- Editorial-only publication requires the complete sufficiency predicate in FR-021.
- Search snippets, directories, generic homepages, map results, and social posts cannot be
  the only source record.
- Evidence level may upgrade without changing the activity identity.

## ParentActivity

The logical event, experience, exhibition, production, or programme.

Key fields: `parentActivityId`, stable source anchors, title and alternate titles, organizer,
description, category, price/access metadata, evidence assessment, source contribution IDs,
content hash, and lifecycle state.

The parent does not duplicate itself for categories, ticket tiers, selectable dates, or venue
occurrences.

## ScheduleState

| Field                  | Type          | Rules                                                                |
| ---------------------- | ------------- | -------------------------------------------------------------------- |
| `kind`                 | enum          | `exact`, `range`, `recurring`, `selectable`, `anytime`, `unverified` |
| `start`, `end`         | datetime/null | Singapore time semantics when known                                  |
| `recurrence`           | object/null   | Source-supported recurrence rule; not unlimited instances            |
| `sessionRefs`          | string[]      | Finite explicit sessions where supplied                              |
| `displayText`          | string/null   | Preserved source schedule text                                       |
| `finalKnownOccurrence` | datetime/null | Expiry boundary when evidence supports it                            |

`anytime` is intentional availability. `unverified` is a date-dependent record lacking a
reliable schedule. Neither receives an invented date.

## ActivitySession

One finite session, explicit selectable slot, or recurrence definition belonging to a parent.

Fields: `sessionId`, `parentActivityId`, source session IDs, schedule state, availability
(`available`, `waitlist`, `sold_out`, `unknown`), access restriction, venue-occurrence IDs,
and evidence refs.

Sibling sessions remain distinct even when title and venue match.

## VenueOccurrence

One location-specific manifestation of a parent activity or session.

| Field                            | Type              | Rules                                                                                    |
| -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `venueOccurrenceId`              | string            | Stable parent/session plus source venue identity                                         |
| `parentActivityId`, `sessionIds` | string / string[] | Required relationship                                                                    |
| `publishedVenueName`             | string/null       | Preserved source value                                                                   |
| `address`, `postalCode`, `unit`  | string/null       | Never invented                                                                           |
| `sourceCoordinates`              | object/null       | Evidence only until resolved                                                             |
| `publicPlacement`                | enum              | `mapped`, `off_map`, or `none`                                                           |
| `mappingStatus`                  | enum              | `approved`, `not_required`, or `pending_review`                                          |
| `offMapSubtype`                  | enum/null         | `secret_tba`, `multiple_locations`, `mobile_route`, `broad_area`, `geometry_unavailable` |
| `approvedLocationId`             | string/null       | Required only for mapped placement                                                       |
| `locationAssessmentId`           | string            | Decision lineage                                                                         |

Reliable multi-location pairings produce multiple venue occurrences. Unresolved pairings
produce one `multiple_locations` occurrence.

## LocationAssessment

Audited venue-to-building decision.

Fields: `assessmentId`, venue occurrence ID, normalized venue/address/postal/unit/coordinate
evidence, authority refs, OneMap candidates, approved OneMap building/POI/tile identity,
parent-building alias, geometry evidence, decision, reason code, policy version, and evidence
hash.

### Invariants

- Mapped placement requires one compatible logical OneMap building and approved mapping.
- A unit maps to its verified parent building while the unit remains display metadata.
- Intentional non-building cases use off-map placement with mapping not required.
- Several plausible buildings with reliable Singapore scope and a usable general location
  use off-map placement with pending mapping review.
- A conflict that makes Singapore scope or every usable general location uncertain uses no
  public placement, pending mapping review, and held lifecycle.
- Unchanged approved evidence may be reused; changed evidence must re-evaluate.

## DuplicateCandidate and DeduplicationDecision

Candidate evidence may include source IDs, canonical URLs, distinctive title/edition tokens,
organizer, schedule/recurrence, venue occurrence, approved building, description, booking
destination, and prior published cluster.

Decision fields: `decisionId`, input identities, evidence comparison, decision (`repeat`,
`merged`, `distinct`, `possible_duplicate_review`, `identity_conflict_review`), retained
anchor, published event ID, source precedence, and evidence refs.

### Merge rules

- Same-source category/ticket repeats collapse before cross-source comparison.
- Direct/editorial provenance does not create separate events.
- Title or raw venue similarity alone never authorizes a merge.
- Exact schedules/buildings provide strong evidence when present.
- Anytime/off-map records require stronger agreement from organizer, canonical/booking links,
  distinctive title, or description.
- Uncertainty keeps records distinct and does not block unrelated records.

## PublishedEvent

| Field                              | Type                 | Rules                                                                    |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `publishedEventId`                 | string               | Stable prior anchor when matched; deterministic new anchor otherwise     |
| `parentActivityIds`                | string[]             | Compatible merged parents                                                |
| `sourceRecordIds`                  | string[]             | Complete provenance                                                      |
| `primaryEvidenceId`                | string               | Current-fact attribution                                                 |
| `sessionIds`, `venueOccurrenceIds` | string[]             | Preserved child identities                                               |
| `displayFields`                    | object               | Provenance-backed user fields                                            |
| `evidenceLevel`                    | enum                 | From EvidenceAssessment                                                  |
| `lifecycleState`                   | enum                 | `active`, `held`, `archived`, or `excluded`                              |
| `publicPlacement`                  | enum                 | `mapped`, `off_map`, or `none`; active public records use mapped/off-map |
| `mappingStatus`                    | enum                 | `approved`, `not_required`, or `pending_review`                          |
| `freshness`                        | enum                 | `current` or `stale`, derived from field/source contributions            |
| `staleSince`, `staleReason`        | datetime/string/null | Required for carry-forward                                               |
| `fieldFreshness`                   | object               | Per displayed field/source evidence freshness for merged activities      |
| `contentHash`                      | string               | Excludes irrelevant source ordering                                      |

Source membership, evidence upgrade, location revelation, and freshness update this entity
without changing its stable ID. Placement, mapping, lifecycle, and freshness are orthogonal:
for example, an active mapped event may be stale, and an active off-map event may have pending
mapping review.

## SourceContributionFreshness

Per-source evidence freshness attached to a merged published activity.

Fields: `publishedEventId`, `sourceRecordId`, status (`current` or `stale`), `lastConfirmedAt`,
`staleSince`, `staleReason`, and the displayed fields supported by that contribution.

The event-level freshness is `current` only when every currently displayed material field is
supported by at least one current compatible contribution; otherwise it is `stale`. A stale
contribution does not prevent a current contribution from updating the fields it supports.

## ReviewItem

Scoped private-admin review record.

Fields: `reviewId`, entity type/ID, category (`event_evidence`, `schedule`, `identity`,
`deduplication`, `location`), reason code, evidence hash, candidate choices, state
(`pending`, `resolved`, `superseded`), resolution, reviewer, timestamps, and trace refs.

Only current evidence hashes remain pending. Changed, expired, recovered, or replaced cases
supersede prior items automatically.

## SourceRunStatus

Fields: source role/state, traversal totals, appearances, unique records, invalid pointers,
evidence outcomes, parent activities, sessions, venue occurrences, excluded/archived/review
counts, dedup contributions, retries/reuse, completeness proof, carry-forward counts,
stale impact, blocker, and exact continuation action.

### Accounting invariants

```text
listingAppearances = repeatedAppearances + uniqueSourceRecords + invalidPointers
uniqueSourceRecords = publishedCandidates + review + excluded + archived + malformed
activePublishedEvents = mappedActiveEvents + offMapActiveEvents
stalePublishedEvents <= activePublishedEvents
allEncounteredRecords = publishedContributions + review + excluded + archived + malformed
```

Counts may overlap only where explicitly labeled as source contributions rather than unique
published events.

## ReconciliationOutcome

One terminal identity decision: `create`, `update`, `no_op`, `expire`, `review`,
`carry_forward_stale`, or `hold_new`.

Rules:

- Complete sources may apply every lifecycle decision.
- Incomplete sources may not apply unproven delete/update decisions.
- Still-active approved source contributions from incomplete sources carry forward as stale;
  compatible current contributions may still update other fields of the merged activity.
- A final known past occurrence may archive from last reliable evidence.
- Isolated review affects only its scoped identity or location branch.

## SnapshotManifest

Immutable assembled catalogue.

Fields: schema version, snapshot/run ID, generated time, source statuses, event identities,
mapped/off-map projections, carried-forward identities, review/exclusion/archive counts,
accounting hashes, trace/report refs, geometry/build/security/browser results, publication
decision, and prior snapshot link.

Activation is atomic. Release-wide invalidity preserves the prior active pointer.

## OperationalTraceRecord

Append-only privacy-safe record containing timestamp, level, run ID, source, stage, adapter
and schema versions, correlation/entity IDs, action, attempt, resume disposition, counts,
duration, outcome, reason code, blocker, continuation, and evidence refs.

Secrets, authorization/cookie headers, raw bodies, credential query parameters, and product
analytics are prohibited.

## State transitions

```text
source: pending -> collecting -> complete | unavailable | incomplete
source record: observed -> interpreted -> eligible | review | excluded | archived | malformed
evidence: pending -> direct | direct_corroborated | editorial_authoritative | incomplete | conflict
schedule: pending -> exact | range | recurring | selectable | anytime | unverified
placement: pending -> mapped | off_map | none
mapping: pending -> approved | not_required | pending_review
lifecycle: pending -> active | held | archived | excluded
freshness: pending -> current | stale
review: pending -> resolved | superseded
reconciliation: pending -> create | update | no_op | expire | review | carry_forward_stale | hold_new
snapshot: assembling -> staged -> verified -> active
                         \-> rejected (prior snapshot remains active)
```
