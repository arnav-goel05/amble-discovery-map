# Free/open restaurant and deal pipeline

Restaurant discovery is user-triggered and limited to the current map viewport. The executable allowlist in `data/provider-policy.json` permits only:

1. OpenStreetMap/Overpass for mapped restaurants and venue details.
2. OpenStreetMap evidence, the approved website registry, and Wikidata P856 for official-site resolution.
3. Direct HTTP retrieval from an evidenced official site and its same-origin promotion pages.

There is no paid search, rendering, scraping, or emergency fallback. Configuration validation fails closed if a provider is missing, disabled, outside its approved domains, or not classified `free`/`open`.

## Evidence and access rules

- Fetch `robots.txt` before an official page and obey the longest matching wildcard rule.
- Follow only public-network URLs and bounded responses; promotion links remain on the verified official origin.
- Publish a deal only when a concrete promotion benefit appears on the current official page.
- Preserve provider identity, cost class, official URL, retrieval method, observation time, evidence excerpt, extractor version, and evidence hash.
- Reject expired evidence. A stale cache may describe restaurants or still-valid deal evidence as **potentially outdated** with its last-checked time, but it never makes an expired claim current.
- Missing websites or optional restaurant fields remain absent. Record `no_deals_found`, `not_available`, or `unavailable` instead of inventing values.

The service first attempts a fresh request. If it fails, it may return only a previously approved exact viewport or applicable overlapping viewport in the common stale envelope. With no approved fallback it returns an explicit unavailable result.

## Operation and verification

Run a bounded refresh:

```sh
npm run restaurant-pipeline -- start --bbox south,west,north,east
```

Exit code `3` means continuation is required. Repair the recorded stage and resume the same run:

```sh
npm run restaurant-pipeline -- resume --run <run-id>
```

Use `--retry-unavailable` only after external availability changes. Runtime runs and caches stay under ignored `outputs/restaurant-pipeline/`; never publish them as approved data.

Verify with:

```sh
npm run test:restaurants
npm run build
```
