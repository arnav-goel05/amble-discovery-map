# Cloudflare cloud-native deployment

The public Amble site runs on Cloudflare Workers, D1, Workers Static Assets, and R2. Visitor traffic does not reach a developer Mac.

## Request path

- HTML, JavaScript, CSS, and other small assets: Workers Static Assets
- Approved event snapshot and public API routing: Worker
- Restaurant viewport queries: D1, with OpenStreetMap Overpass only as a cache-miss fallback
- Restaurant deal discovery: official websites with TinyFish Search/Fetch fallback, cached in D1
- 3D geometry under `/optimized-tiles/*` and `/poi-tiles/*`: R2
- Read-only exhaustive geometry inventory: the isolated `amble-tile-integrity` Worker, using
  a direct R2 binding and a five-minute cached report

The public Worker blocks `/admin.html` and `/api/admin/*`. Administrative and Telegram workflows are not exposed by the public cloud runtime.

## Deploy

Authenticate Wrangler, apply D1 migrations, optionally refresh the D1 restaurant seed from locally collected OpenStreetMap viewport caches, and deploy:

```bash
npx wrangler login
npx wrangler secret put TINYFISH_API_KEY --config wrangler.cloud.jsonc
npx wrangler secret put OPENAI_API_KEY --config wrangler.cloud.jsonc
npx wrangler d1 migrations apply amble-runtime --remote --config wrangler.cloud.jsonc
npm run cloudflare:seed:restaurants
npx wrangler d1 execute amble-runtime --remote --config wrangler.cloud.jsonc --file cloudflare/generated-restaurant-seed.sql
npm run cloudflare:cloud:contracts
npm run cloudflare:cloud:build
npm run cloudflare:cloud:deploy
```

`cloudflare:prepare` copies the public directory without the large tile trees, bundles the checked-in approved event snapshot into the Worker, and builds the static frontend. It deliberately does not run `build:poi-tileset`: that command requires release-hydrated `optimized-tiles`, which is absent from a clean Workers Builds checkout, while the approved snapshot already contains the release-generated tileset catalogue. Geometry remains in the `amble-3d-tiles` R2 bucket. GitHub is the sole test authority: the connected build does not repeat unit, browser, frontend-verification, geometry, performance, or remote-inventory gates. It compiles the promoted `main` revision once, then its deploy phase performs one application upload and one smoke check. It neither hydrates nor synchronizes geometry, queries the integrity Worker, nor deploys the integrity Worker itself.

Background and highlighted-geometry synchronization also consume one inventory report each. They
compare reliable stored validators and byte lengths, upload only missing or stale objects, and
verify uploaded bytes directly through Wrangler's R2 control plane. Same-size stale objects and
objects without a usable validator fail closed; neither synchronization path performs a public
per-object request loop.

## Automatic deployments from GitHub

The production Worker uses Cloudflare Workers Builds to deploy successful pushes from the GitHub `main` branch. Connect the existing `amble` Worker to `arnav-goel05/amble-discovery-map` and use these build settings:

| Setting                      | Value                             |
| ---------------------------- | --------------------------------- |
| Production branch            | `main`                            |
| Root directory               | `/`                               |
| Build command                | `npm run cloudflare:cloud:test`   |
| Deploy command               | `npm run cloudflare:cloud:deploy` |
| Build variable               | `NODE_VERSION=24`                 |
| Build variable               | `VITE_VOICE_UI_ENABLED=false`     |
| Non-production branch builds | Disabled                          |

Authorize the Cloudflare GitHub App only for this repository. Keep runtime secrets, D1, and R2 bindings on the existing Worker; build variables are not a replacement for runtime secrets.

The existing `cloudflare:cloud:test` dashboard command is a compatibility entrypoint: Workers Builds sets `WORKERS_CI=1`, so it runs only `cloudflare:cloud:build`. Outside Workers Builds it retains the credential-free contract suite. The deploy command never rebuilds or repeats GitHub tests; it uploads the prepared bundle and runs one smoke check. A failed build or verification must not replace the active deployment.

A future GitHub-owned upload would require a repository `CLOUDFLARE_API_TOKEN` secret. Until that narrowly scoped secret is deliberately provisioned, the connected Workers Build remains the single deployment executor; do not add a second deployment path using local OAuth credentials.

GitHub Actions separates ordinary validation from production release work:

| Tier                  | Trigger                                                      | Geometry and external use                                                                                    | Tests                                                                                                                                                                                                                     | Mutation                                                               |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Ordinary CI           | Push to `develop` or an explicitly created non-main branch   | 592-byte checked-in geometry contract; zero production hydration, R2 requests, provider calls, or deployment | Lint, changed-file formatting, every Node test, event/voice contracts, local Cloudflare worker contracts, production-equivalent frontend build, all non-render Chromium desktop specs, and targeted Chromium mobile specs | None                                                                   |
| Release verification  | Explicit dispatch with the full current `origin/develop` SHA | One approved-geometry hydration, bounded R2 control-plane/inventory checks, no public object-head loop       | Ordinary gates plus production geometry/separation, complete Chromium/WebKit/Firefox desktop/mobile matrix, production build, visible 3D rendering, and enforced performance budget                                       | Fast-forward `main` to the exact tested SHA after refs are revalidated |
| Cloudflare deployment | Successful update to `main`                                  | No tests or inventory request; one application build, one deploy, and one post-deploy check                  | Compile the promoted bundle only                                                                                                                                                                                          | Production application only                                            |

`main` requires the stable `Quality checks` context. The canonical workflow enforces its own
successful `Release verification` job through the promotion job dependency; requiring that job as
a branch context would circularly block the workflow while it is still running. `develop` permits
the requested direct-push workflow, but force pushes and branch deletion remain prohibited on both
branches.

Use `develop` as the permanent integration branch:

1. Perform new feature work directly on `develop`.
2. Do not create or switch to another branch unless the user explicitly requests it.
3. Keep completed but unreleased changes on `develop` for as long as needed.
4. Commit and push directly to the current branch only when requested; do not automatically create a pull request.
5. When the owner explicitly requests production release, invoke the repository
   `release-production` skill or manually dispatch `Release production` with the full current
   `origin/develop` SHA.
6. Let that workflow verify and fast-forward `main`; never push, force, or merge around the gate.

Cloudflare remains the CD system and watches only `main`. Pushes to `develop` stay in GitHub and do
not deploy. The release workflow's exact-SHA update to `main` triggers the production deployment.

## Uptime and incident handling

GitHub checks `https://amblefinds.com` once daily at 09:00 Singapore time with one attempt. A
healthy run does nothing. Failure opens one deduplicated `[uptime]` issue with sanitized evidence;
it does not retry, roll back, or redeploy. A later healthy daily run documents recovery and closes
the matching issue.

The Codex automation `Diagnose Amble outage` runs daily at 09:15 Singapore time. Without an open
outage issue it exits quietly. With one open issue it performs one bounded diagnostic pass,
classifies the cause, and may commit/push a tested code fix directly to `develop`. It cannot create
a pull request, update `main`, dispatch release, deploy, call live paid providers, or close an
unresolved incident. Production recovery still requires the explicit release gate.

## Verify

```bash
curl https://amble.project-hub-arnav.workers.dev/api/health/ready
curl 'https://amble.project-hub-arnav.workers.dev/api/restaurants?bbox=1.283,103.85,1.288,103.86'
curl -I https://amble.project-hub-arnav.workers.dev/optimized-tiles/tileset.json
curl https://amble.project-hub-arnav.workers.dev/api/snapshot
npm run cloudflare:r2:verify
```

Expected signals:

- health returns `{"ok":true,"runtime":"cloudflare"}`;
- restaurant responses normally report `"cache":"database"`;
- tile responses include `x-amble-tile-source: r2`;
- public admin routes return `404`.
- R2 verification makes one integrity-report request and confirms every manifest-referenced
  object by count, digest, presence, drawable size, and reliable byte validator. The request's
  cache identity covers both the background release and all highlighted-object metadata.

## Cost controls

Start on Workers Free. Static asset requests are free, while dynamic Worker and D1 usage are subject to their free daily allowances. R2 is the expected recurring cost because the tile bucket is approximately 113 GB. Upgrade to Workers Paid only after monitoring shows the free limits are being approached.

Routine integrity checks must use `npm run cloudflare:r2:verify`, which performs one cached
request to the isolated R2-binding inventory Worker and locally compares every highlighted
object's MD5 and length with the returned bounded inventory. A per-run verification identity
prevents pre-upload inventory from being reused after mutable R2 keys change. `--object-heads` is a legacy manual
diagnostic only: it performs one visitor-facing request per object, must be explicitly
bounded, must stop on `429`, and must never run in CI or routine deployment. If the daily
allowance is exhausted, stop public-origin probing and resume live verification after the
allowance resets.

### Realtime voice kill switches and USD 10 lifetime cap

The production voice entry surface is hidden with `VITE_VOICE_UI_ENABLED=false`. Production builds
also fail closed to hidden when that build variable is absent or malformed. Local Vite development
defaults to visible and may set the value explicitly in `.env.local`; no Git-branch name is used at
runtime. Hiding the shell does not remove the shared assistant controller or direct application
controls.

Realtime voice admission is independently disabled by default. Admission requires both
`REALTIME_ENABLED=true` in the Worker environment and the D1 `openai-realtime` runtime flag to be
enabled. Apply `cloudflare/migrations/0003_voice_budget.sql` before enabling it. The OpenAI
credential must exist only as the `OPENAI_API_KEY` Worker secret; never place it in
`wrangler.cloud.jsonc`, frontend variables, logs, or build output.

The D1 ledger enforces a non-resetting lifetime cap of `10_000_000` micro-USD (USD 10). Each billable transcription or response reserves its worst-case amount before provider work. Unknown usage, settlement failure, cap exhaustion, or either disabled switch stops new work. Owner status responses expose state and totals only, never transcript, audio, coordinates, provider payloads, or credentials.

To disable immediately, set the D1 runtime flag off, restore `REALTIME_ENABLED=false`, set
`VITE_VOICE_UI_ENABLED=false`, and deploy. Routine verification always uses mocked audio/provider
fixtures and keeps the live switches off.
