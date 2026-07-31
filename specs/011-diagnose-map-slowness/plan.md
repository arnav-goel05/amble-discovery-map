# Implementation Plan: Diagnose Map Slowness

**Branch**: `develop` | **Date**: 2026-07-25 | **Spec**: [spec.md](spec.md)

## Summary

Extend the existing local performance tooling with a deterministic diagnostic harness that
runs repeated, single-variable scene ablations and separates cold loading from warm,
network-idle camera movement. Add opt-in scene controls and bounded layer/tileset snapshots
that are inert outside diagnostics. Capture browser frame/long-task/network/memory evidence,
renderer and selected-tile state, and asset-level model/texture characteristics. Aggregate
compatible trials into causal comparisons and produce an audit that drills from subsystem
to individual renderer operation or asset class. Research solutions only after causes are
confirmed; do not apply an optimization.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 24 and current Chromium

**Primary Dependencies**: Existing Playwright 1.61, MapLibre 1.15, Deck.gl/Luma.gl 8.5,
loaders.gl 3D Tiles 3.0, Three.js 0.161, browser Performance APIs, and Chrome DevTools
Protocol; no new dependency

**Storage**: Versioned checked-in diagnostic configuration/schema and audit; ignored local
raw trial reports, traces, and extracted asset profiles

**Testing**: Node test runner, focused Playwright diagnostics, ESLint, existing production
build, schema validation, and deterministic aggregation fixtures

**Target Platform**: Local desktop Chromium for causal profiling; existing cross-browser
support remains unchanged because diagnostic controls are opt-in and inert otherwise

**Project Type**: Single-page WebGL map application with Node-based diagnostic tooling

**Performance Goals**: Measurement rather than optimization: at least three valid trials
per variant, separate phase windows, compatible controls, effect sizes in milliseconds per
frame and FPS, and at least 90% attribution of the full-to-light scene delta or an explicit
residual interaction

**Constraints**: No production optimization, no remote telemetry, no public default
change, no paid tool, no personal/application-content capture, bounded runs, and invalid
trials excluded from causal aggregation

**Scale/Scope**: One fixed desktop route, cold/warm/network-idle phases, approximately
eight top-level workload variants, targeted follow-up ablations for confirmed expensive
layers, and asset profiling only for resources observed in valid trials

## Constitution Check

- **Branch workflow — PASS**: Work remains on `develop`; no branch is created or switched.
- **Evidence — PASS**: Claims require recorded browser, renderer, network, scene, and asset
  evidence. Unsupported measurements and invalid trials remain explicit.
- **Automation — PASS**: Variant selection, repeated trials, validation, aggregation,
  causal ranking, trace capture, and asset inspection are deterministic and bounded.
- **Identity and publication — PASS / not applicable**: No event, venue, restaurant, map
  identity, approved snapshot, or publication workflow changes.
- **Boundaries — PASS**: Diagnostic configuration/aggregation, browser execution, opt-in
  scene controls, and asset inspection have separate contracts. Raw outputs stay ignored.
- **Quality and security — PASS**: Variant validation, lifecycle cleanup, schema,
  aggregation, browser execution, lint, and build coverage are required. Diagnostics expose
  no administrative or secret-bearing surface.
- **UX and performance — PASS**: Ordinary sessions allocate no new diagnostic work.
  Diagnostics are explicitly enabled, bounded, and measure their own validity. No
  production rendering change is authorized.
- **Operations and privacy — PASS**: All tooling is local and free/open. Reports contain
  aggregate timings and asset paths, not user location, search, event, restaurant, plan,
  or conversation content.

Post-design re-check: PASS. The contracts require opt-in activation, local artifacts,
single-variable comparisons, invalid-trial isolation, and no optimization.

## Project Structure

### Documentation

```text
specs/011-diagnose-map-slowness/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── map-performance-diagnostic.schema.json
├── checklists/
│   └── requirements.md
├── audit-report.md
└── tasks.md
```

### Source Code

```text
activity-scenes/
└── performance-diagnostic-variants.js

map-layers/
└── building-highlight-layers.js

scripts/
├── diagnose-map-performance.mjs
├── inspect-3d-tile-assets.mjs
└── lib/
    └── map-performance-diagnostics.mjs

tests/
├── map-performance-diagnostics.test.mjs
└── map-performance-diagnostics.spec.mjs

config/
└── map-performance-diagnostic-variants.json

main.js
package.json
```

**Structure Decision**: Reuse the existing application and benchmark stack. The app owns
only validated opt-in scene controls and bounded layer snapshots; the Node scripts own
browser execution, traces, local files, asset parsing, aggregation, and audit evidence.

## Complexity Tracking

No constitution violations or new dependencies require justification.
