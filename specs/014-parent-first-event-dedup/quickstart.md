# Quickstart: Parent-First Event Deduplication

## 1. Run focused tests

```bash
node --test \
  tests/event-activity-projection.test.mjs \
  tests/event-deduplication.test.mjs \
  tests/approved-snapshot.test.mjs
```

Expected:

- broad ranges group with their dated sessions;
- ISO and source-human Singapore dates compare equally;
- same-product Fever surfaces group;
- generic titles remain separate;
- venue conflicts create review evidence;
- snapshot failure leaves the pointer unchanged.

## 2. Stage the current-data repair

```bash
npm run event-snapshot:migrate-activities -- --repair-parent-dedup
```

Expected:

- no source adapter or network request runs;
- a new immutable snapshot is staged;
- the command reports before and after activity counts;
- `data/approved-snapshot.json` remains unchanged.

## 3. Inspect the staged audit

Confirm:

- every occurrence, session, venue group, and offer reconciles;
- the known Catch.sg/SISTIC and Fever duplicate fixtures consolidate;
- unresolved venue conflicts appear in grouping reviews;
- `General Admissions` at different museums remains separate.

## 4. Activate the verified repair

```bash
npm run event-snapshot:migrate-activities -- --repair-parent-dedup --activate
```

Expected:

- the pointer changes atomically to the staged snapshot;
- the prior snapshot remains available;
- repeating the command reports no semantic change or reuses identical staged content.

## Verification record — 26 Jul 2026

- Focused projection, deduplication, and snapshot tests: **37 passed**.
- Event-pipeline regression tests: **99 passed**.
- Targeted ESLint: **passed**.
- Production build: **passed**.
- Active snapshot changed atomically from
  `20260722T174727255Z-source-retirement-activities-v1` to
  `20260722T174727255Z-source-retirement-activities-v1-parent-dedup-v1-parent-dedup-v4`.
- Approved activity cards: **748 → 606** (**142 duplicates consolidated**).
- Sessions: **11,302 → 11,195** while retaining source occurrence evidence and
  offers.
- Parent candidates: **146**; accepted merge edges: **145**; venue-conflict
  reviews: **1**.
- The only repeated normalized titles left are intentionally distinct:
  `General Admissions` at two museums and `Bhaskareeyam 2026` at conflicting
  approved venues.
- A repeated repair command returned
  `parent_dedup_repair_already_active` without creating another snapshot.
