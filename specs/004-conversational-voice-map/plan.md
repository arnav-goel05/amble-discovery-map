# Implementation Plan: Conversational Voice Map Assistant

**Branch**: `develop` | **Date**: 2026-07-18 | **Amended**: 2026-07-27 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-conversational-voice-map/spec.md`

## Summary

Complete the voice-first, text-capable conversational layer by replacing its success-only action
bridge with one shared, versioned capability registry containing both queries and commands.
Application-owned connectors expose authoritative approved catalogue, event, restaurant, map,
discovery-area, plan, location, transit, overlay/navigation, tour, and conditional saved/game state.
Queries return bounded domain results with stable identities; commands use the same executor as
direct controls and publish a refreshed authoritative context revision. The browser continues to
send bounded audio/text turns through the server-mediated Realtime relay. Event sentences from the
direct composer and connected assistant pass through one deterministic, side-effect-free
interpreter and one atomic `event.applyquery` executor, so recognized What/When/Where/Price phrases,
residual query text, ambiguity, and refinements cannot drift. When online voice is unavailable, the
voice session terminates with an explicit unavailable state; ordinary composer, search, and direct
controls remain available without becoming an offline voice assistant. A disabled, non-networked
MCP descriptor projector establishes a future transport boundary over the same registry and
gateway, with no MCP server, listener, client, credential, or runtime dependency.
The paid relay uses only `gpt-realtime-2.1-mini`. Obvious map, transit-layer, and event-filter
commands are interpreted deterministically and executed through the shared gateway before the
model acknowledges them. Each response receives only foundational queries plus the connector
families selected from the bounded request and current interface state.

## Technical Context

**Language/Version**: Browser and Worker JavaScript ES modules; Node.js 24 for local runtime,
scripts, and tests

**Primary Dependencies**: Existing Vite 8, MapLibre GL 1.15, Deck.gl 8.5, Cloudflare Workers/D1;
OpenAI Realtime API pinned to `gpt-realtime-2.1-mini` with no model fallback; server-side WebSocket support; browser Media
Capture and Web Audio APIs; versioned GeoJSON derived from data.gov.sg; no new third-party account
connector or MCP runtime dependency

**Storage**: D1 global budget ledger and immutable reservation/settlement rows containing no audio,
transcript, location, or UI context; in-memory conversation state only; checked-in versioned
GeoJSON and source manifests for URA subzones and MRT context

**Testing**: Node test runner for pure models/contracts, Playwright desktop/mobile Chromium,
WebKit, and Firefox with mocked audio/realtime streams, existing build and production verification,
frontend performance benchmarks, deterministic event-interpreter parity fixtures, atomic
composer-state tests, and disabled MCP projection contract tests

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
disabled. Voice-service failure must stop capture/playback, clear pending/session state, display the
required unavailable message, and never silently invoke a local voice interpreter. MCP projection
code is disabled and transport-free. Current security headers and device gate require scoped
changes.

**Scale/Scope**: One public application and global voice budget; anonymous sessions limited to five
minutes, sixty seconds idle, and six assistant responses initially; 100% of eligible first-release
public UI capabilities represented in the shared registry; three foundational read capabilities
(`app.inspect`, `catalog.search`, `catalog.get`) plus domain commands; eleven active
application-owned connector families, one unregistered conditional-content extension family, four
infrastructure adapters, one event interpreter with typed future domain-interpreter seams, one
disabled protocol projection foundation, and two cross-cutting services (context coordination and
confirmation);
Singapore-wide subzone, MRT station, and rail-line assets; one production host with D1-backed
atomic reservations

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
- **Shared capabilities — PASS**: The design defines one registry for typed queries and commands,
  one executor per application domain shared with direct controls, bounded stable-ID query results,
  observable command outcomes, monotonic post-command context revisions, contextual eligibility,
  and common contract fixtures across local, test, preview, and production. Realtime function tools
  expose the in-app registry. The MCP foundation derives descriptors from that same registry, is
  disabled and non-networked, and cannot own business logic or bypass the gateway.
- **Deterministic interpretation — PASS**: Event language normalization is side-effect-free and
  shares Feature 015's catalogue grammar with the direct composer. Only the event domain executor
  can atomically commit the complete revision-bound proposal; ambiguity, invalid compounds, and
  stale proposals commit nothing.
- **Quality and security — PASS**: The design includes schema validation, same-origin checks,
  bounded audio and messages, server-only secrets, action allowlists, confirmation fingerprints,
  cleanup tests, fail-closed reservations, mocked API tests, build gates, and production security
  checks.
- **Failure honesty — PASS**: Online voice failure is terminal for the voice session, uses one exact
  unavailable message, clears capture/playback and pending state, and leaves regular direct search
  available without presenting it as an offline assistant.
- **UX and performance — PASS**: Mobile support becomes foundational. The required automated
  browser matrix, live transcripts, visible microphone states, reduced-motion behavior,
  accessible controls, and before/after map benchmarks are release gates.
- **Operations and privacy — PASS**: Constitution v2.4.0 retains the Realtime API exception first
  approved in v2.2.0. Arnav owns it; the cumulative cap is USD 10; D1 and environment kill switches
  fail closed; no paid fallback exists; and terminal session paths clear application-held personal
  context.

### Post-design re-check

Phase 1 contracts retain all gates. The backend relay is more complex than direct WebRTC, but it is
required to prevent an anonymous or modified client from bypassing the spending ceiling. The
connector matrix rejects unrelated email, calendar, messaging, storage, and collaboration
connectors because Amble has no matching public capability or authorization lifecycle. No
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
│   ├── capability-connector-architecture.md
│   ├── capability-contract.schema.json
│   ├── capability-result.schema.json
│   ├── app-inspect-result.schema.json
│   ├── catalog-get-result.schema.json
│   ├── catalog-search-result.schema.json
│   ├── domain-interpretation.schema.json
│   ├── event-apply-query-result.schema.json
│   ├── mcp-tool-projection.schema.json
│   ├── mcp-adapter-boundary.md
│   ├── discovery-result.schema.json
│   ├── public-action-inventory.md
│   ├── realtime-relay.md
│   ├── runtime-map-assets.md
│   └── voice-action.schema.json          # legacy action-contract compatibility during migration
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
activity-scenes/
├── assistant/
│   ├── action-gateway.js
│   ├── action-registry.js
│   ├── capability-registry.js
│   ├── capability-result.js
│   ├── context-coordinator.js
│   ├── session-lifecycle-router.js
│   ├── assistant-controller.js
│   ├── assistant-view.js
│   ├── confirmation-controller.js
│   ├── conversation-model.js
│   ├── discovery-model.js
│   ├── interface-context.js
│   ├── interpreters/
│   │   ├── domain-intent-router.js
│   │   └── event-query-interpreter.js
│   ├── protocol-adapters/
│   │   ├── capability-descriptor-projector.js
│   │   ├── realtime-function-adapter.js
│   │   └── mcp-foundation-adapter.js
│   ├── queries/
│   │   ├── app-inspect.js
│   │   ├── catalog-get.js
│   │   └── catalog-search.js
│   ├── connectors/
│   │   ├── approved-catalog-connector.js
│   │   ├── application-state-connector.js
│   │   ├── event-connector.js
│   │   ├── restaurant-connector.js
│   │   ├── map-connector.js
│   │   ├── discovery-area-connector.js
│   │   ├── plan-connector.js
│   │   ├── location-connector.js
│   │   ├── transit-connector.js
│   │   ├── overlay-navigation-connector.js
│   │   ├── tour-connector.js
│   │   └── conditional-content-connector.js
│   └── realtime-relay-client.js
├── location/
│   ├── location-controller.js
│   └── location-model.js
├── events/
│   ├── event-query-classifier.js   # existing Feature 015 deterministic classifier
│   └── event-query-controller.js   # authoritative atomic composer-state owner
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
├── assistant-capability-contract.test.mjs
├── assistant-catalog-query.test.mjs
├── assistant-connector-parity.test.mjs
├── assistant-context-coordinator.test.mjs
├── assistant-action-registry.test.mjs
├── assistant-confirmation.test.mjs
├── assistant-context.test.mjs
├── assistant-domain-interpreter.test.mjs
├── assistant-event-query-integration.test.mjs
├── assistant-mcp-foundation.test.mjs
├── assistant-discovery.test.mjs
├── realtime-relay.test.mjs
├── transit-location.test.mjs
├── voice-budget.test.mjs
├── voice-assistant.spec.mjs
└── voice-action-coverage.spec.mjs
```

**Structure Decision**: Preserve the current single web application and migrate the existing action
registry into a capability registry rather than adding a second assistant backend. Domain connectors
wrap existing authoritative controllers; they do not reimplement controller behavior. Query modules
project bounded approved results, while the context coordinator subscribes to both direct and
assistant-originated state changes. Local and Cloudflare relay adapters receive the same registry
definitions and fixtures. The event interpreter reuses the direct composer's deterministic
classifier but never mutates state; `event.applyquery` is the sole atomic sentence-level executor.
Protocol adapters derive descriptors from capability contracts. The Realtime adapter is active for
connected voice, while the MCP foundation adapter remains disabled and has no transport surface.
Do not route area or transit rendering through the performance-sensitive 3D building manager.
During implementation, re-read dirty target files immediately before editing and sequence
overlapping files rather than applying broad rewrites.

The migration MUST add the currently missing event placement/multi-value filter, filter-removal,
occurrence-selection, session-expansion, and map-attribution capabilities within the existing
`events` and `overlay-navigation` connectors. The version-1 action registry may exist only as a
generated one-way compatibility view until protocol-1.1 verification passes; it cannot own runtime
executors.

The amendment MUST add `event.applyquery` without weakening `event.setfilter` or
`event.removefilter`, expose canonical `EventComposerState` in authoritative context, reject
ambiguous/stale/invalid compound proposals without partial mutation, and project the version-2
registry into closed MCP foundation fixtures. It MUST NOT open a port or route, register an MCP
transport, add an MCP runtime dependency or credential, or implement external-client
authorization.

## Complexity Tracking

No constitution violations require justification. The backend WebSocket relay and D1 reservation
ledger are deliberate complexity within the approved exception: direct browser Realtime access
cannot authoritatively prevent modified anonymous clients from exceeding the global cap.
