# Data Model: Technical SEO and GEO Foundation

This feature adds no database tables. Its models are small, version-controlled configuration,
HTML metadata, edge responses, owned assets, and ephemeral validation evidence.

## 1. Canonical Site Identity

Stable identity for the public product.

| Field               | Type                       | Required | Value/rule                                   |
| ------------------- | -------------------------- | -------: | -------------------------------------------- |
| `schemaVersion`     | string                     |      yes | `1.0`                                        |
| `canonicalOrigin`   | absolute HTTPS URL         |      yes | `https://amblefinds.com`                     |
| `canonicalHomepage` | absolute HTTPS URL         |      yes | `https://amblefinds.com/`                    |
| `workerAliasHost`   | hostname                   |      yes | `amble.amble-sg.workers.dev` exact match     |
| `siteName`          | string                     |      yes | `Amble`                                      |
| `publisherName`     | string                     |      yes | `Amble`                                      |
| `language`          | BCP 47 string              |      yes | `en-SG`                                      |
| `locale`            | Open Graph locale          |      yes | `en_SG`                                      |
| `description`       | string                     |      yes | Accurate approved desktop 3D-map description |
| `websiteId`         | absolute URL with fragment |      yes | `https://amblefinds.com/#website`            |
| `organizationId`    | absolute URL with fragment |      yes | `https://amblefinds.com/#organization`       |
| `logoUrl`           | same-origin absolute URL   |      yes | Stable public Amble-owned logo               |

### Validation

- Canonical URLs use HTTPS, contain no query/fragment except stable entity IDs, and agree across
  HTML, JSON-LD, redirects, sitemap, robots, and social metadata.
- Worker alias matching is exact; a generic `*.workers.dev` suffix is invalid.
- Site and publisher names remain `Amble`; the homepage title is not treated as a brand rename.
- The description must mention the desktop/3D map accurately and must not claim comprehensive
  coverage, ticket sales, mobile event access, or event ownership.

## 2. Homepage Metadata Set

The initial HTML contract for `/`.

| Field           | Type    | Required | Rule                                             |
| --------------- | ------- | -------: | ------------------------------------------------ |
| `title`         | string  |      yes | `Amble: See What’s Happening in Singapore`       |
| `description`   | string  |      yes | Same approved identity description               |
| `canonical`     | URL     |      yes | Canonical homepage exactly once                  |
| `robots`        | string  |      yes | Allows indexing and following                    |
| `ogType`        | string  |      yes | `website`                                        |
| `ogSiteName`    | string  |      yes | `Amble`                                          |
| `ogLocale`      | string  |      yes | `en_SG`                                          |
| `ogTitle`       | string  |      yes | Approved homepage title                          |
| `ogDescription` | string  |      yes | Approved description                             |
| `ogUrl`         | URL     |      yes | Canonical homepage                               |
| `ogImage`       | URL     |      yes | Absolute social-card URL                         |
| `ogImageWidth`  | integer |      yes | `1200`                                           |
| `ogImageHeight` | integer |      yes | `630`                                            |
| `ogImageAlt`    | string  |      yes | Describes wordmark and actual 3D Singapore map   |
| `socialCard`    | string  |      yes | Large-image card                                 |
| `icons`         | list    |      yes | At least browser favicon plus touch icon         |
| `jsonLdGraph`   | list    |      yes | Exactly supported WebSite and Organization nodes |

### Relationships

- Belongs to one Canonical Site Identity.
- References one Social Preview Asset and one or more Identity Assets.
- `WebSite.publisher` references `organizationId`.
- Every URL field resolves to the canonical origin except standards-defined fragment IDs.

### Validation

- Values appear in initial HTML without JavaScript.
- Exactly one title, description, canonical, robots directive, and JSON-LD script are present.
- Social fields and JSON-LD repeat the same identity rather than introducing synonyms.
- No analytics script or analytics connection host is present.

## 3. Identity Asset

Committed, publicly fetchable brand artifact.

| Field        | Type            |    Required | Rule                                                 |
| ------------ | --------------- | ----------: | ---------------------------------------------------- |
| `id`         | enum            |         yes | `social-card`, `logo`, `favicon`, or `touch-icon`    |
| `path`       | repository path |         yes | Under `public/brand/`                                |
| `publicUrl`  | absolute URL    |         yes | Canonical same-origin URL                            |
| `mimeType`   | string          |         yes | Matches actual bytes and response header             |
| `width`      | integer         |         yes | Positive and appropriate to role                     |
| `height`     | integer         |         yes | Positive and appropriate to role                     |
| `byteLength` | integer         |         yes | Social card ≤500 KiB; icons bounded by verifier      |
| `alt`        | string/null     | conditional | Required for social/logo semantics; null for favicon |
| `provenance` | string          |         yes | Amble-owned source asset and composition description |

### Validation

- Social card is exactly 1200×630 and visibly includes the Amble wordmark plus a real map view.
- Files are stable and accessible without cookies or authentication.
- Replacements change file content and deploy atomically with referencing metadata; cache-busted
  filenames are preferred for material replacements.

## 4. Crawler Purpose Policy

Reviewed intent grouped by purpose rather than treating every bot as equivalent.

| Field             | Type        | Required | Rule                                                                      |
| ----------------- | ----------- | -------: | ------------------------------------------------------------------------- |
| `schemaVersion`   | string      |      yes | `1.0`                                                                     |
| `purpose`         | enum        |      yes | `traditional-search`, `answer-search`, `user-retrieval`, `model-training` |
| `agent`           | string      |      yes | Exact primary-source token                                                |
| `access`          | enum        |      yes | `allow` or `disallow`                                                     |
| `paths`           | list        |      yes | `/` for allow or disallow intent                                          |
| `evidenceUrl`     | HTTPS URL   |      yes | Primary operator documentation                                            |
| `reviewedAt`      | ISO date    |      yes | Release-time review date                                                  |
| `edgeEnforcement` | enum        |      yes | `voluntary`, `verified-bot-rule`, or `not-available`                      |
| `notes`           | string/null |       no | Scope caveat, e.g. no effect on ordinary search                           |

### Validation

- Traditional search, answer search, and user retrieval are allowed.
- Dedicated model-training agents are disallowed.
- No rule claims verified enforcement when it matches only raw `User-Agent` text.
- Every named agent has current primary-source evidence and a test case.

## 5. Discovery Response

Deterministic public response for `robots.txt` or `sitemap.xml`.

| Field           | Type    | Required | Rule                                            |
| --------------- | ------- | -------: | ----------------------------------------------- |
| `kind`          | enum    |      yes | `robots` or `sitemap`                           |
| `path`          | string  |      yes | `/robots.txt` or `/sitemap.xml`                 |
| `methods`       | list    |      yes | GET and HEAD                                    |
| `status`        | integer |      yes | 200 for supported methods                       |
| `contentType`   | string  |      yes | Plain text or XML with UTF-8                    |
| `cacheControl`  | string  |      yes | Bounded public cache; permits timely correction |
| `body`          | string  |      yes | Deterministic and syntactically valid           |
| `canonicalUrls` | list    |      yes | Canonical sitemap reference or homepage only    |

### Validation

- HEAD returns the same status/headers with no response body.
- Unsupported methods return 405 plus `Allow: GET, HEAD`.
- Robots contains no HTML and points to the canonical sitemap.
- Sitemap contains the canonical homepage exactly once and no other URL.
- Sitemap omits `lastmod` unless its value comes from a meaningful committed content change.

## 6. Canonical Redirect Rule

Host/protocol/path normalization contract.

| Field           | Type    | Required | Rule                                                     |
| --------------- | ------- | -------: | -------------------------------------------------------- |
| `match`         | object  |      yes | HTTP protocol, `www`, Workers dev host, or `/index.html` |
| `status`        | integer |      yes | 308 permanent redirect                                   |
| `targetOrigin`  | URL     |      yes | Canonical origin                                         |
| `pathTransform` | enum    |      yes | Preserve path or normalize index to `/`                  |
| `queryPolicy`   | enum    |      yes | Preserve query on equivalent redirect                    |
| `hopCount`      | integer |      yes | Exactly 1                                                |

### Validation

- Target never points back to an alias or forms a loop.
- Unknown paths may redirect once from an alias but then receive canonical 404.
- Fragments are browser-only and cannot be asserted by the server.

## 7. Webmaster Verification

Operator-owned external state; no credentials are stored in the model.

| Field        | Type         | Required | Rule                                              |
| ------------ | ------------ | -------: | ------------------------------------------------- |
| `provider`   | enum         |      yes | `google-search-console` or `bing-webmaster-tools` |
| `property`   | string       |      yes | `amblefinds.com` domain property                  |
| `method`     | enum         |      yes | `dns-txt`                                         |
| `state`      | enum         |      yes | See transitions below                             |
| `sitemapUrl` | URL          |      yes | Canonical sitemap                                 |
| `checkedAt`  | ISO datetime |       no | Operator observation time                         |
| `blocker`    | string/null  |       no | Sanitized external reason only                    |

### State transitions

```text
unconfigured → dns-pending → verified → sitemap-submitted → processed
                         ↘ external-blocker ↗
```

- `external-blocker` is non-fatal to technical release and may return to the prior actionable
  state when DNS/provider processing changes.
- Tokens, cookies, account identifiers, screenshots containing private data, and credentials
  are never committed.

## 8. Release Validation Record

Ephemeral, non-personal evidence for a candidate deployment.

| Field                      | Type         |    Required | Rule                                      |
| -------------------------- | ------------ | ----------: | ----------------------------------------- |
| `schemaVersion`            | string       |         yes | `1.0`                                     |
| `candidateCommit`          | Git SHA      |         yes | Exact tested commit                       |
| `workerVersion`            | string/null  | conditional | Set after deployment                      |
| `startedAt` / `finishedAt` | ISO datetime |         yes | Bounded run                               |
| `checks`                   | list         |         yes | Named status plus sanitized evidence      |
| `overallStatus`            | enum         |         yes | `passed`, `failed`, or `external-blocker` |
| `rollbackVersion`          | string/null  | conditional | Previous deploy for recovery              |

### State transitions

```text
draft → locally-validated → deployed-candidate → live-verified → accepted
   ↘ failed-local                         ↘ failed-live → rolled-back
```

- Any mandatory failed check prevents publication or triggers rollback.
- Webmaster processing is recorded separately as an external blocker and does not convert a
  technically correct deployment into a failure.
- Routine records remain ignored under `outputs/`; CI logs follow existing repository policy.

## Cross-entity invariants

1. Every canonical URL equals or is rooted at `https://amblefinds.com/`.
2. `Amble` is the only site/publisher name; the approved longer phrase is the page title.
3. Initial HTML, JSON-LD, social metadata, sitemap, and redirects describe the same identity.
4. Discovery rules allow search/retrieval and disallow training without user-agent cloaking.
5. There is one indexable HTML route and no event-level structured data.
6. The desktop app and mobile gate receive the same metadata and no crawler-only content.
7. No model contains visitor, analytics, advertising, or persistent-user identifiers.
