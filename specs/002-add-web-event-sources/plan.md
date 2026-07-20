# Implementation Plan: Expand Singapore Event Discovery

**Branch**: `develop` | **Feature Directory**: `specs/002-add-web-event-sources` | **Date**: 2026-07-18 | **Spec**: [spec.md](spec.md)

## Summary

Evolve the implemented nine-source event pipeline from a weekly, fixed-building,
direct-authority-only publication model into the approved activity-discovery model. Keep the
existing rendered-source transport, adapters, evidence capture, venue recovery, deduplication,
logging, admin review, and atomic snapshot boundaries. Change shared normalization to retain
all active and future scheduled or anytime activities exposed by bounded source surfaces;
classify standard attraction admission behaviorally; support independent placement and mapping states;
allow sufficiently evidenced editorial-only publication; preserve distinct parent, session,
venue-occurrence, and published identities; and reconcile failures per affected identity
before applying release-wide gates. Extend the existing search experience with mapped,
secret/location-TBA, and multiple-location views.

## Technical Context

**Language/Version**: Node.js 24+ JavaScript, primarily ECMAScript modules

**Primary Dependencies**: Node.js standard library and built-in `fetch`; approved free
TinyFish Fetch REST capability; existing Vite 8, Playwright 1.61, MapLibre, deck.gl, and Three.js
stack; no new runtime package

**Storage**: Versioned JSON source/policy/venue configuration; immutable
`data/snapshots/<run-id>/` catalogues and `data/approved-snapshot.json`; ignored captures,
checkpoints, traces, and reports under `outputs/event-pipeline/<run-id>/`; environment-only
`TINYFISH_API_KEY`

**Testing**: Node built-in test runner, adapter verifier, production build, Playwright
desktop/mobile Chromium/WebKit/Firefox matrix, and `npm run verify`

**Target Platform**: Existing single-host weekly pipeline and anonymous public Singapore web
application

**Project Type**: Web application with deterministic command-line ingestion, admin review,
and atomic catalogue publication

**Performance Goals**: Stay within checked-in pagination/retry/timeout/request-size bounds;
fetch each canonical page at most once per run; avoid material regression in current event
search and map interaction benchmarks; produce byte-equivalent results for identical evidence

**Constraints**: Free/open retrieval only; configured bounded source surfaces; validated
public-network destinations and redirects; no access-control circumvention; all active/future
retention cannot create unbounded recurrence expansion; exact building highlights still
require approved OneMap evidence; isolated failures cannot delete or block unrelated safe
identities; release-wide invalidity preserves the prior snapshot

**Scale/Scope**: Nine configured sources—five direct, three editorial, one unavailable—with
hundreds of source records, potentially longer future horizons, mapped and off-map outputs,
and one shared reconciliation/publication path

### Source matrix

| Order | Source                 | Evidence role | Operating state | Publication behavior                                          |
| ----: | ---------------------- | ------------- | --------------- | ------------------------------------------------------------- |
|    10 | Catch.sg               | direct        | enabled         | Publish eligible direct records                               |
|    20 | SISTIC                 | direct        | enabled         | Publish eligible direct records                               |
|    30 | Fever Singapore        | direct        | enabled         | Include dated, selectable, and anytime activities             |
|    40 | Visit Singapore        | direct        | enabled         | Include individual happenings extracted from details/guides   |
|    50 | Singapore Film Society | direct        | enabled         | Include public and access-restricted programmes               |
|    60 | Roots/HAN              | unavailable   | disabled        | Report only until source contract revalidation                |
|    70 | Honeycombers           | editorial     | enabled         | Corroborate first; publish sufficient editorial-only evidence |
|    80 | ArtsEquator            | editorial     | enabled         | Corroborate first; publish sufficient editorial-only evidence |
|    90 | Time Out Singapore     | editorial     | enabled         | Corroborate first; publish sufficient editorial-only evidence |

## Constitution Check

_GATE: Passed before research and re-checked after design against Constitution v2.3.0._

- **Branch workflow — PASS**: All work remains on `develop`; no feature branch is created or
  selected by the SpecKit feature directory.
- **Evidence — PASS**: Every event retains an approved direct or sufficiently detailed trusted
  editorial source page. Event authority is distinct from building authority; missing values
  remain unavailable, and ambiguous buildings are never fabricated.
- **Automation — PASS**: Inclusion, schedule states, editorial sufficiency, deduplication,
  location outcomes, carry-forward, review, and release-wide rollback are deterministic,
  bounded, reason-coded, resumable operations.
- **Identity and publication — PASS**: Source, parent activity, session, venue occurrence, and
  published identities remain separate. Per-identity create/update/no-op/expire/review and
  stale carry-forward feed one staged atomic snapshot. Unsafe assembled snapshots roll back.
- **Boundaries — PASS**: Transport, source interpretation, event evidence, venue evidence,
  deduplication, reconciliation, frontend projection, UI, review, and publication retain
  explicit versioned contracts.
- **Quality and security — PASS**: Tasks require success/failure/recovery/lifecycle coverage,
  external-content protections, credential redaction, production build, browser matrix, and
  rollback tests.
- **UX and performance — PASS**: Off-map views extend the singleton search component and event
  discovery model without background polling or hidden rendering. Browser coverage and a
  before/after benchmark are release gates.
- **Operations and privacy — PASS**: Only public activity/venue data is collected through the
  approved free capability. Stale state and every terminal outcome are visible in operational
  reports; logs avoid personal data and secrets.
- **Simplicity — PASS**: The design extends existing owners instead of adding a second pipeline,
  publisher, venue registry, or frontend application.

### Post-design re-check

The revised data model separates evidence, schedule, placement, mapping, lifecycle, and
freshness states; the
contract accounts for editorial-only and stale carry-forward outcomes; and the quickstart
validates each independently. No constitutional exception remains.

## Project Structure

### Documentation

```text
specs/002-add-web-event-sources/
├── spec.md
├── policy-review.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
├── checklists/requirements.md
└── contracts/rendered-event-source.md
```

### Source Code

```text
data/
├── event-pipeline-config.json
├── provider-policy.json
├── event-authority-registry.json
├── venue-alias-registry.json
└── approved-snapshot.json

scripts/
├── event-source-collector.mjs
├── event-normalizer.mjs
├── event-pipeline.mjs
├── event-frontend-snapshot.mjs
├── reconcile-event-content.mjs
└── lib/
    ├── approved-snapshot.mjs
    ├── admin-repository.cjs
    ├── event-pipeline/
    │   ├── run-state.mjs
    │   └── reporting.mjs
    └── event-sources/
        ├── authority-confirmation.mjs
        ├── deduplicate.mjs
        ├── rendered-adapter-utils.mjs
        └── <source adapters>.mjs

activity-scenes/
├── landmark-event-search.js
├── events/event-discovery-model.js
└── esplanade-performance.js

style.css

tests/
├── event-source-contract.test.mjs
├── event-authority-confirmation.test.mjs
├── event-deduplication.test.mjs
├── event-reconciliation.test.mjs
├── event-pipeline.test.mjs
├── event-publication.test.mjs
├── event-map-reconciliation.test.mjs
├── event-discovery-model.test.mjs
├── event-discovery.spec.mjs
├── event-pipeline-staged.spec.mjs
└── event-ui.spec.mjs
```

**Structure Decision**: Extend the existing universal fixture, normalizer, venue branches,
dedup finalizer, reconciler, snapshot writer, admin review, discovery model, and search UI.
Add a small pure policy module only if extracting the expanded shared inclusion/schedule/
location rules keeps modified modules within the constitution's simplicity guidance.

## Complexity Tracking

No constitution violations or exceptions.

## Implementation Strategy

1. Version the normalized event and snapshot contracts for schedule, evidence, public
   placement, mapping status, lifecycle, freshness, availability, session, and
   venue-occurrence states; retain deterministic migration from the approved snapshot.
2. Replace the global weekly eligibility cutoff with lifecycle eligibility: retain active and
   future records, represent anytime without fake dates, bound recurrence materialization,
   and archive only after the final known occurrence.
3. Define ordinary standard-attraction admission behaviorally as continuously available
   general entry during normal operations without a distinct named, special, seasonal, or
   facilitated programme. Remove source keyword exclusions that reject valid selectable,
   anytime, waitlist, member-only, guide, or editorial activities; retain their metadata.
4. Upgrade editorial adapters from non-publishing pilots to trusted editorial evidence.
   Reuse compatible direct records first, then evaluate explicit editorial sufficiency and
   preserve corroboration/evidence level.
5. Model parent activities separately from sessions and venue occurrences. Model public
   placement separately from mapping status: keep reliable Singapore activities off-map while
   exact-building review is pending, and hold only those lacking reliable Singapore scope or
   usable general location.
6. Keep exact OneMap building rules for mapped branches, including parent-building unit
   mapping and approved aliases. Do not let event confidence substitute for weak geography.
7. Extend deduplication to all new schedule, placement, and mapping states. Use stronger remaining evidence
   for anytime/off-map records, preserve siblings and historical anchors, and keep uncertain
   candidates distinct.
8. Reconcile each source and identity independently. Carry forward still-active approved
   contributions from incomplete sources with independent freshness metadata, allow compatible
   current contributions to update merged activities, hold only unsafe new identities, prune
   superseded review items, and assemble one complete staged snapshot.
9. Apply release-wide schema, accounting, identity, geometry, build, security, and browser
   gates before atomic activation; preserve the whole previous snapshot only when this
   assembled release is unsafe.
10. Project mapped and off-map events into the frontend contract. Add mapped,
    secret/location-TBA, and multiple-location views beside search, plus this-week,
    this-month, later, and anytime date filtering without duplicate result representations.
11. Update trace/report reason codes and operational documentation, then run focused tests,
    build, browser matrix, performance comparison, and `npm run verify` before any live run.

## Phase 0 Research Output

Resolved decisions and rejected alternatives are recorded in [research.md](research.md). No
planning clarification remains.

## Phase 1 Design Output

- Entities, invariants, and state transitions: [data-model.md](data-model.md)
- Source, evidence, normalization, location, deduplication, and publication contract:
  [contracts/rendered-event-source.md](contracts/rendered-event-source.md)
- End-to-end validation scenarios: [quickstart.md](quickstart.md)
