# Source Adapter Intervention Reference

Executable definitions live in `data/event-pipeline-config.json`, and request, pagination, capture, mapping, and accounting behavior lives in `scripts/event-source-collector.mjs`. This document explains the official contracts for diagnosing a structured `provider_contract_changed` intervention; it is not an instruction to collect records manually.

Use the documented official JSON APIs below. Do not crawl provider pages or rediscover endpoints from frontend bundles. Treat a changed response contract as an adapter failure; never substitute an unofficial site.

## Shared rules

- Method: adapter-specific
- Authentication: none
- Date parameters: do not use the weekly run window as an ingestion cutoff. Collect every active/future record exposed by the bounded source surface; the run window is an expiry/reconciliation boundary.
- Pagination ceiling: 50 listing pages or the source's explicit final page, whichever comes first
- Stop early only when the official listing is demonstrably chronological and every remaining item starts after the window
- Call the official detail API for each unique listing identifier
- Store untouched listing responses at `raw/<source>/listings/page-<four-digit-n>.json`
- Store untouched detail responses and parsed fixtures at `raw/<source>/details/<sha256-of-canonical-detail-url>.response.json` and `.json`
- Preserve exact, ranged, recurring, selectable, anytime, and unverified schedules without inventing dates. Unverified records are held; intentional anytime records remain eligible.
- Exclude expired, pure-promotion, online-only, overseas, and ordinary continuously available general admission. Waitlists, member restrictions, guides, evergreen containers, and future dates are metadata/context rather than automatic exclusions.
- Derive `occurrencesEmitted`, `excludedOccurrences`, and `eligiblePreDedup` from every bounded entry/performance and record a terminal reason for each input.

For each listing page, store the untouched API response and collect its detail identifier. Call each unique official detail API once, store the untouched response, and extract labeled values into this fixture before canonical normalization. Store the fixture as `records[0]` inside the universal JSON artifact envelope:

```json
{
  "adapterVersion": "",
  "listingPage": 1,
  "detailUrl": "",
  "sourceId": "",
  "title": "",
  "mode": "physical | online | hybrid | unknown",
  "dateText": null,
  "timeText": null,
  "venue": null,
  "address": null,
  "sourceCoordinates": null,
  "category": null,
  "price": null,
  "description": null,
  "organizer": null,
  "performances": []
}
```

Each `performances[]` item contains `{ "startDateTime", "endDateTime", "dateText", "timeText" }`. Missing optional fields remain null and are tracked in provenance. Mark a record invalid only when a required identity or title contract fails; do not invent values.

Map an explicit source label `Online` to `mode: online`, `Hybrid` to `hybrid`, and an explicit physical venue/mode to `physical`. Use `unknown` otherwise. Canonical `isOnline` is true only for `online`; hybrid or unknown records enter the map workflow only when a physical venue is present and later approved.

## Rendered-page and discovery adapters

The configured rendered-page adapters are Fever, Visit Singapore, Singapore Film Society, Roots/HAN, Honeycombers, ArtsEquator, and Time Out Singapore. Fever, Visit Singapore, and Singapore Film Society are enabled direct sources. Roots/HAN is explicitly unavailable/disabled until its layout contract is repaired. Honeycombers, ArtsEquator, and Time Out are enabled trusted editorial sources.

Rendered retrieval uses the shared TinyFish transport with public HTTPS destinations only, bounded pages and response sizes, a maximum batch of 10, retry/backoff (including transient per-URL failures), and a rate below 150 URLs per minute. Checked-in source definitions may select `markdown`, `html`, or `json`, force bounded cache freshness, and scope extraction with reviewed CSS selectors. Store canonical listing/detail captures and parser fixtures in the current run. Reuse a canonical URL capture within that run so discovery-first and direct-first processing produce the same authority evidence. Never log credentials or full response bodies.

Editorial assessment first reuses already collected compatible direct evidence, then attempts a bounded organizer/venue/ticketing/official-program link from `data/event-authority-registry.json`. Direct agreement yields `direct_corroborated`; conflicts or ambiguous sibling mapping enter scoped review. If no usable direct record remains after the attempt, a trusted editorial record may publish as `editorial_authoritative` only when it identifies one current Singapore activity, has a usable schedule or intentional anytime state, and has mapped or off-map placement evidence. Generic/search/directory/social evidence never supplies those claims by itself. Preserve the editorial contribution and any later direct upgrade under the same published identity.

Source-specific scope rules are executable in `scripts/lib/event-sources/`: Fever retains selectable/anytime/waitlist activities and behaviorally excludes only ordinary attraction admission; Visit Singapore freshly scopes TinyFish to `stb-event-and-festivals`, emits every embedded `cardmultifield` item as a stable listing-native record, and splits guide headings only when each entry has both schedule and venue evidence; Singapore Film Society preserves screenings and access restrictions; Roots/HAN reports unavailable; Honeycombers and Time Out retain valid roundup/evergreen entries while rejecting pure promotion; ArtsEquator retains attendable programmes and rejects standalone non-attendable opportunities.

Time Out uses one bounded multi-surface listing contract: the weekly hotlist, weekend roundup, art-exhibition roundup, annual concert roundup, and the current monthly roundup discovered from the `THIS MONTH` homepage planner link. Extract only the complete numbered section configured for each roundup and stop at its next section heading. Missing headings, ordinal gaps, a missing/ambiguous current-month route, an unapproved route, or traversal beyond the shared ceiling makes the source incomplete instead of silently accepting partial coverage. Collapse identical canonical detail URLs across all Time Out surfaces before fetching details; retain the first bounded listing evidence and let normal all-source deduplication handle semantically equivalent events exposed under different URLs.

## `catch-official-listing-v1`

- Source: Catch.sg
- Listing page: `https://www.catch.sg/Event`
- Listing API: `POST https://www.catch.sg/api/events/SearchListEvent`
- Content type: `application/x-www-form-urlencoded`
- Body keys: `filter[pageIndex]`, `filter[PageSize]`, `filter[EventDate]`, and `pathUrl`
- Window encoding: `filter[EventDate]=DD/MM/YYYY-DD/MM/YYYY`; use the inclusive manifest dates
- Page size: `100`
- Response paths: records `/data/Items`, provider total `/data/ItemTotal`, page total `/data/PageTotal`
- Listing mapping: event-card title, displayed date/date range, venue, category/mode, price when present, and event-detail link
- Detail mapping: title, event period/specific dates and times, physical/online mode, venue/address, category, price, description, organizer/presenter when shown, and canonical event URL
- Detail bootstrap: `GET` the canonical detail URL and read `event-detail-page-id` from `#event-detail-page`; the static shell contains this attribute, so do not wait for hydration
- Detail API: `POST https://www.catch.sg/api/site/GetEventDetail` as form data with `pathUrl`, `eventPageID`, `articlePageSize=6`, `photosPageSize=8`, `isPhotosPaginated=false`, `articlePageIndex=1`, and `photosPageIndex=1`
- Detail response: use `/data`; a successful record has non-empty `/data/ID` and `/data/DisplayEventTitle`
- Pagination: request page indexes `1..PageTotal`; deduplicate repeated canonical detail URLs before detail capture
- Stable source ID: final event-detail URL path; block the record when absent

## `sistic-official-listing-v1`

- Source: SISTIC
- Listing page: `https://www.sistic.com.sg/events`
- Listing API: `GET https://cms.sistic.com.sg/sistic/docroot/api/events`
- Query keys: `first`, `limit`, `sort_type=date`, `sort_order=ASC`, `index=global`, and `client=1`; use zero-based `first` and the provider-supported page limit
- Response paths: records `/data`, provider total `/total_records`
- Listing mapping: event title, displayed run dates, venue/category when present, price when present, and event-detail link
- Canonical public detail URL: `https://www.sistic.com.sg/event-details/<alias>`
- Detail API: `GET https://cms.sistic.com.sg/sistic/docroot/api/event-detail?client=1&code=<alias>`
- Detail response: the root object contains the canonical fields; use `title`, `start_date`, `end_date`, `event_date`, `venue_name.name`, `venue_name.latitude`, `venue_name.longitude`, `description`/`synopsis`, price fields, and any schedule/performance fields present
- Preserve valid `venue_name.latitude` and `venue_name.longitude` as `sourceCoordinates`. They are official lookup evidence, not yet approved canonical coordinates; canonical events keep `coordinates: null` until OneMap resolution succeeds.
- Detail mapping: title, performance dates/times, venue/address, category, price, synopsis/description, promoter/organizer when shown, and canonical event URL
- Pagination: use the official listing's visible pagination or load-more control; deduplicate repeated detail URLs
- Stable source ID: listing `alias`; block the record when absent

## Adapter failure

Mark one record `invalid` with a stable reason code when its required title, stable identity, or detail URL is missing. Preserve unavailable optional mode/date/detail fields as null or review state. Mark the entire source `blocked` only when listing access, systematic layout change, authentication/CAPTCHA, or incomplete pagination prevents accounting for the source as a whole. Every record-level failure enters `invalid.json` and the reconciliation equation.

When a listing row has no detail URL, keep its pointer to the untouched raw listing JSON (for example `raw/catch/listings/page-0002.json#/data/Items/55`) in `sourceRecordRefs` and `invalidSourceRecordRefs`. Do not invent a URL, source ID, or detail fixture. Only processed records require detail-fixture pointers.

Record `blocked` for that source and name the exact missing selector/semantic field when:

- The official endpoint is unavailable or requires authentication/CAPTCHA.
- Listing pagination cannot be completed within the ceiling.
- Event-detail links or required title/date evidence cannot be extracted reliably.
- The official layout no longer exposes the documented semantic mapping.
