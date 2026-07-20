# SEO and GEO Operations

## Ownership and provenance

- Canonical site identity and crawler policy are owned by `cloudflare/site-discovery.mjs` and
  validated against `tests/fixtures/site-discovery/identity.json`.
- `public/brand/amble-wordmark.png` and `public/brand/event-map-logo.png` are existing
  Amble-owned repository assets. `favicon-32.png` and `apple-touch-icon.png` are deterministic
  size variants of `event-map-logo.png`.
- `amble-social-card.png` was finalized on 2026-07-18 from the owner-supplied capture of the
  real desktop event map and the owned wordmark. The deterministic crop-safe composition is
  1200×630 and 196,366 bytes; it introduces no fictional landmark or alternate product UI.
  The owner approved this event-map direction and instructed release work to move on after the
  full composition review. Full, centered 1000×525, and centered 630×630 checks preserve the
  complete Amble wordmark and message.
- Crawler tokens were re-checked on 2026-07-17 against the primary operator URLs stored in the
  identity fixture. Repeat this review before each release and at least quarterly; a renamed,
  retired, or ambiguous token fails review rather than receiving a guessed replacement.

## Release boundaries

- `https://amblefinds.com/` is canonical. `www` and
  `https://amble.project-hub-arnav.workers.dev/` are redirect-only aliases.
- No event, guide, mobile-content, crawler-only, or analytics surface belongs to this phase.
- Routine verifier and benchmark reports belong under ignored `outputs/seo-geo/` paths.

## Crawler and Cloudflare policy

- Repository intent is `search=yes, ai-input=yes, ai-train=no`. `robots.txt` allows ordinary
  search, answer-search, and user-requested retrieval, and disallows dedicated training agents.
- Keep Cloudflare managed `robots.txt` off: Cloudflare prepends managed text to an existing 200
  response, which would make the repository response non-deterministic and may conflict with
  the explicit `ai-input=yes` policy.
- In AI Crawl Control, allow the reviewed answer-search and user-retrieval agents and block the
  reviewed training agents. On the Free plan, Cloudflare documents that this classification is
  based on user-agent strings; record it as `not-available` for verified-bot enforcement and do
  not describe it as cryptographically verified.
- Never create crawler-only HTML. Unknown and spoofed agents receive the same public page and
  mobile gate as everyone else. Admin paths remain 404.

## Validation, deploy, and rollback

1. Run the local, build, six-project browser, and performance commands in the feature
   quickstart. A redirect, metadata, discovery-file, asset, 404, privacy, or device failure is
   mandatory and stops publication.
2. Run `node scripts/verify-site-discovery.mjs --mode preview --origin <preview-origin>
--build-root dist-cloudflare --output outputs/seo-geo/release/preview.json` against an
   authorized non-production Worker.
3. Record the current Worker version as `rollbackVersion` in the ignored release record before
   deployment. Deploy only an exact tested commit.
4. Run live verification against the canonical origin, then each redirect-only alias. If a
   mandatory live check fails, use Wrangler's version rollback to restore `rollbackVersion`
   and repeat live verification before reporting recovery.

Discovery responses use a one-hour revalidating cache. Identity assets are replaced atomically
with their metadata. After an urgent correction, deploy the corrected Worker and purge only the
affected URL(s), then rerun GET/HEAD and unauthenticated asset checks.

### Production release evidence (2026-07-18)

- Exact tested commit: `67050ba9748daa8caaddea98ca6624180c8c7005`.
- Active Worker version: `5b3ebdd1-11aa-4b6c-898d-c17856b9db9d`; preserved rollback version:
  `28b74c15-d0cc-4817-a12f-aafd7da61804`.
- A mandatory alias check failed during an earlier propagation window, so production was
  immediately restored to the preserved version. After disabling Cloudflare Managed robots.txt
  and selectively purging only the homepage, robots, and sitemap URLs, five consecutive probes
  passed and the full live release record passed all required checks in one attempt.
- The sanitized release record is retained under ignored
  `outputs/seo-geo/release/live.json`; no credentials or account identifiers are stored.

### Performance evidence (2026-07-17)

The pre-change cold UI sample was 746.6 ms; two post-change samples were 700.8 ms and 727.1 ms.
The pre-change warm sample was 111.8 ms; post-change samples varied between 233.3 ms and 722 ms,
with map-motion FPS also varying. This is a one-run 3D tile/cache benchmark and the warm result
is recorded as an observed material outlier, not hidden. The change adds no runtime JavaScript
or client request, removes one analytics request, and leaves the 3D entry bundle unchanged, so
the evidence does not attribute the warm variance to SEO/GEO code. Raw results are retained in
ignored `outputs/seo-geo/before/`, `after/`, and `after-repeat/` directories.

## Webmaster service

- Google Search Console: create the `amblefinds.com` domain property, verify by DNS TXT, submit
  `https://amblefinds.com/sitemap.xml`, and inspect the selected canonical after processing.
- Commit only `unconfigured`, `dns-pending`, `verified`, `sitemap-submitted`, `processed`, or a
  sanitized `external-blocker`. Never commit TXT values, cookies, account identifiers, or
  screenshots containing private account data.

## Deliberate limitations

This phase adds one indexable homepage only. It adds no event or guide pages, mobile event
content, `llms.txt`, crawler-only response, paid SEO service, behavioral analytics, or
event/venue/review/rating/offer/FAQ schema. Desktop retains full 3D Amble; mobile retains the
existing desktop-required compatibility screen without loading the 3D bundle.

## Operator evidence

- Cloudflare dashboard review on 2026-07-18 found Managed robots.txt enabled and prepending
  Cloudflare content to the repository response. It was disabled with owner approval, the five
  affected URLs were selectively purged, and the exact repository response then passed five
  consecutive probes plus the full live verifier. The Free-plan per-crawler block switches are
  present but disabled, so verified-bot edge enforcement remains `not-available`; repository
  directives remain voluntary.
- Google Search Console: `sitemap-submitted` — the `amblefinds.com` domain property is verified
  by DNS, and `https://amblefinds.com/sitemap.xml` was submitted and read successfully on
  2026-07-18 with one discovered page. Keep the verification DNS record in place.
- Secrets, verification tokens, account identifiers, and screenshots containing private data
  are not committed.
