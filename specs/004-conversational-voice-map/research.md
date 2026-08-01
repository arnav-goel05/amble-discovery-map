# Phase 0 Research: Conversational Voice Map Assistant

## Empty-recognition admission safety

**Decision**: When the provider completes transcription for the active committed item with an empty
transcript, settle the known transcription reservation and request exactly one fixed “I didn't
catch that” response. Do not propose a capability, mutate application state, hold the settled
reservation, or enter the global protocol-failure kill-switch path.

**Rationale**: Empty recognition is an ordinary speech-recognition outcome, not evidence of
corrupted protocol identity. Treating it as corruption disabled every later local voice session.

**Alternatives rejected**: Holding the reservation and stopping as `protocol` falsely classifies
silence; reporting provider unavailability is misleading; fabricating an utterance violates
transcript ownership.

> **Superseding decision — 2026-08-01:** Local audit evidence showed that provider classification
> could force-fill unsupported facets and generic request wording could leak into residual search.
> Native ingress therefore uses the relay-owned transcript plus a deterministic closed vocabulary.
> Only current-catalogue event facets are extracted; unmatched words are ignored unless introduced
> by an explicit keyword-search prefix. Earlier provider-classification decisions are historical.

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
fallback model. Use 4,000 post-instruction context tokens, low reasoning effort, no automatic
provider response creation, and no image input in the default flow. Do not impose a per-session
turn, assistant-response-count, maximum-duration, or idle-expiry limit. Do not transmit
`max_output_tokens` in session or response requests; OpenAI documents a default of `inf`, meaning
the maximum available for the model, and a 4,096-token Realtime response maximum. Pin 4,096 only as
the conservative response-cost reservation bound. Use the Realtime model's native audio
understanding rather than a separate input-transcription model.

**Rationale**: OpenAI positions the mini model as the faster, lower-cost Realtime voice option.
Small, request-scoped prompts and tools reduce input cost and bound the next-turn reservation.
Images are unnecessary when stable structured UI IDs are present. Per-response admission,
reservation, watchdog, and terminal cleanup prevent runaway provider work without imposing an
arbitrary conversation-length limit. See the
[OpenAI API changelog](https://developers.openai.com/api/docs/changelog),
[GPT-Realtime-2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini),
[Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs), and
[Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations).

Fixed guidance uses short, capitalized bullet rules plus a response-specific instruction override.
The exact text is provided once between explicit delimiters, and the prompt forbids additions,
omissions, repetition, translation, and paraphrase. This follows OpenAI's Realtime prompting
guidance to prefer precise short bullets, examples, and capitalization for important rules.

**Alternatives considered**: Full-size Realtime models and silent model fallback are rejected for
this feature because they increase cost and make the reviewed policy nondeterministic. Continuous
screenshot context adds cost, staleness, and location exposure. Fixed response-count,
maximum-duration, and idle-expiry limits were rejected because they end healthy conversations for
reasons unrelated to user intent. The current response counter also charges the one-shot greeting.
A lower application output-token ceiling was rejected because it can truncate otherwise valid
assistant responses; per-response admission, context, interruption, explicit lifecycle
termination, spending, and kill-switch controls retain safe operation.

## Privacy-safe response tracing and stalled-response recovery

**Decision**: Emit one structured operational record at each applicable turn boundary:
`audio_committed`, `response_requested`, `response_created`, `first_audio`, `response_done`, and
terminal failure. Records contain only a one-way session
identifier, monotonic turn number, bounded phase/event code, timestamp, elapsed durations, and
terminal reason. Start a separate 30-second watchdog when `response.create` is sent. Clear it on
`response.done`, cancellation, or any terminal session path. If it expires, emit
`response_timeout`, attempt `response.cancel`, conservatively reconcile the pending reservation
through the existing repository contract, and terminate through the standard provider-unavailable
path.

**Rationale**: A session-level timer does not identify a single stalled provider response. Phase
timing shows whether delay occurred before response creation or first audio without recording user
content. A dedicated per-response deadline makes the failure bounded and testable without limiting
the conversation and remains independent of the provider/model response-token limit prohibited by
constitution v2.8.0.

**Alternatives considered**: Content-bearing logs remain prohibited in routine, preview, and
production operation. The former five-minute session timer left the user in a processing state too
long and is now rejected as a conversation limit. A browser-only timer cannot authoritatively
cancel the provider or reconcile the server-side reservation. A response token ceiling is
unrelated to latency and is constitutionally prohibited.

## Explicit local content diagnostics

**Decision**: Add a second diagnostic channel that exists only when the local Node relay process is
started with both `NODE_ENV=development` and `REALTIME_CONTENT_DEBUG=true`. The relay records all
permitted browser-to-relay, relay-to-provider, provider-to-relay, and relay-to-browser messages
after recursive sanitization. Transcripts, prompts, tool arguments/results, and non-sensitive
provider/browser fields remain visible. Credential-shaped values, authorization/cookie material,
raw session identities, and raw or encoded audio are replaced with bounded omission metadata. The
default sink is synchronous process output only.

**Rationale**: Phase timings identify where a stall occurs but cannot explain malformed provider
events, prompts, capability calls, or results. An explicit developer-only trace gives enough
evidence to reproduce those failures without weakening production privacy. Requiring the local
adapter to inject the logger makes activation structurally unavailable to the browser, Worker, and
preview/production configuration. Centralized sanitization prevents individual call sites from
forgetting audio or secret removal.

**Alternatives considered**: Always-on content logs, browser-controlled activation, Worker
environment flags, unbounded debug files, remote telemetry, and raw audio capture are rejected.
Logging only selected tool events was also rejected because it would not diagnose ordering and
provider-body failures; the permitted sanitized protocol stream is more complete and simpler to
reason about.

## Bounded persistent local audit

**Decision**: Permit persistence only when local development mode, `NODE_ENV=development`,
`REALTIME_CONTENT_DEBUG=true`, and `REALTIME_CONTENT_AUDIT=true` are all present before relay
construction. Append already-sanitized records as JSONL to
`outputs/realtime-content-audit/`, using owner-only permissions, rotation before 5 MiB, at most five
files, and startup/rotation deletion after seven days. Store the first permitted large static
configuration and compact later identical copies by fingerprint. Replace a single oversized record
with a bounded fingerprint marker. Preserve actual provider transcript events, tool calls/results,
errors, lifecycle, and validated terminal cause; never synthesize absent native-audio user text.
Audit I/O failures warn safely and cannot change relay behavior.

**Rationale**: Terminal output is truncated and disappears on restart, so it cannot reliably answer
what happened in a completed multi-turn session. A separate startup gate prevents routine content
debugging from silently becoming persistent. Bounded local storage retains enough evidence for
later diagnosis without creating an application data store, remote telemetry system, or background
retention service. Fingerprinting repeated configuration prevents large stable tool schemas from
crowding out the conversational records developers need.

**Alternatives considered**: Redirecting terminal output cannot enforce sanitization, permissions,
rotation, or retention. Browser storage would expose content to application code and users.
Application databases and remote observability would cross the approved privacy boundary.
Persisting raw audio or locally inferring a user transcript is unnecessary and prohibited.

## Provider-safe capability projection and configuration barrier

**Decision**: Preserve canonical capability IDs such as `event.search` everywhere inside Amble.
Project each canonical segment to a provider-only name joined by a reserved double underscore, for
example `event__search`. Canonical segments cannot contain underscores, so this mapping is
injective and reversible without a lookup guess; nevertheless the relay constructs and validates
explicit forward and reverse maps and rejects collisions. Provider function calls are resolved
through the reverse map before contract lookup.

Treat every provider `session.update` as an asynchronous configuration barrier. Queue the opening
or active-turn continuation, release it only after `session.updated`, and reject overlapping,
missing, stale, or duplicate acknowledgements. A provider `error` is terminal and uses the existing
provider-unavailable cleanup. The opening welcome is supplied only in the opening
`response.create.instructions`; no persistent system item is created.

**Rationale**: The live provider accepts function names containing letters, numbers, underscores,
and hyphens, while Amble's canonical IDs deliberately contain dots. Replacing canonical IDs
throughout the application would break stable identity and shared gateway contracts. A transport
alias isolates the incompatibility at the correct boundary. Waiting for acknowledgement prevents
the relay from speaking under default provider instructions after a rejected update. Removing the
persistent welcome item prevents a one-turn exact-speech command from influencing later turns.

**Alternatives considered**: Renaming every capability was rejected because transport syntax must
not redefine domain identity. Blind dot-to-underscore replacement without collision validation was
rejected as fragile. Sending `session.update` and relying only on WebSocket ordering was rejected
because an invalid update is still processed in order but rejected; explicit acknowledgement is
the only proof that Amble's configuration is active.

## Bounded live provider validation

**Decision**: After deterministic suites pass, run one owner-authorized live session containing the
opening response and one representative typed turn, then stop. Inspect the persisted sanitized
audit and fail the smoke if it lacks configuration acknowledgements, contains any provider error,
repeats the opening unexpectedly, or leaves the session active.

**Rationale**: The previous fake provider accepted an invalid function-name grammar, so deterministic
tests alone could not prove the external contract. A two-response smoke is the smallest useful
validation of initial configuration, per-turn configuration, instructions, response lifecycle,
and cleanup while retaining the lifetime budget.

**Alternatives considered**: A full exploratory conversation spends more budget and is less
deterministic. Mock-only validation cannot surface provider schema drift. Running an unbounded live
loop is prohibited.

## Deterministic command routing and per-turn tools (superseded for native audio)

**Decision**: Recognize a deliberately narrow set of obvious application commands in a bounded,
side-effect-free browser interpreter. Execute recognized commands through the same capability
gateway as direct controls, then let the model provide the conversational acknowledgement. Before
each text response, select only eligible capabilities from connector families indicated by the
request and current overlay; exclude a deterministically routed capability from that turn's
provider tools. The earlier native-audio choice to expose foundational queries plus all
context-eligible capabilities is superseded by the forced-ingress decision below.

**Rationale**: Map camera and layer commands and deterministic event-filter phrases do not benefit
from probabilistic tool selection. Shared gateway execution preserves schema, eligibility,
confirmation, context-revision, and observable-result rules. Per-turn family selection avoids
irrelevant tools when authoritative text exists. Forced native ingress supplies bounded routing
text without adding a separate transcription service, so the broader current-state audio menu is
no longer accepted.

**Alternatives considered**: Sending the full eligible registry on every context refresh repeats
irrelevant schemas even when no turn is active. Waiting for an auxiliary transcript blocks
native-audio response creation and is rejected. A second model/tool round trip solely to unlock a
connector family adds latency and accounting complexity without improving authorization, because
the gateway already validates every proposed capability. Building a second executor in the
interpreter would bypass the registry and is rejected.

## Turn taking, interruption, and transcripts

**Decision**: Use explicit microphone activation. Start with semantic voice activity detection for
turn boundaries but keep provider automatic response creation disabled; the relay commits a bounded
native-audio turn only after response-budget reservation. Enable interruption, cancel queued output
on new speech, and retain ordinary direct/text controls. Do not configure a separate
input-transcription service for new audio turns.

**Rationale**: Semantic detection better preserves hesitant conversational speech than silence-only
detection, while server-controlled response creation retains spending authority. The Realtime model
accepts audio natively, so removing the transcription prerequisite eliminates redundant latency,
cost, and failure state. Representative tests must cover Singlish, code-switching, place names, MRT
announcements, and barge-in. See
[voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad).

**Alternatives considered**: Always-on listening violates the specification. Server VAD is simpler
but more likely to cut off hesitant turns. A separate asynchronous transcript retained only for
display or diagnostics was rejected because the product no longer exposes a live user transcript
and the extra paid operation provides no required user value.

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
singleton ledger and immutable reservations. Before accepting each native-audio turn or emitting a
text/opening `response.create`, atomically reserve the worst-case response envelope using a pinned
rate card and the provider/model intrinsic maximum output capacity. This accounting bound is not
sent to the provider as a generation cutoff. Settle only from trusted provider usage. Missing or
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

## One atomic event-query tool for native audio

**Decision**: Project `event.applyquery` as the sole native-audio event discovery and filter
mutation tool. It receives the complete spoken request and handles one or several filters through
the same replace, refine, or remove contract. Keep `event.search`, `event.setfilter`,
`event.removefilter`, `event.clearfilters`, and legacy setters as application/direct-control
capabilities, but do not offer them to the Realtime model.

**Rationale**: Offering both a free-text search command and the atomic sentence interpreter lets
the model choose a lossy path for compound requests such as “today at Marina Bay Sands.” One
provider-facing event-query route prevents partial intent loss without adding transcription,
duplicating parsing, or changing authoritative event behavior.

**Alternatives considered**: Prompting the model to prefer `event.applyquery` leaves the incorrect
tool callable. Removing lower-level commands from the shared registry would break direct semantic
controls and parity. Restoring transcript-gated routing would add latency and a redundant paid
operation.

## Forced native ingress with progressive tool disclosure

**Decision**: On audio commit, expose and force exactly one provider-only
`voice.submitutterance` function. Its closed argument contains the complete bounded utterance heard
by the existing Realtime model. Bind context revision in the relay, run the existing deterministic
text-turn router, execute deterministic capabilities directly, and expose at most one routed
connector family only when a second model choice is genuinely required.

**Rationale**: Native audio supplies no relay-visible transcript before the model responds, so
request-specific tool scoping cannot happen before that response. Forcing one function uses the
same native model to produce bounded routing text without restoring a separate transcription
service. The Realtime API supports forcing a specific function through `tool_choice`, and
`session.update` can replace the active tool list between stages. The design removes the model's
56-way initial choice, prevents broad catalogue search from competing with event interpretation,
and reuses the already tested typed-turn router rather than creating voice-only business logic.

**Alternatives considered**: Keeping `tool_choice: auto` with better descriptions cannot guarantee
selection. Exposing only 10–15 top-level domain tools reduces noise but still lets overlapping
domains compete. A generic dispatcher accepting arbitrary capability IDs would duplicate the
capability gateway and weaken per-command schemas. Restoring input transcription would recreate
the latency, cost, and lifecycle dependency removed by FR-059–FR-064.

## Same-response OpenAI event facets with deterministic verification

**Decision**: Extend the existing forced native-ingress function arguments with an event-domain
proposal containing evidence-backed What, When, Where, Price, residual, and unresolved fields.
OpenAI proposes natural-language labels in the same Realtime response that captures the utterance.
Pure application code resolves only unique labels from the current bounded facet catalogue and
either passes the verified proposal to `event.applyquery` or returns clarification with no partial
mutation.

**Rationale**: The observed native phrase “can you please find events in my device and today”
showed that regex-only classification retained command boilerplate and an unrecognized
location-shaped fragment as search text. The Realtime model already hears the complete utterance
and can classify natural paraphrases without a second provider call. Catalogue-bound verification,
evidence checks, current revisions, and the shared executor keep model output non-authoritative.
Voice-only scope preserves the free deterministic typed/direct experience.

**Alternatives considered**: A second Realtime response or separate classifier API adds latency,
spend, reservation state, and another failure boundary. Fully deterministic parsing cannot cover
open natural phrasing and recognition substitutions without an expanding alias list. Fully
model-owned execution can invent options or bypass current context. Sending raw full event records
would exceed the classifier's need and broaden privacy and prompt surface; the compact catalogue
contains only approved filter labels grouped by facet.

**Provider evidence**: The official
[Realtime API reference](https://platform.openai.com/docs/api-reference/realtime?lang=javascript)
documents `auto`, `required`, and a specific forced function as supported tool-choice modes. The
official
[Realtime client-events reference](https://platform.openai.com/docs/api-reference/realtime-client-events)
documents replacing the active session tool list through `session.update`.

## Relay-owned live reliability

**Decision**: Treat Realtime tool arguments and fixed speech as stochastic transport output, not
authority. Canonicalize only bounded shape-equivalent ingress, independently verify the domain with
the deterministic application router, buffer tool-stage commentary, and validate fixed-response
transcripts before releasing audio. Retry one malformed fixed response within the existing
three-stage turn guard.

**Rationale**: The live matrix observed semantically identical fields at the root and under
`eventQuery`, `eventWhere` aliases, null unused facets, missing required utterances, incorrect event
domain guesses, tool preambles, and spoken instruction delimiters. Prompt changes alone did not
eliminate these variants. Relay-owned normalization and validation preserve application semantics
without hardcoding the sixteen utterances or trusting the model to execute state.

**Alternatives considered**: Strictly terminating every equivalent shape causes avoidable user
failures. Trusting the provider domain or event proposal permits incorrect mutation. Releasing
audio before transcript validation exposes preambles and delimiters. Adding an unbounded retry
loop weakens cost and lifecycle guarantees.

## Relay-owned final transcript and concurrent classification

**Decision**: Supersede the model-echoed utterance portion of forced native ingress. Configure one
low-latency input-transcription model within the existing Realtime session, start transcription and
the forced classification response from the same committed audio without serial startup, and join
their terminal results by the provider input-item identity. The classification schema contains only
the bounded domain and optional event-facet proposal. The relay supplies the final transcript and
authoritative context revision to deterministic routing and verification.

**Rationale**: The approved Realtime response model supports function calling but does not support
Structured Outputs, and the live provider omitted the required `utterance` while still returning
usable facets. Application validation can reject such output but cannot force a stochastic model to
emit a missing field. OpenAI documents a chained voice path for predictable workflows and final
Realtime transcription events keyed by `item_id`; production voice frameworks similarly separate
STT from tool reasoning when auditability and mature tool calling matter. A concurrent join retains
native response startup while making the utterance independently observable and testable.

**Alternatives considered**: Prompt strengthening cannot guarantee a field on a model without
Structured Outputs. `strict: true` was rejected by the live Realtime session configuration and is
not a supported model feature. Retrying malformed tool calls may reduce frequency but still trusts
the same absent field and spends another response. A completely sequential STT-LLM-TTS rewrite
would provide the strongest stage isolation but would discard the existing Realtime speech,
interruption, and session implementation. The selected hybrid is the smallest reliable change.

**Provider evidence**: OpenAI's current voice-agent guide recommends a chained path when stronger
control over intermediate text or deterministic logic is needed, its Realtime transcription guide
provides final transcript events keyed by input `item_id`, and the `gpt-realtime` model catalogue
marks function calling supported but Structured Outputs unsupported.

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

## Grounded and engaging capability-result dialogue

**Decision**: Project final capability speech deterministically from the validated result envelope
and refreshed authoritative context. Use action-family templates that lead with the confirmed
outcome, include verified names, counts, and settings when available, distinguish every terminal
and no-op state, and optionally offer one currently eligible next step. Keep camera and navigation
responses brief; allow restrained warmth for discovery, restaurant, event, and plan outcomes.

**Rationale**: A universal “Done in Amble” confirms neither the target nor the resulting state and
makes successful, unchanged, and failed interactions sound alike. Deterministic templates preserve
the exact-speech boundary while giving users useful feedback and preventing invented names or
unavailable follow-up offers.

**Alternatives considered**: Free-form model narration risks unsupported detail and inconsistent
failure language. A unique handwritten sentence for every capability duplicates connector rules
and is difficult to maintain. Generic acknowledgements are safe but not informative or engaging.
