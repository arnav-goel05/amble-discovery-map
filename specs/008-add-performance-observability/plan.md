# Implementation Plan: Performance Observability

**Branch**: `develop` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-add-performance-observability/spec.md`

## Summary

Add diagnostics that explain frontend cost without collecting analytics. An explicit URL
flag conditionally loads a lifecycle-owned runtime collector and compact overlay before the
main application. The collector uses browser timing capabilities and whitelisted aggregate
map counters, exposes a bounded snapshot, and performs no network or persistent storage.
The existing Playwright benchmark gains a pure, versioned, profile-aware budget evaluator,
enforced release guardrails, validated report schema, and clearer Markdown output.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 24 and current evergreen browsers

**Primary Dependencies**: Existing browser Performance APIs, MapLibre lifecycle events,
Playwright 1.61, Vite 8; no new runtime or hosted dependency

**Storage**: Checked-in JSON budget configuration; ignored local JSON/Markdown benchmark
reports; exported runtime snapshots only on explicit developer action

**Testing**: Node test runner, Playwright browser tests, ESLint, Vite production build,
existing production verification and benchmark commands

**Target Platform**: Current desktop/mobile Chromium, WebKit, and Firefox; heap reporting
is capability-dependent

**Project Type**: Single-page map application with Node-based release tooling

**Performance Goals**: Diagnostic UI refreshes at most once per second; motion frame
sampling exists only while the map moves; disabled diagnostics allocate no observers,
diagnostic timers, animation loops, or requests; snapshot stays below 100 KiB

**Constraints**: No user analytics, remote telemetry, persistence, location/content capture,
new paid service, third-party SDK, or app-start failure caused by diagnostics

**Scale/Scope**: Four existing benchmark profiles, seven core runtime signal groups, one
developer overlay, one versioned export, and profile-specific red-line regression budgets

## Constitution Check

- **Branch workflow — PASS**: Work remains on `develop`; no branch is created or switched.
- **Evidence — PASS**: Measurements originate from browser performance capabilities and
  explicit aggregate map counters. Unsupported values are represented as unsupported.
- **Automation — PASS**: Collection, budget evaluation, schema validation, report writing,
  enforcement, and cleanup are deterministic and bounded.
- **Identity and publication — PASS / not applicable**: No product entity or approved
  snapshot is changed. Benchmark artifacts remain ignored and runtime exports are explicit.
- **Boundaries — PASS**: Runtime collection/view, pure budget evaluation, benchmark adapter,
  and checked-in configuration have separate contracts and versioned schemas.
- **Quality and security — PASS**: Unit, privacy, browser, lint, build, and release benchmark
  coverage are required. No credential or external-content boundary is added.
- **UX and performance — PASS**: The overlay is opt-in, compact, keyboard-accessible,
  capability-aware, and lifecycle-safe. The existing browser matrix and visual-quality
  restoration gate remain intact.
- **Operations and privacy — PASS**: No external service is used. No automatic retention or
  upload occurs; exports strictly whitelist aggregate numeric signals.

Post-design re-check: PASS. The contracts prohibit telemetry and arbitrary DOM/application
state export, and the planned sampling lifecycle satisfies the continuous-work constraint.

## Project Structure

### Documentation (this feature)

```text
specs/008-add-performance-observability/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── performance-budget.schema.json
│   └── performance-snapshot.schema.json
└── tasks.md
```

### Source Code (repository root)

```text
activity-scenes/
├── performance-diagnostics-model.js
├── performance-diagnostics-view.js
└── performance-diagnostics.js

config/
└── frontend-performance-budgets.json

scripts/
├── benchmark-frontend-performance.mjs
└── lib/
    └── frontend-performance-budgets.mjs

tests/
├── performance-observability.test.mjs
├── performance-observability.spec.mjs
├── performance-budgets.test.mjs
└── no-telemetry.test.mjs

app-entry.js
main.js
style.css
package.json
docs/performance-baseline.md
```

**Structure Decision**: Keep the implementation inside the existing single web application.
Runtime collection belongs to an isolated activity-scene module; release evaluation belongs
to a pure scripts library; the executable benchmark remains a thin browser/filesystem
adapter.

## Complexity Tracking

No constitution violations or new dependencies require justification.
