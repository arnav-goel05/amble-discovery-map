# Feature Specification: Technical SEO and GEO Foundation

**Feature Branch**: `develop` (no branch-creation hook configured)

**Created**: 2026-07-17

**Status**: Ready for planning

**Input**: Research and specify a technical SEO and generative-engine optimization foundation
for the existing Amble application without adding event pages, guide pages, or a mobile
content experience.

## Clarifications

### Session 2026-07-17

- Q: Should mobile devices have access to search-facing event information? → A: No. Retain
  the current device gate for every public Amble page.
- Q: Should this feature add event pages, collection pages, or editorial guides? → A: No.
  Implement technical metadata, crawler, sitemap, canonical, sharing, and structured-identity
  foundations only for now.
- Q: What title should identify the homepage in search results and browser tabs? → A: Use
  `Amble: See What’s Happening in Singapore`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Find the canonical Amble website (Priority: P1)

As a person searching for Amble, I can identify the official Amble website at one canonical
domain and understand that it is a desktop 3D map for discovering Singapore events.

**Why this priority**: A new domain needs one unambiguous identity before search engines and
answer engines can consolidate its signals.

**Independent Test**: Request the homepage through every public hostname and protocol,
inspect the returned metadata, and confirm that all alternate origins resolve permanently to
the equivalent canonical Amble URL.

**Acceptance Scenarios**:

1. **Given** the canonical homepage, **When** it is requested, **Then** it returns a successful
   response with a unique title, useful description, absolute self-canonical URL, and index
   permission.
2. **Given** `www`, HTTP, or the public worker-development hostname, **When** the homepage is
   requested, **Then** it permanently redirects to `https://amblefinds.com/` without a loop.
3. **Given** a mobile visitor, **When** any public Amble URL is opened, **Then** the existing
   desktop-required device gate remains unchanged.

---

### User Story 2 - Share Amble clearly (Priority: P1)

As a user, I can share the Amble homepage and receive an accurate branded preview with a
recognizable title, description, image, and destination.

**Why this priority**: Clear previews improve recognition and earned sharing without adding
new content surfaces.

**Independent Test**: Inspect the homepage preview metadata and validate the image directly,
then compare every preview claim with the visible application and brand.

**Acceptance Scenarios**:

1. **Given** the canonical homepage, **When** a compatible service creates a link preview,
   **Then** it receives page-specific Open Graph and social-card metadata using absolute URLs.
2. **Given** the preview image, **When** fetched without a browser session, **Then** it returns
   successfully at a stable URL with the documented dimensions and descriptive alternative.

---

### User Story 3 - Crawl Amble according to its stated policy (Priority: P1)

As a search or answer-engine operator, I can retrieve a valid crawler policy that permits
ordinary search and user-requested retrieval while separately expressing that Amble content
must not be collected for model training.

**Why this priority**: SEO and GEO crawler access must be intentional, syntactically valid,
and separated by purpose.

**Independent Test**: Request crawler directives using representative traditional-search,
answer-search, user-retrieval, and model-training agents; validate the plain-text response and
confirm that each reviewed agent receives the intended policy.

**Acceptance Scenarios**:

1. **Given** a normal search crawler, **When** it reads the policy, **Then** crawling the
   canonical homepage is allowed.
2. **Given** a reviewed answer-search or user-retrieval crawler, **When** it reads the policy,
   **Then** retrieval of the canonical public homepage is allowed.
3. **Given** a reviewed model-training crawler, **When** it reads the policy, **Then** the
   no-training preference is explicit and consistent with edge enforcement.
4. **Given** the crawler-policy URL, **When** it is requested, **Then** it returns only valid
   plain text and never contains the application HTML shell.

---

### User Story 4 - Discover the homepage through a valid sitemap (Priority: P2)

As a search engine, I can fetch a valid sitemap that identifies the canonical Amble homepage
without duplicate, parameterized, development, or unavailable URLs.

**Why this priority**: A correct minimal sitemap gives the new domain an explicit discovery
signal while honestly reflecting the current one-page product.

**Independent Test**: Fetch and validate the sitemap, compare its URLs with live HTTP and
canonical responses, and confirm that it contains only the production homepage.

**Acceptance Scenarios**:

1. **Given** the sitemap URL, **When** requested, **Then** it returns valid XML with the correct
   content type and a successful status.
2. **Given** the current single-page scope, **When** sitemap membership is inspected, **Then**
   it contains the canonical homepage once and no application state, test, admin, asset,
   parameter, `www`, or worker-development URLs.

---

### User Story 5 - Understand Amble as a named entity (Priority: P2)

As a search or answer engine, I can identify the website name, publisher identity, canonical
URL, logo, language, and Singapore event-discovery purpose from visible and machine-readable
homepage information.

**Why this priority**: Consistent entity information helps engines associate the new domain
with the Amble product without inventing event-level content.

**Independent Test**: Validate the homepage's organization and website identity data and
compare every field with visible content and accessible brand assets.

**Acceptance Scenarios**:

1. **Given** homepage identity metadata, **When** validated, **Then** its name, URL, logo,
   description, language, and publisher relationships are internally consistent.
2. **Given** no event pages in this phase, **When** structured data is inspected, **Then** no
   individual event, review, rating, local-business, or other unsupported entity is claimed.

---

### User Story 6 - Verify technical discovery without tracking users (Priority: P2)

As the operator, I can verify indexing readiness, crawler access, sitemap submission,
canonical selection, social previews, and homepage performance without adding visitor
analytics or persistent identifiers.

**Why this priority**: The feature needs evidence while respecting the product constitution's
privacy boundary.

**Independent Test**: Inspect browser network activity and the configured aggregate
webmaster/crawler checks; confirm that no client analytics beacon is sent and that each
reported status has a non-personal operational source.

**Acceptance Scenarios**:

1. **Given** the released homepage, **When** an operator runs the documented checks, **Then**
   canonical, indexing, crawler, sitemap, structured identity, preview, and page-experience
   status are available.
2. **Given** a real visitor, **When** Amble loads, **Then** no analytics or advertising beacon
   records the visit and no new persistent visitor identifier is created.

### Edge Cases

- HTTP, `www`, and the worker-development hostname are requested with paths, query strings,
  fragments, or redirect loops.
- A crawler user agent is spoofed, renamed, retired, or split into search, user-retrieval, and
  training purposes.
- Cloudflare-managed crawler directives conflict with the repository-owned policy or append
  text to the application fallback.
- `robots.txt` or `sitemap.xml` falls through to the single-page application shell.
- A nonexistent URL, missing asset, test route, or admin route returns the homepage with a
  successful status.
- The social image is missing, changes dimensions, is not publicly accessible, or is cached
  after replacement.
- Organization metadata uses a brand name that differs from visible branding or the chosen
  site name.
- Search consoles have not yet processed the new domain or select an unexpected canonical.
- The homepage is rendered with a smartphone user agent and receives the intended gate.
- A metadata change deploys while the previous frontend snapshot remains active.

## Scope and Constraints _(mandatory)_

- **In scope**: Canonical production origin and permanent host/protocol redirects; homepage
  title, description, canonical and indexing metadata; branded social preview metadata and
  image; favicon and accessible logo identity; minimal website and publisher structured data;
  valid `robots.txt`; purpose-specific search/retrieval/training crawler policy; valid
  one-URL sitemap; correct content types and cache behavior for discovery files; true
  not-found outcomes for unknown public paths; free webmaster registration/submission and
  synthetic validation; removal of client-side visitor analytics; and operational guidance.
- **Out of scope**: Individual event pages; venue pages; date, category, price, neighbourhood,
  or filter collections; articles, guides, FAQs, or editorial content; mobile event
  information; event structured data; keyword-volume tooling; paid SEO/GEO services; backlink
  campaigns; crawler-only pages; `llms.txt` or Markdown-for-agent content; application redesign;
  guaranteed rankings, rich results, answer-engine mentions, or citations.
- **Evidence and dependencies**: Homepage claims MUST describe the existing product accurately.
  Crawler identities and directives MUST be checked against current primary operator
  documentation. Only free webmaster and validation capabilities may be used. External
  console delays or outages MUST NOT affect public availability.
- **Privacy and lifecycle**: Public use remains anonymous. No behavioral analytics, advertising
  identifiers, client tracking beacons, or new personal data may be collected. Aggregate
  webmaster reports, verified crawler requests, and synthetic checks are operational evidence.
- **Experience**: The current full 3D desktop application and current mobile device gate remain
  visually and behaviorally unchanged except for metadata and removal of the analytics beacon.
  The feature MUST NOT expose event information on mobile or serve privileged content to a
  smartphone crawler.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `https://amblefinds.com/` MUST be the single canonical public homepage.
- **FR-002**: HTTP, `www`, and the public worker-development hostname MUST permanently redirect
  to the equivalent canonical production URL without loops or multi-hop chains.
- **FR-003**: The homepage MUST use the title `Amble: See What’s Happening in Singapore` and
  return one useful description, one absolute self-canonical URL, and explicit index/follow
  permission.
- **FR-004**: Homepage metadata MUST accurately describe Amble as a desktop 3D Singapore event
  discovery map and MUST NOT imply mobile event access, comprehensive coverage, ticket sales,
  event organization, or unsupported authority.
- **FR-005**: The existing mobile gate MUST remain the public mobile experience on every Amble
  route; crawler handling MUST NOT create a richer bot-only mobile page.
- **FR-006**: The homepage MUST provide accurate Open Graph and social-card metadata containing
  an absolute canonical URL, title, description, site name, locale, image, image dimensions,
  and descriptive image alternative.
- **FR-007**: Social, favicon, wordmark, and logo assets used for identity MUST be publicly
  accessible, stable, correctly typed, appropriately sized, and permitted for Amble's use.
- **FR-008**: Homepage machine-readable identity MUST describe only the actual website and
  publisher/brand using facts also visible or directly verifiable on the page.
- **FR-009**: This phase MUST NOT emit event, venue, review, rating, offer, FAQ, or other
  content-specific structured data that the homepage does not visibly support.
- **FR-010**: `robots.txt` MUST return successful plain text containing only valid crawler
  directives, the canonical sitemap location, and the reviewed content-use policy; it MUST
  never include application HTML.
- **FR-011**: Traditional search, answer-search, user-retrieval, and model-training crawlers
  MUST be reviewed as separate purposes; search and user-retrieval access MUST be allowed,
  while the no-training preference MUST be expressed for reviewed training crawlers.
- **FR-012**: Edge-level crawler enforcement MUST agree with the published directives and MUST
  verify crawler identity where enforcement relies on more than a voluntary instruction.
- **FR-013**: `sitemap.xml` MUST return successful valid XML with the appropriate content type
  and contain `https://amblefinds.com/` exactly once.
- **FR-014**: The sitemap MUST exclude aliases, development hosts, admin/test routes, assets,
  API URLs, query parameters, fragments, and non-successful or non-indexable URLs.
- **FR-015**: Sitemap modification time, if supplied, MUST represent a meaningful homepage
  content change and MUST NOT be regenerated on every request.
- **FR-016**: Unknown public paths and missing assets MUST return true not-found responses;
  private admin paths MUST retain their existing public denial behavior and MUST not appear in
  discovery files.
- **FR-017**: Discovery files and identity assets MUST use cache behavior that permits timely
  policy/brand correction without producing unnecessary crawler downloads.
- **FR-018**: The public application MUST not send the existing or any replacement client-side
  visitor analytics beacon and MUST not create a new persistent analytics identifier.
- **FR-019**: The operator MUST be able to verify the domain with configured free webmaster
  services, submit the canonical sitemap, inspect the canonical homepage, and review crawl and
  index outcomes without exposing credentials in the repository.
- **FR-020**: Automated validation MUST cover canonical and alternate origins; metadata;
  structured identity; preview and favicon assets; crawler-purpose policy; crawler-file
  syntax/content types; sitemap membership; missing paths/assets; mobile gate; absence of
  analytics requests; and preservation of the existing desktop application.
- **FR-021**: A failed redirect, metadata, asset, crawler-policy, sitemap, status-code, privacy,
  build, or browser gate MUST prevent publication and preserve the previous working deployment.
- **FR-022**: Operational documentation MUST explain canonical-host policy, metadata ownership,
  crawler categories, no-training policy, sitemap submission, webmaster verification,
  synthetic checks, cache updates, rollback, and the deliberate limitations of this phase.

### Key Entities

- **Canonical Site Identity**: The official hostname, site name, brand/publisher name,
  language, description, logo, and canonical relationships used consistently across metadata.
- **Homepage Metadata Set**: Title, description, canonical, indexing, social preview, locale,
  image, and favicon references for the single indexable page.
- **Crawler Purpose Policy**: Reviewed allow/block intent for traditional search,
  answer-search, user-triggered retrieval, and model training.
- **Discovery File**: A public crawler-control or sitemap response with its format, content
  type, cache policy, canonical references, and validation state.
- **Webmaster Verification**: Secret-safe ownership proof and aggregate crawl/index status for
  a configured free search platform.
- **Release Validation Record**: Evidence that canonical, metadata, crawler, sitemap, status,
  privacy, mobile-gate, and existing-desktop checks passed for a deployment.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The canonical homepage passes 100% of title, description, canonical, indexing,
  social-preview, favicon, and structured-identity checks with zero unsupported factual claims.
- **SC-002**: HTTP, `www`, and the worker-development origin reach the canonical production
  homepage in one permanent redirect, with zero loops and zero alternate successful copies.
- **SC-003**: `robots.txt` passes its syntax checks with zero application-shell contamination;
  every reviewed crawler purpose receives the documented allow or no-training instruction.
- **SC-004**: `sitemap.xml` passes XML and URL validation, contains exactly one canonical
  homepage URL, and contains zero aliases, parameters, assets, APIs, or non-success URLs.
- **SC-005**: 100% of tested unknown paths and missing assets return a true not-found response,
  while the canonical homepage and discovery files return successful correctly typed responses.
- **SC-006**: Link-preview checks obtain the intended canonical title, description, image,
  dimensions, alternative, and destination from every configured preview parser.
- **SC-007**: Browser-network checks across the required matrix record zero analytics or
  advertising beacon requests and zero new persistent visitor identifiers.
- **SC-008**: Existing desktop acceptance tests and the existing mobile device-gate tests pass
  without a user-visible application regression.
- **SC-009**: Each configured free webmaster service accepts domain ownership and the canonical
  sitemap, or records a specific external blocker without affecting release correctness.
- **SC-010**: Every failed release fixture leaves the prior canonical redirects, homepage,
  metadata, assets, crawler policy, and sitemap unchanged.

## Assumptions

- The canonical product remains a single indexable homepage during this phase.
- The public brand and structured-data site name remain `Amble`; the longer approved wording
  is the homepage title, not a brand rename.
- The domain `amblefinds.com` is canonical; `www` is only a redirecting alias.
- Mobile event discovery is intentionally excluded despite its negative effect on mobile-first
  search potential.
- Search and answer-engine retrieval should be permitted, while model-training collection
  should remain disallowed.
- Paid keyword, backlink, rendering, analytics, and SEO platforms remain prohibited.
- Search rankings and generative citations cannot be promised from technical changes alone;
  this phase establishes correctness and eligibility for future content work.
