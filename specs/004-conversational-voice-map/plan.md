# Implementation Plan: Conversational Voice Map Assistant

**Branch**: `develop` | **Date**: 2026-07-18 | **Amended**: 2026-08-01 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-conversational-voice-map/spec.md`

## Summary

**2026-08-01 superseding amendment**: Native ingress no longer creates or joins a provider
classification response. The relay routes its final transcript with a deterministic allowlist.
Event interpretation extracts current-catalogue facets and ignores unmatched wording unless the
user explicitly requests an event keyword search. The bounded deterministic vocabulary covers all
active connector families; safe target-free commands may execute directly, while target-bearing
and consequential actions retain scoped connector tools and the existing gateway safeguards.
Earlier classification/join passages below are retained as implementation history.

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
The paid relay uses only `gpt-realtime-2.1-mini`. Text turns retain deterministic map,
transit-layer, and event-filter interpretation plus connector-family scoping. Audio turns start
input transcription and native-audio classification concurrently after commit. The first response
exposes only one forced provider-only classification tool whose schema contains domain and optional
event facets but no utterance. The relay joins that proposal with the final provider transcript for
the same committed audio item, then reuses deterministic text routing or exposes one relevant
connector family. Lower-level event search/filter primitives remain available to
direct controls but are withheld from the provider. Every routed audio capability still passes
through the existing registry, browser-owned confirmation, shared executor, validated result, and
refreshed-context path.
The relay also emits content-free structured phase timing for each turn and enforces a separate
30-second response watchdog, making provider stalls diagnosable and terminal without retaining
conversation content or imposing a response-token ceiling. When a developer explicitly starts the
local Node relay in content-debug mode, a separate process-local diagnostic stream may include
sanitized browser/provider messages, transcripts, prompts, and tool arguments/results. That mode is
off by default, cannot be activated by a browser request, is absent from preview/production wiring,
and recursively removes secrets and raw audio. A third explicit local audit flag may persist those
already-sanitized records as compact rotating JSONL in a fixed gitignored owner-only directory for
later debugging. The audit is bounded to five files below 5 MiB, cleaned after seven days, has no
remote transport, never invents missing native-audio transcripts, and cannot affect voice behavior
if local audit I/O fails.
At the provider boundary, canonical dotted capability IDs are projected through a validated
collision-free alias map into provider-safe function names and mapped back before any browser or
gateway interaction. Every initial and per-turn `session.update` becomes an acknowledged
configuration barrier: response creation waits for `session.updated`, provider errors terminate
through the standard unavailable path, and the opening exact-speech instruction exists only on its
single `response.create`. A bounded owner-authorized live smoke validates this real provider
contract after deterministic tests.
Native audio no longer begins with the complete eligible application inventory. Audio commit
forces one provider-only classification tool while enabling one relay-owned final input transcript.
The relay binds the transcript and current context revision to the classification and reuses the typed-turn router:
deterministic event/map/transit/session requests execute through their existing shared capability,
while unresolved requests receive at most one connector family's currently eligible tools. The
opening greeting and deterministic-result acknowledgement expose no application tools. This keeps
native speech output and barge-in, prevents `catalog.search` from competing with
`event.applyquery`, and keeps the initial native menu at one tool while removing the model-generated
utterance failure mode.

## Technical Context

**Language/Version**: Browser and Worker JavaScript ES modules; Node.js 24 for local runtime,
scripts, and tests

**Primary Dependencies**: Existing Vite 8, MapLibre GL 1.15, Deck.gl 8.5, Cloudflare Workers/D1;
OpenAI Realtime API pinned to `gpt-realtime-2.1-mini` with native audio input, one configured
low-latency input-transcription model, and no response-model fallback;
server-side WebSocket support; browser Media
Capture and Web Audio APIs; versioned GeoJSON derived from data.gov.sg; no new third-party account
connector or MCP runtime dependency

**Storage**: D1 global budget ledger and immutable reservation/settlement rows containing no audio,
transcript, location, or UI context; in-memory conversation and turn-timing state only; structured
operational logs containing allowlisted phase metadata only; optional explicitly activated local
developer content traces written to the current process output; and, only behind a separate local
audit flag, bounded sanitized JSONL under `outputs/realtime-content-audit/` with owner-only
permissions, rotation, age cleanup, and no database/browser-storage/remote sink; checked-in
versioned GeoJSON and source manifests for URA subzones and MRT context

**Testing**: Node test runner for pure models/contracts, Playwright desktop/mobile Chromium,
WebKit, and Firefox with mocked audio/realtime streams, existing build and production verification,
frontend performance benchmarks, deterministic event-interpreter parity fixtures, atomic
composer-state tests, disabled MCP projection contract tests, phase-order and log-privacy tests,
native-audio transcript/classification join ordering and capability-boundary fixtures, deterministic response-watchdog
tests using an injected scheduler, local-content diagnostic activation/redaction/environment-
isolation fixtures, and persistent-audit activation, permissions, rotation, retention, compaction,
oversize-record, terminal-reason, and non-interference fixtures; provider-alias round-trip,
native-audio single-event-query projection and legacy-filter exclusion fixtures,
forced native classification, deterministic route reuse, connector-menu cardinality,
malformed-classification, missing/empty/failed/stale/duplicate transcript, and join-cleanup fixtures,
configuration-acknowledgement ordering, provider-error termination, one-shot welcome, stable audit
fingerprint, and bounded live-smoke fixtures

**Target Platform**: Current desktop and mobile Chrome, Safari, Firefox, and Edge; Cloudflare
Worker production runtime with a Node local-development equivalent

**Project Type**: Anonymous public web application with browser map UI, static generated map
assets, and thin local/Cloudflare API adapters

**Performance Goals**: Visible listening/acting feedback within 250 ms of local state changes;
first assistant audio/text begins within 4 seconds for at least 90% of mocked representative turns;
classification and transcription begin concurrently; the join adds no serial startup delay and the
final user-facing response retains that 4-second mocked target;
stalled responses terminate within the configured 30-second deadline plus one scheduler interval;
map pan/zoom remains visually smooth with no more than 10% regression in the existing benchmark;
area, location, and MRT layers update without rebuilding 3D tiles

**Constraints**: Operational owner is Arnav (project owner). Voice has one cumulative lifetime cap
of USD 10 (`10_000_000` micro-USD), no automatic reset, and no paid fallback. The standard API key
never reaches the browser. The relay reserves the conservative response maximum before accepting
audio for a native-audio turn and independently admits at most one input-transcription operation. Raw
audio, transcripts, exact location, screenshots, and UI
context are never persisted by the application except for permitted provider-generated transcript
events in the separately activated bounded local developer audit. Microphone use is explicit and continuous
background listening is prohibited. Existing direct interactions must keep working when voice is
disabled. Voice-service failure must stop capture/playback, clear pending/session state, display the
required unavailable message, and never silently invoke a local voice interpreter. MCP projection
code is disabled and transport-free. Current security headers and device gate require scoped
changes. Content-bearing diagnostics require both an explicit process-start flag and the exact
local-development environment. Persistence additionally requires a separate audit flag. They may
preserve permitted text and structured payload fields for debugging, but must recursively omit
credentials, authentication material, raw session identities, and raw or encoded audio. Persistent
records are limited to the fixed gitignored owner-only directory, five files below 5 MiB, and seven
days, with no background or remote transport.

**Scale/Scope**: One public application and global voice budget; anonymous sessions have no
turn-count, assistant-response-count, maximum-duration, or idle-expiry limit; 100% of eligible
first-release
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
- **Native audio — PASS**: The approved Realtime model consumes session-scoped audio directly while
  the relay captures the provider's final input transcript as application-owned utterance evidence.
  Classification and transcription start concurrently, join by active provider item identity, and
  cannot mutate application state independently; typed registry validation and browser-owned
  confirmation remain authoritative.
- **Identity and publication — PASS**: Existing stable entity IDs remain authoritative. Area and
  transit assets carry source IDs, content hashes, schema versions, and create/update/no-op/review
  status. Generated assets are staged and validated before replacement; failed refreshes preserve
  the last approved version.
- **Boundaries — PASS**: Conversation, discovery, action gateway, map presentation, location,
  transit assets, budget policy, and provider relay have separate contracts and thin adapters.
- **Bounded local audit — PASS**: Constitution v2.7.0 permits only an explicitly triple-gated
  local-development sink after centralized sanitization. Fixed owner-only storage, strict
  size/count/age bounds, no network path, no synthetic transcript, and non-interference on I/O
  failure preserve the production privacy and runtime boundaries.
- **Provider contract — PASS**: Transport aliases are a thin reversible adapter over canonical
  registry identities, configuration acknowledgement is deterministic workflow owned by the
  relay, provider errors fail closed, and the bounded live smoke remains behind the existing owner
  authorization, lifetime cap, and terminal cleanup. The provider-only ingress has no executor and
  cannot enter the application registry or MCP projection.
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
  browser matrix, session-scoped transcript handling, visible microphone states, reduced-motion behavior,
  accessible controls, and before/after map benchmarks are release gates.
- **Operations and privacy — PASS**: Constitution v2.8.0 retains the Realtime API exception first
  approved in v2.2.0. Arnav owns it; the cumulative cap is USD 10; D1 and environment kill switches
  fail closed; no paid fallback exists; provider requests impose no application output-token
  ceiling; the provider intrinsic maximum is used only for conservative reservation; and terminal
  session paths clear application-held personal context. Operational logging is an allowlisted
  reliability surface rather than analytics: it contains a one-way session identifier, turn/phase
  codes, timestamps, durations, and terminal reasons only. Each response request owns a 30-second
  watchdog that bounds only that in-flight response and clears on every response/session terminal
  path. Content-bearing traces are a separate explicit local-development mode: default
  relay and all preview/production adapters cannot construct the logger; the browser protocol has
  no activation field; recursive sanitization removes credentials and audio payloads; and the only
  sink is the active local process output with no persistence or remote transport.

### Post-design re-check

Phase 1 contracts retain all gates. The backend relay is more complex than direct WebRTC, but it is
required to prevent an anonymous or modified client from bypassing the spending ceiling. The
connector matrix rejects unrelated email, calendar, messaging, storage, and collaboration
connectors because Amble has no matching public capability or authorization lifecycle. No
constitution violation or unjustified exception remains.

## Transcript-Owned Native-Audio Amendment (2026-07-31)

Audio commit remains the response-critical boundary. The relay independently admits one response
stage and one input-transcription operation, commits the provider audio buffer, exposes exactly one
forced provider-only classification tool, and immediately creates the classification response.
The classification contains no utterance. The final input transcript is matched to the committed
audio item and joined with the classification and relay-owned context before deterministic routing
or application mutation.

Text submissions and transcript-owned native utterances continue through the existing deterministic
interpreter and per-family tool scope. A deterministic command executes without another provider
choice. Only a non-deterministic classified request receives one connector family's eligible tools,
bounded to fifteen. This preserves the lower-ambiguity path while giving the application an
independently observable utterance rather than depending on optional tool arguments.

Provider tool choice does not confer authority. Every audio-originated function call remains
bounded by the registered schema, current eligibility, approved identities, browser-owned
confirmation class, shared application executor, result validation, and authoritative context
revision. Unknown, stale, malformed, or unavailable calls fail closed.

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

## Live Realtime reliability amendment (2026-07-30)

The owner-authorized sixteen-case matrix exposed failures that deterministic fixtures did not
represent: provider-shaped ingress variations were rejected before semantic verification, optional
event facets were treated as missing requirements, a refinement could not distinguish new evidence
from retained authoritative state, deterministic text execution was not represented faithfully by
the live harness, query narration lacked realistic result evidence, and browser/server payload
bounds disagreed.

Implementation proceeds by failure category rather than one case at a time:

1. Add one lossless ingress canonicalizer followed by the existing strict semantic verifier. It
   recognizes only the exact documented provider variations and never broadens accepted labels,
   evidence, domains, or cardinality.
2. Make event replacement and refinement semantics explicit. Omitted optional facets remain null;
   genuine ambiguity requires wording plus multiple current candidates; retained refinement state
   comes only from the authoritative composer snapshot.
3. Serialize deterministic text execution and final narration across configuration acknowledgement,
   browser execution, context refresh, and no-tool response creation.
4. Align browser/server payload limits and make oversize handling session-local.
5. Promote a faithful sixteen-case live matrix that executes browser-side deterministic and
   proposed capabilities with realistic structured results. Deterministic tests remain the primary
   regression gate; paid live repetition is used only for the owner-authorized final acceptance
   loop.

Rejected alternatives:

- Relaxing the ingress schema generally: this would accept invented or conflicting state.
- Prompt-only correction: live failures demonstrate that provider output cannot be the trust
  boundary.
- Treating every empty facet as unresolved: this causes unnecessary clarification.
- Re-running paid cases after every line-level edit: focused deterministic category tests provide
  faster proof without reducing final live coverage.

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
├── realtime-relay.mjs             # phase trace + response watchdog owner
├── voice-budget-repository.mjs
└── migrations/
    └── 0003_voice_budget.sql

scripts/
├── build-discovery-areas.mjs
├── build-transit-context.mjs
├── realtime-voice-api-plugin.cjs
├── serve-app.cjs
└── lib/
    ├── realtime-content-debug.mjs
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
├── realtime-content-debug.test.mjs
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

The transcript-owned amendment MUST configure one input-transcription model inside the existing
Realtime session and MUST add no separate audio upload or persistent transcript. The provider-only
classification descriptor is transport plumbing rather than a user-facing application
capability and therefore MUST NOT enter the shared capability inventory or MCP projection. Its
proposal is joined with the final active transcript and routed through the existing text-turn
interpreter boundary.
Application tools remain registry-derived; the Realtime adapter may only narrow them by the routed
connector and current eligibility. The adapter MUST NOT reimplement event, restaurant, map, plan,
or navigation business rules.

### Voice event facet proposal amendment

The forced native classification response will continue to be the only provider response before
event execution, and its closed arguments carry `domain` and an optional structured `eventQuery`
without an `utterance` member. Event proposals contain bounded evidence-backed What, When, Where, and Price labels,
meaningful residual text, and unresolved facets. The relay builds the ingress schema from a compact
bounded event-facet catalogue in authoritative interface context; it does not expose application
tools during ingress.

`activity-scenes/events/event-facet-proposal.js` will own pure deterministic verification. It maps
provider labels only to unique current catalogue options, verifies evidence against the final
relay-owned transcript, rejects invented/conflicting/stale values, strips request boilerplate from residual
text, and returns either a verified classification or bounded clarification. The existing event
interpreter and query controller reuse that verifier for native voice proposals. Typed and direct
queries omit the proposal and retain the existing deterministic classifier. Every accepted path
continues through the same versioned `event.applyquery` capability and event owner.

This design adds no dependency, API key, provider request, application capability, MCP descriptor,
or output-token limit. The existing response-stage budget, configuration acknowledgement,
watchdog, local audit, interruption, and terminal cleanup remain unchanged.

## Complexity Tracking

No constitution violations require justification. The backend WebSocket relay and D1 reservation
ledger are deliberate complexity within the approved exception: direct browser Realtime access
cannot authoritatively prevent modified anonymous clients from exceeding the global cap.
