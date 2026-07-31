# Quickstart: Review Questionable Event Dates

## Prerequisites

- Work on `develop`.
- Use existing local dependencies; no credential or network access is required.

## Focused validation

```bash
node --test tests/event-date-quality-audit.test.mjs
node --test tests/event-dashboard-sync.test.mjs
node --test tests/event-pipeline.test.mjs --test-name-pattern "date quality|date review"
npx eslint scripts/audit-event-dates.mjs scripts/event-normalizer.mjs scripts/event-pipeline.mjs scripts/lib/event-pipeline/date-quality-audit.mjs scripts/lib/event-pipeline/dashboard-sync.mjs scripts/lib/event-pipeline/reporting.mjs scripts/lib/event-sources/trace.mjs tests/event-date-quality-audit.test.mjs tests/event-dashboard-sync.test.mjs
```

Expected outcomes:

- Plausible events continue into accepted normalized events.
- Questionable events appear only in `normalized/date-reviews.json` with stable IDs and reasons.
- Source and run totals reconcile, and venue branches exclude date-review identities.
- Terminal trace and dashboard summaries expose held counts and exact reasons.

## Existing artifact audit

```bash
npm run event-date-audit -- --run 20260721T164446Z-20260722T000000+0800-20260729T235959+0800
```

This remains read-only. Do not run a complete network collection for this feature validation.

## Validation evidence — 2026-07-22

- Shared policy and dashboard tests: 11 passed, 0 failed.
- Focused date-review, trace, and status tests: 5 passed, 0 failed.
- Broader normalizer/normalization regression tests: 10 passed, 0 failed.
- Focused ESLint and `git diff --check`: passed.
- Latest completed artifact: 12,920 records assessed; 12,881 plausible and 39
  questionable under policy 1.0.
- Questionable breakdown: 3 implausibly long intervals, 3 missing dates, 28
  unparseable dates, 2 far-future dates, 1 known placeholder year, 1
  far-future waitlist placeholder, and 3 conflicting-start records. Reason counts
  overlap, so they exceed neither the identity total nor imply separate records.
- No source retrieval or complete pipeline run was performed.
