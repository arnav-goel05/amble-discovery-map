# Implementation Plan: Spatial Highlight Tiles

**Branch**: `develop` | **Date**: 2026-07-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-spatial-highlight-tiles/spec.md`

## Summary

Replace the served event-venue catalogue of 136 external per-venue tilesets with one sparse spatial hierarchy that validates all 818 extracted B3DM fragments but directly references only the 143 finest venue/spatial fragments. The deterministic builder uses the optimized background hierarchy as spatial and level evidence, prunes it to relevant branches, and attaches one zero-error finest-content leaf per branch. It validates catalogue parity, source provenance, bounds, URI safety, and asset reachability before an atomic write. The map layer URL, POI identities, visual material, selection behavior, and movement policy remain unchanged.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 24+; browser JavaScript

**Primary Dependencies**: Existing `@loaders.gl/3d-tiles` 3.0 and deck.gl `Tile3DLayer` 8.5; Node built-ins only for generation

**Storage**: Version-controlled JSON 3D Tiles catalogues, immutable approved snapshot files, and existing extracted B3DM assets

**Testing**: Node test runner, Playwright across desktop/mobile Chromium, WebKit, and Firefox, production Vite build, existing geometry-separation verifier

**Target Platform**: Current supported desktop and mobile web browsers; local, preview, Cloudflare, and production asset layouts

**Project Type**: Static web application with deterministic Node publication tooling

**Performance Goals**: Eliminate 136 possible venue-manifest round trips; request zero coarse highlight assets; retain spatial culling so off-screen finest assets are not requested

**Constraints**: Reuse existing geometry; no event collection, venue lookup, or extraction; keep direct asset paths portable between staging, immutable snapshots, and site-root serving; write atomically; no new dependency; changed modules should remain below 400 lines

**Scale/Scope**: Current active set of 136 approved venues, 143 venue/spatial branches, and 818 extracted fragments, while supporting future catalogue growth

## Constitution Check

- **Branch workflow — PASS**: The repository is and remains on `develop`; no branch is created or switched.
- **Evidence — PASS**: Inclusion comes only from the active approved POI catalogue. Fragment identity and hashes come from each venue's extraction manifest. Bounds and refinement values come from `optimized-tiles/tileset.json`. Missing evidence rejects the candidate.
- **Automation — PASS**: A deterministic builder owns hierarchy construction and validation. Inputs, structured output metadata, errors, and atomic write behavior are bounded and testable.
- **Identity and publication — PASS**: Stable `poi.id` is retained across every fragment. Unchanged byte-equivalent output is no-op; approved additions/changes are create/update; removal follows the approved catalogue. A failed assembled candidate cannot replace the served file or approved snapshot.
- **Boundaries — PASS**: The builder owns catalogue packaging; extraction manifests own fragment provenance; the optimized tileset owns spatial/refinement evidence; the map layer remains a thin consumer. The generated schema is versioned `spatial-highlight-v1`.
- **Shared capabilities — PASS**: No user-facing command or query changes. Existing map, event, direct UI, voice, and future MCP paths continue using stable POI identities and the same application executors.
- **Quality and security — PASS**: Unit/contract tests cover success, malformed evidence, unsafe paths, missing content, parity, determinism, and atomic preservation. Existing separation, map-rendering, browser, lint, format, and production build gates remain required.
- **UX and performance — PASS**: No interaction changes. The six-browser desktop/mobile matrix remains the release gate. A same-path before/after benchmark records request and timing measures.
- **Operations and privacy — PASS**: No service, credential, telemetry, personal data, cache, or background worker is added. Existing version-controlled deployment artifacts and single-host publication rules remain unchanged.

The check passes before research and remains satisfied after design. No constitutional exception is required.

## Project Structure

### Documentation

```text
specs/019-spatial-highlight-tiles/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── benchmark.md
├── quickstart.md
├── contracts/
│   ├── builder.md
│   └── spatial-highlight-tileset.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
scripts/
├── build-combined-poi-tileset.mjs
├── event-frontend-snapshot.mjs
├── event-pipeline.mjs
└── lib/
    └── spatial-highlight-tileset.mjs

public/poi-tiles/
├── event-venues/tileset.json
└── <poi-id>/
    ├── extraction-manifest.json
    └── <fragment>.b3dm

optimized-tiles/
└── tileset.json

tests/
├── spatial-highlight-tileset.test.mjs
├── combined-poi-tileset.test.mjs
├── building-highlight-movement.test.mjs
└── map-render-sync.spec.mjs
```

**Structure Decision**: Keep the existing single web application. Extract pure hierarchy construction and validation into one focused library module; retain CLI/input resolution and atomic filesystem publication in the existing builder. Pipeline and snapshot modules remain orchestration adapters.

## Design

1. Index every content node in the optimized background hierarchy by normalized source URI, retaining its exact bounds, geometric error, and ancestor path.
2. For each approved venue, validate every extraction-manifest fragment and group them by source spatial key. Sort each group coarse-to-detailed and select its minimum-level, finest available B3DM.
3. Attach each finest content leaf to a content-free sparse clone of the source hierarchy at the coarse fragment's parent. Give the leaf zero geometric error so it has no further highlight refinement stage.
4. Declare the approved venue catalogue once at top level; annotate content nodes with stable POI, source-tile, fragment, and level identities.
5. Validate the complete candidate, serialize deterministically, compare with existing output for no-op, and atomically rename only after validation.
6. Reuse this builder from normal builds and staged event publication. Store the same spatial candidate in future immutable snapshots after durable URI rewriting.

## Complexity Tracking

No constitution violations or exceptional complexity are required.
