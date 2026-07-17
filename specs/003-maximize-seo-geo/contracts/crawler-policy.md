# Contract: Crawler Purpose Policy

**Policy intent**: `search=yes`, `ai-input=yes`, `ai-train=no`

**Contract version**: 1.0

## Purpose groups

| Purpose                  | Desired access | Reason                                                   |
| ------------------------ | -------------- | -------------------------------------------------------- |
| Traditional search       | Allow          | Make the canonical homepage eligible for ordinary search |
| AI answer search         | Allow          | Permit answer engines to discover and cite the homepage  |
| User-requested retrieval | Allow          | Permit assistants to open Amble when a user asks         |
| Dedicated model training | Disallow       | User explicitly declined training use                    |

## Initial reviewed identities

Every row requires release-time confirmation against its linked primary documentation. If an
identity is renamed or its purpose becomes ambiguous, classify it as `review` and do not invent
a replacement.

| Agent token        | Purpose                  | Access   | Evidence                                                                                                                                                      |
| ------------------ | ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Googlebot`        | Traditional search       | Allow    | [Google crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers)                                                     |
| `Bingbot`          | Traditional search       | Allow    | [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)                                                               |
| `OAI-SearchBot`    | AI answer search         | Allow    | [OpenAI bots](https://developers.openai.com/api/docs/bots)                                                                                                    |
| `ChatGPT-User`     | User-requested retrieval | Allow    | [OpenAI bots](https://developers.openai.com/api/docs/bots)                                                                                                    |
| `GPTBot`           | Model training           | Disallow | [OpenAI bots](https://developers.openai.com/api/docs/bots)                                                                                                    |
| `Claude-SearchBot` | AI answer search         | Allow    | [Anthropic crawler controls](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| `Claude-User`      | User-requested retrieval | Allow    | [Anthropic crawler controls](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| `ClaudeBot`        | Model training           | Disallow | [Anthropic crawler controls](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| `PerplexityBot`    | AI answer search         | Allow    | [Perplexity bots](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)                                                                              |
| `Perplexity-User`  | User-requested retrieval | Allow    | [Perplexity bots](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)                                                                              |
| `Google-Extended`  | Model-use control        | Disallow | [Google-Extended](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended)                                       |
| `CCBot`            | Dataset/model training   | Disallow | [Common Crawl bot](https://commoncrawl.org/ccbot)                                                                                                             |

## Enforcement levels

1. `robots.txt` expresses the public voluntary policy.
2. Cloudflare managed content signals/AI Crawl Control must express the same intent where
   available on the free account.
3. A hard edge rule may be used only when Cloudflare identifies a verified bot or published IP
   range. Raw user-agent matching alone must not be described as verified enforcement.
4. Unknown or spoofed agents receive ordinary public content; they never receive a richer page.
5. Private/admin paths remain 404 regardless of crawler identity.

## Change lifecycle

```text
documented → reviewed → configured → verified
     ↘ changed/retired → review → update-or-remove
```

- `documented`: primary operator source exists.
- `reviewed`: purpose and desired access match product policy.
- `configured`: repository robots output and optional Cloudflare rule agree.
- `verified`: live response and, when applicable, verified-bot behavior pass tests.
- `review`: purpose, spelling, or operator behavior is uncertain; retain the last known-safe
  configuration only if it remains non-contradictory.

## Validation cases

- Parser selects the most specific matching agent group according to RFC 9309 behavior.
- Every allowed search/retrieval token can fetch `/` and discovery files.
- Every training token receives `Disallow: /` in robots policy.
- `Google-Extended` blocking does not accidentally block `Googlebot`.
- Cloudflare does not append a contradictory or malformed managed policy.
- No response differs in substantive homepage content solely because of crawler identity.
- Renamed/retired agents cause a documented review failure rather than silent deletion.
