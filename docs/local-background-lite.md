# Local background-lite migration

This workflow keeps `tiles/` as the original source and locally generates:

- one stable colour-preserving lightweight background for every building;
- one automatically reconciled full-quality overlay catalogue for active highlights.

It is intentionally unable to upload, deploy, publish, commit, push, or release.

## Safety order

1. Run `npm run background-lite:local -- preflight --output <absolute-path>`.
2. Review source validation, exact deletion target, capacity, and confirmation token.
3. Reclaim only the exact `optimized-tiles/` target using the fresh emitted token.
4. Build and resume the lightweight background from `tiles/`.
5. Build current highlight overlays from approved source identities.
6. Validate and switch the local renderer.
7. Retire legacy `public/poi-tiles/` only through a later, separate confirmation.

Temporary local map breakage after step 3 is an expected `intentionally-unavailable`
state. `tiles/` is never a valid deletion target.

## Commands and recovery

Use absolute paths for generated output and destructive targets:

```bash
npm run background-lite:local -- preflight --output /absolute/output
npm run background-lite:local -- build --output /absolute/output \
  --batch-size 20 --concurrency 2 --reserve-bytes 1073741824
npm run background-lite:local -- overlays --output /absolute/output
npm run background-lite:browser
npm run background-lite:local -- validate --output /absolute/output
npm run background-lite:local -- switch-local --output /absolute/output \
  --manifest /absolute/output/switch-manifest.json
npm run background-lite:local -- rollback-local --output /absolute/output
```

`build` resumes only hash-verified work. `blocked-by-capacity` leaves completed
checkpoints reusable; free space and repeat the same command. A changed source,
policy, checkpoint, or output hash is rejected or regenerated rather than trusted.
`validate` remains `failed-validation` until background, overlay, payload, automated
browser, and rollback gates all pass. Visual and repeated runtime diagnostics are advisory.
`background-lite:browser` writes the six-project Playwright JSON report to
`outputs/background-lite-local/browser/playwright-report.json`; validation hashes and
parses that exact artifact, requires identical test coverage in all six projects, and
records each project outcome without inferring results from console output.

The first reclaim and the later legacy POI cleanup each require a fresh, separate
short-lived confirmation token. Never reuse a token after its inventory or expiry
changes. Rollback uses the hash-bound manifest written during local activation.

## Current known migration boundary

`data/background-source-exclusions.json` formally accounts for the exact 52
content nodes that the source tileset references but OneMap returns as HTTP 403.
The ledger is bound to the source tileset, the complete recorded failure set,
and the immutable release descriptor. Its entries are terminal `excluded`
outcomes, not inferred or fabricated tiles. The generated tileset removes only
each unavailable node's `content`; any available descendants remain reachable.
Preflight fails if another source is missing, one returns, or any bound evidence
changes. Reclaim rechecks the same evidence identity before deleting anything.

The checked-in snapshot-to-source identity scan may return `review` outcomes when
historical batch numbers no longer match authoritative `tiles/`. Only exact GML
identity evidence or a unique, LOD-consistent approved name is accepted. Any remaining
review keeps overlay parity incomplete and prevents local switching or legacy cleanup.

See `specs/025-local-background-lite/quickstart.md` for the complete planned
operator and validation contract.
