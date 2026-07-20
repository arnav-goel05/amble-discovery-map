# Contract: Event Source, Activity Evidence, Location, and Publication

## 1. Source definition

Each checked-in source validates a versioned definition equivalent to:

```json
{
  "name": "Honeycombers",
  "adapterId": "honeycombers-v2",
  "version": "2.0",
  "providerId": "honeycombers",
  "owner": "Honeycombers",
  "domains": ["thehoneycombers.com"],
  "evidenceRole": "editorial",
  "operatingState": "enabled",
  "collectionOrder": 70,
  "listing": {
    "urls": ["https://..."],
    "paginationCeiling": 50,
    "listingPatterns": [],
    "detailPatterns": [],
    "terminalRule": "..."
  },
  "retrieval": {
    "providerId": "tinyfish-fetch",
    "format": "json",
    "extractLinks": true,
    "batchSize": 10,
    "timeoutMs": 110000,
    "maxAttempts": 3,
    "maximumUrlsPerMinute": 149,
    "maximumResponseBytes": 0
  },
  "editorialPolicy": {
    "version": "2.0",
    "corroborateFirst": true,
    "allowSufficientEditorialOnly": true
  }
}
```

Roles are `direct`, `editorial`, and `unavailable`; states are `enabled` and `disabled`.
Unavailable sources require a reason and perform no retrieval. Content-source policy and
retrieval-provider policy validate independently.

## 2. Listing and evidence envelope

Every appearance has a raw pointer. A row without a valid detail/activity pointer is invalid;
no synthetic URL or ID is allowed.

```json
{
  "schemaVersion": "3.0",
  "runId": "...",
  "source": { "name": "...", "evidenceRole": "editorial", "state": "enabled" },
  "records": [],
  "counts": {},
  "terminalEvidence": {}
}
```

Canonical URLs remove non-semantic fragments/default ports/tracking parameters and retain
semantic parameters. Redirects must remain within approved public-network destinations.

## 3. Source record

```json
{
  "recordType": "source_record",
  "sourceRecordId": "time-out-sg:<article>#<item-key>",
  "appearanceIds": [],
  "canonicalUrl": "https://...",
  "itemKey": null,
  "evidenceRole": "editorial",
  "claims": {
    "title": "",
    "description": null,
    "organizer": null,
    "schedule": { "text": null, "sessions": [] },
    "availability": "unknown",
    "venue": null,
    "address": null,
    "coordinates": null,
    "scope": "Singapore"
  },
  "evidenceRefs": ["raw/...#..."],
  "terminalOutcome": null,
  "reasonCode": null
}
```

Roundup entries require a stable item key; ordinal is evidence only. Specific detail-page
evidence outranks selector, listing-entry, and general page text.

## 4. Evidence assessment

Exactly one evidence decision is required per candidate activity:

- `direct`
- `direct_corroborated`
- `editorial_authoritative`
- `editorial_evidence_incomplete`
- `evidence_conflict`
- `excluded`

```json
{
  "assessmentId": "sha256:...",
  "sourceRecordIds": [],
  "primaryEvidenceId": "...",
  "evidenceLevel": "editorial_authoritative",
  "compatibility": {
    "identity": "compatible",
    "schedule": "compatible",
    "scope": "singapore",
    "location": "usable"
  },
  "decision": "eligible",
  "reasonCode": "editorial_sufficient",
  "evidenceRefs": []
}
```

For editorial sources, attempt reuse of a compatible collected direct record or explicit
official activity page first. Editorial-only evidence is sufficient only when it describes a
specific current Singapore activity, supplies a usable schedule or intentional anytime state,
supplies enough evidence for mapped or off-map public placement, is more than a pure
promotion, and contains no material contradiction. Optional missing fields remain null.

Search snippets, directories, generic homepages, user-generated map records, and social posts
cannot be the sole activity evidence.

## 5. Eligibility and schedule contract

Eligible activity kinds include one-off, date-range, recurring, selectable-session, and
book-anytime experiences. Ordinary standard-attraction admission, expired records,
online-only/overseas occurrences, and pure promotions without an underlying activity are
terminal exclusions.

```json
{
  "schedule": {
    "kind": "exact | range | recurring | selectable | anytime | unverified",
    "start": null,
    "end": null,
    "recurrence": null,
    "sessionRefs": [],
    "displayText": null,
    "finalKnownOccurrence": null
  }
}
```

The current date through the following seven days is minimum run coverage, not an eligibility
cutoff. `anytime` receives no invented date. `unverified` is held for schedule review.
Recurrence materialization must remain finite and source-backed.

## 6. Parent, session, and venue-occurrence contract

- One parent activity may own many finite sessions and venue occurrences.
- Ticket categories and repeated listing categories do not create parent duplicates.
- Reliable venue-to-session pairing creates distinct venue occurrences.
- Unresolved multi-location pairing creates one off-map multiple-location occurrence.
- Sibling sessions and venue occurrences retain their stable identities.

```json
{
  "parentActivityId": "...",
  "sessionIds": ["..."],
  "venueOccurrences": [
    {
      "venueOccurrenceId": "...",
      "publishedVenueName": "Secret location",
      "publicPlacement": "off_map",
      "mappingStatus": "not_required",
      "offMapSubtype": "secret_tba",
      "approvedLocationId": null
    }
  ]
}
```

## 7. Location contract

Location uses independent dimensions:

- public placement: `mapped`, `off_map`, or `none`
- mapping status: `approved`, `not_required`, or `pending_review`
- off-map subtype when applicable: `secret_tba`, `multiple_locations`, `mobile_route`,
  `broad_area`, or `geometry_unavailable`

OneMap mapping requires compatible venue name/address/postal code, coordinates when available,
and building geometry. A unit maps to its verified parent building and remains display detail.
Intentional non-building cases are off-map with mapping not required. Exact-building ambiguity
with reliable Singapore scope and a usable general location is off-map with pending mapping
review. Uncertainty about Singapore scope or every usable general location is held with no
public placement. Event evidence cannot substitute for location evidence.

## 8. Deduplication contract

- Collapse same-source canonical repeats and ticket/category variants first.
- Compare all configured sources and the prior approved catalogue.
- Preserve alternate titles and every source contribution.
- Merge compatible records using source IDs/links, organizer, edition, schedule/recurrence,
  venue occurrence/building, description, and booking destination as available.
- Title or raw venue similarity alone cannot merge.
- Anytime/off-map matches require stronger remaining identity evidence.
- Distinct editions, sessions, venues, and organizers remain separate.
- `possible_duplicate_review` remains separate and does not block unrelated records.
- Stable published anchors survive source membership, evidence level, and location changes.

## 9. Reconciliation and publication contract

Per identity terminal outcomes are:

- `create`
- `update`
- `no_op`
- `expire`
- `review`
- `carry_forward_stale`
- `hold_new`

A complete source may apply every outcome. An unavailable or incomplete source applies no
unproven delete or replacement. Its still-active approved source contributions carry forward
with `staleSince` and `staleReason`; compatible current contributions may still update the
same merged activity, and unsafe new identities remain held.

User-facing state uses four independent dimensions:

- lifecycle: `active`, `held`, `archived`, or `excluded`
- public placement: `mapped`, `off_map`, or `none`
- mapping status: `approved`, `not_required`, or `pending_review`
- freshness: `current` or `stale`, optionally refined per displayed field/source contribution

An active mapped or off-map activity may therefore be current or stale. Mapping review may be
pending while reliable activity information remains publicly off-map. Event-level freshness
is current only when every displayed material field has at least one current compatible source
contribution; otherwise it is stale. A stale contribution cannot prevent a current compatible
contribution from updating the fields it supports.

The assembled catalogue stages once and activates atomically only after release-wide schema,
accounting, identity, geometry, build, security, and browser gates pass. A failure making the
assembled catalogue invalid, inconsistent, unsafe, or unverifiable preserves the complete
previous approved snapshot.

## 10. Accounting contract

```text
listingAppearances = repeatedAppearances + uniqueSourceRecords + invalidPointers
uniqueSourceRecords = eligible + review + excluded + archived + malformed
activePublishedEvents = mappedActiveEvents + offMapActiveEvents
stalePublishedEvents <= activePublishedEvents
allEncounteredRecords = publishedContributions + review + excluded + archived + malformed
```

Reports distinguish source contributions from unique published activities. Every source
record, evidence assessment, session, venue occurrence, dedup decision, reconciliation
outcome, and review item terminates exactly once.

For multi-surface rendered sources, results also expose `completion.surfaceOutcomes` and the
counts `listingAppearances`, `uniqueSourcePointers`, and `listingDuplicatesCollapsed`. Each
configured surface has a terminal success or blocked outcome. Any blocked surface blocks the
source, retains completed same-run capture references and diagnostics, and cannot authorize
deletion or claim zero results. An HTTP status may be retained as an integer; response bodies,
credentials, and authorization values are forbidden in diagnostics.

## 11. Operational trace contract

Trace path: `outputs/event-pipeline/<run-id>/logs/trace.jsonl`.

Minimum trace events include run/source/stage start and terminal state; listing and detail
accounting; request/retry/reuse; evidence assessment; eligibility/schedule classification;
venue occurrence and location decision; deduplication; per-identity reconciliation;
carry-forward and stale labeling; review reconciliation; release-wide validation; and atomic
activation or rollback.

Each record contains the required fields in [data-model.md](../data-model.md). API keys,
authorization/cookie headers, raw response bodies, and credential-bearing query parameters
are prohibited. Missing lineage or unbalanced accounting is a release-wide gate failure.

## 12. Frontend projection contract

The approved snapshot exposes one user-facing record per published logical activity plus its
sessions and venue occurrences. Projection supplies:

- map-backed results for active records with mapped placement;
- `Secret / Location TBA` results for `secret_tba`;
- `Multiple locations` results for unresolved multiple-location records;
- suitable off-map labeling for mobile, broad-area, and geometry-unavailable records;
- exact/range/recurring/selectable/anytime/unverified schedule display states; and
- stale evidence indication derived from carried-forward source/field contributions without
  changing mapped/off-map placement.

The discovery model and singleton search own filtering and presentation. Pipeline artifacts
must not contain component markup.

## 13. Source terminal behavior

Source states are `pending`, `collecting`, `complete`, `unavailable`, and `incomplete`.

- `complete`: current evidence may reconcile normally.
- `unavailable`: no retrieval; carry forward still-active approved source contributions as
  stale while retaining independent placement/lifecycle.
- `incomplete`: partial new output is not authoritative for delete/replace; carry forward
  prior safe identities and hold unsafe new records.

An isolated unavailable/incomplete source does not itself block unrelated safe identities.
A release-wide accounting, schema, identity, geometry, security, build, browser, or activation
failure preserves the whole previous snapshot.
