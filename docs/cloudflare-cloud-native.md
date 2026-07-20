# Cloudflare cloud-native deployment

The public Amble site runs on Cloudflare Workers, D1, Workers Static Assets, and R2. Visitor traffic does not reach a developer Mac.

## Request path

- HTML, JavaScript, CSS, and other small assets: Workers Static Assets
- Approved event snapshot and public API routing: Worker
- Restaurant viewport queries: D1, with OpenStreetMap Overpass only as a cache-miss fallback
- Restaurant deal discovery: official websites with TinyFish Search/Fetch fallback, cached in D1
- 3D geometry under `/optimized-tiles/*` and `/poi-tiles/*`: R2

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
npm run cloudflare:cloud:test
npm run cloudflare:cloud:deploy
```

`cloudflare:prepare` copies the public directory without the large tile trees, bundles the current approved event snapshot into the Worker, and builds the static frontend. Geometry remains in the `amble-3d-tiles` R2 bucket.

## Automatic deployments from GitHub

The production Worker uses Cloudflare Workers Builds to deploy successful pushes from the GitHub `main` branch. Connect the existing `amble` Worker to `arnav-goel05/amble-discovery-map` and use these build settings:

| Setting                      | Value                             |
| ---------------------------- | --------------------------------- |
| Production branch            | `main`                            |
| Root directory               | `/`                               |
| Build command                | `npm run cloudflare:cloud:test`   |
| Deploy command               | `npm run cloudflare:cloud:deploy` |
| Build variable               | `NODE_VERSION=24`                 |
| Non-production branch builds | Disabled                          |

Authorize the Cloudflare GitHub App only for this repository. Keep runtime secrets, D1, and R2 bindings on the existing Worker; build variables are not a replacement for runtime secrets.

The deploy command always creates a fresh frontend bundle and verifies that its lightweight entry contains the phone/tablet compatibility gate before Wrangler publishes it. A failed test, build, or verification must not replace the active deployment.

GitHub Actions is the pre-merge CI gate. Pull requests into `develop` and `main` run JavaScript linting, changed-file formatting checks, the complete Node test suite, Chromium desktop/mobile smoke tests, and a production-equivalent Cloudflare build. Both branches require the `CI / Quality checks` result but do not require another reviewer, which keeps the flow practical for a solo developer.

Use `develop` as the permanent integration branch:

1. Perform new feature work directly on `develop`.
2. Do not create or switch to another branch unless the user explicitly requests it.
3. Keep completed but unreleased changes on `develop` for as long as needed.
4. Open a release pull request from `develop` into `main` when the combined changes are ready for users.
5. Merge the release pull request after CI passes.

Cloudflare remains the CD system and watches only `main`. Pushes and merges into `develop` stay in GitHub and do not deploy; merging a release pull request into `main` triggers the production deployment.

## Verify

```bash
curl https://amble.project-hub-arnav.workers.dev/api/health/ready
curl 'https://amble.project-hub-arnav.workers.dev/api/restaurants?bbox=1.283,103.85,1.288,103.86'
curl -I https://amble.project-hub-arnav.workers.dev/optimized-tiles/tileset.json
curl https://amble.project-hub-arnav.workers.dev/api/snapshot
```

Expected signals:

- health returns `{"ok":true,"runtime":"cloudflare"}`;
- restaurant responses normally report `"cache":"database"`;
- tile responses include `x-amble-tile-source: r2`;
- public admin routes return `404`.

## Cost controls

Start on Workers Free. Static asset requests are free, while dynamic Worker and D1 usage are subject to their free daily allowances. R2 is the expected recurring cost because the tile bucket is approximately 113 GB. Upgrade to Workers Paid only after monitoring shows the free limits are being approached.

### Realtime voice kill switches and USD 10 lifetime cap

Realtime voice is disabled by default. Admission requires both `REALTIME_ENABLED=true` in the Worker environment and the D1 `openai-realtime` runtime flag to be enabled. Apply `cloudflare/migrations/0003_voice_budget.sql` before enabling it. The OpenAI credential must exist only as the `OPENAI_API_KEY` Worker secret; never place it in `wrangler.cloud.jsonc`, frontend variables, logs, or build output.

The D1 ledger enforces a non-resetting lifetime cap of `10_000_000` micro-USD (USD 10). Each billable transcription or response reserves its worst-case amount before provider work. Unknown usage, settlement failure, cap exhaustion, or either disabled switch stops new work. Owner status responses expose state and totals only, never transcript, audio, coordinates, provider payloads, or credentials.

To disable immediately, set the runtime flag off and restore `REALTIME_ENABLED=false`, then deploy. Routine verification always uses mocked audio/provider fixtures and keeps both live switches off.
