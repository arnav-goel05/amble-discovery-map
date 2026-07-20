# Phase 0 Research: Conversational Voice Map Assistant

## Realtime transport and authentication

**Decision**: Use a same-origin browser WebSocket to a backend relay, which maintains the provider
WebSocket connection. Keep `OPENAI_API_KEY`, model choice, session instructions, automatic-response
settings, tools, and token bounds entirely server-side.

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

**Decision**: Pin `gpt-realtime-2.1` in the paid-exception policy. Start with five-minute sessions,
sixty-second idle expiry, six assistant responses, 4,000 post-instruction context tokens, 512 output
tokens per response, low reasoning effort, no automatic provider response creation, and no image
input in the default flow. Pin the supported input-transcription model and its rate formula in the
same policy before release.

**Rationale**: The 2.1 model is documented for improved noise, interruption, and alphanumeric
handling while retaining function calling. Small, stable prompts/tools improve cache behavior and
bound the next-turn reservation. Images are unnecessary when stable structured UI IDs are present.
See [GPT-Realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1),
[Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs), and
[Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).

**Alternatives considered**: `gpt-realtime-2` remains compatible with the original idea but is not
the preferred pinned model after the documented 2.1 improvements. Continuous screenshot context
adds cost, staleness, and location exposure. Unbounded sessions conflict with the USD 10 ceiling.

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

## Typed application actions

**Decision**: Build one versioned action registry used by pointer, keyboard, text, and voice. The
model may propose allowlisted action IDs and JSON arguments; an application gateway validates the
schema, eligible state, stable target, context revision, and confirmation class before invoking the
same command used by direct UI.

**Rationale**: Current behavior is distributed across DOM listeners and scene closures. Simulated
clicks would be incomplete and fragile. A shared command boundary makes 100% coverage measurable
and prevents model-generated selectors, URLs, or function names from becoming executable. Stable
session-level tools cover common actions; context-specific actions are exposed only when eligible.
See [Realtime function calling](https://developers.openai.com/api/docs/guides/realtime-conversations#function-calling).

**Alternatives considered**: DOM automation cannot prove semantic equivalence. A single generic
`execute` tool is too permissive. Separate voice-only business logic would drift from direct UI.

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

## Grounded conversational discovery

**Decision**: Construct a candidate envelope from the active approved snapshot, current restaurant
results, current plan state, and other registered public-domain controllers. The model returns only
known candidate IDs, official area IDs, fit reasons tied to supplied attributes, trade-offs, and
confidence. A deterministic validator rejects unknown IDs or unsupported claims. When paid voice is
unavailable, a local keyword/constraint matcher over the same envelope supplies a reduced text and
direct-control fallback without calling another model.

**Rationale**: This creates exploratory conversation without turning the product into open-web
research or bypassing evidence rules. The existing event discovery model and restaurant viewport
model remain deterministic candidate providers.

**Alternatives considered**: Open-web agent research would violate provenance and make latency and
cost unpredictable. Letting the model invent free-form places cannot be reconciled with approved map
identity. Replacing existing search would weaken the required no-paid-service fallback.

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
pinned rate card and configured maximums. Settle only from trusted provider usage. Missing or
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
Retain text/direct mode where capture, playback, or WebSocket capability is unavailable.

**Rationale**: The feature's primary use case includes mobile users, while current entry code blocks
them. Same-origin relay architecture avoids adding the provider domain to browser CSP.

**Alternatives considered**: Keeping the desktop-only gate contradicts the accepted user story.
Allowing arbitrary microphone origins or provider connections would broaden the security boundary.
