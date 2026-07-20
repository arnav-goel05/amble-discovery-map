# Event Pipeline Contract

## Contents

1. Manifest and run identity
2. Canonical event schema
3. Deduplication and grouping
4. Durable artifacts and resume
5. Status and reporting

## Manifest and run identity

`data/event-pipeline-config.json` is the executable source of truth for timezone, window length, enabled sources, endpoints, pagination, and response pointers. `pull_data.md` is the human-readable source schedule and last-success ledger. Missing executable adapter details block only that source.

Each schema-v2 source declares `evidenceRole` (`direct`, `editorial`, or `unavailable`), `operatingState` (`enabled` or `disabled`), deterministic `collectionOrder`, and precedence only for direct sources. Five direct and three editorial sources are enabled; Roots/HAN is disabled/unavailable with an explicit reason. Legacy role/mode aliases are migrated at the runtime boundary only.

Use `Asia/Singapore` and `windowDaysAfterStart` for expiry/reconciliation and bounded recurrence materialization, not as an ingestion cutoff. Create run ID `<UTC YYYYMMDDTHHMMSSZ>-<window-start>-<window-end>`.

Acquire `outputs/event-pipeline/.lock` with exclusive-create semantics before mutation. Store `{ "runId", "startedAt", "owner": { "host": "<hostname>", "pid": 123 } }`; always release it in final cleanup after success or failure. On the same host, test PID liveness with signal `0`; treat the lock as stale only when that check reports no process and `startedAt` is over two hours old. When the host differs or liveness cannot be established, never assume staleness - report and require explicit user-approved removal. Stop with the active run ID for every non-stale lock.

Copy the run-start manifest to `<run-id>/manifest.snapshot.md` before any update and store its SHA-256 plus adapter versions in `run.json`. Resume compatibility uses this immutable snapshot/config hash, never the later mutable manifest. Update a source's `Last successful use` as an ISO-8601 UTC timestamp only after every page and validation step succeeds. Write manifest changes through a temporary file and atomic rename.

Start a new run by default. Resume only when invoked with an explicit run ID (`resume: <run-id>` in the request or runner input); never auto-select among incomplete runs. If snapshot/window/adapter/upstream hashes are incompatible, report the mismatch and stop the explicit resume. For a compatible resume, reuse only atomically completed `success` source/stage artifacts whose input hashes still match. Reset `pending`, `blocked`, `failed`, and interrupted artifacts before retry. When any upstream hash changes, recursively invalidate and rerun every downstream artifact for that branch.

## Canonical activity schema

```json
{
  "schemaVersion": "3.0",
  "parentActivityId": "<stable parent id>",
  "publishedEventId": "<stable public anchor>",
  "title": "<required>",
  "schedule": {
    "kind": "exact | range | recurring | selectable | anytime | unverified",
    "start": null,
    "end": null,
    "finalKnownOccurrence": null
  },
  "sessions": [],
  "venueOccurrences": [],
  "timeText": "<time or range, or null>",
  "venue": "<source venue or null>",
  "lifecycleState": "active | held | archived | excluded",
  "publicPlacement": "mapped | off_map | none",
  "mappingStatus": "approved | not_required | pending_review",
  "freshness": "current | stale",
  "evidenceLevel": "direct | direct_corroborated | editorial_authoritative | editorial_evidence_incomplete | evidence_conflict | excluded",
  "category": null,
  "price": null,
  "description": null,
  "organizer": null,
  "eventUrl": null,
  "isOnline": false,
  "parentEventId": "<listing id>",
  "sourceContributions": [],
  "sources": [
    {
      "source": "<adapter name>",
      "sourceId": "<id>",
      "sourceUrl": "<url or null>",
      "recordRef": "<raw artifact pointer>"
    }
  ]
}
```

Require a title and one explicit schedule state; never fabricate a date. Active activities require mapped or off-map placement. Mapped placement requires exact approved OneMap identity/tile evidence and geometry; unit numbers map to their parent building. Secret/TBA, unresolved multiple-location, mobile-route, broad-area, and geometry-unavailable activities stay off-map without fake coordinates. Reliable venue-session pairs split; unresolved multi-location pairing remains one off-map activity.

When a listing exposes multiple performances, emit one canonical occurrence per performance. Use `<source-id>#<start-ISO>` when datetime exists. For date-only performances, use `<source-id>#<YYYY-MM-DD>#<one-based-source-order>` so same-day occurrences remain distinct. Retain the listing ID in `parentEventId` and give each occurrence its own start/end/date/time. Deduplicate and sort occurrences independently; pills and panels display each upcoming occurrence as a separate event.

The pill and panel consume `title`, `dateText`, `timeText`, `eventUrl`, and other canonical fields directly. Convert resolver coordinates to `landmark.anchor` at the pill handoff.

## Deduplication and grouping

Generate same-source repeat and all-source candidates after normalization. Merge exact-building records only after the same approved OneMap POI plus compatible title/schedule evidence; anytime/off-map records require matching strong off-map state and venue evidence. Preserve every contribution, finite session, venue occurrence, source ID, and URL. Keep sibling sessions, distinct editions, generic-title matches, and uncertainty separate. Prefer the prior published anchor across membership, evidence, schedule, and location changes; conflicting prior clusters become scoped held review identities rather than a catalogue-wide block.

Before resolution, group only identical venue strings after Unicode normalization, case-folding, whitespace collapse, and punctuation trimming; do not merge aliases. Give every branch deterministic ID `venue-<first-16-hex-of-SHA256(normalized-venue)>`; a hash collision uses the full SHA-256. Store each final result at `stages/<branch-id>/resolve.json`. Store approved mappings only in `data/venue-alias-registry.json`; cache `needs_review` and `not_mappable` by normalized venue plus evidence hash only in ignored `outputs/event-pipeline/venue-resolution-cache.json`. After resolution, regroup approved records by `poiId`.

An authoritative `mobile_venue` or `multi_venue` classification remains stable for the same normalized venue when a later source adds a representative coordinate; that coordinate cannot turn a moving or multi-stop venue into one fixed building. Reuse the classification with the current branch evidence hash. Every other unresolved outcome requires an exact evidence-hash match.

After normalization, the executable `prepare-venues` checkpoint must complete before any resolve result is accepted. It verifies or builds the local index, enriches pending events, and records exact/local candidates. Treat remaining local misses as recovery inputs, not terminal classifications.

## Durable artifacts and resume

Write under `outputs/event-pipeline/<run-id>/`:

- `raw/<source>/listings/page-<four-digit-n>.dom.md`
- `raw/<source>/details/<sha256-of-canonical-detail-url>.dom.md`
- `raw/<source>/details/<sha256-of-canonical-detail-url>.json`
- `normalized/events.json`
- `normalized/excluded.json`
- `normalized/invalid.json`
- `normalized/dedup-decisions.json`
- `normalized/dedup-candidates.json`
- `normalized/dedup-final-decisions.json`
- `stages/<poi-id>/<stage>.json`
- `trace.jsonl`
- `status.json`
- `status.md`

Every record-collection JSON artifact uses this envelope; `run.json` and stage handoffs use their dedicated schemas:

```json
{
  "schemaVersion": "1.0",
  "runId": "",
  "createdAt": "",
  "source": null,
  "counts": {},
  "records": []
}
```

`excluded.json` and `invalid.json` add a stable `reasonCode` and `sourceRecordRef` to every record. `dedup-decisions.json` records input IDs, output ID, decision, evidence, and primary-source attribution.

Use this exact `run.json` schema:

```json
{
  "schemaVersion": "1.0",
  "runId": "",
  "createdAt": "",
  "updatedAt": "",
  "status": "pending | success | partial | failed",
  "timezone": "Asia/Singapore",
  "window": { "start": "", "end": "", "inclusive": true },
  "manifestSnapshot": { "path": "manifest.snapshot.md", "sha256": "" },
  "adapterDefinitionsSnapshot": {
    "path": "pipeline-config.snapshot.json",
    "sha256": ""
  },
  "configSha256": "",
  "adapters": [{ "id": "", "version": "", "definitionSha256": "" }],
  "resume": { "requestedRunId": null, "parentRunId": null },
  "artifacts": {
    "relative/path.json": {
      "sha256": "",
      "status": "pending | success | invalidated",
      "inputSha256": []
    }
  }
}
```

At run creation, copy `data/event-pipeline-config.json` to `pipeline-config.snapshot.json` without rewriting it. Hash the exact file bytes of that snapshot with SHA-256 lowercase hex; use this same value as every selected adapter's `definitionSha256`. This deliberately invalidates all adapters when any executable definition changes.

Compute `configSha256` from one UTF-8 byte string serialized exactly as compact JSON with no insignificant whitespace and keys in this order:

```json
{
  "manifestSha256": "<lowercase hex>",
  "adapters": [
    {
      "id": "<adapter id>",
      "version": "<adapter version>",
      "definitionSha256": "<lowercase hex>"
    }
  ]
}
```

Order `adapters` by Unicode code-point order of `id`; encode strings with standard JSON escaping and no ASCII-only escaping; append no newline before hashing with SHA-256 lowercase hex. The manifest hash is over the exact bytes of `manifest.snapshot.md`, also copied without rewriting. Store both snapshot paths in `run.json`; resume hashes their bytes again and rejects the run if either stored hash differs. Update `artifacts` atomically after each artifact write; resume compares each artifact's `inputSha256` with current upstream hashes and recursively marks mismatches `invalidated`.

Detail fixture JSON is not a bare object: it uses the universal envelope with `counts: { "records": 1 }` and the extracted fixture as `records[0]`. Canonical `sources[].recordRef` uses JSON Pointer format `<relative-detail-json-path>#/records/0`; the fixture itself carries `sourceId`.

Canonicalize a final detail URL before hashing: resolve it to absolute HTTPS/HTTP; lowercase scheme and host; remove default ports; remove the fragment; resolve dot segments; remove a trailing slash except for root; delete `utm_*`, `gclid`, and `fbclid` parameters case-insensitively; sort remaining query pairs by Unicode code-point order of decoded key then decoded value while preserving duplicates; serialize with the platform URL percent-encoding rules. Hash the UTF-8 canonical URL with SHA-256 lowercase hex. Identical hashes reuse the same detail artifact; a theoretical collision appends the full source ID hash.

Write every artifact via temporary file and atomic rename. Each stage file uses the envelope in `stage-handoffs.md`. Resume only when the immutable snapshot/config hash, window, adapter versions, and upstream artifact hashes match.

## Status and reporting

Statuses: `pending`, `success`, `pilot_failed`, `blocked`, `failed`, `skipped`, `unresolved`. A `pilot_failed` discovery source is reported but does not block publication; the same source in `required` mode does block it.

Use the run-window start as the expiry boundary. An event is expired only when its final parseable end date, or start date when no end exists, is earlier than that boundary. Retain undated events for review. Remove a pipeline-managed landmark and POI from the successful snapshot when expiry leaves it empty.

Overall decision order:

1. Report cannot be written: `failed`; emit the same report content in the final response as fallback.
2. Build or required browser verification fails: `failed`.
3. Every source blocked/failed: `failed`.
4. Isolate an unavailable/incomplete source by carrying forward only its still-active previously approved contributions as stale; first-run outages add nothing. A reliable Singapore exact-building ambiguity publishes off-map with pending mapping review. Identity conflicts are held individually. These outcomes do not block unrelated safe updates.
5. All successful sources return zero records, only online records, or zero eligible physical records with complete accounting: `success` with no map changes.
6. Assemble one immutable candidate from safe updates, stale carry-forward, holds, and archives. Invalid schema/accounting/identity/geometry/security, build/browser failure, or activation failure rejects the entire candidate and preserves the prior pointer. Otherwise activation is atomic and the run is `success`.

Track source records separately from expanded occurrences. Per source enforce `sourceRecordsReceived = invalidSourceRecords + processedSourceRecords`. Each processed source record records `occurrencesEmitted`; globally enforce `occurrencesEmitted = excludedOccurrences + eligiblePreDedup`. Then enforce `acceptedPostDedup = sum(eligiblePreDedup) - duplicateCollapsed` and `sum(acceptedPrimary) = acceptedPostDedup`. Attribute a merged output to the earliest configured contributing source; count every later contributing occurrence - including same-source duplicates - as `duplicateCollapsed` for its source. The one retained occurrence counts as `acceptedPrimary` for the attributed source.

Keep three identities separate: `occurrenceId` is the stable replacement key, `parentListingId` groups sibling performances, and `mergedEventId` groups matching cross-source occurrences. Construct `mergedEventId` by sorting contributing objects by Unicode code-point order of `source`, then `sourceId`; serialize the exact array with JSON UTF-8 and no extra whitespace; compute lowercase SHA-256 hex; use `merged:<64-hex>`. A merged-membership change must never change or collapse the primary occurrence identity.

The report must include per source: pages, source-records-received, invalid-source-records, processed-source-records, occurrences-emitted, excluded-occurrences, eligible-pre-dedup, duplicate-collapsed, accepted-primary, and artifact refs. Per venue include each stage status, timing, output ref, error, and next step. Totals must satisfy all equations.

`trace.jsonl` records run/source configuration, retrieval attempts, source completion, normalization, deduplication, venue stages, verification, staged publication, and finalization. Each line is redacted structured JSON with run/source/stage context, outcome, reason code, counts, durations where available, and artifact references; secrets and raw bodies are forbidden. `status.json` is the machine-readable companion to `status.md` and includes source roles/modes, confirmation histograms, dedup counts, blockers, and final publication state.

Use these report sections: run/window/manifest metadata, reconciled summary, per-source accounting, per-venue stage table, build/browser verification, errors, and ordered next steps.
