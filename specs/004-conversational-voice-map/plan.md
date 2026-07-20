# Implementation Plan: Conversational Voice Map Assistant

**Branch**: `develop` | **Date**: 2026-07-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-conversational-voice-map/spec.md`

## Summary

Add a voice-first, text-capable conversational layer that turns vague intent into grounded,
area-first recommendations and exposes every public application action through one deterministic
action registry. The browser sends bounded audio/text turns through a server-mediated realtime
relay; the server owns the OpenAI credential, model configuration, tool allowlist, and a global
lifetime USD 10 budget ledger. Separate MapLibre layers render recommended URA subzones, a shared
user-location marker/accuracy state, and authoritative MRT stations and rail lines. Existing direct
controls remain the fallback and invoke the same application commands as voice.

## Technical Context

**Language/Version**: Browser and Worker JavaScript ES modules; Node.js 24 for local runtime,
scripts, and tests

**Primary Dependencies**: Existing Vite 8, MapLibre GL 1.15, Deck.gl 8.5, Cloudflare Workers/D1;
OpenAI Realtime API pinned to `gpt-realtime-2.1`; server-side WebSocket support; browser Media
Capture and Web Audio APIs; versioned GeoJSON derived from data.gov.sg

**Storage**: D1 global budget ledger and immutable reservation/settlement rows containing no audio,
transcript, location, or UI context; in-memory conversation state only; checked-in versioned
GeoJSON and source manifests for URA subzones and MRT context

**Testing**: Node test runner for pure models/contracts, Playwright desktop/mobile Chromium,
WebKit, and Firefox with mocked audio/realtime streams, existing build and production verification,
and frontend performance benchmarks

**Target Platform**: Current desktop and mobile Chrome, Safari, Firefox, and Edge; Cloudflare
Worker production runtime with a Node local-development equivalent

**Project Type**: Anonymous public web application with browser map UI, static generated map
assets, and thin local/Cloudflare API adapters

**Performance Goals**: Visible listening/acting feedback within 250 ms of local state changes;
first assistant audio/text begins within 4 seconds for at least 90% of mocked representative turns;
map pan/zoom remains visually smooth with no more than 10% regression in the existing benchmark;
area, location, and MRT layers update without rebuilding 3D tiles

**Constraints**: Operational owner is Arnav (project owner). Voice has one cumulative lifetime cap
of USD 10 (`10_000_000` micro-USD), no automatic reset, and no paid fallback. The standard API key
never reaches the browser. The relay reserves a conservative worst-case amount before every audio
transcription and model response. Raw audio, transcripts, exact location, screenshots, and UI
context are never persisted by the application. Microphone use is explicit and continuous
background listening is prohibited. Existing direct interactions must keep working when voice is
disabled. Current security headers and device gate require scoped changes.

**Scale/Scope**: One public application and global voice budget; anonymous sessions limited to five
minutes, sixty seconds idle, and six assistant responses initially; 100% of first-release public UI
actions represented in the action registry; Singapore-wide subzone, MRT station, and rail-line
assets; one production host with D1-backed atomic reservations

## Constitution Check

_GATE: Passed before Phase 0 and re-checked after Phase 1 design._

- **Branch workflow — PASS**: Work stays on `develop`; the numbered Spec Kit directory is not a Git
  branch.
- **Evidence — PASS**: Conversational output can reference only approved snapshot entities,
  approved restaurant results, deterministic application state, and versioned government map
  assets. Unknown IDs, unsupported attributes, and stale evidence fail closed.
- **Automation — PASS**: Action execution, reference resolution, recommendation validation, asset
  generation, usage reservation, settlement, cleanup, and release gates are deterministic code.
  The model proposes typed intents and actions but never owns workflow or authorization.
- **Identity and publication — PASS**: Existing stable entity IDs remain authoritative. Area and
  transit assets carry source IDs, content hashes, schema versions, and create/update/no-op/review
  status. Generated assets are staged and validated before replacement; failed refreshes preserve
  the last approved version.
- **Boundaries — PASS**: Conversation, discovery, action gateway, map presentation, location,
  transit assets, budget policy, and provider relay have separate contracts and thin adapters.
- **Quality and security — PASS**: The design includes schema validation, same-origin checks,
  bounded audio and messages, server-only secrets, action allowlists, confirmation fingerprints,
  cleanup tests, fail-closed reservations, mocked API tests, build gates, and production security
  checks.
- **UX and performance — PASS**: Mobile support becomes foundational. The required automated
  browser matrix, live transcripts, visible microphone states, reduced-motion behavior,
  accessible controls, and before/after map benchmarks are release gates.
- **Operations and privacy — PASS**: Constitution v2.2.0 explicitly permits this Realtime API use.
  Arnav owns it; the cumulative cap is USD 10; D1 and environment kill switches fail closed; no
  paid fallback exists; and terminal session paths clear application-held personal context.

### Post-design re-check

Phase 1 contracts retain all gates. The backend relay is more complex than direct WebRTC, but it is
required to prevent an anonymous or modified client from bypassing the spending ceiling. No
constitution violation or unjustified exception remains.

## Project Structure

### Documentation (this feature)

```text
specs/004-conversational-voice-map/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── discovery-result.schema.json
│   ├── realtime-relay.md
│   ├── runtime-map-assets.md
│   └── voice-action.schema.json
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
activity-scenes/
├── assistant/
│   ├── action-gateway.js
│   ├── action-registry.js
│   ├── assistant-controller.js
│   ├── assistant-view.js
│   ├── confirmation-controller.js
│   ├── conversation-model.js
│   ├── discovery-model.js
│   ├── interface-context.js
│   └── realtime-relay-client.js
├── location/
│   ├── location-controller.js
│   └── location-model.js
├── events/                         # existing event controllers/models adapted to actions
├── planning/                       # existing planning controllers/models adapted to actions
├── restaurants/                    # existing restaurant controllers/models adapted to actions
├── landmark-event-search.js        # existing UI delegates to action registry
├── plan-builder.js                 # existing UI consumes shared location/actions
└── restaurant-explorer.js          # existing UI delegates to action registry

map-layers/
├── building-highlight-layers.js    # unchanged 3D lifecycle boundary
├── discovery-area-layers.js
├── location-context-layers.js
└── transit-context-layers.js

cloudflare/
├── cloud-native-worker.mjs
├── realtime-relay.mjs
├── voice-budget-repository.mjs
└── migrations/
    └── 0003_voice_budget.sql

scripts/
├── build-discovery-areas.mjs
├── build-transit-context.mjs
├── realtime-voice-api-plugin.cjs
├── serve-app.cjs
└── lib/
    ├── realtime-policy.mjs
    └── voice-budget-ledger.mjs

data/
├── discovery-areas.geojson
├── discovery-areas-manifest.json
├── transit-context.geojson
├── transit-context-manifest.json
└── provider-policy.json

tests/
├── assistant-action-registry.test.mjs
├── assistant-confirmation.test.mjs
├── assistant-context.test.mjs
├── assistant-discovery.test.mjs
├── realtime-relay.test.mjs
├── transit-location.test.mjs
├── voice-budget.test.mjs
├── voice-assistant.spec.mjs
└── voice-action-coverage.spec.mjs
```

**Structure Decision**: Preserve the current single web application. Add small pure browser models
under `activity-scenes/assistant/`, isolated MapLibre managers under `map-layers/`, and parallel
local/Cloudflare relay adapters around shared policy and budget logic. Do not route area or transit
rendering through the performance-sensitive 3D building manager. During implementation, re-read
dirty target files immediately before editing and sequence overlapping files rather than applying
broad rewrites.

## Complexity Tracking

No constitution violations require justification. The backend WebSocket relay and D1 reservation
ledger are deliberate complexity within the approved exception: direct browser Realtime access
cannot authoritatively prevent modified anonymous clients from exceeding the global cap.
