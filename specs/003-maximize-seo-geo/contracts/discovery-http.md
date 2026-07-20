# Contract: Public Discovery HTTP Surface

**Canonical origin**: `https://amblefinds.com`

**Contract version**: 1.0

This contract covers public HTML identity, canonical redirects, crawler documents, and true
not-found behavior. Existing API, tile, and private-admin contracts remain unchanged.

## Global rules

- Security headers already owned by the Cloudflare Worker apply to every Worker-produced and
  asset response.
- GET and HEAD are supported for homepage, discovery documents, and static assets. HEAD returns
  the same status and headers as GET with no body.
- Discovery endpoints reject unsupported methods with 405 and `Allow: GET, HEAD`.
- Canonical redirects run before private, API, tile, discovery, and static-asset routing.
- Redirect status is 308 so method semantics remain stable.
- All absolute public identity URLs use HTTPS and `amblefinds.com` without `www`.

## Redirect matrix

| Request                                       | Expected response | Location                          |
| --------------------------------------------- | ----------------: | --------------------------------- |
| `http://amblefinds.com/`                      |               308 | `https://amblefinds.com/`         |
| `https://www.amblefinds.com/`                 |               308 | `https://amblefinds.com/`         |
| `http://www.amblefinds.com/path?q=1`          |               308 | `https://amblefinds.com/path?q=1` |
| `https://amble.project-hub-arnav.workers.dev/path?q=1` |               308 | `https://amblefinds.com/path?q=1` |
| `https://amblefinds.com/index.html`           |               308 | `https://amblefinds.com/`         |
| `https://amblefinds.com/`                     |       no redirect | —                                 |

An alias request for an unknown path redirects once; the resulting canonical request returns 404. Only the exact `amble.project-hub-arnav.workers.dev` host is a configured Worker alias; the
implementation must not redirect an arbitrary `*.workers.dev` hostname. Fragments are not sent
in HTTP requests and are outside the server contract.

## GET `/`

### Response

- Status: 200
- Content-Type: `text/html; charset=utf-8`
- Cache: existing homepage revalidation policy
- Body: production HTML containing exactly one approved metadata set

### Required observable fields

- Title: `Amble: See What’s Happening in Singapore`
- Description: `Explore Singapore in 3D and discover events happening across the city. Amble
turns what’s on into an interactive desktop map.`
- Canonical: `https://amblefinds.com/`
- Indexing: index/follow permitted
- Open Graph: website type, Amble site name, `en_SG`, title, description, canonical URL,
  1200×630 image, and descriptive image alternative
- Social card: large image using the same identity
- JSON-LD: supported WebSite and Organization only
- Favicons/touch icon: stable same-origin assets
- Analytics: no Cloudflare Insights or replacement visitor beacon

### Behavioral invariants

- Desktop continues to load the full 3D application.
- Mobile continues to render the current desktop-required gate and does not load the 3D bundle.
- Smartphone crawlers receive the same HTML metadata and gate as smartphone users.

## GET `/robots.txt`

### Response

- Status: 200
- Content-Type: `text/plain; charset=utf-8`
- Cache-Control: `public, max-age=3600, must-revalidate`
- Body: valid RFC 9309-compatible groups rendered from the reviewed crawler contract

### Required content

- General public crawling allowed.
- Private/admin paths disallowed as defense in depth while still returning 404 at runtime.
- Search/answer/user-retrieval agents allowed.
- Dedicated training/control agents disallowed.
- Exactly one sitemap line:
  `Sitemap: https://amblefinds.com/sitemap.xml`
- No HTML, Cloudflare marketing text, contradictory group, or non-directive content.

## GET `/sitemap.xml`

### Response

- Status: 200
- Content-Type: `application/xml; charset=utf-8`
- Cache-Control: `public, max-age=3600, must-revalidate`
- Body: valid XML sitemap protocol document

### Required membership

```text
https://amblefinds.com/
```

The URL occurs exactly once. No aliases, Workers hostname, APIs, assets, admin/test routes,
query strings, fragments, or unknown paths are included. `lastmod` is omitted until a
deterministic meaningful-content date is supplied.

## Static identity assets

| Path                           | Expected status/type    | Additional rule               |
| ------------------------------ | ----------------------- | ----------------------------- |
| `/brand/amble-social-card.png` | 200 `image/png`         | Exactly 1200×630 and ≤500 KiB |
| Approved logo path             | 200 matching image type | JSON-LD URL is identical      |
| Approved favicon paths         | 200 matching image type | Declared sizes match bytes    |

Assets are public without cookies, redirects to third parties, or authentication. Cache headers
may be long-lived only when a content-hashed filename or explicit replacement process prevents
stale identity from persisting.

## Not-found behavior

| Request class                               |            Expected status |
| ------------------------------------------- | -------------------------: |
| Unknown HTML path such as `/events/example` |                        404 |
| Missing asset such as `/brand/missing.png`  |                        404 |
| Public `/admin.html`                        |                        404 |
| Public `/api/admin/*`                       |                        404 |
| Unknown `/api/*`                            | Existing JSON 404 contract |

Unknown HTML paths never return the homepage body, title, or status 200. Missing static assets
retain security headers after `ASSETS.fetch`.

## Failure and rollback contract

- A redirect loop, more than one redirect hop, successful alias copy, malformed discovery body,
  wrong content type, missing identity asset, analytics request, soft 404, or device regression
  is a mandatory failure.
- Mandatory failures prevent deploy. If discovered only after deploy, restore the previous
  Cloudflare Worker version and re-run the live contract.
- Search-console processing delay is recorded as an external blocker, not an HTTP-contract
  failure.
