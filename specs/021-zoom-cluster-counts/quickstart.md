# Quickstart: Validate Zoom-Aware Event Cluster Counts

## Prerequisites

- Node.js 24 or newer
- Installed repository dependencies
- Worktree on `develop`

## 1. Establish performance evidence

Before implementation, run one bounded frontend benchmark and retain its ignored output:

```bash
npm run benchmark:frontend -- --runs 1 --settle-ms 1000 --motion-ms 500 --output outputs/performance-baseline/zoom-clusters-before
```

After implementation, repeat with:

```bash
npm run benchmark:frontend -- --runs 1 --settle-ms 1000 --motion-ms 500 --output outputs/performance-baseline/zoom-clusters-after
```

Compare the reports for regressions in map movement, long tasks, DOM size, and idle work.

## 2. Run focused deterministic tests

```bash
node --test tests/event-location-clusters.test.mjs
```

Expected: grouping preserves every eligible stable identity exactly once, produces correct
counts, splits with greater projected separation, and handles empty/boundary inputs.

## 3. Run focused browser behavior

```bash
npx playwright test -c playwright.config.mjs tests/event-ui.spec.mjs --project chromium-desktop --grep "cluster"
```

Expected:

- counts appear below the pill threshold;
- counts and ordinary pills are mutually exclusive;
- zoom and filters recompute exact totals;
- a count activation increases detail;
- keyboard activation matches pointer behavior;
- empty and destroyed layers leave no stale controls;
- no idle position/cluster pass occurs.

## 4. Run regression gates

```bash
npm run lint
npm run build
```

Then run the existing event UI suite in the browser matrix required by the release workflow:

```bash
npx playwright test -c playwright.config.mjs tests/event-ui.spec.mjs
```

## 5. Manual interaction check

Start the app, zoom out below the existing pill level, and verify:

1. compact counts identify event-containing areas without obscuring map controls;
2. counts split as the map zooms in;
3. selecting a count visibly moves toward its locations;
4. full event pills replace counts at the established detail level;
5. search and category filters update counts immediately;
6. touch targets and keyboard focus remain usable on desktop and mobile widths.

## Validation Record

Completed on 2026-07-30:

- Pure grouping suite: 6/6 passed.
- Focused cluster/idle/real-map journeys: passed across desktop and mobile Chromium,
  WebKit, and Firefox.
- Complete Chromium desktop event UI suite: 38/38 passed.
- ESLint: passed for the full configured repository scope.
- Targeted Prettier check: passed for all feature code, tests, styles, and documents. The
  repository wrapper could not run locally because `CI_BASE_SHA` is a required CI-only
  input.
- Production build: passed. Existing third-party direct-eval and bundle-size warnings
  remain unchanged release observations.

The paired one-run benchmark was intentionally bounded and showed high load/network
variance: desktop cold UI-ready time changed from 8149 ms to 9417 ms, desktop warm from
967 ms to 5402 ms, wide-area cold from 13935 ms to 6987 ms, and map-context cold from
8565 ms to 4482 ms. This sample is not statistically sufficient to attribute the mixed
movement to clustering. The deterministic idle assertion is stable: zero idle cluster,
pill, or direction passes, and three coalesced move/zoom events produce one position pass.
