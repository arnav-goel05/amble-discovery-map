# Quickstart Validation: Expand Singapore Event Discovery

This guide defines implementation validation. Do not run the live event pipeline until the
fixture, build, browser, artifact, and full verification gates pass.

## Prerequisites

- Node.js 24+
- Checked-in definitions for all nine sources and approved free provider policy
- `TINYFISH_API_KEY` in the server environment only for the final bounded live verification
- Immutable fixtures under `tests/fixtures/event-sources/`
- Existing approved snapshot and venue evidence fixtures for migration/reconciliation tests

Never commit credentials, live captures, traces, checkpoints, caches, or routine reports.

## 1. Validate source and provider contracts

Run the adapter verifier and provider/source contract tests.

Expected:

- five direct and three editorial sources validate as enabled;
- Roots/HAN validates as unavailable/disabled with an explicit reason;
- editorial sources require versioned corroboration/sufficiency policy;
- paid, policy-mismatched, unsafe-destination, redirect, body-size, timeout, and credential
  failures occur before unsafe retrieval.

## 2. Validate shared inclusion and schedule policy

Use fixtures for active/future exact, ranged, recurring, selectable, anytime, unverified,
expired, pure-promotion, ordinary-attraction-admission, special-attraction-programme,
online-only, overseas, waitlist, and member-only records.

Expected:

- active/future and anytime activities remain eligible outside the current week;
- special/seasonal attraction programmes remain eligible while ordinary admission is
  excluded using the continuously-available-general-entry predicate rather than attraction
  title lists;
- waitlist/member restrictions become metadata, not automatic non-events;
- expired, pure-promotion, online-only, and overseas records terminate explicitly;
- no date is invented, and recurrence expansion remains finite.

## 3. Validate source-specific interpretation

Exercise Catch.sg, SISTIC, Fever, Visit Singapore, Singapore Film Society, Honeycombers,
ArtsEquator, and Time Out listing/detail/roundup fixtures.

Expected:

- specific detail evidence outranks selector, listing, and general document text;
- unrelated carousels and whole-page keywords cannot contaminate an activity;
- guides/roundups split reliably bounded entries;
- ticket categories and repeated cards collapse without losing metadata;
- all encountered records reconcile to one terminal outcome.

## 4. Validate editorial evidence

Cover direct corroboration, explicit official page, several editorial sources, one sufficient
editorial-only record, incomplete evidence, internal conflict, pure promotion, generic
homepage, directory/search/social-only evidence, and later direct-evidence upgrade.

Expected:

- compatible direct evidence is reused and editorial provenance is retained;
- a sufficient editorial-only activity publishes as `editorial_authoritative`;
- insufficient/conflicting evidence enters review or exclusion;
- generic/search/directory/social evidence cannot stand alone;
- evidence upgrades update the same activity identity.

## 5. Validate parent, session, and venue-occurrence identity

Cover one parent with selectable sessions, recurring schedules, multi-cinema screenings,
reliable and unreliable venue pairings, source membership changes, and sibling performances.

Expected:

- one parent owns distinct finite sessions and venue occurrences;
- reliable multi-location pairings split; unresolved pairing remains one off-map record;
- siblings remain distinct;
- changes update stable identities rather than creating replacements.

## 6. Validate placement, mapping status, and OneMap safety

Cover exact building, unit-in-parent-building, approved alias, mall/campus ambiguity,
address/postal conflict, coordinate conflict, secret venue, mobile route, broad outdoor area,
and missing geometry.

Expected:

- only one compatible OneMap building produces mapped placement with approved mapping;
- units map to parent buildings and remain display details;
- intentional non-building cases publish off-map with mapping not required;
- exact-building ambiguity with reliable Singapore scope/general location publishes off-map
  with pending mapping review;
- uncertainty about Singapore scope or any usable general location is held with no placement;
- no building is guessed and valid off-map activities remain eligible.

## 7. Validate deduplication

Exercise exact repeats and variants across all sources, direct/editorial overlaps, generic
titles, changed dates, different editions, venue aliases, anytime/off-map matches, and prior
cluster membership changes.

Expected:

- confirmed duplicates produce one published logical activity with full provenance;
- sessions, editions, organizers, and venue occurrences remain distinct;
- anytime/off-map merges require stronger remaining evidence;
- uncertain matches stay separate with non-blocking review;
- prior published anchors remain stable.

## 8. Validate isolated failure reconciliation

Use fixtures for one unavailable existing source, one unavailable first-run source, incomplete
source accounting, one malformed record with otherwise complete accounting, location review,
identity conflict, expired stale record, and superseded admin review.

Expected:

- still-active approved source contributions carry forward as stale for
  unavailable/incomplete sources, while compatible current contributions may still update the
  same merged activity;
- no unproven deletions or replacements are applied;
- first-run unavailable sources publish nothing;
- safe sources and identities continue;
- only affected unsafe records are held;
- expired records archive from last reliable schedule evidence;
- stale review items are superseded automatically.

## 9. Validate release-wide atomic safety

Exercise invalid schema, unbalanced accounting, identity inconsistency, missing mapped
geometry, security failure, build failure, browser failure, and activation failure.

Expected: every release-wide failure leaves the complete prior approved snapshot pointer and
contents unchanged. A valid assembled snapshot containing safe updates plus explicit stale
carry-forward activates atomically.

## 10. Validate trace, reporting, and redaction

Inspect JSON-lines trace and JSON/Markdown status for success, retry, resume, unavailable,
incomplete, carry-forward, review, archive, rollback, and successful activation fixtures.

Expected:

- every source record and downstream identity reaches a traceable terminal outcome;
- counts distinguish source contributions from unique activities;
- new/reused/retried/skipped/carried-forward work is visible;
- review categories and stale reasons are visible;
- no API key, authorization/cookie value, raw body, or secret query parameter appears.

## 11. Validate public discovery

Run discovery-model and browser fixtures for mapped, secret/location-TBA,
multiple-location, mobile/broad-area, anytime, future, stale, loading, empty, missing-data,
and error states.

Expected:

- one result represents each logical activity;
- mapped, Secret / Location TBA, and Multiple locations views are keyboard/touch accessible;
- this-week, this-month, later, and anytime filters do not mutate ingestion data;
- selecting mapped results navigates the map; selecting off-map results opens activity detail
  without a fake map target;
- current responsive layout and overlay behavior do not regress.

## 12. Run release gates

```sh
node --test tests/event-source-contract.test.mjs tests/event-authority-confirmation.test.mjs tests/event-deduplication.test.mjs tests/event-reconciliation.test.mjs tests/event-pipeline.test.mjs tests/event-publication.test.mjs tests/event-map-reconciliation.test.mjs tests/event-discovery-model.test.mjs
npm run build
npx playwright test tests/event-pipeline-staged.spec.mjs tests/event-discovery.spec.mjs tests/event-ui.spec.mjs --project=chromium-desktop --project=chromium-mobile --project=webkit-desktop --project=webkit-mobile --project=firefox-desktop --project=firefox-mobile
npm run benchmark:release
npm run verify
git status --short
```

Expected: all gates pass, performance-sensitive behavior has before/after evidence, runtime
artifacts remain ignored, and unrelated user files remain untouched.

### Verified release evidence (2026-07-18)

- Focused feature 002 Node matrix: 154/154 passed.
- Complete Node matrix: 444/444 passed.
- Production build, voice-action coverage, source-adapter validation, POI/background
  separation, approved-artifact policy, and production smoke checks passed.
- Browser matrices passed: event discovery 30/30, event UI 168/168, restaurant integration
  24/24, voice-only isolation 114/114, and the broader application matrix 276 passed with
  18 staged cases intentionally excluded from that invocation and covered by the dedicated
  staged matrix.
- Dedicated staged event-pipeline browser matrix: 18/18 passed.
- `npm run verify` completed successfully with exit code 0. The one-retry Playwright policy
  remains a bounded guard for browser-process/WebGL stalls; this successful run did not report
  a retried or flaky test.
- Release performance gates passed. The final full-verification baseline is
  `outputs/performance-baseline/2026-07-18T152242758Z`: desktop cold 3883.7 ms UI,
  desktop warm 2230.3 ms UI, wide-area cold 2767.8 ms UI, and map-context conversation cold
  1685.3 ms UI. The focused feature baseline at
  `outputs/performance-baseline/2026-07-18T092332127Z` also passed the area/context regression
  gates (desktop cold 938.2 ms, desktop warm 1159.2 ms, wide-area 2184.0 ms, context 993.5 ms).
- `git status --short` was inspected after verification. Runtime evidence remains under ignored
  `outputs/` paths, and concurrent feature 004 plus unrelated user changes were preserved.

## 13. Final bounded live verification

Only after Step 12 passes, run the complete event-pipeline command through every continuation
using the checked-in source definitions and server-side credential. Do not rediscover endpoints
or reuse old run artifacts.

Expected:

- every source and identity has a terminal accounted outcome;
- Roots/HAN remains reported unavailable;
- active/future and anytime records survive normalization;
- editorial-only evidence and off-map states appear as designed;
- duplicate, review, stale carry-forward, and archive counts reconcile;
- the assembled snapshot activates only after all release-wide gates pass.

### Bounded live-run evidence (2026-07-18)

- Run `20260718T130213Z-20260718T000000+0800-20260725T235959+0800` reached its terminal
  continuation with `complete: true`. Catch.sg was isolated after HTTP 469 and Roots/HAN was
  reported unavailable with `layout_contract_changed`; every other configured source reached a
  terminal outcome.
- Source accounting produced 359 accepted SISTIC occurrences, 88 Fever activities, 9 Singapore
  Film Society activities, 2 Honeycombers activities, and no accepted Visit Singapore,
  ArtsEquator, or Time Out activities. The run normalized 458 eligible activities, collapsed no
  cross-source duplicates, and retained 458 unique accepted activities. Evidence was 456 direct,
  1 direct-corroborated, and 1 editorial-authoritative activity.
- Venue and lifecycle accounting produced 137 approved venues, 28 pending reviews, 16 safely
  not-mappable outcomes, 381 mapped activities, 55 off-map activities, 49 expired activities,
  18 undated review activities, and 16 removed landmarks. No stale activities were introduced.
- The original staged-browser gate exposed that 11 selectable/undated landmarks were absent from
  pills and correctly prevented publication. The active snapshot remained `initial`; no failed
  candidate was written under `data/snapshots/` or activated.
- Regression coverage now retains selectable and unverified activities in pills, applies the
  ordinary-attraction policy to real admission/opening-date wording, and checks staged pill
  identities in one bounded batch. Replaying the saved live candidate passed all 3 staged-browser
  checks, including all 107 expected pills and the narrow viewport panel.
- Reproducible status and trace evidence remains in the ignored run directory under
  `outputs/event-pipeline/`; no runtime artifact was committed.

### Final convergence live-run evidence (2026-07-19 window)

- The final focused feature matrix passed 161/161 with serial test-file execution; this avoids
  shared temporary/public-asset races between the pipeline integration fixtures.
- The release performance benchmark passed with baseline
  `outputs/performance-baseline/2026-07-18T161053798Z` (desktop cold 929.1 ms, desktop warm
  504.2 ms, wide-area 987.9 ms, and map-context conversation 2630.8 ms).
- Fresh run `20260718T162339Z-20260719T000000+0800-20260726T235959+0800` completed and
  published atomically with `complete: true`; the candidate and active snapshot IDs both match
  the run ID. Its extraction, POI separation, production build, 28 event-UI tests, and 3 staged
  browser tests all passed.
- SISTIC accepted 345 activities, Fever 70, Singapore Film Society 9, and Honeycombers 1.
  Visit Singapore, ArtsEquator, and Time Out accepted none in this capture. Catch.sg was safely
  isolated after HTTP 469, while Roots/HAN remained explicitly disabled/unavailable.
- The run accepted 425 unique activities, with 424 direct and 1 editorial-authoritative evidence
  outcome. No cross-source duplicate was collapsed and no blocking deduplication review remained.
- Venue accounting completed for all 159 branches: 121 approved, 16 safely not mappable, and 22
  held for venue review. Reconciliation archived 51 expired activities, preserved 18 undated
  review activities, removed 18 empty managed landmarks, and superseded 8 stale admin reviews.
- Final runtime evidence is in
  `outputs/event-pipeline/20260718T162339Z-20260719T000000+0800-20260726T235959+0800/`, and the
  immutable published snapshot is in the matching `data/snapshots/` directory.
- The feature gates and live publication gates pass. Repository-wide `npm run verify` is currently
  blocked only by the concurrently edited transit-location behavior: the explicit transit action
  does not set `document.body.dataset.transitConstraintActive`. This is outside feature 002 and
  leaves T156 open until the shared `develop` tree is green.

## Reason-code examples

- Inclusion: `ordinary_attraction_admission`, `pure_promotion`, `online_only`, `outside_sg`,
  `expired`
- Schedule: `anytime`, `schedule_unverified`
- Editorial evidence: `direct_corroborated`, `editorial_sufficient`,
  `editorial_evidence_incomplete`, `evidence_conflict`
- Location: `secret_tba`, `multiple_locations`, `mobile_route`, `broad_area`,
  `geometry_unavailable`, `location_conflict`
- Deduplication: `repeat`, `merged`, `distinct`, `possible_duplicate_review`,
  `identity_conflict_review`
- Reconciliation: `carry_forward_stale`, `hold_new`, `release_validation_failed`

To audit a run, follow trace correlation IDs and artifact references rather than raw content.
A missing terminal trace, unexplained count difference, or invalid assembled snapshot is a
release-wide blocker; an explicitly isolated source/event/location outcome is not.

## 14. Focused multi-surface hardening validation

```bash
node --test tests/event-deduplication.test.mjs tests/event-source-contract.test.mjs tests/event-pipeline.test.mjs
```

Expected: compact Time Out ranges are retained; cross-surface repeats collapse without merging
siblings; exact listing overlap is reported; a failed surface blocks the source with per-surface
diagnostics; HTTP 469 is a non-retried provider-policy blocker; and Roots/HAN performs no fetch.
This focused check does not satisfy the separate live-run task.
