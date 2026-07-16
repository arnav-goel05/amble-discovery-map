# Script index

The executable files remain at this directory's top level because their paths are part of npm commands, tests, deployment templates, and event-pipeline continuation contracts. Shared implementation code lives in `lib/`.

## Application and APIs

- `serve-app.cjs` - production Node server
- `*-api-plugin.cjs` - Vite and server API integrations
- `configure-telegram-webhook.mjs` - Telegram webhook setup

## Events and publication

- `event-pipeline.mjs` - staged event-pipeline entry point
- `event-source-collector.mjs`, `event-normalizer.mjs`, and `reconcile-event-content.mjs` - collection and normalization
- `event-frontend-snapshot.mjs` and `process-event-pill-eligibility.mjs` - frontend publication artifacts
- `run-weekly-refresh.mjs` - scheduled event and restaurant refresh

## Restaurants

- `restaurant-pipeline.mjs` - restaurant and deal refresh entry point
- `restaurant-api-plugin.cjs` - viewport restaurant API

## Venues and OneMap

- `build-local-venue-index.mjs`, `search-local-venues.mjs`, and `resolve-venues-locally.mjs` - offline venue index
- `enrich-event-locations.mjs`, `query-onemap-location.mjs`, and `update-venue-registry.mjs` - venue evidence and approved mappings
- `extract-web-evidence.mjs` - authoritative webpage evidence extraction

## 3D tiles and models

- `fetch-tiles.mjs`, `optimize-tiles.mjs`, and `prune-tileset.mjs` - background-tile preparation
- `extract-poi-tileset.mjs` and `extract-cbd-poi-tilesets.mjs` - POI geometry extraction
- `build-combined-poi-tileset.mjs` - combined event-venue manifest
- `create-esplanade-concert-*` - editable Blender source and exported runtime models

## Verification and maintenance

- `verify-*.mjs` - release and artifact contracts
- `smoke-*.mjs` - production smoke checks
- `benchmark-frontend-performance.mjs` - browser performance contract
- `migrate-*.mjs` - explicit data migrations

Run scripts through the commands in `package.json` whenever one exists. Several pipeline commands have stricter continuation rules documented in `AGENTS.md`.
