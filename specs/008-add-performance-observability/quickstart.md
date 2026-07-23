# Quickstart: Validate Performance Observability

## Runtime diagnostics

1. Start the existing local application.
2. Open `/?autoStart&performanceDiagnostics=1`.
3. Confirm the diagnostics panel shows startup, resources, responsiveness, frames, memory
   capability, and map workload with freshness and state.
4. Move the map and confirm motion measurements update.
5. Export a snapshot and confirm it follows
   [performance-snapshot.schema.json](contracts/performance-snapshot.schema.json), is below
   100 KiB, and contains no application content or location.
6. Remove the map and confirm the panel and diagnostic work stop.
7. Open the same page without `performanceDiagnostics=1` and confirm diagnostics do not load.

## Automated validation

```sh
node --test tests/performance-observability.test.mjs tests/performance-budgets.test.mjs tests/no-telemetry.test.mjs
playwright test -c playwright.config.mjs tests/performance-observability.spec.mjs --project chromium-desktop
npm run lint
npm run build
npm run benchmark:release
```

Expected outcomes:

- Unit and browser tests pass.
- The build succeeds.
- The benchmark writes schema-versioned JSON and Markdown reports.
- Every declared profile/metric receives a passed, exceeded, or unsupported evaluation.
- Release mode exits unsuccessfully on an enforced error-level breach while preserving the
  completed report.

## Interpretation

The checked-in limits are red-line regression guardrails, not performance goals. A passing
report means the build did not become dramatically worse than the current application; it
does not mean the current application is lightweight.
