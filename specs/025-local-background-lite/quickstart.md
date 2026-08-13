# Quickstart: Local Background-Lite Migration

This guide describes the planned validation flow. No command may deploy, upload, commit, push, or release.

## 1. Verify the current state

```bash
git branch --show-current
df -h .
npm run background-lite:local -- preflight \
  --output /absolute/path/to/local-background-lite
```

Expected: branch `develop`; `tiles/` is valid; all source tiles and active highlights are accounted for; exact deletion candidates and capacity estimates are reported; no deletion occurs.

## 2. Reclaim derived-background space

Review the preflight JSON, then run the exact command it emits after confirming its resolved target is:

```text
/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/optimized-tiles
```

Expected: only that directory is deleted, `tiles/` remains unchanged, actual reclaimed bytes are recorded, and the local app becomes intentionally unavailable. This step is destructive and must not be run from a stale preflight.

## 3. Prove batching on a fixture

```bash
npm run background-lite:local -- build \
  --output /absolute/path/to/local-background-lite \
  --batch-size 20 \
  --concurrency 2 \
  --reserve-bytes 1073741824
```

Interrupt after a checkpoint, repeat the command, and confirm verified tiles are reused. Also test a deliberately insufficient reserve and a corrupt checkpoint.

## 4. Build the local corpus and overlays

```bash
npm run background-lite:local -- build \
  --output /absolute/path/to/local-background-lite
npm run background-lite:local -- overlays \
  --output /absolute/path/to/local-background-lite
```

Expected: complete terminal accounting; exact geometry/identity preservation; current active highlight identity parity; no background hash changes when only the highlight fixture changes.

## 5. Validate and switch locally

```bash
npm run background-lite:local -- validate \
  --output /absolute/path/to/local-background-lite
npm run background-lite:local -- switch-local \
  --output /absolute/path/to/local-background-lite \
  --manifest /absolute/path/to/local-background-lite/switch-manifest.json
npm run background-lite:local -- rollback-local \
  --output /absolute/path/to/local-background-lite
```

Expected: automated browser evidence passes across the supported desktop/mobile matrix; background is 30%, overlays are 100%; manifest loading, exact-once identities, depth preference, and missing/incomplete states pass; combined payload reduction is at least 40%. Optional visual/performance diagnostics are advisory.

## 6. Automated gates

```bash
node --test \
  tests/background-lite-b3dm.test.mjs \
  tests/background-lite-run.test.mjs \
  tests/highlight-overlay-build.test.mjs \
  tests/highlight-overlay-reconcile.test.mjs \
  tests/local-asset-migration.test.mjs \
  tests/building-highlight-movement.test.mjs

playwright test -c playwright.config.mjs tests/background-lite-local.spec.mjs \
  --project chromium-desktop --project chromium-mobile \
  --project webkit-desktop --project webkit-mobile \
  --project firefox-desktop --project firefox-mobile

npm run lint
npm run format:check
npm run build
git diff --check
```

## 7. Retire legacy highlights separately

Do not delete `public/poi-tiles/` during the first reclaim. After the local switch passes overlay identity, provenance, automated renderer contracts, payload, and rollback gates, perform a new preflight and explicit confirmation for that exact directory.

## Expected final status

- `tiles/` preserved as original source.
- Stable complete lightweight background generated locally.
- Active full-quality overlay catalogue generated automatically.
- Local renderer uses the new asset manifest.
- Legacy POI assets removed only after parity confirmation.
- No remote or production action and no Git publication.

## Recovery states

- `blocked-by-capacity`: no unsafe batch was started; free space and repeat the same build command.
- `failed-validation`: inspect `final/report.json`; switching and legacy cleanup remain blocked.
- `intentionally-unavailable`: the old background was explicitly reclaimed, but a complete replacement is not active yet.
- `active-local`: the immutable candidate manifest was activated and has a hash-bound rollback reference.
- `rolled-back`: the prior local manifest was restored atomically.

Historical snapshot batch numbers are not authoritative by themselves. Overlay evidence
must resolve to current original geometry by exact GML identity, or by a unique approved
name that agrees across LOD siblings; unresolved mappings remain `review` and block parity.
