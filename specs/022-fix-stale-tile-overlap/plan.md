# Implementation Plan: Eliminate Stale Highlight Overlap

**Branch**: `develop` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-fix-stale-tile-overlap/spec.md`

## Summary

Eliminate duplicate venue surfaces by treating active highlight geometry and its
corresponding background removals as one publication unit. A deterministic Node.js
library will derive all active background objects and selected GML identities from the
approved snapshot and extraction manifests. A CLI will audit remote R2 objects, upload
only mismatches, verify every active object, and publish the root tileset manifest last
with SHA-256 query versions on active content URIs. The application will select that
manifest through a checked-in release descriptor, making cache invalidation explicit.

## Technical Context

**Language/Version**: JavaScript on Node.js 22; browser ES modules

**Primary Dependencies**: Node built-ins, Wrangler CLI, existing Vite/deck.gl application

**Storage**: Local B3DM/JSON files and Cloudflare R2 bucket `amble-3d-tiles`

**Testing**: Node test runner, existing Playwright browser suite, production-origin audit

**Target Platform**: Cloudflare Worker/R2; current desktop and mobile browsers

**Project Type**: Web application plus deterministic operator CLI

**Performance Goals**: Audit 665 active objects with bounded concurrency; skip byte-identical
objects; no extra frame-time work in the renderer

**Constraints**: No credentials in repository or reports; bounded retries; tileset manifest
published only after full object parity; failures return non-zero and cannot activate a release

**Scale/Scope**: 136 active POIs, 665 unique active background B3DM objects, 77 spatial tile
chains and six supported detail levels

## Constitution Check

- **Branch workflow**: PASS. Work remains on `develop`.
- **Evidence**: PASS. Approved snapshot POIs and extraction manifests define identities and
  local expected SHA-256 values; R2 responses provide served bytes. Missing or malformed
  evidence is a named failure, never inferred.
- **Automation**: PASS. Enumeration, inspection, synchronization, retries, verification,
  manifest rewriting, and reports are deterministic code paths with bounded inputs/outputs.
- **Identity and publication**: PASS. Stable identity is the R2 object key; classification is
  matched/stale/failed. Objects are staged and verified before the release manifest is
  uploaded last. The prior manifest remains active on failure.
- **Boundaries**: PASS. The audit library owns derivation and validation, the CLI owns
  orchestration, and Wrangler is a thin external upload adapter. Report schema is versioned.
- **Shared capabilities**: PASS. The map remains the only consumer. Local, preview, and
  production use the same release URL contract. No conversational command semantics change.
- **Quality and security**: PASS. Pure unit tests cover classification and manifest versioning;
  integration tests cover interruption/resumption. Wrangler owns credentials and no secret
  values enter reports.
- **UX and performance**: PASS. No interaction or layout changes. Browser verification covers
  refinement and National Stadium after the asset repair; rendering work is unchanged.
- **Operations and privacy**: PASS. Only public GML identifiers and content hashes are written
  to gitignored reports. No user data, databases, remote telemetry, or paid source is added.

Post-design re-check: PASS. The manifest-last protocol, digest query keys, and application
release descriptor close the publication/cache boundary without adding a second state owner.

## Project Structure

### Documentation (this feature)

```text
specs/022-fix-stale-tile-overlap/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── background-geometry-audit.schema.json
│   └── background-geometry-release.schema.json
└── tasks.md
```

### Source Code (repository root)

```text
data/
└── background-geometry-release.json
scripts/
├── lib/
│   └── background-geometry-release.mjs
└── sync-r2-background-tiles.mjs
tests/
└── background-geometry-release.test.mjs
main.js
package.json
```

**Structure Decision**: Extend the existing single-project layout. The pure release logic lives
under `scripts/lib`, the operator entry point lives under `scripts`, the map consumes one small
validated descriptor from `data`, and tests use the repository's existing Node test runner.

## Complexity Tracking

No constitution violations require justification.
