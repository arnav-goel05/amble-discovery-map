# Cloudflare Workers VPC deployment

This deployment exposes the application through a stable Cloudflare `workers.dev` Worker. The Worker supports an incremental R2 migration for the public 3D tiles while retaining the local Mac as the application origin and tile fallback.

## Request path

Application and API requests:

`workers.dev` Worker → Workers VPC service → Cloudflare Tunnel → `http://127.0.0.1:4173`

Tile requests after R2 activation:

`workers.dev` Worker → Cloudflare edge cache → R2 `TILES_BUCKET` → local VPC fallback when the object is not migrated

The public Worker blocks `/admin.html` and `/api/admin/*`. Full `GET` responses under `/optimized-tiles/*` and `/poi-tiles/*` are eligible for Cloudflare edge caching. Range responses are not inserted into the Worker cache. When R2 is bound, the Worker serves full, range, and `HEAD` tile requests from R2 first and falls back to the private origin for missing objects or temporary R2 failures.

## Local origin

Build and start the production server:

```bash
npm run build
npm run serve
```

The production server already mounts `optimized-tiles/` directly from the repository root, so the 112 GB tileset is not copied into `dist/`.

## Cloudflare resources

1. In the Cloudflare dashboard, create a Workers VPC tunnel named `amble-local` and install its `cloudflared` connector on the Mac.
2. Create an HTTP VPC service named `amble-origin` using that tunnel, IPv4 address `127.0.0.1`, and HTTP port `4173`. Avoid `localhost`: it may resolve to IPv6 `::1`, while the local server listens on IPv4.
3. Copy `wrangler.vpc.example.jsonc` to `wrangler.vpc.jsonc` and replace `REPLACE_WITH_VPC_SERVICE_ID` with the service ID.
4. Authenticate Wrangler and deploy:

```bash
npx wrangler login
npm run cloudflare:deploy
```

The deployed MVP hostname is:

```text
https://amble.amble-sg.workers.dev
```

## R2 migration

R2 activation is a usage-based, auto-renewing subscription even when the amount due immediately is `$0.00`. Do not perform the activation step unless billing has been explicitly approved.

After R2 is activated:

1. Create a Standard bucket named `amble-3d-tiles`.
2. Create a bucket-scoped R2 read/write API token and configure an `rclone` remote named `r2` using the account S3 endpoint.
3. Upload only public runtime assets. Do not upload `public/poi-tiles/source/`; it is a 3.1 GB local evidence cache and is not used by the browser.

```bash
rclone copy optimized-tiles r2:amble-3d-tiles/optimized-tiles \
  --transfers 16 --checkers 32 --fast-list --progress

rclone copy public/poi-tiles r2:amble-3d-tiles/poi-tiles \
  --exclude '/source/**' --transfers 16 --checkers 32 --fast-list --progress
```

The upload contains approximately 113 GB and 25,089 public files. `copy` is intentional: it does not delete remote objects. Use versioned snapshots and an audited cleanup process instead of `sync` for destructive removal.

4. Copy the `r2_buckets` entry from `wrangler.r2.example.jsonc` into `wrangler.vpc.jsonc`, preserving the checked-in VPC service ID:

```jsonc
"r2_buckets": [
  {
    "binding": "TILES_BUCKET",
    "bucket_name": "amble-3d-tiles",
    "remote": true
  }
]
```

5. Run the Worker tests, deploy, and verify that both manifests and representative child tiles are delivered by R2:

```bash
npm run cloudflare:test
npm run cloudflare:deploy
npm run cloudflare:r2:verify
```

R2 responses include `x-amble-tile-source: r2`. Existing application URLs remain unchanged, so no frontend CORS or URL migration is required. During upload, missing R2 objects continue to load from the local VPC origin.

## Verification

```bash
npm run cloudflare:test
curl -I https://amble.amble-sg.workers.dev/
curl -I https://amble.amble-sg.workers.dev/optimized-tiles/tileset.json
curl -I https://amble.amble-sg.workers.dev/api/snapshot
```

Confirm that `/admin.html` and `/api/admin/session` both return `404` through the public Worker.

## Operational constraints

- The Mac, local production server, and `cloudflared` connector must remain running.
- Workers VPC is currently beta.
- The Workers Free plan has a daily request allowance; each HTML, API, and tile request counts.
- R2 removes tile delivery from the Mac, but the Mac and VPC connector remain required for the application and APIs until those are migrated separately.
