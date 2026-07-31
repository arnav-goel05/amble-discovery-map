# Quickstart Validation: Group Event Activities

## Prerequisites

- Use the `develop` branch.
- Use the stored completed run `20260721T164446Z-20260722T000000+0800-20260729T235959+0800`.
- Do not run source collection.

## Focused validation

1. Run activity-projection, discovery-model, dashboard-sync, publication, and event-UI tests.
2. Reproject the stored run with `npm run event-activity-project -- --run 20260721T164446Z-20260722T000000+0800-20260729T235959+0800`.
3. Confirm the projection reports distinct activities and occurrences, exact reconciliation, zero external requests, and completion under 10 seconds.
4. Run the main application production build.
5. Build and test the Sites dashboard, then publish it through the existing Sites project.

## Expected outcomes

- Repeated Catch.sg occurrences share one activity identity.
- Exact session identities remain available beneath activities.
- Multi-venue activities expose venue groups.
- Source offers are deduplicated and labelled.
- Dashboard metrics no longer label occurrence records as unique activities.
- No source collection artifact or approved production snapshot is replaced during focused reprojection.

## Recorded result — 22 July 2026

- Stored inputs: 12,920 occurrence records.
- Safe projection: 12,916 sessions in 781 activities and 781 venue groups.
- Provenance: 816 source offers.
- Isolated uncertainty: 2 grouping reviews covering four contradictory input rows.
- Performance: 940.5 ms on the development machine; zero external requests.
- Repeat projection: 15,294 safe entity decisions were `no-op`, with 2 reviews and no creates, updates, or expirations.
- Safety: `data/approved-snapshot.json` and the normalized occurrence input retained their original SHA-256 hashes.
- Verification: focused Node suites, affected pipeline tests, desktop/mobile Chromium, WebKit and Firefox interaction tests, ESLint, the main production build, and the Sites test/build suite passed.
