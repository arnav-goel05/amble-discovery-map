# Quickstart: Background Geometry Release

## Prerequisites

- Run from the repository root on `develop`.
- The active approved snapshot, extraction manifests, and `optimized-tiles` outputs exist.
- Wrangler is authenticated for the remote `amble-3d-tiles` bucket.

## Audit without writes

```bash
npm run geometry:background:audit -- --origin https://amblefinds.com
```

Success requires all of these totals to be zero: `staleObjects`, `failedObjects`,
`retainedIdentityCount`, and `affectedVenueCount`.

## Synchronize and verify

```bash
npm run geometry:background:sync -- --origin https://amblefinds.com
```

The command:

1. audits every active object;
2. uploads only stale objects with bounded retries;
3. verifies every object through its digest-versioned URL;
4. uploads the rewritten tileset manifest last;
5. verifies the release manifest;
6. writes `data/background-geometry-release.json` only after success.

An interrupted run is resumed by executing the same command. Already-correct objects are
skipped. A failure exits non-zero and leaves the previous release descriptor unchanged.

## Deploy and final production verification

```bash
npm run cloudflare:cloud:deploy
npm run geometry:background:audit -- --origin https://amblefinds.com
```

The Cloudflare deploy command runs synchronization first and cannot deploy the application
bundle when background parity is incomplete. `npm run cloudflare:cloud:check` runs the
read-only zero-overlap gate before its build checks.

The final audit report is written below `outputs/background-geometry-release/` and is
gitignored. National Stadium must be included in the zero-overlap venue verification.

## Recovery

Fix the reported object-store or local-evidence error and rerun synchronization. Do not edit the
release descriptor manually. Because the manifest is published last and the descriptor only
changes after verification, an incomplete run does not activate a partial release.
