# Phase 0 Research: Conversational Voice Map Assistant

## Realtime transport and authentication

**Decision**: Use a same-origin browser WebSocket to a backend relay, which maintains the provider
WebSocket connection. Keep `OPENAI_API_KEY`, model choice, session instructions, automatic-response
settings, tools, and budget/accounting bounds entirely server-side.

**Rationale**: OpenAI recommends WebRTC for browser media quality, but direct WebRTC requires a
client credential and lets a modified anonymous client submit provider events. Usage is reported
after work completes. A server relay is therefore required to authorize every billable turn before
it happens and enforce the cumulative cap. The relay sends only sanitized protocol events to the
browser. See [Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc),
[Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), and
[server controls](https://developers.openai.com/api/docs/guides/realtime-server-controls).

**Alternatives considered**: Direct browser WebRTC offers lower latency but cannot enforce the hard
anonymous-client budget. Ephemeral client secrets still expose a usable provider session. A
sideband monitor sees usage too late to be the sole admission control.

## Model and conversation bounds

**Decision**: Pin `gpt-realtime-2.1-mini` as the sole model in the paid-exception policy, with no
fallback model. Start with five-minute sessions, sixty-second idle expiry, six assistant responses,
4,000 post-instruction context tokens, low reasoning effort, no automatic provider response
creation, and no image input in the default flow. Do not transmit `max_output_tokens` in session or
response requests; OpenAI documents a default of `inf`, meaning the maximum available for the
model, and a 4,096-token Realtime response maximum. Pin 4,096 only as the conservative
response-cost reservation bound. Pin the supported input-transcription model and its rate formula
in the same policy before release.

**Rationale**: OpenAI positions the mini model as the faster, lower-cost Realtime voice option.
Small, request-scoped prompts and tools reduce input cost and bound the next-turn reservation.
Images are unnecessary when stable structured UI IDs are present. See the
[OpenAI API changelog](https://developers.openai.com/api/docs/changelog),
[GPT-Realtime-2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini),
[Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs), and
[Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).

Fixed guidance uses short, capitalized bullet rules plus a response-specific instruction override.
The exact text is provided once between explicit delimiters, and the prompt forbids additions,
omissions, repetition, translation, and paraphrase. This follows OpenAI's Realtime prompting
guidance to prefer precise short bullets, examples, and capitalization for important rules.

**Alternatives considered**: Full-size Realtime models and silent model fallback are rejected for
this feature because they increase cost and make the reviewed policy nondeterministic. Continuous
screenshot context adds cost, staleness, and location exposure. Unbounded sessions conflict with
the USD 10 ceiling. A lower application output-token ceiling was rejected because it can truncate
otherwise valid assistant responses; duration, response-count, context, interruption, spending,
and kill-switch controls retain bounded operation.

## Privacy-safe response tracing and stalled-response recovery

**Decision**: Emit one structured operational record at each applicable turn boundary:
`audio_committed`, `transcription_completed`, `response_requested`, `response_created`,
`first_audio`, `response_done`, and terminal failure. Records contain only a one-way session
identifier, monotonic turn number, bounded phase/event code, timestamp, elapsed durations, and
terminal reason. Start a separate 30-second watchdog when `response.create` is sent. Clear it on
`response.done`, cancellation, or any terminal session path. If it expires, emit
`response_timeout`, attempt `response.cancel`, conservatively reconcile the pending reservation
through the existing repository contract, and terminate through the standard provider-unavailable
path.

**Rationale**: Idle and maximum-session timers do not identify a single stalled provider response,
and unrelated browser/provider activity can keep an otherwise stuck session alive. Phase timing
shows whether delay occurred before transcription, response creation, or first audio without
recording user content. A dedicated deadline makes the failure bounded and testable while remaining
independent of the provider/model response-token limit prohibited by constitution v2.5.0.

**Alternatives considered**: Content-bearing logs remain prohibited in routine, preview, and
production operation. Relying on the five-minute session timer leaves the user in a processing
state too long. A browser-only timer cannot authoritatively cancel the provider or reconcile the
server-side reservation. A response token ceiling is unrelated to latency and is constitutionally
prohibited.

## Explicit local content diagnostics

**Decision**: Add a second diagnostic channel that exists only when the local Node relay process is
started with both `NODE_ENV=development` and `REALTIME_CONTENT_DEBUG=true`. The relay records all
permitted browser-to-relay, relay-to-provider, provider-to-relay, and relay-to-browser messages
after recursive sanitization. Transcripts, prompts, tool arguments/results, and non-sensitive
provider/browser fields remain visible. Credential-shaped values, authorization/cookie material,
raw session identities, and raw or encoded audio are replaced with bounded omission metadata. The
sink is synchronous process output only; records are never stored or transported.

**Rationale**: Phase timings identify where a stall occurs but cannot explain malformed provider
events, prompts, capability calls, or results. An explicit developer-only trace gives enough
evidence to reproduce those failures without weakening production privacy. Requiring the local
adapter to inject the logger makes activation structurally unavailable to the browser, Worker, and
preview/production configuration. Centralized sanitization prevents individual call sites from
forgetting audio or secret removal.

**Alternatives considered**: Always-on content logs, browser-controlled activation, Worker
environment flags, persistent debug files, remote telemetry, and raw audio capture are rejected.
Logging only selected tool events was also rejected because it would not diagnose ordering and
provider-body failures; the permitted sanitized protocol stream is more complete and simpler to
reason about.

## Deterministic command routing and per-turn tools

**Decision**: Recognize a deliberately narrow set of obvious application commands in a bounded,
side-effect-free browser interpreter. Execute recognized commands through the same capability
gateway as direct controls, then let the model provide the conversational acknowledgement. Before
each response, select only eligible capabilities from connector families indicated by the request
and current overlay; exclude a deterministically routed capability from that turn's provider tools.
For audio, wait for the final transcript before creating the response so this scope is available.

**Rationale**: Map camera and layer commands and deterministic event-filter phrases do not benefit
from probabilistic tool selection. Shared gateway execution preserves schema, eligibility,
confirmation, context-revision, and observable-result rules. Per-turn family selection avoids
re-sending the previously observed 63-tool eligible set and reduces both prompt cost and tool-choice
ambiguity.

**Alternatives considered**: Sending the full eligible registry on every context refresh leaves
tool selection entirely to the model and repeats irrelevant schemas. Building a second executor in
the interpreter would bypass the registry and is rejected. Broad natural-language parsing is also
rejected; unmatched requests remain with the scoped model path.

## Turn taking, interruption, and transcripts

**Decision**: Use explicit microphone activation. Start with semantic voice activity detection for
turn boundaries but keep provider automatic response creation disabled; the relay commits a bounded
turn only after budget reservation. Enable interruption, cancel queued output on new speech, and
provide push-to-talk and text input as fallbacks. Reconcile transcript deltas by provider item ID.

**Rationale**: Semantic detection better preserves hesitant conversational speech than silence-only
detection, while server-controlled response creation retains spending authority. Item identity
prevents duplicate or reordered transcript lines. Representative tests must cover Singlish,
code-switching, place names, MRT announcements, and barge-in. See
[voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad).

**Alternatives considered**: Always-on listening violates the specification. Server VAD is simpler
but more likely to cut off hesitant turns. Push-to-talk alone is less conversational and remains a
fallback rather than the default.

## Shared capability registry

**Decision**: Evolve the action registry into one versioned capability registry used by pointer,
keyboard, text, and voice. Every entry is explicitly a `query` or `command`. Queries read
authoritative domain state and return bounded validated results with stable identities. Commands
invoke the same executor used by direct UI and return an observable result containing status,
changed state, affected identities, and resulting context revision. The model may propose only
allowlisted capability IDs and closed JSON arguments; the gateway validates schema, eligible state,
stable targets, context revision, and confirmation class.

**Rationale**: Current behavior is distributed across DOM listeners and scene closures. Simulated
clicks would be incomplete and fragile. A shared command boundary makes 100% coverage measurable
and prevents model-generated selectors, URLs, or function names from becoming executable. Adding
queries fixes the existing gap where `event.search` and `restaurant.search` can change the UI but
return only success, leaving the assistant unable to inspect or discuss the results. Stable
session-level read tools cover common inspection; state-specific commands are exposed only when
eligible. See
[Realtime function calling](https://developers.openai.com/api/docs/guides/realtime-conversations#function-calling).

**Alternatives considered**: DOM automation cannot prove semantic equivalence. A single generic
`execute` tool is too permissive. Success-only command results cannot ground dependent turns.
Separate voice-only business logic would drift from direct UI.

During migration, any version-1 voice action definition is generated one-way from a compatible
version-2 command contract. It cannot register an executor or own runtime semantics, and it is
removed after protocol-1.1 coverage and deployment verification pass.

## Connector topology

**Decision**: Use twelve application-owned connector families:

1. approved catalogue;
2. aggregate application state;
3. events;
4. restaurants;
5. map camera and layers;
6. discovery areas;
7. plan;
8. location;
9. transit;
10. overlays, assistant navigation, and confirmed external routing;
11. feature tour;
12. conditional saved content and games.

The first eleven connector families are active. `conditional-content` is an unregistered extension
point until real saved/game data and matching direct controls exist. Keep four infrastructure
adapters outside the application capability layer: Realtime provider transport, browser audio I/O,
budget repository, and deterministic non-voice application access. The latter means the ordinary
composer, search, and direct controls remain usable without Realtime; it is not a local voice
assistant. Each application connector wraps one existing authoritative controller and implements
the common capability contract. Confirmed external routing resolves application-owned targets to
approved URLs; it never accepts a model-provided URL.

**Rationale**: These connectors cover every existing public application domain without importing
unrelated account or collaboration systems. A connector boundary gives the registry a consistent
way to inspect state, derive eligibility, execute, and produce a context patch, while preserving the
existing controller as the business owner.

**Alternatives considered**: A connector per DOM component would reproduce UI coupling. One large
application connector would hide ownership and make eligibility hard to test. Outlook, Gmail,
Calendar, Slack, Teams, SharePoint, Box, and similar connectors have no matching Amble public
feature or anonymous authorization lifecycle and are therefore excluded.

The confirmation gateway and context coordinator remain cross-cutting application services, not
additional connectors. Protected consent, push-to-talk, and confirmation controls remain
browser-owned. Stop, mute, unmute, and interrupt may use a deterministic local lifecycle router so
they do not depend on another provider turn.

## Realtime function tools and the MCP foundation

**Decision**: Expose Amble's in-app registry to Realtime as application-owned function tools. Do not
add a remote MCP server or built-in account connector for the first-release integration. Add a
disabled, non-networked MCP projection foundation that deterministically derives closed tool and
eligible-read descriptors from the same version-2 registry, preserves capability IDs, versions,
argument/result schemas and structured results, and routes fixture invocations back through the
same gateway. It contains no transport, listener, route, client, credential, authorization policy,
confirmation policy, session management, or business executor.

**Rationale**: OpenAI's Realtime guidance says function tools are the default when the application
owns business logic, approval checks, or private system access, while MCP is useful when Realtime
should call an already remote tool server. Amble already owns the controllers and confirmation
gateway, so an active MCP transport would add tool-import latency, failure modes, and a second
security boundary without improving in-app coverage. Establishing only the projection seam now
prevents Realtime-specific descriptor code from becoming the registry or business owner and makes a
future separately approved server an adapter rather than a rewrite. See
[Realtime with tools](https://developers.openai.com/api/docs/guides/realtime-mcp).

**Alternatives considered**: Building a new Amble MCP server now would require external identity,
authorization, rate limiting, session isolation, remote confirmation, exposure/logging policy, and
operations that are not approved. Deferring even the descriptor projection would let the Realtime
adapter hard-code transport concerns. Built-in calendar, email, file, or collaboration connectors
expand product and privacy scope without serving the existing anonymous map experience.

## Deterministic domain intent interpretation

**Decision**: Insert a side-effect-free domain intent boundary between connected conversation text
and the capability gateway. A bounded router selects the event interpreter or a registered future
restaurant, plan, or map interpreter. Every interpreter returns exactly one of `applicable`,
`clarification_required`, or `unsupported`, along with the normalized utterance, base context
revision, bounded clarification choices, and closed proposed capability calls. Interpreters never
execute. For events, reuse Feature 015's deterministic sentence classifier and option catalogue;
commit the complete sentence through one revision-bound `event.applyquery` command. The direct
composer invokes the same interpreter and executor.

**Rationale**: Event sentences can contain What, When, Where, Price, and residual keyword meaning in
one turn. Sequential `event.setfilter` calls can partially mutate before a later phrase proves
ambiguous or stale. A pure shared interpreter plus one atomic owner command guarantees direct/voice
parity, makes ambiguity testable, preserves unmatched wording through the existing query field, and
lets the UI render one authoritative canonical composer state. Domain-specific interpreters avoid
an unbounded global parser while leaving a consistent seam for later restaurant, plan, and map
language.

**Alternatives considered**: A voice-only parser would drift from the composer. Letting the model
emit multiple facet commands would not guarantee atomicity. A universal free-text interpreter for
all domains would expand scope and weaken deterministic eligibility. Interpreters that execute
would bypass the capability gateway and duplicate domain ownership.

## Context references and consequential actions

**Decision**: Resolve “this,” “that one,” and ordinal references from a compact, revisioned interface
context containing visible stable IDs and order, focus, selection, active overlay, viewport, filters,
and coarse location state. Consequential actions create a single-use pending confirmation with a
canonical argument fingerprint and 25-second expiry; a later explicit user confirmation must match
that fingerprint.

**Rationale**: Structured state is cheaper, auditable, and more reliable than screenshots. The model
never confirms itself. Interruption, navigation, target change, rejection, or expiry invalidates the
pending action. Safe reversible actions execute immediately with visible feedback and available undo.
See OpenAI's [human-in-the-loop guidance](https://developers.openai.com/api/docs/guides/safety-best-practices#human-in-the-loop-hitl).

**Alternatives considered**: A map screenshot can supplement a future spatial ambiguity but cannot
identify actionable entities safely without IDs. Confirming every action would make voice tedious;
confirming none would make recognition mistakes consequential.

## Grounded catalogue queries and conversational discovery

**Decision**: Provide three foundational read capabilities: `app.inspect`, `catalog.search`, and
`catalog.get`. `catalog.search` searches the active approved snapshot plus current registered
restaurant, plan, saved, and game state; it returns a bounded page of projected records, accurate
total/truncation metadata, and stable IDs. `catalog.get` retrieves allowlisted details for known
IDs. `app.inspect` returns the compact revisioned UI snapshot, including map, filters, overlays,
selection, plan summary, coarse location, transit, and currently eligible capability IDs.
Catalogue results carry a `catalogRevision` derived from an ordered provenance vector containing
the approved snapshot and each participating dynamic connector revision; they never imply that
mutable restaurant or plan state belongs to the immutable event snapshot.
Conversational discovery consumes these results and returns only known candidate IDs, official area
IDs, fit reasons tied to supplied attributes, trade-offs, and confidence. A deterministic validator
rejects unknown IDs or unsupported claims. The local keyword/constraint matcher remains available
only through the ordinary typed composer/search/direct experience. It never consumes captured
speech or presents itself as an offline conversational assistant when paid voice is unavailable.

**Rationale**: This creates exploratory conversation without turning the product into open-web
research or bypassing evidence rules. It also prevents the provider from receiving an unbounded
full-catalogue dump at session start. Existing event discovery and restaurant viewport models
remain deterministic data owners behind connectors.

**Alternatives considered**: Open-web agent research would violate provenance and make latency and
cost unpredictable. Sending the complete catalogue every session is unbounded and creates local/
production divergence. Letting the model invent free-form places cannot be reconciled with approved
map identity. Removing ordinary deterministic search would make the application unnecessarily
dependent on the paid service.

## Authoritative context coordination and environment parity

**Decision**: Add one context coordinator that subscribes to every connector's state changes,
including changes initiated by direct controls. It serializes one canonical context snapshot,
increments the revision only when assistant-relevant state changes, and updates Realtime tools
before a dependent turn can execute. Every command result carries that revision. Local, test,
preview, and production use the same capability definitions, validators, projections, and contract
fixtures; environment adapters may change data sources and policy but not semantics.

**Rationale**: Updating context only from assistant-owned flows leaves direct filter changes,
overlay changes, plan edits, and search results invisible to the model. Shared projections also fix
the current local relay gap where production receives approved event candidates but local
development does not.

**Alternatives considered**: Polling the DOM is fragile and expensive. Allowing each connector to
invent its own context format causes drift. Treating production-only data injection as acceptable
makes local validation unable to prove production behavior.

## Area-first recommendation geometry

**Decision**: Build a versioned, checked-in runtime GeoJSON asset from the URA Master Plan 2019
Subzone Boundary (No Sea) dataset. Spatially join approved candidates to official subzone codes at
build/reconciliation time. Rank only subzones containing eligible candidates and render the top
areas through a dedicated MapLibre manager.

**Rationale**: Subzones are official, named, small enough for neighborhood-level discovery, free for
commercial reuse under Singapore's Open Data Licence, and independent of model-generated geometry.
The source dataset is documented by
[data.gov.sg](https://data.gov.sg/datasets/d_8594ae9ff96d0c708bc2af633048edfb/view).

**Alternatives considered**: Planning areas are too broad. Ad hoc circles or model-generated
polygons have unstable identity. Adding polygons to the 3D tile manager would couple unrelated
rendering lifecycles.

## MRT visual context

**Decision**: Generate a separate versioned runtime asset from LTA MRT station exits plus the latest
approved URA rail line geometry and station-name layer. Consolidate exits to stable station entities,
retain source dates/hashes, and simplify large line geometry for wide-zoom rendering. MRT visibility
is not included in ranking input unless the user explicitly activates a transit constraint.

**Rationale**: These government datasets are free under the Open Data Licence and cover both station
points and network geometry. The rail asset remains a visual map concern rather than an implicit
preference. Sources: [LTA MRT station exits](https://data.gov.sg/datasets/d_b39d3a0871985372d7e1637193335da5/view),
[URA rail lines](https://data.gov.sg/datasets/d_e8bf3cff62f97300817d1fdcce382584/view), and
[URA station names](https://data.gov.sg/datasets/d_bd17bca97549a4ab0fb7b6ad102d640c/view).

**Alternatives considered**: Venue descriptions are incomplete and not a network. Runtime third-party
transit calls are unnecessary for visual context. Exit points without line/name sources cannot show
the requested system context.

## User location

**Decision**: Extract geolocation from the plan-builder closure into a shared, in-memory controller.
Request permission only after a user action. Render a distinct point plus accuracy circle in a
separate MapLibre layer; expose coarse/relative location to discovery by default and exact
coordinates only to an action that needs them.

**Rationale**: A global state prevents duplicate prompts and lets plan, map, and assistant share one
truth. Exact coordinates never enter transcripts, persistent storage, logs, or D1. Every terminal
session path stops media and clears session context; location can remain in memory only while the
page and explicitly requested map-location feature remain active.

**Alternatives considered**: Browser geolocation controls alone do not integrate with the 3D map or
assistant context. Persisting the last position would conflict with anonymous privacy constraints.

## Lifetime USD 10 spending ceiling

**Decision**: Arnav owns a single lifetime feature budget of `10_000_000` micro-USD. There is no
automatic reset; an increase or reset requires an explicit owner-approved policy change. Store a D1
singleton ledger and immutable reservations. Before accepting each audio-transcription turn and
before the relay emits each `response.create`, atomically reserve a worst-case envelope using a
pinned rate card and the provider/model intrinsic maximum output capacity. This accounting bound
is not sent to the provider as a generation cutoff. Settle only from trusted provider usage. Missing or
unrecognized usage keeps the reservation held and disables new work when safety cannot be proven.

**Rationale**: `spent + reserved + nextReservation <= cap` makes application authorization atomic
across concurrent sessions. Reserving at the highest enabled rate and ignoring cache discounts keeps
the bound conservative. Provider project budgets and alerts are defense in depth, not the primary
hard stop. See [Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs) and
[API pricing](https://developers.openai.com/api/docs/pricing).

**Alternatives considered**: A browser counter is bypassable. Settling only after `response.done`
permits overshoot. Monthly reset was not selected; the user supplied a hard USD 10 usage allowance,
which is treated as cumulative until explicitly changed.

## Privacy, provider policy, and failure behavior

**Decision**: Add a separate exact paid-exception assertion for `openai-realtime`; do not weaken the
generic free/open provider assertion. Require environment and D1 kill switches, same-origin and size
checks, anonymous admission limits, server-only secrets, and no sensitive payload logging. Before
microphone access, disclose provider processing and retention accurately. Application storage keeps
only non-personal budget accounting. At cap, disable, error, expiry, permission revoke, navigation,
or explicit stop, close both sockets, stop media tracks, detach audio, abort pending work, and clear
transcript, intent, exact location, context, and confirmation memory.

For any online voice transport, admission, budget, or provider failure, present exactly “Voice
service is currently unavailable. Please try again later.” before completing terminal cleanup.
Captured speech and transcript fragments are discarded with the session and are never forwarded to
the deterministic application matcher as an offline voice turn. A new voice attempt requires an
explicit retry; ordinary composer, search, and direct controls remain independently usable.

**Rationale**: The current provider policy correctly fails paid services closed and should remain so
for every other adapter. OpenAI documents that API content is not used for training by default, but
Realtime may retain abuse-monitoring data under the account's applicable controls; the application
must not promise provider-side deletion. See
[default usage policies](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

**Alternatives considered**: A generic `paid` cost class would accidentally authorize unrelated
providers. Silent paid fallback would violate the constitution. Persisting transcripts for resume
would create a new personal-data lifecycle without user need.

## Mobile and security-header compatibility

**Decision**: Replace the current blanket phone/tablet rejection with capability-based support for
the map and voice shell. Narrow `Permissions-Policy` from `microphone=()` to `microphone=(self)` and
extend `connect-src` only for the same-origin relay; the browser never connects directly to OpenAI.
Retain the ordinary non-voice composer, search, and direct controls where capture, playback, or
WebSocket capability is unavailable; do not retain or emulate the failed conversational session.

**Rationale**: The feature's primary use case includes mobile users, while current entry code blocks
them. Same-origin relay architecture avoids adding the provider domain to browser CSP.

**Alternatives considered**: Keeping the desktop-only gate contradicts the accepted user story.
Allowing arbitrary microphone origins or provider connections would broaden the security boundary.
