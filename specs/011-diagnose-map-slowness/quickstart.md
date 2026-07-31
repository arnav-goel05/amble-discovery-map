# Quickstart: Diagnose Map Slowness

## Prerequisites

- Work on `develop`.
- Preserve unrelated working-tree changes.
- Use the repository's existing Node and Playwright installation.
- Run diagnostics in a foreground desktop session without interacting with the window.

## Validate instrumentation

```bash
node --test tests/map-performance-diagnostics.test.mjs
npx playwright test -c playwright.config.mjs tests/map-performance-diagnostics.spec.mjs --project chromium-desktop
npx eslint activity-scenes/performance-diagnostic-variants.js map-layers/building-highlight-layers.js scripts/diagnose-map-performance.mjs scripts/inspect-3d-tile-assets.mjs scripts/lib/map-performance-diagnostics.mjs tests/map-performance-diagnostics.test.mjs tests/map-performance-diagnostics.spec.mjs
```

Expected: variant validation, cleanup, invalid-trial classification, aggregation, schema,
and focused browser execution pass.

## Run the isolation matrix

```bash
npm run diagnose:map-performance
```

Expected: an ignored timestamped directory contains the versioned raw report, compatible
single-variable comparisons, trace summary, selected asset list, and a readable summary.
Every variant has at least three valid trials or an explicit invalid reason.

## Inspect implicated assets

```bash
npm run diagnose:map-assets -- --report outputs/map-performance-diagnostics/latest/report.json
```

Expected: only 3D resources observed in valid trials are parsed. Geometry, material,
texture, compression, encoded-size, and estimated decoded-size evidence is added without
modifying the source tiles.

## Audit gate

The investigation is complete only when:

1. startup/loading and network-idle motion have separate conclusions;
2. each confirmed cause has a controlled counterfactual;
3. a broad 3D-layer finding has been drilled into renderer/asset/lifecycle evidence;
4. residual unexplained frame time is quantified;
5. researched solution options cite authoritative sources; and
6. no optimization is implemented.
