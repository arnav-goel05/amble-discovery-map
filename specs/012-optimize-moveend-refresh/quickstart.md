# Quickstart: Optimize Map-Move Event Refresh

## Automated correctness

1. Run:

   `node --test tests/map-performance-diagnostics.test.mjs tests/event-discovery-model.test.mjs tests/event-density-minimap.test.mjs`

2. Run:

   `npx playwright test tests/event-discovery.spec.mjs --project=chromium-desktop`

3. Run the required targeted browser matrix:

   `PLAYWRIGHT_FULL_MATRIX=1 npx playwright test tests/event-discovery.spec.mjs --grep "map movement reuses discovery"`

4. Confirmed outcomes:

   - 20 focused unit checks passed.
   - All 8 event-discovery Chromium scenarios passed.
   - The new regression passed in all 6 required desktop/mobile browser projects.

5. Confirm map movement increments the move-end refresh counter without incrementing the
   discovery-filter counter.
6. Change a search filter and confirm the discovery-filter counter increments and the
   displayed result set changes.

## Controlled timing comparison

1. Build the production application.
2. Run the existing headed performance diagnostic for both the legacy full-refresh mode
   and production viewport-only mode using the same route, viewport, snapshot, and trial
   count.
3. Compare median move-end refresh duration, FPS, p95/worst frame time, and long tasks.
4. Confirm the optimized median refresh duration improves by at least 80%.

Executed:

`npm run diagnose:map-performance -- --headed --runs 3 --variants primed-viewport-moveend-refresh,legacy-full-moveend-refresh --output outputs/map-performance-diagnostics/issue-1-moveend-refresh-primed`

See [performance-results.md](performance-results.md).

## Release gates

- Focused unit tests pass.
- Focused Playwright behavior passes in Chromium.
- Required browser regression matrix remains green.
- Lint passes.
- Production build passes.
- No files related to minimap rendering or 3D quality are modified for this feature.

All gates passed. The production build emitted only existing dependency/chunk-size
warnings.
