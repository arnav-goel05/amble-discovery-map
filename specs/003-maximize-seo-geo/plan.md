# Implementation Plan: Technical SEO and GEO Foundation

**Working Branch**: `codex/amble-homepage-title-seo` | **Target**: `develop` | **Date**:
2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-maximize-seo-geo/spec.md`

## Summary

Make `https://amblefinds.com/` the single crawlable identity for Amble and give the existing
one-page desktop 3D application a complete technical search and answer-engine foundation.
Static HTML will carry the approved title, description, canonical, social, favicon, and
`WebSite`/`Organization` identity. A small repository-owned Cloudflare discovery module will
handle host normalization, `robots.txt`, `sitemap.xml`, and response contracts before static
asset delivery. Cloudflare Static Assets will stop using SPA fallback so unknown paths become
true 404s. The existing desktop experience and mobile gate remain unchanged; event pages,
mobile event content, crawler-only content, analytics, and paid services remain excluded.

## Technical Context

**Language/Version**: JavaScript ESM on Node.js 24 for build/test tooling and the Cloudflare
Workers runtime with compatibility date `2026-07-16`

**Primary Dependencies**: Existing Vite 8.1, Wrangler 4.110, Cloudflare Workers Static Assets,
Playwright 1.61, Node test runner, ESLint, and Prettier; no new runtime package

**Storage**: Version-controlled HTML, JavaScript policy constants, and image/icon assets; no
database migration or new runtime persistence. Routine validation output, if retained, stays
under ignored `outputs/` paths.

**Testing**: `node:test` for pure policy and Worker contracts; Playwright projects for desktop
and mobile Chromium, WebKit, and Firefox behavior; Vite/Cloudflare production builds; live
HTTP smoke checks for DNS, redirects, discovery responses, and assets

**Target Platform**: Cloudflare Workers plus Static Assets at `amblefinds.com`; current Chrome,
Safari/WebKit, Firefox, and Edge-compatible desktop/mobile browsers

**Project Type**: Single web application with a static client, Cloudflare edge Worker, and
repository-owned build/verification scripts

**Performance Goals**: Add no client JavaScript and no client network request to the homepage;
keep each text discovery response below 10 KiB; keep the 1200×630 social card at or below
500 KiB; preserve the existing frontend benchmark and device-gate behavior

**Constraints**: Free services only; no visitor analytics or persistent identifiers; no event
or guide pages; no mobile event content; no cloaking; no unsupported structured claims; exact
canonical origin `https://amblefinds.com/`; search/retrieval crawlers allowed and dedicated
training crawlers disallowed; private admin routes remain 404

**Scale/Scope**: One indexable homepage, two discovery documents, one social card, favicon/logo
variants, three alternate-origin classes, four crawler-purpose classes, and the existing API
and asset surface

## Constitution Check

_GATE: Passed before Phase 0 and re-checked after Phase 1 design._

- **Evidence — PASS**: Homepage claims are limited to the visible 3D Singapore event-discovery
  product. Search, crawler, structured-data, and Cloudflare behavior is sourced from primary
  operator documentation in [research.md](./research.md). Missing optional identity fields are
  omitted, and no event-level claims are fabricated.
- **Automation — PASS**: Pure policy helpers, build verification, Worker contract tests, browser
  tests, and live synthetic checks own repeatable validation. Manual work is limited to visual
  approval of the social card and Google Search Console ownership/submission, with documented
  expected outputs.
- **Identity and publication — PASS**: Stable IDs are the canonical origin and fragment IDs
  `#website` and `#organization`. A candidate is classified as create, update, or no-op by file
  diff; invalid candidates do not deploy. Cloudflare versioned deployments are atomic and the
  previous Worker version is the rollback target.
- **Boundaries — PASS**: Static metadata belongs to `index.html`; edge routing and discovery
  responses belong to `cloudflare/site-discovery.mjs`; the existing Worker remains the thin
  request adapter; build verification reads both through explicit contracts. No event pipeline
  or UI component owns SEO policy.
- **Quality and security — PASS**: Unit, Worker, build, browser-matrix, and live contract tests
  cover success and failure paths. DNS ownership tokens and console credentials remain outside
  Git. Admin denial, security headers, and existing API behavior remain covered.
- **UX and performance — PASS**: No visible desktop/mobile interaction is redesigned. The
  required Chromium/WebKit/Firefox desktop/mobile matrix preserves the current gate and desktop
  app. The social card is a non-runtime asset; no rendering loop or client dependency is added.
  Existing before/after benchmark output is recorded because public HTML and assets change.
- **Operations and privacy — PASS**: Google Search Console, Cloudflare, and local validators are
  free. The Cloudflare analytics beacon is removed, no replacement is added, operational
  evidence contains no visitor identifiers, and the single-host deployment model is unchanged.

### Post-design re-check

Phase 1 introduces only explicit HTTP and data contracts, static assets, tests, and operational
documentation. It adds no paid dependency, new datastore, user tracking, event-data mutation,
background worker, or additional public content surface. All gates remain passed.

## Architecture and Delivery Approach

### 1. Canonical identity and static metadata

- Keep the brand/site name `Amble` and homepage title
  `Amble: See What’s Happening in Singapore`.
- Use the description: `Explore Singapore in 3D and discover events happening across the city.
Amble turns what’s on into an interactive desktop map.`
- Add absolute canonical, robots, Open Graph, and social-card tags directly to `index.html` so
  they are available in the initial HTML without JavaScript execution.
- Add JSON-LD with only `WebSite` and `Organization`, stable fragment IDs, `en-SG`, the canonical
  URL, the same description, and repository-owned logo references. Do not add event, venue,
  offer, rating, FAQ, or search-action schema.
- Remove the Cloudflare Web Analytics script and remove its hosts from Content Security Policy.

### 2. Brand assets

- Create `public/brand/amble-social-card.png` at 1200×630 from a representative screenshot of
  the real 3D map plus the existing Amble wordmark. Preserve legibility in center crops and do
  not imply event coverage beyond the application.
- Derive committed favicon and touch-icon variants from an approved Amble-owned mark; declare
  explicit type and sizes in HTML.
- Validate dimensions, MIME types, byte limits, cache headers, and unauthenticated availability.
  Asset changes are create/update/no-op repository changes, not generated runtime state.

### 3. Edge discovery boundary

- Add `cloudflare/site-discovery.mjs` as a pure module containing canonical host constants,
  reviewed crawler-purpose rules, deterministic robots/sitemap renderers, canonical redirect
  logic, discovery response headers, and root/index normalization.
- Set Cloudflare Static Assets `run_worker_first` to `true` so host normalization and discovery
  routes run before assets. Change `not_found_handling` from `single-page-application` to `none`.
- In `cloudflare/cloud-native-worker.mjs`, execute canonical redirect handling before private,
  API, tile, and asset routes. Serve repository-owned `/robots.txt` and `/sitemap.xml` for GET
  and HEAD. Preserve API paths and private admin denial. Delegate known static assets to
  `ASSETS.fetch`; propagate true missing-asset status with security headers.
- Permanently redirect HTTP, `www`, the exact public Workers development hostname
  `amble.project-hub-arnav.workers.dev`, and `/index.html` to the equivalent canonical URL in one hop.
  Preserve path and query where the canonical path is meaningful; `/index.html` normalizes to
  `/`. Store the exact alias in the validated identity fixture and match it exactly rather than
  using a broad `*.workers.dev` suffix. A redirected unknown path then returns a true 404 at the
  canonical host.

### 4. Crawler-purpose policy

- Permit traditional search plus answer-search/user retrieval, including the reviewed Google,
  Bing, OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, and Perplexity retrieval
  identities.
- Express `Disallow: /` for reviewed dedicated training/control identities such as GPTBot,
  ClaudeBot, Google-Extended, and CCBot without treating voluntary `robots.txt` as authentication.
- Disable conflicting Cloudflare managed `robots.txt` injection and align free Cloudflare AI
  Crawl Control/content signals to `search=yes`, `ai-input=yes`, `ai-train=no` where the account
  exposes those controls. Any blocking rule that claims verified identity must use Cloudflare's
  verified-bot signal, not raw user-agent text.
- Keep exact agent names and evidence URLs in an operator-maintained table; changes require a
  test fixture and primary-source review.

### 5. Verification and release

- Extend the Cloudflare frontend verifier to compare built HTML with canonical identity,
  metadata, JSON-LD, analytics absence, and committed asset contracts.
- Add focused `node:test` coverage for redirects, GET/HEAD/method handling, crawler rules,
  sitemap membership, content types, cache policy, 404s, and existing API/admin preservation.
- Extend Playwright device coverage to assert the approved metadata and zero analytics requests
  while retaining the current desktop/mobile behavior in Chromium, WebKit, and Firefox. Keep
  the protected `Quality checks` context stable, install all three engines in that job, raise
  its timeout to 40 minutes, and execute the six explicit desktop/mobile projects.
- Add idempotent live checks that distinguish required release correctness from asynchronous
  webmaster indexing. Run the production build and full relevant test suite before deployment;
  deploy one Worker version containing HTML, policy, and assets; run live checks; roll back to
  the previous version on a failed mandatory check.
- Verify the domain through DNS in Google Search Console, submit
  `https://amblefinds.com/sitemap.xml`, and document pending/external-blocker states without
  delaying a technically correct release.

## Project Structure

### Documentation (this feature)

```text
specs/003-maximize-seo-geo/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── discovery-http.md
│   └── crawler-policy.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
index.html                              # Initial HTML metadata, JSON-LD, analytics removal
public/brand/                           # Social card, favicons, wordmark, logo assets
cloudflare/
├── cloud-native-worker.mjs             # Edge request adapter
└── site-discovery.mjs                  # Pure canonical/discovery policy owner (new)
scripts/
├── verify-cloudflare-frontend.mjs      # Built metadata and identity validation
└── verify-site-discovery.mjs            # Local/live deterministic contract checker (new)
tests/
├── cloudflare-cloud-native.test.mjs     # Worker integration regression coverage
├── site-discovery.test.mjs              # Pure policy/metadata/discovery tests (new)
├── cloudflare-frontend-build.test.mjs   # Build verifier fixtures
└── device-support.spec.mjs              # Desktop/mobile matrix and analytics assertions
wrangler.cloud.jsonc                     # Worker-first and true-404 asset routing
docs/
└── seo-geo-operations.md                # Console, crawler, deploy, cache, rollback operations
```

**Structure Decision**: Retain the existing single-project web architecture. Add one pure edge
policy module and one verifier rather than a new service, datastore, framework, or frontend
route. Metadata remains server-visible in the static HTML, while response behavior remains at
the Cloudflare boundary.

## Complexity Tracking

No constitution violations or justified complexity exceptions.
