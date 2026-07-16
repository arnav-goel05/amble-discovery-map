---
name: restaurant-discovery-pipeline
description: Run, resume, audit, and repair this repository's viewport restaurant discovery, official-website resolution, and deal-enrichment pipeline. Use when asked to scan visible map bounds for OpenStreetMap food venues, discover missing official sites, populate restaurant deal evidence, resume an incomplete restaurant run, validate restaurant UI/API behavior, or supervise a fresh end-to-end restaurant pipeline test.
---

# Restaurant Discovery Pipeline

Use the checked-in commands and configuration. Do not replace the Overpass endpoint contract, scrape unrelated aggregators, or invent a deal when an official page is unavailable.

## Run

Start a bounded viewport scan:

```sh
npm run restaurant-pipeline -- start --bbox south,west,north,east
```

Treat exit code `3` as `continuation_required`. Read the emitted `runId`, repair the failed or invalid stage, and resume the same run:

```sh
npm run restaurant-pipeline -- resume --run <run-id>
```

Use `--retry-unavailable` only when external availability changed. Do not discard a run merely because one endpoint or restaurant site failed.

## Evidence rules

- Use OpenStreetMap/Overpass for viewport membership and mapped restaurant details.
- Resolve a missing website only from the viewport's OSM tags, an explicitly approved website registry entry, exact-name evidence repeated in Singapore-wide OSM data, or Wikidata's official-website property. Leave it unresolved when those approved sources are insufficient.
- Accept a discovered website only when the restaurant identity and Singapore scope are unambiguous. Preserve competing candidates as `needs_review`; never pick one merely because it ranks first.
- Reject aggregators, delivery services, booking platforms, directories, and social profiles as official websites.
- Scrape only the verified official origin and same-origin promotion links.
- Respect `robots.txt`, public-network restrictions, response-size limits, and configured concurrency.
- Accept a deal only when the extracted evidence states a concrete benefit and is scoped to Singapore.
- Preserve the exact official source URL, observed time, evidence excerpt, extractor version, and evidence hash.
- Record `no_deals_found`, `not_available`, or `unavailable` explicitly; never turn generic “offers,” awards, ordering, or navigation text into a deal.
- Reuse fresh cache entries only when both their extractor and website-discovery versions match the current implementation.

## Audit and repair

Inspect `orchestrator-state.json`, `restaurants.json`, and per-restaurant deal results in the emitted run directory. Require every discovered restaurant to have one verified terminal enrichment result. Review every claimed deal for concrete benefit, duplicate claims, readable evidence, source scope, and working official URL.

After a code or extractor change, resume the same run. Use `--refresh true` after adding approved website evidence. The version gate must invalidate only affected enrichment stages while valid stages remain unchanged.

Run deterministic verification:

```sh
npm run test:restaurants
npm run build
```

Finish only when the CLI reports `complete: true`, tests pass, and the evidence audit has no false-positive, duplicate, foreign-scope, or truncated deal claim.

For a final clean-room check, start a new run with the same bounds after the repaired resume succeeds. Compare restaurant count, terminal stages, and deal evidence quality; do not copy artifacts from the earlier run.
