# Quickstart: Validate the Technical SEO and GEO Foundation

This guide validates the completed feature. It does not implement it and does not run the event
pipeline.

## Prerequisites

- Node.js 24+
- Repository dependencies installed with `npm ci`
- Playwright browsers required by the repository test matrix
- Wrangler authentication only for an authorized preview/deployment check
- DNS/Cloudflare access only for final host and webmaster verification

Run commands from the repository root.

## 1. Review the contracts

- Confirm the approved title, description, canonical URL, assets, and identity fields in
  [data-model.md](./data-model.md).
- Confirm public statuses, redirects, content types, and 404 behavior in
  [contracts/discovery-http.md](./contracts/discovery-http.md).
- Re-check every crawler identity against primary documentation in
  [contracts/crawler-policy.md](./contracts/crawler-policy.md).

Expected: no unresolved crawler purpose, unsupported identity claim, or non-canonical URL.

## 2. Run static quality checks

```sh
npm run lint
CI_BASE_SHA="$(git merge-base HEAD origin/develop)" CI_HEAD_SHA=HEAD npm run format:check
npm run test:unit
```

Expected: all relevant unit/integration tests pass, including site discovery, Worker routing,
metadata consistency, analytics absence, and existing API/private-route regression tests.

## 3. Build the Cloudflare candidate

```sh
npm run cloudflare:cloud:check
```

Expected:

- `dist-cloudflare/index.html` contains the approved initial-HTML metadata and JSON-LD.
- The analytics beacon and Cloudflare Insights CSP hosts are absent.
- Every declared identity asset exists with matching dimensions and type.
- The lightweight device entry remains separate from the 3D application.
- The Cloudflare configuration routes the Worker first and uses true not-found handling.

## 4. Run the browser matrix

Install the required engines if they are not already available:

```sh
npx playwright install chromium webkit firefox
```

Run the relevant desktop/mobile projects:

```sh
PLAYWRIGHT_FULL_MATRIX=1 npx playwright test -c playwright.config.mjs \
  tests/device-support.spec.mjs \
  --project chromium-desktop --project chromium-mobile \
  --project webkit-desktop --project webkit-mobile \
  --project firefox-desktop --project firefox-mobile
```

Expected:

- Desktop projects retain the full 3D Amble entry behavior.
- Mobile projects retain `Singapore is waiting on the big screen`, do not create the map, and
  do not download the full 3D entry bundle.
- Every project receives the same approved static metadata.
- No request targets Cloudflare Web Analytics or another analytics/advertising endpoint.

## 5. Record a performance comparison

Run the existing benchmark before and after the implementation candidate using the repository's
documented baseline procedure:

```sh
npm run benchmark:release
```

Expected: no new client request or JavaScript attributable to SEO/GEO metadata, and no material
regression in the established benchmark. Keep routine benchmark output untracked under the
existing output policy.

## 6. Validate a non-production Worker preview

Use the project’s authorized Cloudflare preview workflow. Do not change DNS or the canonical
production route for this step. Run the site-discovery verifier against the preview origin while
supplying the expected public-host mapping documented by the implementation.

Required preview scenarios:

1. Canonical `/` returns 200 HTML and the complete approved metadata set.
2. `/robots.txt` returns 200 plain text and the reviewed purpose policy.
3. `/sitemap.xml` returns 200 XML and exactly one canonical homepage URL.
4. `/index.html` returns one 308 to `/`.
5. Unknown path and missing asset return 404 rather than homepage HTML.
6. Private admin and unknown API behavior remain unchanged.
7. GET/HEAD pairs have matching statuses/headers and HEAD has no body.

Expected: the verifier emits a passing release-candidate record. Any mandatory failure stops
the workflow before production deployment.

## 7. Validate production after deployment

After all local, build, browser, and preview gates pass, deploy one version through the existing
Cloudflare workflow. Then run the same verifier against these live origins:

```text
https://amblefinds.com/
http://amblefinds.com/
https://www.amblefinds.com/
https://amble.project-hub-arnav.workers.dev/
```

Expected:

- Every alternate origin reaches the canonical equivalent in exactly one 308.
- No alternate origin serves a successful duplicate homepage.
- Root, robots, sitemap, assets, 404s, APIs, and mobile/desktop behavior satisfy the HTTP
  contract.
- Cloudflare managed robots/content-signal settings do not alter or contradict the repository
  response.

If a mandatory live check fails, use the existing Wrangler rollback facility to restore the
previous Worker version, then repeat live verification. Do not label the release successful
until rollback or correction is verified.

## 8. Verify free webmaster services

This is operator work and must not expose credentials in Git or logs.

### Google Search Console

1. Add `amblefinds.com` as a domain property.
2. Add the provided DNS TXT record in Cloudflare.
3. Wait for verification and record only the non-secret state.
4. Submit `https://amblefinds.com/sitemap.xml`.
5. Inspect the canonical homepage and confirm the selected canonical when processing completes.

Expected: Google Search Console reaches verified and sitemap-submitted, or has a specific
sanitized external blocker. Provider delay does not roll back an otherwise correct HTTP
release.

## 9. Manual social-preview check

Fetch `https://amblefinds.com/brand/amble-social-card.png` without a browser session and inspect
the homepage through available free preview debuggers or message drafts.

Expected:

- The preview uses `Amble: See What’s Happening in Singapore`.
- The approved description and canonical URL are present.
- The image clearly shows the Amble wordmark plus a representative real 3D Singapore map view.
- Center/square crops keep the brand legible and do not reveal private/test UI.

## Completion evidence

The feature is ready only when:

- All mandatory local, build, browser, preview, and live HTTP checks pass.
- The previous deployment remains available for rollback.
- No analytics request or persistent visitor identifier is observed.
- Crawler policy matches current primary documentation and Cloudflare controls.
- Webmaster services are verified/submitted or have a documented external blocker.
- The existing desktop app and existing mobile gate show no user-visible regression.
