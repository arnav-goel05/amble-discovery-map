# Quickstart: Verify Source Retirement

1. Confirm the active branch is `develop` and historical snapshots/specs are unchanged.
2. Run focused source, reconciliation, pipeline, and dashboard tests.
3. Build the application and Sites dashboard.
4. Dry-run, then apply `npm run event-sources:retire -- --source Honeycombers --source ArtsEquator --apply`; this reads only the approved snapshot and performs no source collection.
5. Verify the new immutable active snapshot has no Honeycombers or ArtsEquator in source health, event catalogue, landmark events, or dashboard payload.
6. Verify supported-source counts reconcile and unrelated current/future events remain.
7. Publish the existing Sites project and verify the public dashboard shows only the remaining sources.

Expected evidence:

- Focused and full relevant tests pass.
- Production builds pass.
- Offline snapshot activation is complete and atomic, with original freshness retained.
- Retirement traces account for removed current identities.
- Current generated artifacts and public dashboard contain zero retired-source rows or contributions.
- Files under `data/snapshots/` and completed earlier spec directories are unchanged.
