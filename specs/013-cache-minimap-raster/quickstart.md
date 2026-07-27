# Quickstart: Cache Minimap Raster

## Correctness

1. Run:

   `node --test tests/event-discovery-model.test.mjs tests/event-density-minimap.test.mjs tests/map-performance-diagnostics.test.mjs`

2. Run:

   `npx playwright test tests/event-discovery.spec.mjs --project=chromium-desktop`

3. Run the cache-reuse and visual-equivalence checks across the required desktop/mobile
   browser projects.

Results:

- 20 focused unit/diagnostic checks passed.
- All 9 event-discovery Chromium scenarios passed.
- Cache behavior passed in Chromium, WebKit, and Firefox desktop/mobile.
- Visual equivalence passed the strict cross-browser perceptual bounds.

4. Verify movement increases composite count but not static build count.
5. Verify one filter change increases static build count exactly once and updates activity
   count.

## Performance

Run three headed trials each for cached and diagnostic legacy rendering with the same
route, viewport, and snapshot. Compare movement-time render duration, static builds,
FPS, worst frame, and long-task time.

Two counterbalanced three-trial runs completed. See
[performance-results.md](performance-results.md).

## Gates

- Focused unit and browser tests
- Required targeted cross-browser matrix
- ESLint
- Production build
- No Issue 1 or 3 behavior change

All gates passed. Build output contains only existing dependency and chunk-size warnings.
