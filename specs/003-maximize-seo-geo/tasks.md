# Tasks: Technical SEO and GEO Foundation

**Input**: Design documents from `specs/003-maximize-seo-geo/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`,
`quickstart.md`

**Tests**: Tests are required by the feature specification and project constitution. Within
each user story, failing contract/regression tests are written before implementation.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested
as an independent increment. No task runs the event pipeline.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it uses different files and has no incomplete dependency
- **[Story]**: Maps the task to a user story in `spec.md`
- Every task names its target file or output path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish deterministic fixtures, commands, baseline evidence, and provenance.

- [x] T001 Create the schema-versioned canonical identity, expected metadata, exact `amble.project-hub-arnav.workers.dev` redirect host, crawler-purpose, and discovery-response fixture in `tests/fixtures/site-discovery/identity.json`
- [x] T002 [P] Add `verify:site-discovery` and focused test commands without changing runtime dependencies in `package.json`
- [x] T003 [P] Capture the pre-change frontend benchmark as ignored routine evidence under `outputs/seo-geo/before/`
- [x] T004 [P] Record owned wordmark/logo provenance, approved social-card source requirements, and the primary crawler-document review date in `docs/seo-geo-operations.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the shared, pure identity/policy boundary used by every story.

**⚠️ CRITICAL**: Complete this phase before implementing any user story.

- [x] T005 Write failing fixture-schema, canonical-identity, duplicate-agent, evidence-URL, and unsupported-claim tests in `tests/site-discovery.test.mjs`
- [x] T006 Implement schema-versioned site identity constants, crawler-purpose records, validation errors, and deterministic serialization helpers in `cloudflare/site-discovery.mjs`
- [x] T007 Implement fixture loading and reusable static/live assertion primitives with sanitized release-record output in `scripts/verify-site-discovery.mjs`

**Checkpoint**: Shared identity and validation boundaries are ready; no public behavior has
changed yet.

---

## Phase 3: User Story 1 — Find the canonical Amble website (Priority: P1) 🎯 MVP

**Goal**: Serve one accurately described homepage at `https://amblefinds.com/`, normalize every
alternate origin in one permanent hop, preserve the mobile gate, and return true 404s.

**Independent Test**: Request canonical root, HTTP, `www`, Workers development origin,
`/index.html`, unknown paths, missing assets, APIs, and private admin paths. Confirm the approved
initial metadata, one-hop redirects, true 404s, preserved APIs/admin denial, and unchanged
desktop/mobile behavior.

### Tests for User Story 1 ⚠️

- [x] T008 [US1] Write failing canonical redirect, query/path preservation, loop prevention, `/index.html`, unknown-path, missing-asset, private-route, and existing-API tests in `tests/cloudflare-cloud-native.test.mjs`
- [x] T009 [P] [US1] Write failing initial-HTML title, description, canonical, robots-directive, duplicate-field, and unsupported-claim build fixtures in `tests/cloudflare-frontend-build.test.mjs`
- [x] T010 [P] [US1] Extend failing desktop/mobile metadata and unchanged-device-gate assertions in `tests/device-support.spec.mjs`

### Implementation for User Story 1

- [x] T011 [US1] Add the approved description, absolute canonical URL, index/follow directive, and normalized title to initial HTML in `index.html`
- [x] T012 [US1] Implement 308 canonical protocol/host/path normalization, exact `amble.project-hub-arnav.workers.dev` alias matching, arbitrary-Workers-host rejection, and one-hop loop guards in `cloudflare/site-discovery.mjs`
- [x] T013 [US1] Run canonical handling before private/API/tile/asset routing and preserve security headers in `cloudflare/cloud-native-worker.mjs`
- [x] T014 [US1] Set `assets.run_worker_first` to `true` and `assets.not_found_handling` to `none` in `wrangler.cloud.jsonc`
- [x] T015 [US1] Extend built-HTML, redirect, true-404, and existing-route validation in `scripts/verify-cloudflare-frontend.mjs` and `scripts/verify-site-discovery.mjs`

**Checkpoint**: User Story 1 independently establishes the canonical homepage and removes
successful duplicate/soft-404 surfaces.

---

## Phase 4: User Story 2 — Share Amble clearly (Priority: P1)

**Goal**: Produce a clear branded link preview using the Amble wordmark and the real 3D map.

**Independent Test**: Parse the built homepage as a link-preview client and fetch the image
without authentication. Confirm title, description, canonical destination, stable absolute
image URL, 1200×630 dimensions, ≤500 KiB size, descriptive alternative, and recognizable crop.

### Tests for User Story 2 ⚠️

- [x] T016 [P] [US2] Write failing Open Graph/social-card completeness, absolute-URL, duplicate-field, image-type, dimension, byte-limit, and missing-asset tests in `tests/site-social-preview.test.mjs`

### Implementation for User Story 2

- [x] T017 [US2] Capture an approved representative desktop 3D map view and compose it with `public/brand/amble-wordmark.png` into `public/brand/amble-social-card.png` at 1200×630 and ≤500 KiB
- [x] T018 [US2] Add consistent Open Graph and large-image social metadata with explicit image dimensions and alternative text in `index.html`
- [x] T019 [US2] Validate the built social metadata, asset bytes, crop-safe dimensions, MIME type, unauthenticated fetch, and cache behavior in `scripts/verify-cloudflare-frontend.mjs` and `scripts/verify-site-discovery.mjs`, then record explicit owner approval of full, center, and square crops in `docs/seo-geo-operations.md`

**Checkpoint**: User Story 2 independently produces an accurate share preview without changing
the application UI.

---

## Phase 5: User Story 3 — Crawl Amble according to purpose (Priority: P1)

**Goal**: Serve a valid crawler policy that allows search/answer/user retrieval, disallows
dedicated model training, and agrees with verified Cloudflare controls.

**Independent Test**: Fetch and parse `/robots.txt` as representative traditional-search,
answer-search, user-retrieval, and training agents. Confirm the intended rule, canonical sitemap
line, valid plain text, no HTML/managed contamination, and no substantive crawler-only page.

### Tests for User Story 3 ⚠️

- [x] T020 [US3] Write failing RFC 9309 grouping, most-specific-agent, allow/search, disallow/training, Googlebot-versus-Google-Extended, sitemap-line, GET/HEAD/405, and no-HTML tests in `tests/site-discovery.test.mjs`
- [x] T021 [P] [US3] Write failing Worker integration tests for `/robots.txt`, cache/content headers, managed-content contamination fixtures, and unchanged API/private behavior in `tests/cloudflare-cloud-native.test.mjs`

### Implementation for User Story 3

- [x] T022 [US3] Implement deterministic robots rendering and GET/HEAD/405 response creation from reviewed purpose records in `cloudflare/site-discovery.mjs`
- [x] T023 [US3] Serve `/robots.txt` before asset fallback in `cloudflare/cloud-native-worker.mjs` and document Cloudflare managed-robots disablement, verified-bot enforcement, and `search=yes, ai-input=yes, ai-train=no` controls in `docs/seo-geo-operations.md`

**Checkpoint**: User Story 3 independently exposes the approved SEO/GEO crawler policy without
pretending raw user-agent text verifies identity.

---

## Phase 6: User Story 4 — Discover the homepage through a sitemap (Priority: P2)

**Goal**: Serve a valid one-URL sitemap that lists only the canonical homepage.

**Independent Test**: Fetch `/sitemap.xml`, validate its XML/content type/cache contract, and
confirm the canonical homepage appears exactly once with no alias, API, asset, admin/test,
parameter, fragment, Workers, or unsuccessful URL.

### Tests for User Story 4 ⚠️

- [x] T024 [US4] Write failing XML syntax, exact-membership, duplicate/excluded URL, speculative-`lastmod`, GET/HEAD/405, content-type, and cache tests in `tests/site-discovery.test.mjs`
- [x] T025 [P] [US4] Write failing Worker integration tests proving `/sitemap.xml` never reaches SPA/static fallback in `tests/cloudflare-cloud-native.test.mjs`

### Implementation for User Story 4

- [x] T026 [US4] Implement deterministic one-URL sitemap rendering without speculative `lastmod` in `cloudflare/site-discovery.mjs`
- [x] T027 [US4] Serve `/sitemap.xml` before asset fallback in `cloudflare/cloud-native-worker.mjs` and add local/live membership validation in `scripts/verify-site-discovery.mjs`

**Checkpoint**: User Story 4 independently provides an accurate sitemap for the single-page
scope.

---

## Phase 7: User Story 5 — Understand Amble as a named entity (Priority: P2)

**Goal**: Expose consistent `WebSite` and `Organization` identity plus stable logo/favicon
assets without unsupported event or business claims.

**Independent Test**: Parse initial JSON-LD and icon declarations, resolve every referenced
asset, and confirm stable IDs, `Amble`, canonical URL, `en-SG`, description, publisher
relationship, dimensions/types, and absence of event/review/rating/offer/FAQ/search-action data.

### Tests for User Story 5 ⚠️

- [x] T028 [P] [US5] Write failing JSON-LD graph, stable-ID, relationship, language, same-origin asset, unsupported-type, and duplicate-entity tests in `tests/site-identity.test.mjs`

### Implementation for User Story 5

- [x] T029 [P] [US5] Derive and commit approved browser favicon and touch-icon variants under `public/brand/` with documented Amble-owned provenance in `docs/seo-geo-operations.md`
- [x] T030 [US5] Add favicon/touch declarations and one `WebSite`/`Organization` JSON-LD graph with stable fragment IDs to `index.html`
- [x] T031 [US5] Validate JSON-LD types/relationships, claim consistency, asset dimensions/types, and unsupported-schema absence in `scripts/verify-cloudflare-frontend.mjs`

**Checkpoint**: User Story 5 independently gives search and answer engines a truthful,
consistent Amble entity.

---

## Phase 8: User Story 6 — Verify discovery without tracking users (Priority: P2)

**Goal**: Remove visitor analytics and provide deterministic release, browser, live, webmaster,
and rollback verification without storing visitor identifiers or secrets.

**Independent Test**: Run local/build/browser/live validation and inspect browser storage and
network activity. Confirm zero analytics requests/identifiers, complete release evidence,
preserved desktop/mobile behavior, secret-safe console instructions, and rollback on a failed
mandatory fixture.

### Tests for User Story 6 ⚠️

- [x] T032 [P] [US6] Write failing source/build tests for analytics script/CSP host absence and no replacement telemetry surface in `tests/no-telemetry.test.mjs` and `tests/cloudflare-frontend-build.test.mjs`
- [x] T033 [P] [US6] Write failing Chromium/WebKit/Firefox desktop/mobile network, storage, metadata, and unchanged-gate assertions in `tests/device-support.spec.mjs`
- [x] T034 [US6] Write failing release-record, mandatory-failure, external-blocker, sanitization, and rollback-target tests in `tests/site-discovery-release.test.mjs`

### Implementation for User Story 6

- [x] T035 [US6] Remove the Cloudflare Web Analytics beacon from `index.html` and remove Cloudflare Insights hosts from `SECURITY_HEADERS` in `cloudflare/cloud-native-worker.mjs`
- [x] T036 [US6] Implement idempotent static/preview/live modes, schema-versioned release records, secret sanitization, mandatory versus external-blocker classification, and rollback-target reporting in `scripts/verify-site-discovery.mjs`
- [x] T037 [US6] Keep the protected `Quality checks` context stable while raising its timeout to 40 minutes, installing Chromium/WebKit/Firefox, running all six explicit desktop/mobile projects in `.github/workflows/ci.yml`, and aligning project definitions in `playwright.config.mjs`
- [x] T038 [US6] Document DNS-only Google Search Console verification, sitemap submission, cache correction, Cloudflare deploy/rollback, sanitized evidence, and deliberate mobile/content limitations in `docs/seo-geo-operations.md`

**Checkpoint**: User Story 6 independently proves technical eligibility and privacy without
tracking users.

---

## Phase 9: Polish & Cross-Cutting Release Gates

**Purpose**: Reconcile all stories, validate current external evidence, and prepare an atomic
release without broadening scope.

- [x] T039 Re-check every crawler token and purpose against the primary URLs in `specs/003-maximize-seo-geo/contracts/crawler-policy.md`, update `tests/fixtures/site-discovery/identity.json`, and fail review on unresolved names
- [x] T040 [P] Update canonical-host, metadata ownership, crawler review cadence, privacy, artifact classification, and single-page limitations in `README.md` and `docs/seo-geo-operations.md`
- [x] T041 Run the post-change benchmark and compare it with `outputs/seo-geo/before/`, storing routine results under `outputs/seo-geo/after/` and documenting any material regression in `docs/seo-geo-operations.md`
- [x] T042 Run lint, changed-file formatting, unit/integration tests, `npm run cloudflare:cloud:check`, and the full desktop/mobile Chromium/WebKit/Firefox matrix from `specs/003-maximize-seo-geo/quickstart.md`
- [x] T043 Validate preview and production HTTP contracts with `scripts/verify-site-discovery.mjs`, record the prior Worker rollback version under ignored `outputs/seo-geo/release/`, and preserve/restore it on any mandatory failure
- [x] T044 Apply the matching free Cloudflare managed-robots/content-signal/verified-bot controls, or record `not-available` when the free account lacks a control, in `docs/seo-geo-operations.md`
- [x] T045 Complete DNS-only Google Search Console verification plus canonical sitemap submission, or record a sanitized provider `external-blocker`, in `docs/seo-geo-operations.md`
- [x] T046 Perform a final scope audit confirming no event/guide/mobile-content/`llms.txt`/crawler-only page, paid service, analytics, or unsupported schema was added in `specs/003-maximize-seo-geo/checklists/requirements.md`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on Setup and blocks every story.
- **US1 (Phase 3)**: Starts after Foundational and establishes canonical routing/true 404s.
- **US2 (Phase 4)**: Starts after Foundational; only final built verification depends on US1
  metadata scaffolding.
- **US3 (Phase 5)**: Starts after Foundational; Worker integration follows US1 routing order.
- **US4 (Phase 6)**: Starts after Foundational; Worker integration follows US1 routing order.
- **US5 (Phase 7)**: Starts after Foundational; HTML integration follows US1 metadata.
- **US6 (Phase 8)**: Starts after US1–US5 so its release verifier and matrix cover the combined
  candidate.
- **Polish (Phase 9)**: Depends on all selected user stories.

### User-story dependency graph

```text
Setup → Foundation → US1 ─┬→ US2 ─┐
                          ├→ US3 ─┤
                          ├→ US4 ─┼→ US6 → Polish/Release
                          └→ US5 ─┘
```

US2–US5 are independently testable and may be developed in parallel after the US1 routing/HTML
foundation lands. US6 intentionally reconciles their combined release and privacy behavior.

### Within each user story

1. Write the listed tests and confirm they fail for the intended missing behavior.
2. Implement pure models/renderers before the Worker/build adapter.
3. Implement adapters before browser/live integration.
4. Run the story's independent test before advancing.
5. Keep unrelated dirty-worktree changes unstaged and unmodified.

## Parallel Opportunities

- T002–T004 can run in parallel after T001's fixture shape is agreed.
- T009 and T010 can run in parallel with T008 because they modify different test surfaces.
- US2 asset/test work, US3 policy tests, US4 sitemap tests, and US5 identity tests can proceed
  in parallel after US1's canonical boundary.
- T032 and T033 can run in parallel before T034.
- T040 can run in parallel with release-time crawler review T039.

## Parallel Example: P1 Stories

```text
Task: T016 — social preview contract tests in tests/site-social-preview.test.mjs
Task: T020 — crawler purpose tests in tests/site-discovery.test.mjs
Task: T021 — robots Worker tests in tests/cloudflare-cloud-native.test.mjs
```

After US1, the social asset work and pure crawler-policy work use different files; Worker-file
integration remains sequential to avoid conflicting edits.

## Independent Test Summary

| Story | Independent completion signal                                                           |
| ----- | --------------------------------------------------------------------------------------- |
| US1   | One canonical homepage, one-hop alias redirects, true 404s, unchanged app/gate          |
| US2   | Complete share metadata and public 1200×630 real-product image                          |
| US3   | Valid purpose-specific robots policy with search/retrieval allowed and training blocked |
| US4   | Valid one-URL canonical sitemap with no excluded URL class                              |
| US5   | Consistent WebSite/Organization graph and owned identity assets only                    |
| US6   | Zero analytics, full browser/release evidence, secret-safe webmaster and rollback flow  |

## Implementation Strategy

### MVP first

1. Complete Setup and Foundational phases.
2. Complete US1 and run its independent test.
3. Stop at the checkpoint if a minimal canonical/404 deployment is desired.

### Incremental delivery

1. US1 establishes canonical correctness.
2. Add US2 and US3 for sharing and GEO crawler eligibility.
3. Add US4 and US5 for sitemap/entity completeness.
4. Complete US6 and all cross-cutting release gates.
5. Deploy one atomic candidate only after all selected story gates pass.

### Scope guardrails

- Do not create event, venue, collection, guide, FAQ, editorial, mobile event, `llms.txt`, or
  crawler-only pages.
- Do not run or modify the event pipeline for this feature.
- Do not add analytics, visitor identifiers, paid services, or a new runtime dependency.
- Do not commit DNS tokens, console credentials, cookies, or routine output artifacts.
- Do not claim rankings, rich results, or AI citations as guaranteed outcomes.
