# Research: Technical SEO and GEO Foundation

**Feature**: `003-maximize-seo-geo`

**Date**: 2026-07-17

**Status**: Complete; no unresolved clarifications

## Evidence reviewed

- Live `amblefinds.com` desktop and mobile responses, unknown routes, discovery-file routes,
  alternate hosts, link metadata, network requests, and Lighthouse desktop/mobile reports.
- Repository HTML, device entry point, Cloudflare Worker/static-asset configuration, security
  headers, production build scripts, and automated test matrix.
- Primary documentation from Google Search Central, Bing, OpenAI, Anthropic, Perplexity,
  Cloudflare, Schema.org, Open Graph, and the Robots Exclusion Protocol.
- A comparable Singapore event site's server-visible metadata, event URL structure, sitemap,
  and mobile content model, used only as product context rather than copied implementation.
- The original GEO paper and a later critical survey, used to separate controlled visibility
  experiments from evidence of stable organic discovery.

## Decision 1: Keep the phase technical and homepage-only

**Decision**: Optimize one canonical homepage. Do not add event, venue, collection, guide,
FAQ, editorial, `llms.txt`, or agent-specific Markdown pages in this phase.

**Rationale**: The user explicitly selected the technical-foundation scope. Search systems can
only index content that exists, so this phase should make the real homepage correct without
creating thin or unsupported surfaces. Technical eligibility is measurable; rankings and AI
citations are not guaranteed.

**Alternatives considered**:

- Individual event/venue pages: strongest path to query coverage, but explicitly deferred.
- Editorial guides and date/category landing pages: useful future work, but outside the chosen
  scope and not supportable until data quality and mobile content decisions change.
- `llms.txt` or crawler-only Markdown: excluded because it is not a substitute for accessible,
  canonical human content and creates maintenance/cloaking risk.

## Decision 2: Preserve the mobile gate and do not cloak

**Decision**: Keep the current mobile gate for users and smartphone crawlers. Do not serve
event information only to bots.

**Rationale**: Google states that the smartphone version is used for mobile-first indexing and
recommends equivalent primary content. The user knowingly chose the existing gate. Serving a
richer crawler-only response would conflict with the user decision and create cloaking risk.
The plan records the resulting SEO ceiling instead of hiding it.

**Alternatives considered**:

- Mobile event information with desktop-only 3D map: recommended for future discoverability,
  but rejected for this phase.
- Responsive 3D map: larger UX/performance project, rejected.
- Bot-only content: rejected as deceptive and operationally fragile.

**Primary source**: [Google mobile-first indexing guidance](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)

## Decision 3: Put essential metadata in initial HTML

**Decision**: Add the approved title, description, canonical, index directive, Open Graph,
social card, icons, and JSON-LD directly to `index.html`.

**Rationale**: These fields describe a single static identity and do not need client state.
Initial HTML is simpler to crawl, preview, validate, and cache than JavaScript-injected
metadata, and it adds no client dependency or request.

**Alternatives considered**:

- Inject metadata from application JavaScript: unnecessary rendering dependency.
- Worker HTML rewriting: adds runtime coupling for values known at build time.
- A new head-management framework: disproportionate for one page.

**Primary sources**:

- [Google title links](https://developers.google.com/search/docs/appearance/title-link)
- [Google snippets and meta descriptions](https://developers.google.com/search/docs/appearance/snippet)
- [Google canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Open Graph protocol](https://ogp.me/)

## Decision 4: Use only WebSite and Organization identity data

**Decision**: Emit one JSON-LD graph containing `WebSite` (`#website`) and `Organization`
(`#organization`) with `Amble`, the canonical URL, `en-SG`, the verified description, publisher
relationship, and owned logo. Omit unsupported optional fields.

**Rationale**: These entities accurately describe the homepage and brand. There are no
indexable event pages, so event rich-result markup would not meet Google's requirement that
structured data represent visible page content and that each event have a unique leaf URL.

**Alternatives considered**:

- Event schema on the homepage: rejected because it would describe dynamically hidden events
  without corresponding indexable leaf pages.
- `LocalBusiness`, reviews, ratings, FAQ, offers, or `SearchAction`: rejected because Amble does
  not support those claims on this homepage.
- `sameAs` profiles: defer until official profiles are supplied and verified.

**Primary sources**:

- [Google structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Google organization markup](https://developers.google.com/search/docs/appearance/structured-data/organization)
- [Schema.org WebSite](https://schema.org/WebSite)
- [Schema.org Organization](https://schema.org/Organization)

## Decision 5: Normalize every alternate origin at the Worker

**Decision**: Route every request through the Cloudflare Worker, return a one-hop permanent
redirect for HTTP, `www`, the exact Workers development hostname
`amble.amble-sg.workers.dev`, and `/index.html`, then delegate canonical requests to existing
API/tile/static handlers. The alias comes from the authenticated Cloudflare account subdomain
`amble-sg` and Worker name `amble`; implementation matches that hostname exactly.

**Rationale**: One boundary can enforce host/protocol rules before any HTML or API copy is
served. Keeping the Workers hostname reachable only as a redirect satisfies the explicit
contract better than disabling it and returning an uncontrolled provider error.

**Alternatives considered**:

- Disable `workers.dev`: removes a duplicate but cannot provide the required permanent
  redirect.
- Cloudflare dashboard redirect rules only: viable, but splits the testable contract between
  unversioned dashboard state and code. Dashboard HTTPS settings may remain defense in depth.
- HTML canonical tags without redirects: weaker consolidation and leaves successful copies.

**Primary source**: [Cloudflare Worker-first static-asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)

## Decision 6: Remove SPA fallback and return true 404s

**Decision**: Change Static Assets `not_found_handling` to `none`. The only public HTML route is
`/`; known API/assets retain their existing contracts; unknown paths and missing assets return
404 with security headers.

**Rationale**: The app has no client-side public routes in this phase. Current SPA fallback
turns every typo into the homepage with status 200, creating soft 404s and unbounded crawl
space. Wrangler 4.110 supports `none`, so no custom 404 service is needed.

**Alternatives considered**:

- Keep SPA fallback and add `noindex` dynamically: still produces incorrect successful
  responses and unnecessary complexity.
- Add a custom branded 404 page: permissible later but not required for technical correctness.
- Enumerate every invalid path in Worker code: unbounded and unnecessary.

## Decision 7: Serve deterministic robots and sitemap responses

**Decision**: A pure repository-owned module renders `robots.txt` and `sitemap.xml`. The Worker
serves GET/HEAD responses with explicit types and bounded cache headers before asset fallback.
The sitemap contains exactly `https://amblefinds.com/` and omits `lastmod` until a meaningful
date can be maintained deterministically.

**Rationale**: The live discovery URLs currently fall through to application HTML; the live
robots response also contains managed content that caused syntax errors. Worker-owned text
keeps policy versioned and unit-testable. Omitting speculative `lastmod` is more accurate than
emitting the deployment time on every request.

**Alternatives considered**:

- Static public files only: simpler, but less reliable while Worker host normalization and
  Cloudflare managed robots features also apply.
- Dynamic `lastmod` using current time: rejected as misleading.
- IndexNow: unnecessary for a one-page site in this phase; normal sitemap submission suffices.

**Primary sources**:

- [RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
- [Google robots.txt guidance](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

## Decision 8: Separate AI search/retrieval from model training

**Decision**: Allow traditional search, AI answer-search, and user-requested retrieval. Express
a no-training directive for dedicated training/control crawlers. Keep the reviewed mapping in
an explicit contract and update it only from primary operator documentation.

**Rationale**: OpenAI, Anthropic, and other operators expose separate crawler identities for
different purposes. Blocking all AI agents would undermine the user's GEO goal; allowing every
agent would contradict the selected no-training policy. Robots rules are voluntary and raw
user-agent strings are spoofable, so enforcement must use Cloudflare verified-bot signals when
available rather than pretending text matching authenticates a crawler.

**Initial reviewed mapping**:

| Purpose                  | Allow                                                       | No-training                               |
| ------------------------ | ----------------------------------------------------------- | ----------------------------------------- |
| Traditional search       | Googlebot, Bingbot                                          | —                                         |
| AI answer search         | OAI-SearchBot, Claude-SearchBot, PerplexityBot              | —                                         |
| User-requested retrieval | ChatGPT-User, Claude-User, Perplexity-User where documented | —                                         |
| Training/control         | —                                                           | GPTBot, ClaudeBot, Google-Extended, CCBot |

The implementation must re-check names immediately before release because crawler identities
can change. `Google-Extended` does not control ordinary Google Search ranking and is treated as
a content-use control rather than a search crawler.

**Alternatives considered**:

- Allow all agents: rejected by user.
- Block all AI agents: rejected because it prevents desired retrieval/citation eligibility.
- Worker blocks based only on `User-Agent`: rejected as spoofable and prone to false blocks.

**Primary sources**:

- [OpenAI crawler overview](https://platform.openai.com/docs/bots)
- [Anthropic crawler controls](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- [Perplexity crawler information](https://docs.perplexity.ai/guides/bots)
- [Google-Extended](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers#google-extended)
- [Cloudflare managed robots.txt](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/)

## Decision 9: Create a real-product social card

**Decision**: Commit a 1200×630 social card made from a representative screenshot of the real
3D Singapore map and the approved Amble wordmark, with a stable absolute URL and descriptive
alternative text.

**Rationale**: The user chose a product-representative image. It makes link previews clearer
without making a ranking claim. A committed asset is reproducible, cacheable, and can be
validated without running the 3D app in a social crawler.

**Alternatives considered**:

- Existing generic event-map icon: owned and usable, but does not communicate the Amble name or
  actual experience.
- Wordmark-only card: recognizable but less descriptive.
- Generated illustration: rejected because it could misrepresent the real map.

## Decision 10: Remove analytics rather than replace it

**Decision**: Delete the Cloudflare Web Analytics beacon and its CSP allowances. Do not add a
replacement analytics SDK, cookie, identifier, or visitor-level log.

**Rationale**: The project constitution forbids user analytics and product telemetry. Search
Console aggregate webmaster reports and synthetic HTTP/browser checks provide sufficient
operational evidence without instrumenting visitors.

**Alternatives considered**:

- Privacy-focused analytics: still violates the explicit no-user-analytics constraint.
- Server-side pageview logs: not required; minimal security/reliability logs remain allowed.

## Decision 11: Verify through Google Search Console and DNS

**Decision**: Use free Google Search Console domain verification via a DNS TXT record managed
in Cloudflare, submit the canonical sitemap, and document state as pending, verified,
submitted, indexed, or external blocker. No token or console credential is committed.

**Rationale**: DNS verification proves the whole domain without adding secret-like HTML files
or runtime configuration. Console processing is asynchronous and must not be confused with a
release gate.

**Alternatives considered**:

- HTML meta/file verification: workable, but creates token lifecycle in the public build.
- Additional webmaster consoles: excluded because Google Search Console is sufficient for this
  foundation phase.
- Paid rank/GEO monitoring suites: prohibited and unnecessary for foundation correctness.

## Decision 12: Treat GEO claims conservatively

**Decision**: Measure crawl eligibility, retrieval, citations in explicit test prompts when
available, and source consistency; do not promise a ranking or citation uplift.

**Rationale**: The original GEO study reports large gains in controlled experiments, but later
reviews find the evidence base narrow and insufficient to establish stable longitudinal
organic discovery. The durable engineering response is crawlability, consistent entities,
clear sourced content, and repeatable observation—not keyword stuffing or unverifiable tricks.

**Research sources**:

- [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735)
- [Critical survey of GEO evidence](https://arxiv.org/abs/2607.14035)

## Resolved unknowns

There are no unresolved research or product decisions. Exact external crawler names and
console states are intentionally release-time evidence checks, not product ambiguity.
