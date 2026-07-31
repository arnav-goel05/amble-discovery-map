# Quickstart: Spatial Highlight Tiles

## Generate

```bash
npm run build:poi-tileset
```

Expected output reports `spatial-highlight-v1`, exact venue/finest-fragment/source-fragment/branch counts, zero external tilesets, and `create`, `update`, or `noop`.

## Focused validation

```bash
node --test tests/spatial-highlight-tileset.test.mjs tests/combined-poi-tileset.test.mjs tests/building-highlight-movement.test.mjs
npm run test:poi-separation
```

## Browser and build gates

```bash
playwright test -c playwright.config.mjs tests/map-render-sync.spec.mjs \
  --project chromium-desktop --project chromium-mobile \
  --project webkit-desktop --project webkit-mobile \
  --project firefox-desktop --project firefox-mobile
npm run lint
npm run format:check
npm run build
```

## Benchmark

Run the same representative introduction/settled-camera path against the saved legacy fixture and the generated spatial hierarchy. Record manifest requests, content requests before first highlight, first-highlight time, and detailed-state time in `benchmark.md`.

## Safety

- Do not run the event pipeline for this feature.
- Do not regenerate venue geometry.
- Do not edit the active approved snapshot pointer.
- If generation fails, verify the served combined tileset is unchanged.

## Final Evidence (2026-07-29)

- Spatial output: 136 venues, 143 finest direct fragments selected from 818 validated source fragments, 143 venue branches, 314 spatial nodes, and 0 external venue manifests.
- Visible branches request only their finest available B3DM; coarse highlight levels remain unreferenced.
- Transfer: 125,372 raw bytes / 18,938 gzip bytes, down 72.7% from the legacy combined catalogue plus venue manifests.
- Marina Bay zoom-18 check: 64 finest requests, 0 coarse requests, 0 venue-manifest requests, and 0 tile errors.
- Geometry separation: passed for all 136 approved POIs across 818 tiles.
- Focused Node tests: 12 passed.
- Browser matrix: 60 passed across desktop/mobile Chromium, WebKit, and Firefox.
- Lint, scoped changed-file formatting, and production build: passed.
- Spec Kit convergence: clean with zero findings.
