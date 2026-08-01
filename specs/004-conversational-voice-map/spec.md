# Feature Specification: Conversational Voice Map Assistant

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-18

**Status**: Draft — amended through constitution v2.7.0 for shared capabilities, deterministic
interpretation, MCP-foundation architecture, privacy-safe reliability tracing, and explicit local
content diagnostics with a bounded persistent local audit mode

**Input**: User description: "Replace research-heavy search with open-ended conversational discovery, highlight suitable areas when zoomed out, make user location and Singapore MRT context clear, and let users control every user-facing application feature by voice."

## Clarifications

### Session 2026-08-01

- Q: Should native voice use the Realtime model to classify requests or propose event facets? → A:
  No. The relay-owned final transcript is routed by an application-owned deterministic allowlist;
  the provider is used for transcription and for scoped/final responses only.
- Q: What happens to words that are not recognized event facets? → A: They are ignored by default.
  A residual event keyword query is created only after an explicit prefix such as “search events
  for …”. This supersedes earlier requirements to preserve arbitrary unmatched wording or force a
  provider classification response.
- Q: How broad is deterministic recognition? → A: It covers every active first-release connector
  family and protected local lifecycle controls with bounded phrase/regex templates. Target-bearing
  commands retain connector target, eligibility, confirmation, and context validation. Inactive
  saved/game extensions remain unrecognized.

### Session 2026-07-29

- Q: Where may content-bearing debug data be captured? → A: Explicitly activated local developer sessions only; secrets and raw audio remain excluded.

### Session 2026-07-30

- Q: May sanitized voice-session diagnostics survive the local process for later debugging? → A:
  Yes, only behind a separate explicit local-development audit flag, in a bounded rotating
  gitignored store with no remote transport.
- Q: How should Amble preserve dotted capability identities when the provider rejects dots in
  function names? → A: Keep canonical capability IDs unchanged and use a deterministic,
  collision-free, reversible provider-only alias.
- Q: Should event-facet classification require a second provider request? → A: No. The existing
  forced Realtime ingress response returns both the complete utterance and its proposed structured
  What, When, Where, and Price facets; deterministic application code verifies the proposal.
- Q: Which event-query entry points use OpenAI facet classification? → A: Native voice only.
  Typed and direct event queries remain deterministic and free; all entry points share the same
  deterministic verifier and `event.applyquery` executor.

### Session 2026-07-31

- Q: What is the authoritative utterance for a native-audio turn? → A: The relay-owned final input
  transcript matched to the committed audio item; the Realtime response proposes classification
  and facets but does not supply or override the utterance.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Discover From a Vague Intent (Priority: P1)

As a user who does not yet know exactly what to do, I can describe an incomplete or subjective intent in natural speech, such as “somewhere relaxing tonight” or “I want something fun but not too crowded,” and receive suitable areas with concise reasons instead of needing to construct a research-style query.

**Why this priority**: Helping uncertain users discover a direction is the central product value and removes the main weakness of the current search experience.

**Independent Test**: A user can begin with a vague spoken request, receive multiple differentiated area suggestions, understand why each fits, and refine the results through conversation without restarting.

**Acceptance Scenarios**:

1. **Given** the user has started a voice session, **When** they express a vague interest, **Then** the assistant identifies the useful constraints it can infer and presents a small set of suitable areas with a reason and meaningful trade-off for each.
2. **Given** initial areas are visible, **When** the user says “quieter,” “closer,” or another conversational refinement, **Then** the assistant updates the highlighted areas and explains what changed.
3. **Given** the request lacks one decision that materially changes the results, **When** the assistant cannot make a reliable recommendation, **Then** it asks one focused follow-up question while retaining the existing conversation and map state.
4. **Given** no suitable recommendation is supported by approved application data, **When** discovery completes, **Then** the assistant says that no reliable match was found and offers a relevant refinement rather than inventing a place.

---

### User Story 2 - Explore Recommended Areas on the Map (Priority: P1)

As a zoomed-out map user, I can immediately see which geographic areas best match my current interests and then move from an area-level recommendation to specific places within it.

**Why this priority**: Area-first discovery makes vague recommendations spatially understandable and tells users where to look before overwhelming them with individual markers.

**Independent Test**: From a Singapore-wide or district-level view, a user can identify recommended areas, select one, and reveal relevant places while preserving the reasons for the recommendation.

**Acceptance Scenarios**:

1. **Given** multiple areas match the current intent, **When** the map is zoomed out, **Then** each recommended area is visibly highlighted and differentiated from ordinary map content.
2. **Given** a highlighted area, **When** the user selects it by voice or touch, **Then** the map focuses on the area and presents suitable places within it.
3. **Given** the user changes their intent, **When** recommendation relevance changes, **Then** stale highlights are removed and the new highlights appear without leaving contradictory selections behind.
4. **Given** an area has low-confidence or sparse evidence, **When** it is presented, **Then** its uncertainty is communicated and it is not styled as a confident recommendation.

---

### User Story 3 - Control the Entire Application by Voice (Priority: P1)

As a user, I can use natural voice commands to operate every user-facing feature available through the application interface, including navigation, selection, filters, details, discovery, planning, games, restaurants, events, and saved content.

**Why this priority**: The first release promises voice as a universal interaction mode rather than a limited search shortcut.

**Independent Test**: A complete inventory of existing user-facing actions can be exercised through voice, with the resulting application state matching the equivalent direct interaction.

**Acceptance Scenarios**:

1. **Given** any user-facing action available in the interface, **When** the user requests its semantic equivalent by voice, **Then** the application performs the same action or clearly explains why the action is temporarily unavailable.
2. **Given** a visible or selected map marker, card, panel, or list item, **When** the user refers to “this,” “that one,” or another contextual expression, **Then** the assistant resolves the reference from current interface context or asks for clarification when more than one target is plausible.
3. **Given** a safe and reversible command, **When** the command is understood with sufficient confidence, **Then** it executes immediately and provides visible feedback.
4. **Given** a consequential or external action, **When** the user requests it, **Then** the assistant describes the exact action and obtains explicit confirmation before execution.
5. **Given** a feature is added or materially changed, **When** it becomes user-facing, **Then** its voice action contract and voice acceptance coverage are required as part of that feature.
6. **Given** the user asks to search events, restaurants, areas, or current plan content, **When**
   the query runs, **Then** the assistant receives bounded approved results with stable identities
   and can explain, refine, select, or open those results without guessing from UI success alone.
7. **Given** the assistant changes application state, **When** the command completes, **Then** its
   validated observable result and a refreshed authoritative interface context are available before
   a dependent follow-up action can run.
8. **Given** the same approved fixture and application state in local, test, preview, and production
   adapters, **When** the same capability is invoked, **Then** its eligibility, validation, result
   shape, and observable effect are semantically equivalent.
9. **Given** saved content, games, or another conditional feature has no real eligible data or
   direct control, **When** the assistant receives its capability list, **Then** that feature is not
   exposed or advertised.
10. **Given** an action completes, **When** Amble responds, **Then** it leads with the confirmed
    outcome and uses the verified target name, count, setting, or state when that evidence exists.
11. **Given** an action is unchanged, empty, unavailable, failed, ambiguous, or awaiting
    confirmation, **When** Amble responds, **Then** it distinguishes that state and never implies a
    successful mutation.
12. **Given** a useful follow-up capability is currently eligible, **When** Amble finishes a
    discovery, selection, or planning response, **Then** it may offer one concise next step; minor
    navigation and camera actions remain brief and do not force a follow-up question.

---

### User Story 4 - Speak Naturally in Public or Noisy Places (Priority: P2)

As a mobile user, I can choose voice-first interaction with interrupt and stop controls, a clear microphone state, and the application's ordinary direct controls.

**Why this priority**: Voice should feel natural without making the application unusable on public transport, in noisy environments, or when microphone access is unavailable.

**Independent Test**: A user can begin, pause, resume, correct, interrupt, and continue a voice conversation while always understanding whether the microphone is active.

**Acceptance Scenarios**:

1. **Given** voice is available, **When** the user explicitly activates it, **Then** the application clearly indicates listening, processing, speaking, muted, and stopped states.
2. **Given** Amble is responding, **When** the user selects Interrupt, **Then** playback stops,
   Amble returns to listening, and the user's next utterance becomes the active turn.
3. **Given** the assistant is speaking, **When** the user interrupts, **Then** playback stops promptly and the new request becomes the active conversational turn.
4. **Given** microphone permission is denied or audio quality is insufficient, **When** the user attempts voice interaction, **Then** the application explains the limitation and preserves ordinary search and direct-interface access.
5. **Given** the online voice service is unavailable, disabled, over budget, or terminates
   unexpectedly, **When** the failure is known, **Then** the application says “Voice service is
   currently unavailable. Please try again later.”, stops microphone capture and audio playback,
   clears the voice session and pending voice work, and does not silently hand the utterance to a
   local or offline voice assistant.
6. **Given** a submitted voice turn does not produce a completed response within the configured
   response deadline, **When** the deadline expires, **Then** the application cancels that provider
   response, terminates the affected voice session through the ordinary unavailable path, and
   records enough privacy-safe phase timing to identify where the turn stopped.
7. **Given** a developer is reproducing a voice defect locally, **When** they explicitly activate
   content diagnostics before starting the local process, **Then** the local process records the
   complete permitted transcript, prompt, tool, and redacted relay-event content for that session
   while excluding credentials, authorization material, cookies, session tokens, signing material,
   and raw audio.
8. **Given** content diagnostics were not explicitly activated or the application is running in
   preview or production, **When** voice traffic is processed, **Then** no content-bearing
   diagnostic record can be emitted and only the closed privacy-safe operational phase records are
   available.

---

### User Story 5 - Understand Location and MRT Context (Priority: P2)

As a user navigating Singapore, I can clearly identify my location and see MRT stations and lines as map context while exploring recommendations.

**Why this priority**: Location and transit context help users orient themselves, especially when public transport is their primary way to travel.

**Independent Test**: A user viewing recommendations can identify their own position, nearby MRT stations, and relevant lines without MRT proximity changing recommendation order unless they explicitly request it.

**Acceptance Scenarios**:

1. **Given** location permission and a valid position, **When** the map is visible, **Then** the user’s location is visually distinct from recommendations, places, and transit markers and communicates its accuracy.
2. **Given** location is unavailable, denied, or stale, **When** the map is visible, **Then** the application communicates that state and does not imply a precise current position.
3. **Given** MRT information is available at the current map scale, **When** the user explores the map, **Then** stations and lines are clear but subordinate to the active discovery task.
4. **Given** the user has not requested transit-aware recommendations, **When** results are ranked, **Then** MRT proximity does not affect their order.
5. **Given** the user explicitly asks for MRT-accessible options or a route, **When** results are updated, **Then** transit becomes an active constraint and the assistant explains its effect.

---

### User Story 6 - Speak Event Searches Like the Composer (Priority: P1)

As a user, I can describe or refine an event search by voice using the same natural sentence style
as the event search composer, and the application shows exactly how the request became structured
What, When, Where, and Price phrases plus any remaining keyword query.

**Why this priority**: Voice and direct search must be two entry points into one event-search
behavior. A separate voice parser would drift, mutate filters piecemeal, and make the visible
composer disagree with what the assistant actually applied.

**Independent Test**: With the same option catalogue and starting composer state, submitting the
same sentence through the composer and through voice produces the same canonical sentence, ordered
phrases, residual query, results, and single new context revision.

**Acceptance Scenarios**:

1. **Given** the current event option catalogue, **When** the user says “free concerts this weekend
   near Marina Bay,” **Then** the shared deterministic interpreter recognizes every supported
   What, When, Where, and Price phrase, preserves unmatched meaningful wording as the existing event
   keyword query, and applies the complete proposal atomically.
2. **Given** a voice event query is applied, **When** the command completes, **Then** the event
   sentence composer immediately displays the same canonical ordered phrases and residual query as
   the authoritative event state.
3. **Given** an existing composed query, **When** the user says “make it free,” “change it to
   tomorrow,” or “remove the location,” **Then** only the requested phrase changes and all unrelated
   phrases and residual query remain intact.
4. **Given** a phrase has multiple materially plausible recognized values, **When** the interpreter
   cannot choose deterministically, **Then** it returns bounded clarification choices and makes no
   event-state change.
5. **Given** the option catalogue or interface context changed after interpretation, **When** the
   proposal is submitted, **Then** the stale proposal is rejected with no partial mutation and the
   user is asked to retry or clarify against the current state.
6. **Given** a compound event sentence, **When** one recognized part is invalid or ambiguous,
   **Then** none of its proposed query or filter changes are committed.
7. **Given** native voice is active, **When** the user says either “today” or “today at Marina Bay
   Sands,” **Then** the complete spoken event request is submitted through the same single atomic
   event-query path and no alternative event filter tool can discard part of the request.
8. **Given** a native-audio turn begins, **When** the committed speech reaches the provider,
   **Then** the provider is forced to return one bounded classification call rather than choose
   among application tools, while the relay independently captures the final input transcript.
9. **Given** the final transcript contains an event sentence and the classification proposes event
   facets, **When** deterministic routing succeeds, **Then** the relay proposes `event.applyquery`
   directly through the shared gateway without exposing `app.inspect`, `catalog.search`, or any
   other competing event-search route.

---

### User Story 7 - Prepare the Shared Capabilities for MCP (Priority: P3)

As a product developer, I have a disabled MCP projection foundation derived from the same Amble
capability registry, so a future separately authorized MCP server can reuse the contracts without
creating another application backend.

**Why this priority**: Defining the protocol boundary now prevents Realtime-specific tool metadata
from becoming business logic while avoiding the security and operational scope of exposing a
remote server before its authorization model exists.

**Independent Test**: Contract fixtures project eligible version-2 capabilities into closed MCP
tool/resource descriptors and map structured results back without changing IDs, versions, schemas,
confirmation policy, or gateway behavior; no MCP listener, route, runtime dependency, credential,
or registered external transport exists.

**Acceptance Scenarios**:

1. **Given** an eligible versioned capability contract, **When** the disabled MCP projector reads
   it, **Then** it derives a deterministic descriptor from the registered name, description, input
   schema, result schema, kind, and version without duplicating business rules.
2. **Given** a projected command is invoked by a future adapter fixture, **When** execution is
   simulated, **Then** the call returns through the existing capability gateway, eligibility,
   confirmation, lifecycle, and observable-result path.
3. **Given** the first-release application starts, **When** its routes, listeners, dependencies,
   credentials, and registered connectors are inspected, **Then** no network-exposed MCP server or
   client is present and the projection foundation is disabled by default.

---

### User Story 8 - Bind Voice Actions to a Reliable Transcript (Priority: P1)

As a voice user, I want Amble to preserve what I said independently from its proposed filters, so a
missing tool argument cannot discard part of my request or terminate an otherwise understandable
turn.

**Why this priority**: The Realtime model supports function calling but not strict structured
outputs. The application must therefore own the utterance while the model contributes only bounded
classification and facet proposals.

**Independent Test**: Commit a representative spoken turn, deliver the matching final transcript
and a classification proposal in either order, and verify that Amble executes exactly once using
the transcript-owned utterance. Omit the old model-generated utterance field and verify that the
turn still succeeds; omit or fail the final transcript and verify bounded zero-mutation cleanup.

**Acceptance Scenarios**:

1. **Given** an admitted spoken turn and current authoritative interface context, **When** the audio
   turn is committed, **Then** transcription and bounded classification may progress concurrently.
2. **Given** classification completes before transcription or transcription completes before
   classification, **When** both belong to the active turn, **Then** the relay joins them once by
   provider item identity and executes using the final transcript as the utterance.
3. **Given** the classification omits an utterance field, **When** its remaining closed proposal is
   valid, **Then** the turn continues because that field is neither requested nor accepted.
4. **Given** transcription fails, never completes before the response deadline, or belongs to a
   stale item, **When** the relay cannot establish the active utterance, **Then** it performs no
   application mutation and terminates through the existing unavailable lifecycle.
5. **Given** the provider completes transcription for the active item with no recognized speech,
   **When** the relay receives that valid empty result, **Then** it settles the known transcription
   usage, performs no application mutation, gives one concise retry prompt, and keeps voice
   admission enabled.
6. **Given** a spoken request causes a tool proposal, **When** the relay combines transcript and
   classification, **Then** existing argument validation, current-state eligibility, confirmation,
   shared execution, observable result, and refreshed-context rules remain unchanged.
7. **Given** the user submits text instead of audio, **When** the turn is processed, **Then** the
   existing deterministic text interpretation and connector-family scoping remain unchanged.

---

### User Story 9 - Audit a Past Local Voice Session (Priority: P2)

As a developer reproducing a voice defect locally, I can explicitly retain a compact sanitized
session audit long enough to inspect the conversation lifecycle after the process or browser
session ends.

**Why this priority**: Process-only output is frequently truncated and disappears when the server
restarts, preventing reliable diagnosis of delayed, interrupted, or multi-turn failures.

**Independent Test**: Start the local relay with development mode, content diagnostics, and the
separate persistent-audit flag; complete and interrupt representative sessions; restart the
process; and verify the bounded JSONL audit still contains the sanitized lifecycle, provider
transcript events that actually existed, tool calls, results, and terminal causes.

**Acceptance Scenarios**:

1. **Given** all three local-development gates are active, **When** permitted content diagnostics
   are emitted, **Then** sanitized JSONL records are written to the fixed gitignored local audit
   directory and remain available after the session or process ends.
2. **Given** the persistent-audit flag is absent, **When** local content diagnostics are active,
   **Then** permitted records remain process-only and no audit file is created.
3. **Given** preview or production mode, **When** any caller supplies diagnostic or audit flags,
   **Then** no content-bearing process record or persistent audit file can be created.
4. **Given** audit files exceed the size, count, or age bounds, **When** startup or rotation cleanup
   runs, **Then** files are rotated or removed while the newest bounded audit history remains.
5. **Given** repeated large static provider payloads such as identical session configuration,
   **When** they are audited, **Then** the first permitted payload and compact fingerprinted
   repetitions remain traceable without crowding out conversational turns.
6. **Given** the native-audio provider emits no user transcript, **When** the audit is reviewed,
   **Then** it records audio metadata and lifecycle only and never invents or claims a user
   transcript.
7. **Given** the browser explicitly stops a session, unloads the page, or loses microphone
   permission, **When** the relay terminates it, **Then** the validated terminal reason is retained
   in the audit.
8. **Given** the local audit store is unavailable or unwritable, **When** a voice record is
   produced, **Then** voice behavior remains unchanged and the local process emits only a safe
   bounded diagnostic warning.

---

### User Story 10 - Start Every Live Voice Session With Valid Amble Controls (Priority: P1)

As a voice user, I receive Amble's configured product behavior and currently eligible controls
before the greeting or my first turn, rather than silently falling back to a generic assistant when
provider configuration is rejected.

**Why this priority**: A rejected provider configuration removes both Amble's instructions and all
application controls while leaving plausible speech working, which is a misleading baseline
failure.

**Independent Test**: Connect a live provider session, apply a capability set containing canonical
dotted IDs, wait for provider acknowledgement, speak the one-shot welcome, submit a representative
turn, and verify the provider reports no configuration error and any function proposal maps back to
the exact canonical capability ID.

**Acceptance Scenarios**:

1. **Given** canonical Amble capability IDs contain dots, **When** tools are projected to the
   provider, **Then** every provider name satisfies its accepted naming grammar and maps
   bijectively back to exactly one canonical capability ID.
2. **Given** a new provider connection, **When** Amble sends its initial configuration, **Then** no
   greeting or user turn is processed until the provider acknowledges that configuration.
3. **Given** a later turn changes the eligible tool set, **When** the relay updates provider
   configuration, **Then** that turn waits for the matching acknowledgement before response
   creation.
4. **Given** the provider rejects configuration or emits another provider error, **When** the relay
   receives it, **Then** the session follows the ordinary terminal provider-unavailable lifecycle
   rather than continuing with default behavior.
5. **Given** the opening response is requested, **When** it completes, **Then** its exact-speech
   instruction does not remain as a persistent conversation item capable of influencing later
   turns.
6. **Given** the provider proposes an aliased function name, **When** the relay validates it,
   **Then** the browser receives only the matching canonical capability ID and every existing
   schema, eligibility, confirmation, execution, and result rule remains unchanged.
7. **Given** identical sanitized static configuration is audited at different timestamps, **When**
   compaction runs, **Then** one full payload and compact repetitions remain, while genuinely
   different configurations remain separate.
8. **Given** the bounded live smoke is authorized and configured, **When** it runs, **Then** it
   records provider acknowledgement, exact welcome completion, one representative turn, terminal
   cleanup, and zero provider error events.

### Edge Cases

- The microphone is revoked, disconnected, or changes while a conversation is active.
- Background speech, MRT announcements, or another speaker is mistaken for the user.
- The user switches between voice and text in the middle of a request.
- The user interrupts while an application action or assistant response is in progress.
- “This,” “nearby,” or “the second one” has no target or multiple plausible targets.
- A recognized command is valid generally but unavailable in the current application state.
- A compound utterance mixes safe actions with an action requiring confirmation.
- The assistant suggests an unsupported place, stale event, or result outside approved application data.
- The user asks a general-knowledge question, requests open-web research, or asks what the assistant
  can do while only a subset of application actions is currently eligible.
- Recommended areas overlap, contain no currently eligible places, or move outside the visible map.
- Location permission is approximate, stale, denied, or unavailable.
- MRT data is missing or temporarily unavailable at a relevant zoom level.
- The realtime conversation service is slow, unavailable, reaches its usage limit, or ends unexpectedly.
- A response request is accepted but never emits audio or a terminal completion event.
- Provider events continue arriving without completing the active response.
- A native-audio classification completes before its final user-transcription event.
- A final transcript is empty, failed, duplicated, delayed beyond the deadline, or belongs to a
  stale or unexpected audio item.
- The currently eligible typed capability set changes immediately before an audio turn is committed.
- Local content diagnostics are requested in a production or preview process.
- A debug event contains nested credential, authorization, cookie, session-token, signing-material,
  or raw-audio fields.
- A single permitted diagnostic payload is larger than the maximum audit-file size.
- Identical large session configuration events repeat across turns or reconnects.
- Old audit files remain after the retention window or the local clock changes.
- The local audit directory becomes unavailable or unwritable during an active voice session.
- Two canonical capability IDs could normalize to the same provider alias.
- A provider acknowledgement is missing, delayed, stale, duplicated, or refers to a different
  configuration update.
- The provider rejects an initial or per-turn configuration while speech responses remain
  otherwise available.
- A provider function proposal uses an unknown, stale, or malformed transport alias.
- The one-shot welcome succeeds but its instruction accidentally remains in later conversation
  context.
- An event utterance contains overlapping recognized values, unmatched wording, or a stale catalogue
  revision.
- A future protocol projection attempts to expose an ineligible capability or bypass confirmation.
- The user leaves or closes the application during a voice session.

## Scope and Constraints _(mandatory)_

- **In scope**: Voice-first and text-fallback conversation; vague-intent discovery; area-first
  recommendations and reasoning; bounded catalogue queries over approved events, restaurants,
  areas, plans, saved content, and games when present; contextual references to visible interface
  elements; shared typed command/query contracts for every existing user-facing action; safe-action
  execution; confirmation for consequential actions; authoritative state resynchronization; local,
  test, preview, and production connector parity; deterministic event-sentence interpretation
  shared by voice and the direct composer; atomic event-query application and composer mirroring;
  a domain-interpreter extension boundary; a disabled, transport-neutral MCP contract projection
  foundation; clear location state; and MRT stations and lines as visual context.
- **Out of scope**: General-purpose chat, open-web research, unrestricted browser/device control;
  creating new booking, payment, messaging, or transport-routing capabilities that do not already
  exist; continuous always-listening behavior; inferring eye gaze; allowing generated claims to
  override approved source data; making MRT access a default ranking factor; direct Realtime access
  to third-party account connectors; a universal open-ended parser for every future domain;
  network-exposed MCP servers, routes, listeners, clients, credentials, runtime dependencies, or
  deployment; and MCP authentication, authorization, rate limiting, session isolation, remote
  confirmation, or external account connectors. Restaurant, plan, and map interpreters may have
  typed extension seams, but full natural-language implementations beyond the approved first-release
  event composer are not required by this amendment.
- **Evidence and dependencies**: Recommendations MUST be grounded in approved application data and
  retain the source/evidence rules already governing events, venues, restaurants, and deals.
  Constitution v2.4.0 retains the feature-scoped OpenAI Realtime API exception first approved in
  v2.2.0. Arnav is the operational owner. The feature has one cumulative lifetime spending ceiling
  of USD 10 with no automatic reset; increasing or resetting it requires explicit owner approval.
  When online voice is unavailable, disabled, or at its cap, the voice experience MUST terminate
  with the specified unavailable message and MUST NOT masquerade as a local or offline voice
  assistant. The ordinary event composer, search, and direct controls remain available without
  calling another paid model.
- **Privacy and lifecycle**: Microphone use MUST begin only after explicit user action and MUST be visibly indicated. Continuous background listening is prohibited. Raw audio MUST NOT be retained by the application. Conversation transcripts, exact location, and current interface context MUST remain session-scoped unless the user explicitly invokes an existing persistence feature. Provider-side retention and processing behavior MUST be disclosed before voice activation. No voice, transcript, or location analytics may be collected. Production and preview reliability logs MAY contain a one-way session identifier, bounded lifecycle phase, timestamps, durations, event code, and terminal reason only; they MUST NOT contain audio, transcripts, prompts, tool arguments or results, provider payloads, exact location, secrets, or raw session identifiers. An explicitly activated local-development diagnostic session MAY additionally emit complete permitted transcripts, prompts, tool arguments/results, and redacted provider/browser event bodies to its active process output only. It MUST default off, create no application persistence or remote telemetry, end with the local process/session, and structurally exclude credentials, API keys, authorization material, cookies, session tokens, signing material, and raw audio. Audio is represented only by sizes, format, timing, and lifecycle metadata.
- **Experience**: The feature MUST support the project’s required current desktop and mobile browsers. Voice is the conversational entry, while ordinary search and direct-interface alternatives remain available. Spoken output, transcript updates, map motion, and selection changes MUST not compete for attention or obscure the active task.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST accept vague, incomplete, and subjective discovery requests without requiring users to choose structured filters first.
- **FR-002**: The system MUST maintain conversational intent and refinements throughout an active session.
- **FR-003**: The system MUST provide concise reasoning and at least one meaningful trade-off for each recommended area or place.
- **FR-004**: The system MUST ask a focused clarification when ambiguity would materially change the result and MUST retain previously established context.
- **FR-005**: The system MUST recommend areas before individual places for vague discovery requests unless the user explicitly asks for a specific place or result list.
- **FR-006**: The system MUST visually distinguish recommended areas by relevance and confidence when the map is zoomed out.
- **FR-007**: Users MUST be able to select, compare, dismiss, and refine recommended areas through both voice and direct interaction.
- **FR-008**: The system MUST derive all recommendation claims from approved application data and MUST NOT invent places, events, availability, routes, or attributes.
- **FR-009**: The system MUST expose a voice-equivalent action for 100% of user-facing actions available in the first-release interface.
- **FR-010**: Each voice action MUST declare its eligible application states, required context, expected visible result, reversibility, and confirmation class.
- **FR-011**: The system MUST resolve contextual references against the currently visible, focused, selected, and recently discussed interface elements.
- **FR-012**: The system MUST request clarification rather than guess when multiple contextual targets are materially plausible.
- **FR-013**: Safe, reversible interface actions MUST execute without confirmation and MUST provide immediate visible feedback.
- **FR-014**: Consequential, destructive, privacy-sensitive, or external actions MUST require explicit confirmation that names the target and effect.
- **FR-015**: The system MUST allow users to interrupt spoken output, cancel a pending action, and undo reversible actions wherever the equivalent direct interface supports undo.
- **FR-016**: While the online conversation is active, the system MUST provide voice-first
  interaction with explicit interrupt and stop controls.
- **FR-017**: The system MUST clearly communicate microphone listening, processing, responding, muted, unavailable, and stopped states.
- **FR-018**: The system MUST preserve ordinary composer, search, and direct-interface access when
  microphone access or the realtime voice service is unavailable, while keeping that non-voice
  access visibly separate from the terminated voice session.
- **FR-019**: The system MUST show user location as visually distinct from every recommendation, place marker, area highlight, and transit symbol.
- **FR-020**: The system MUST communicate location accuracy and stale, denied, approximate, and unavailable states without implying false precision.
- **FR-021**: The system MUST show MRT stations and lines as visual context at appropriate map scales while preserving the hierarchy of the active task.
- **FR-022**: MRT proximity MUST NOT influence recommendation ranking unless the user explicitly introduces transit accessibility as a preference or constraint.
- **FR-023**: The system MUST stop microphone capture and playback and clear session-scoped audio,
  transcript, exact-location, interface-context, pending tool, and pending confirmation state when
  the user ends the session, leaves the application, or the online voice service becomes
  unavailable.
- **FR-024**: The system MUST enforce bounded usage and a documented disable mechanism for the approved realtime voice service exception.
- **FR-025**: The system MUST define stable identity and create/update/no-op/expire/review behavior for changing recommendation evidence and voice-action contracts.
- **FR-026**: The system MUST preserve the last approved application data and direct interaction experience when recommendation or voice dependencies cannot be safely used.
- **FR-027**: The system MUST define testable listening, processing, loading, empty, missing-data,
  stale, denied-permission, ambiguous-reference, usage-limit, and service-error states. Every online
  voice service error MUST show “Voice service is currently unavailable. Please try again later.”,
  complete terminal microphone/session cleanup, and perform no local or offline voice handoff.
- **FR-028**: The assistant MUST identify and behave as Amble's application-scoped guide, refuse
  unrelated general-chat and open-web requests, describe capabilities only from the currently
  eligible typed action registry, and MUST NOT claim an application action succeeded before its
  validated result confirms success.
- **FR-029**: Every affected user-facing capability MUST be represented by one versioned typed
  `query` or `command` contract in a shared capability registry used by direct controls, text, and
  voice.
- **FR-030**: Query capabilities MUST read authoritative application or approved-catalogue state
  and return bounded validated results with stable identities, source snapshot identity, total
  count, truncation state, and only allowlisted user-facing fields.
- **FR-031**: Command capabilities MUST execute through the same business executor as their direct
  controls and return a validated observable outcome containing status, changed state, affected
  stable identities, and the resulting context revision.
- **FR-032**: After every state-changing command and every direct interaction that changes assistant-
  relevant state, the system MUST publish a refreshed authoritative interface context before a
  dependent assistant turn or capability call can proceed.
- **FR-033**: Capability eligibility MUST be derived from current registered application state,
  available direct controls, approved targets, and required data; empty or synthetic saved/game
  surfaces MUST NOT be advertised.
- **FR-034**: Local, test, preview, and production connectors MUST expose semantically equivalent
  capability contracts, validation, eligibility, and result schemas for the same fixture and state.
- **FR-035**: Internal Amble capabilities MUST use application-owned function tools. The first
  release MUST include only a disabled, non-networked MCP projection foundation over the shared
  registry. Any later MCP transport MAY expose those projections only as a thin adapter and MUST
  NOT duplicate business logic or bypass provenance, authorization, confirmation, privacy,
  eligibility, result validation, or lifecycle controls.
- **FR-036**: The canonical application connector IDs MUST be `approved-catalog`,
  `application-state`, `events`, `restaurants`, `map`, `discovery-areas`, `plan`, `location`,
  `transit`, `overlay-navigation`, and `tour`, plus the unregistered `conditional-content`
  extension connector. The infrastructure adapter set MUST be Realtime provider, browser audio,
  budget repository, and deterministic non-voice application access. The disabled MCP descriptor
  projector is a protocol adapter foundation, not an application connector or active
  infrastructure transport. No unrelated email, calendar, messaging, file-storage, or
  collaboration connector is required.
- **FR-037**: Disclosure, interruption, stop, and confirmation controls MUST remain protected
  browser-owned lifecycle controls. Spoken stop, mute, unmute, and interrupt requests MAY use a
  deterministic local `session.*` router, but the model MUST NOT invoke disclosure or confirm its
  own consequential action.
- **FR-038**: Capability coverage MUST include multi-value event filters, placement/location
  filters, individual filter removal, occurrence selection, event-session expansion, and map
  attribution controls in addition to the existing inventory.
- **FR-039**: Event sentences submitted by direct composer, connected voice, or same-session text
  MUST pass through one deterministic event-query interpreter using the same recognized option
  catalogue, explicit date/price grammar, aliases, overlap rules, and residual keyword-query rules.
- **FR-040**: The `event.applyquery` command MUST atomically replace or refine the authoritative
  event composer state from bounded text and a base context/catalogue revision, returning the
  canonical sentence, ordered stable phrases, residual query, affected result count, and resulting
  context revision. `event.setfilter` and `event.removefilter` remain the direct semantic commands
  for individual phrase edits.
- **FR-041**: Materially ambiguous event interpretations MUST return bounded clarification choices
  with zero mutation; stale proposals and any invalid compound part MUST fail with zero partial
  mutation. Refine and remove requests MUST preserve unrelated composer state.
- **FR-042**: Domain interpreters MUST normalize bounded language into
  `applicable`, `clarification_required`, or `unsupported` proposals bound to the current context
  revision and MUST NOT execute or mutate state. The event interpreter is required in this release;
  restaurant, plan, and map interpreter boundaries MAY be registered later over their existing
  capabilities without adding new domain connectors.
- **FR-043**: The event composer and assistant MUST render state only from the authoritative
  post-command `EventComposerState`; a voice-originated change MUST therefore be visually
  indistinguishable from the same direct composer change.
- **FR-044**: The MCP projection foundation MUST deterministically derive closed tool descriptors
  and eligible read projections from version-2 capability contracts while preserving capability
  identity, version, argument/result schemas, kind, and structured result mapping.
- **FR-045**: MCP projection invocations MUST route back through the shared capability gateway with
  non-authoritative caller-origin metadata. Caller origin MUST NOT alter validation, eligibility,
  confirmation, privacy, lifecycle, or execution semantics.
- **FR-046**: The MCP projection foundation MUST be disabled and unregistered by default and MUST
  introduce no MCP network listener, route, server runtime, client, credential, external
  authorization surface, or third-party account connector.
- **FR-047**: Online voice MUST use `gpt-realtime-2.1-mini` as its sole Realtime response model.
  The relay MUST NOT configure or attempt a fallback model.
- **FR-048**: Obvious application commands, including zoom in/out, MRT line or station visibility,
  and free-event filtering, MUST be recognized by a bounded deterministic application interpreter
  and executed through the shared capability gateway. The model MAY phrase the reply but MUST NOT
  be the sole action-selection authority for those commands.
- **FR-049**: Before each text model response, the relay MUST expose only foundational queries and
  the eligible capabilities belonging to connector families relevant to the bounded request and
  current interface state. A deterministically routed capability MUST be excluded from provider
  tools for that turn. Native-audio responses use the staged ingress and connector-family
  projection defined by FR-061 and FR-084–FR-091.
- **FR-050**: The relay MUST emit a privacy-safe operational trace for each voice turn covering
  audio committed, response requested, response created, first audio, response completed, and
  terminal failure where applicable. Each record MUST contain only a
  one-way session identifier, turn number, phase, timestamp, elapsed durations, bounded event code,
  and terminal reason.
- **FR-051**: Every requested provider response MUST have a configurable deadline that bounds only
  that in-flight response and never expires an otherwise healthy conversation. The first-release
  deadline MUST be 30 seconds and MUST begin when the response request is sent.
- **FR-052**: When a response deadline expires, the relay MUST record a `response_timeout` terminal
  outcome, cancel the in-flight provider response where possible, clear its watchdog and pending
  reservation, terminate the session through the standard unavailable lifecycle, and ignore any
  late provider completion for that terminated session.
- **FR-053**: Operational trace records MUST NOT contain raw audio, transcripts, prompts, tool
  arguments or results, provider request or response bodies, exact location, secrets, or raw
  session identifiers, and MUST NOT be used as product analytics.
- **FR-054**: Content-bearing voice diagnostics MUST be disabled by default and MUST require an
  explicit local-development process activation before relay construction.
- **FR-055**: Content-bearing diagnostics MUST be structurally unavailable in production and
  preview configurations even when a caller supplies the local activation value.
- **FR-056**: An active local diagnostic session MUST emit complete permitted browser and provider
  event bodies, transcripts, prompts, tool arguments, and tool results to the active local process
  output with a one-way session identifier and direction/event metadata.
- **FR-057**: Local diagnostic serialization MUST recursively replace credentials, API keys,
  authorization material, cookies, session tokens, signing material, and raw audio before any
  logger receives the record. Audio events MUST expose only byte count, format, timing, and
  lifecycle metadata.
- **FR-058**: Local content diagnostics MUST create no file, database row, cache, browser-storage
  entry, remote telemetry request, or background upload unless the separately gated persistent
  local audit mode defined by FR-065–FR-073 is active. Process diagnostics MUST cease when the
  local process or voice session ends.
- **FR-059**: Committing an admitted audio turn MUST start the approved Realtime classification
  response and configured input transcription without serially waiting for one to finish before
  starting the other. Application mutation MUST wait until both terminal results are available for
  the active turn.
- **FR-060**: The relay MUST configure one approved low-latency input-transcription model inside the
  existing Realtime session, retain its final transcript only for the active session, and reserve
  and settle its usage through the existing cumulative budget controls. Raw audio remains
  prohibited from application persistence and content logs.
- **FR-061**: Native-audio application capabilities MUST be selected only after the forced ingress
  stage and MUST be limited to a deterministic route or one currently eligible connector family
  from authoritative interface context. Every proposed capability MUST continue through the
  existing schema, eligibility, confirmation, shared-executor, result-validation, and
  refreshed-context boundaries.
- **FR-062**: Removing transcript-gated routing MUST NOT change the deterministic interpreter or
  connector-family scoping used for text turns.
- **FR-063**: Final input transcripts MUST be joined to the active committed audio item by provider
  item identity. Duplicate, stale, or unrelated transcript events MUST be ignored; missing,
  failed, or timed-out active transcripts MUST cause bounded zero-mutation terminal cleanup.
- **FR-064**: Voice budget admission and settlement MUST reserve only costs for billable operations
  that the turn can actually invoke, while retaining the cumulative cap, kill switches, trusted
  usage settlement, and fail-closed handling for missing response usage.
- **FR-065**: Persistent content auditing MUST require development runtime mode,
  `NODE_ENV=development`, explicit local content diagnostics, and a separate explicit persistent
  audit activation before relay construction. Missing any gate MUST create no audit file.
- **FR-066**: The persistent audit MUST write only sanitized newline-delimited JSON to the fixed
  gitignored owner-controlled `outputs/realtime-content-audit/` directory with directory mode
  `0700` and file mode `0600`.
- **FR-067**: Credentials, authorization material, cookies, session or signing material, raw audio,
  and encoded audio MUST be removed before any persistent sink receives a record. Persistent audit
  data MUST NOT use application databases, browser storage, analytics, telemetry, or network
  transport.
- **FR-068**: Audit files MUST rotate before 5 MiB, retain at most five files, delete files older
  than seven days during startup and rotation cleanup, and require no background process.
- **FR-069**: A single record that cannot fit within the file-size bound MUST be replaced with a
  bounded marker containing its event identity, byte count, and content fingerprint rather than
  written partially or beyond the limit.
- **FR-070**: Repeated large static provider payloads MUST be compacted after the first permitted
  copy using a stable fingerprint and useful bounded metadata, while conversation lifecycle,
  provider-generated transcripts, prompts, tool arguments/results, errors, and terminal outcomes
  remain individually auditable.
- **FR-071**: Persistent audit records MAY contain only provider-generated transcripts that were
  actually emitted. They MUST distinguish partial and final transcript events and MUST NOT
  synthesize, infer, or label user speech as transcribed when no final event exists.
- **FR-072**: Browser `session.stop` messages MUST carry a validated reason from the closed set
  `user`, `pagehide`, and `permission`; the relay MUST preserve that reason in terminal diagnostics.
- **FR-073**: Audit creation, cleanup, rotation, or append failure MUST NOT alter the voice-session
  lifecycle. It MUST degrade to a safe bounded local warning without including prohibited content.
- **FR-074**: Canonical capability IDs MUST remain the authoritative application identity.
  Provider-facing function names MUST use a deterministic, collision-free, reversible alias that
  satisfies the provider naming grammar without changing registry, gateway, result, or browser
  identities.
- **FR-075**: The relay MUST validate every projected provider alias and reject duplicate,
  malformed, unknown, or non-reversible mappings before connecting or sending billable work.
- **FR-076**: Initial and per-turn provider configuration MUST enter a pending state after
  `session.update`; greeting or response creation MUST wait until the provider emits the matching
  successful configuration acknowledgement.
- **FR-077**: Provider configuration acknowledgement MUST be single-use and ordered. Missing,
  stale, duplicate, or out-of-order acknowledgement MUST NOT authorize a response.
- **FR-078**: Any provider `error` event MUST terminate the session through the ordinary
  provider-unavailable lifecycle, release or conservatively hold relevant budget state, and expose
  no raw provider error content to the browser.
- **FR-079**: Provider function proposals MUST resolve the provider alias to one currently exposed
  canonical capability before argument validation. All browser messages and pending-call state
  MUST use only the canonical capability ID.
- **FR-080**: The opening exact-speech instruction MUST apply only to the opening response and MUST
  NOT be inserted as a persistent system conversation item.
- **FR-081**: Static audit compaction fingerprints MUST be derived from stable sanitized content
  and direction while excluding occurrence timestamp and other changing audit-envelope metadata.
- **FR-082**: The live provider smoke MUST be owner-authorized, bounded to the minimum opening and
  representative-turn responses needed for validation, preserve the cumulative budget controls,
  stop terminally, and fail if any provider error or missing configuration acknowledgement is
  observed.
- **FR-083**: For native-audio event discovery, `event.applyquery` MUST be the only reachable event
  query/filter mutation capability. The relay MUST pass the complete spoken event request through
  that one atomic command whether it contains one filter or several, while withholding
  `event.search`, broad catalogue search, individual filter mutation commands, and legacy filter
  setters from the provider. Direct controls MAY continue using those lower-level semantic
  commands.
- **FR-084**: The first provider response after each committed native-audio user turn MUST expose
  exactly one provider-only classification tool and MUST force that tool. No application
  capability, catalogue query, or domain action may be exposed at this stage.
- **FR-085**: The classification tool MUST return one closed bounded object containing the domain
  and, when the request is an event query, one structured proposal covering What, When, Where, and
  Price. It MUST neither require nor accept an utterance member. The relay MUST supply the final
  transcript and current authoritative application context revision before deterministic routing
  or proposal verification. Classification is non-authoritative model interpretation and MUST
  follow the existing session-only privacy and diagnostic rules.
- **FR-086**: After ingress, the relay MUST reuse the same bounded deterministic turn router,
  domain interpreters, capability registry, gateway, and authoritative context used by text turns.
  A deterministic event sentence MUST proceed directly to `event.applyquery`; obvious map, transit,
  and lifecycle commands MUST retain their existing deterministic routes.
- **FR-087**: If deterministic routing cannot select a complete action, the relay MAY expose only
  the currently eligible tools from one relevant connector family, plus a bounded read-only detail
  query when authoritative visible targets require it. The scoped menu MUST contain at most 15
  tools and MUST NOT include an unrelated connector family.
- **FR-088**: `app.inspect` and broad `catalog.search` MUST NOT be exposed during native-audio
  ingress. Catalogue search MAY appear only after the deterministic router selects the approved
  catalogue family, so it cannot compete with an event or restaurant entry command.
- **FR-089**: A deterministic native-audio command result MUST be followed by a response that
  cannot invoke another tool. Malformed, missing, duplicate, stale, or overlapping classification
  calls, and classifications that cannot be paired with a final active transcript, MUST fail closed
  with zero application mutation and ordinary terminal cleanup.
- **FR-090**: The classification response, input transcription, and any subsequent scoped/final
  response MUST retain the existing reservation, response-watchdog, configuration-acknowledgement,
  interruption, and terminal-cleanup controls. The transcript MUST remain session-scoped and its
  reservation MUST be settled independently from response stages.
- **FR-091**: Voice sessions MUST NOT impose a per-session user-turn or assistant-response-count
  limit, maximum duration, or idle expiry. The relay MUST instead allow at most three sequential
  provider response stages for one admitted user turn, allow at most one unresolved stage at a
  time, and apply billable-stage budget admission independently. Sessions end only through
  explicit stop, navigation or socket loss, permission loss, provider/service failure, or
  budget/kill-switch enforcement.
- **FR-092**: OpenAI event-facet classification MUST apply only to native voice ingress. Typed and
  direct event-query entry points MUST remain deterministic and MUST NOT require provider
  availability or spend. Voice, typed, and direct entry points MUST converge on the same
  deterministic proposal verifier, capability contract, and `event.applyquery` executor.
- **FR-093**: The relay MUST normalize only documented, semantically lossless provider variations
  of the forced classification result before applying the closed classification validator. Normalization MAY move
  the known event facet, `residualQuery`, and `unresolved` members into an event proposal, discard
  a structurally bounded event proposal when the declared domain is non-event because it has no
  routing authority, collapse matching `eventWhat`, `eventWhen`, `eventWhere`, `eventPrice`,
  `eventResidualQuery`, and `eventUnresolved` aliases, accept null for an unused non-event facet,
  unwrap an empty or singleton value for a single-value event facet. It MUST reject
  unknown members, conflicting aliases, multiple values for a single-value facet, domain conflicts,
  invented labels, an unexpected `utterance` member, or any other semantic change. A structurally
  malformed event proposal MAY be discarded while the server-owned final transcript continues
  through the existing deterministic classifier; the malformed proposal itself MUST never
  contribute a value.
- **FR-094**: A facet absent from an event request is optional and MUST NOT be reported as unresolved.
  `unresolved` MUST contain only a facet whose wording is present in the current utterance and has
  two or more materially plausible current-catalogue interpretations. Generic event wording MUST
  NOT create an invented What selection.
- **FR-095**: A native event refinement MUST verify newly proposed values against the current
  utterance and MAY retain an unchanged authoritative facet only from the immediately preceding
  event composer state. It MUST NOT require new utterance evidence for retained state, and MUST
  reject a provider-restated inherited value when it differs from that authoritative state.
- **FR-096**: Every deterministic text turn MUST execute the same application capability as its
  direct control and return the authoritative result to the relay before the final no-tool provider
  response. Provider configuration acknowledgement, capability execution, context refresh, and
  response creation MUST be serialized so no text turn can reserve a response without eventually
  creating or terminally cancelling it.
- **FR-097**: Final speech after an application capability MUST describe only the structured
  authoritative result returned by that capability. Query fixtures MUST return the bounded
  user-facing result data required for truthful narration; a generic changed flag is insufficient
  evidence for a discovery answer.
- **FR-098**: Browser and local relay audio/message limits MUST agree. The browser MUST chunk below
  the relay's accepted binary payload, and an oversized or malformed WebSocket message MUST
  terminate only the affected session through the ordinary protocol path without crashing the
  local server process.
- **FR-099**: The owner-authorized live acceptance gate MUST run the same named sixteen-case matrix
  through the real Realtime relay. Each case MUST assert the expected capability or clarification,
  authoritative application outcome, truthful final response, terminal state, configuration
  acknowledgements, and absence of timeout, protocol stop, process crash, or unintended mutation.
  Failed cases MUST be retained as regression fixtures and the gate MUST repeat after correction.
- **FR-100**: FR-059, FR-061, FR-084–FR-090, and FR-092–FR-095 are superseded only where they
  require a provider classification response or provider-proposed event facets. A committed native
  turn MUST instead route the relay-owned final transcript through the deterministic application
  router before any scoped provider tool menu is created.
- **FR-101**: Event query interpretation MUST extract only current-catalogue What, When, Where, and
  Price phrases recognized by the closed deterministic grammar. Unrecognized wording MUST NOT
  become a residual query unless the utterance starts with an explicit bounded event keyword-search
  prefix.
- **FR-102**: The router MUST recognize bounded vocabulary for every active connector family and
  MUST resolve incidental words such as “plan” in “add this event to my plan”, “area” in a
  restaurant viewport request, and “MRT” in a discovery preference without exposing unrelated
  connector families.
- **FR-103**: Safe target-free commands with closed arguments MAY execute deterministically.
  Target-bearing or consequential commands MUST retain current eligibility, stable target
  resolution, confirmation policy, shared execution, and refreshed context.
- **FR-104**: Saved/game actions MUST remain absent from deterministic recognition until real data,
  direct controls, and their connector are registered.
- **FR-105**: Every capability-result response MUST map the validated `completed`, `empty`,
  `unavailable`, `failed`, and `confirmation_required` states to distinct truthful dialogue and
  MUST distinguish `changed: false` from a completed state change.
- **FR-106**: Completed dialogue MUST lead with the confirmed outcome and use only bounded labels,
  counts, settings, and state projected by the capability result or refreshed authoritative
  context. Missing evidence MUST use a target-neutral fallback rather than an inferred name.
- **FR-107**: Discovery, selection, and planning dialogue SHOULD be warm, concise, and
  occasionally playful; camera, layer, overlay, and tour-step dialogue SHOULD remain short. The
  system MUST NOT collapse supported actions into the phrase “Done in Amble.”
- **FR-108**: A capability-result response MAY ask at most one follow-up question and only when the
  proposed next capability is currently eligible in refreshed context. It MUST NOT append a
  follow-up to every minor action.
- **FR-109**: Consequential actions MUST present the browser-owned exact effect and confirmation
  controls before execution. Spoken wording MUST not imply that the action has executed until the
  validated post-confirmation result arrives.
- **FR-110**: The dialogue matrix MUST cover event, restaurant, map/area, plan/location, tour,
  navigation/external, clarification, no-op, empty, unavailable, failed, confirmation, and
  out-of-scope outcomes with deterministic fixtures.
- **FR-111**: A valid final transcription event for the active committed item with an empty
  transcript MUST settle its known bounded transcription reservation, perform no application
  mutation, request exactly one fixed retry prompt, and MUST NOT enter the protocol-failure path,
  hold that reservation, or disable admission for subsequent voice sessions.

### Key Entities

- **Conversation Session**: A temporary voice/text interaction containing the current intent, refinements, transcript, permission state, and lifecycle state.
- **Discovery Intent**: The inferred and explicitly stated interests, constraints, exclusions, time context, and requested level of specificity.
- **Suggested Area**: A geographic region recommended for the current intent, including confidence, supporting reasons, trade-offs, and eligible places.
- **Recommendation Candidate**: An approved place, event, restaurant, deal, plan, or other discoverable item with evidence and its fit to the current intent.
- **Capability Contract**: A versioned typed query or command shared by direct and conversational
  entry points, including authoritative owner, eligibility, arguments, bounded result, confirmation
  class, and observable failure behavior.
- **Domain Connector**: A thin adapter from a capability contract to one authoritative application
  domain, with explicit environment availability and no duplicated business rules.
- **Capability Result**: A validated query result or observable command outcome carrying stable
  identities, context revision, and bounded user-facing data.
- **Domain Interpretation**: A side-effect-free, revision-bound interpretation outcome containing
  a selected domain, normalized utterance, clarification choices, and zero or more closed proposed
  capability calls.
- **Event Composer State**: The authoritative canonical event sentence, residual keyword query,
  ordered stable What/When/Where/Price phrases, option-catalogue revision, and context revision.
- **Capability Projection**: A deterministic protocol descriptor derived from a registered
  capability contract; it contains no executor, authorization rule, or business logic.
- **Native Audio Turn**: An admitted session-scoped audio turn whose transcription and
  classification begin from the committed audio buffer and are joined before application mutation.
- **Native Voice Classification**: A provider-only, forced, closed function result containing a
  bounded domain and optional event-facet proposal. It is non-authoritative routing input and does
  not contain the utterance.
- **Final Input Transcript**: The provider-emitted final transcript matched to the active committed
  audio item. The relay owns it as the session-scoped utterance used for deterministic routing,
  evidence verification, diagnostics when locally authorized, and no application persistence.
- **Native Tool Menu**: The immutable provider projection for one native-audio stage: exactly one
  forced ingress tool initially, no tools after a deterministic result, or at most fifteen
  currently eligible tools from one routed connector family.
- **Invocation Context**: Bounded metadata such as caller origin and proposal revision that aids
  auditing but never changes capability semantics or authority.
- **Interface Context**: The session-scoped set of visible, focused, selected, ordered, and recently discussed elements used to resolve expressions such as “this” or “the second one.”
- **Confirmation Request**: A pending consequential action with its target, effect, expiry, and explicit approval or rejection state.
- **User Location State**: The current permission, position, accuracy, freshness, and availability state used for map orientation.
- **Transit Context**: MRT stations and lines relevant to the visible map, plus whether transit has been explicitly activated as a recommendation constraint.
- **Voice Turn Trace**: A session-scoped reliability state containing a one-way session
  identifier, monotonically increasing turn number, the current bounded phase, phase timestamps,
  elapsed durations, event code, and terminal reason. It contains no conversational content and
  is emitted only as minimal operational logging.
- **Local Content Diagnostic Record**: An explicitly enabled local-process record containing
  direction, bounded event identity, one-way session identity, timestamp, and a recursively
  sanitized copy of the permitted browser/provider payload. It remains process-only unless the
  separately gated local audit mode is active and cannot exist in preview or production.
- **Local Content Audit Set**: At most five owner-only newline-delimited JSON files in the fixed
  gitignored local audit directory, each smaller than 5 MiB and no older than seven days after
  cleanup. It contains only sanitized diagnostic records or bounded fingerprint markers and has no
  remote transport.
- **Provider Capability Alias Map**: An immutable bijection between canonical dotted capability IDs
  and provider-safe function names for one relay configuration. Provider aliases never cross into
  browser, gateway, result, or application state.
- **Provider Configuration State**: The current configuration revision, pending acknowledgement,
  accepted revision, and queued continuation for the opening or active turn. Only a matching
  provider acknowledgement releases the continuation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least 85% of moderated users starting with a vague intent identify at least one suitable area without constructing a structured query.
- **SC-002**: At least 80% of users can explain why a recommended area fits and name one trade-off after viewing or hearing its recommendation.
- **SC-003**: At least 90% of test users identify the highest-priority recommended area within five seconds of seeing a zoomed-out result map.
- **SC-004**: 100% of first-release user-facing actions appear in the voice-action inventory and pass at least one successful voice-equivalence acceptance test.
- **SC-005**: At least 90% of representative safe voice commands reach the same observable application state as their direct-interface equivalents without an unnecessary confirmation.
- **SC-006**: 100% of tested consequential actions require explicit confirmation, and rejected or expired confirmations produce no external or destructive effect.
- **SC-007**: At least 90% of test users can correctly identify microphone state, their location state, and whether the assistant is waiting, acting, or responding.
- **SC-008**: At least 90% of contextual references in representative test scenarios resolve to the intended visible target; ambiguous cases ask for clarification rather than selecting an unverified target.
- **SC-009**: When voice service or microphone access is unavailable, 100% of tested attempts show
  the required limitation or unavailable message, stop capture/playback, clear the voice session,
  perform no offline voice handoff, and leave ordinary composer/search/direct controls usable.
- **SC-010**: In tests where transit is not requested, recommendation order remains unchanged when MRT visualization is toggled; when transit is requested, the resulting constraint is visibly and verbally disclosed.
- **SC-011**: No application-retained raw audio, session transcript, exact-location state, or interface-context state remains after the session lifecycle completes.
- **SC-012**: 100% of catalogue-query fixtures return schema-valid bounded results with stable
  identities, accurate total/truncation metadata, and no field outside the approved projection.
- **SC-013**: 100% of state-changing capability tests publish a new authoritative context revision
  before a dependent follow-up call executes.
- **SC-014**: 100% of affected public direct controls and assistant commands invoke the same
  registered executor and reach the same observable success, failure, and unavailable states.
- **SC-015**: Contract-parity fixtures pass without schema or eligibility differences across local,
  test, preview, and production connector implementations.
- **SC-016**: No unconfigured or empty saved-content/game capability and no unrelated external
  account connector appears in the assistant's advertised tool list.
- **SC-017**: Every event filter, occurrence/session control, and attribution control has a typed
  capability and direct/conversational observable-state parity fixture.
- **SC-018**: Consent and confirmation cannot be model-invoked, while deterministic local stop,
  mute, unmute, and interrupt fixtures complete without a Realtime tool call.
- **SC-019**: For 100% of the approved event-sentence fixture corpus, direct composer and voice
  entry produce the same canonical sentence, ordered phrases, residual query, result state, and
  exactly one changed context revision.
- **SC-020**: 100% of ambiguity, stale-revision, and invalid-compound event fixtures produce zero
  partial mutation; clarification fixtures contain only bounded current-catalogue choices.
- **SC-021**: 100% of version-2 MCP projection fixtures preserve registered capability ID, version,
  kind, closed input schema, result schema, confirmation class, and gateway outcome.
- **SC-022**: Production inspection finds zero MCP listeners, routes, server/client runtime
  dependencies, credentials, registered external transports, or unrelated account connectors.
- **SC-023**: 100% of policy, relay, and provider-connection fixtures use
  `gpt-realtime-2.1-mini` and contain no fallback model identifier.
- **SC-024**: 100% of approved obvious-command fixtures reach the same gateway result as their
  direct controls without a provider tool proposal for that command.
- **SC-025**: 100% of turn-scope fixtures expose no eligible capability outside the selected
  connector families for text turns; native-audio fixtures expose only forced ingress,
  deterministic routing, or one current-authoritative connector family.
- **SC-026**: 100% of successful voice-turn fixtures emit the ordered applicable lifecycle phases,
  and every phase record passes an allowlist test proving it contains no conversational content,
  precise location, provider body, secret, or raw session identifier.
- **SC-027**: 100% of stalled-response fixtures terminate within the configured response deadline
  plus one scheduler interval, cancel the pending provider response, release pending budget state,
  emit `response_timeout`, and leave no response watchdog active.
- **SC-028**: 100% of local content-diagnostic fixtures require explicit activation and reproduce
  every permitted transcript, prompt, tool argument/result, and non-audio event field needed by the
  fixture.
- **SC-029**: 100% of production, preview, default-off, nested-secret, and raw-audio fixtures emit
  zero prohibited content; no application database, cache, browser storage, or remote request is
  created by the diagnostic path, and no file is created unless every local audit gate is active.
- **SC-030**: 100% of committed-audio fixtures start transcription and classification without
  serial startup delay, while producing zero application mutation until both active-turn results
  are available.
- **SC-031**: 100% of historical classification-first and transcript-first fixtures join once by
  active item identity; missing, failed, timed-out, duplicate, and stale-transcription fixtures
  produce zero unintended mutation and leave no pending join state, while the empty-transcript
  fixture follows the bounded retry behavior in SC-068.
- **SC-032**: 100% of native-audio tool-call fixtures reject unavailable or malformed capabilities
  and preserve the same confirmation and observable-result outcomes as direct interaction.
- **SC-033**: Every new audio turn admits and settles at most one input-transcription reservation,
  independently from response stages, while cumulative-cap, kill-switch, and missing-usage tests
  continue to pass.
- **SC-034**: 100% of existing text-turn interpretation, deterministic-command, and per-family tool
  scope fixtures remain unchanged.
- **SC-035**: 100% of activation fixtures create persistent audit files only when all four
  development, environment, content-diagnostic, and persistent-audit gates are active.
- **SC-036**: 100% of audit fixtures keep every file below 5 MiB, retain at most five files, remove
  files older than seven days during cleanup, and apply owner-only directory and file permissions.
- **SC-037**: 100% of nested-secret, token, cookie, raw-audio, and encoded-audio fixtures contain
  none of those values in persistent bytes.
- **SC-038**: Repeating an identical large session configuration 100 times retains one permitted
  full copy and compact fingerprinted repetitions while preserving all conversational turn,
  tool-call, error, and terminal records.
- **SC-039**: 100% of native-audio fixtures without a final provider user-transcription event
  contain no claimed or synthetic final user transcript in the persistent audit.
- **SC-040**: 100% of user, page-unload, and microphone-permission stop fixtures preserve their
  validated terminal reason, while invalid reasons are rejected.
- **SC-041**: 100% of simulated audit-directory, cleanup, rotation, and append failures leave the
  voice lifecycle and provider relay result unchanged.
- **SC-042**: 100% of registered capability fixtures project to unique provider names matching
  `^[a-zA-Z0-9_-]+$` and round-trip to the original canonical IDs.
- **SC-043**: 100% of initial and per-turn response fixtures create zero provider responses before
  matching configuration acknowledgement and exactly one afterward.
- **SC-044**: 100% of provider-error, missing-acknowledgement, stale-acknowledgement, and
  duplicate-acknowledgement fixtures fail closed without generic-assistant continuation.
- **SC-045**: 100% of provider function-call fixtures expose canonical capability IDs to the
  browser and retain existing validation, confirmation, and result behavior.
- **SC-046**: 100 repeated identical sanitized configuration payloads across different timestamps
  retain one full record plus compact repetitions; changed tool or instruction payloads remain
  independently auditable.
- **SC-047**: A bounded authorized live smoke completes the exact opening and one representative
  turn with a provider configuration acknowledgement before each response, zero provider errors,
  terminal cleanup, and an auditable zero-error report.
- **SC-048**: 100% of native-audio event-routing fixtures reach `event.applyquery` for event
  discovery and expose zero alternative event query/filter mutation tools; single-filter and
  compound-filter requests both produce one atomic event-query proposal containing the complete
  request.
- **SC-049**: 100% of committed native-audio fixtures expose exactly one forced classification
  tool with no `utterance` property in the first provider configuration and expose zero application
  capabilities at that stage.
- **SC-050**: The representative “today at Marina Bay Sands” fixture produces one
  `event.applyquery` proposal containing both constraints, zero `app.inspect` or `catalog.search`
  calls, exactly one resulting context revision, and no partial mutation.
- **SC-051**: 100% of non-deterministic native-audio fixtures expose at most 15 tools from exactly
  one relevant connector family; unsupported or ambiguous turns expose no action menu and mutate
  nothing.
- **SC-052**: 100% of malformed, missing, duplicate, stale, and overlapping classification or
  transcript-join fixtures fail closed without an application effect, leaked raw audio, persistent
  transcript, orphaned reservation, join state, or active watchdog.
- **SC-053**: The representative event-query flow requires at most two provider responses after
  audio commit—one forced classification response and one final spoken response—plus one concurrent
  input transcription, and its first-stage tool definition count remains one.
- **SC-054**: A deterministic relay fixture completes more than six consecutive user turns in one
  active session and remains active beyond the former duration and idle thresholds without
  `usage_limit`, `duration`, or `idle`, while a fixture attempting a fourth provider stage within
  one user turn terminates without additional application mutation.
- **SC-055**: A deterministic matrix covers single-filter, compound-filter, follow-up, mixed-domain,
  and unsupported native utterances. The live wording “events today nearby in my area” binds the
  current application revision, applies both date and nearby-location filters, and produces no
  `stale_context` result.
- **SC-056**: Every accepted native event facet in deterministic fixtures matches one unique
  current catalogue label and exact utterance evidence. Invented, conflicting, unresolved,
  malformed, and stale proposals cause zero event-state mutation, while typed event queries retain
  their pre-existing deterministic output.
- **SC-057**: 100% of the documented lossless ingress variants normalize to the same canonical
  object and application outcome, while every unknown, conflicting, multi-valued, invented, or
  evidence-free variant fails closed with zero mutation.
- **SC-058**: Event fixtures covering omitted optional facets, genuine ambiguity, generic event
  wording, compound replacement, and context-backed refinement produce no unnecessary
  clarification, no invented category, and no loss of an unrelated retained facet.
- **SC-059**: 100 consecutive deterministic text fixtures create exactly one application outcome
  and one final provider response after matching configuration acknowledgement, with no timeout,
  unresolved reservation, duplicate execution, or response/configuration race.
- **SC-060**: 100% of query-result narration fixtures are supported by returned structured data and
  contain no unrelated fallback, invented result, or success claim after a failed or unavailable
  capability.
- **SC-061**: Audio chunks emitted by the browser remain below the relay payload limit, and
  oversized-message fixtures close only the offending session while a subsequent session is
  admitted and completes normally.
- **SC-062**: All sixteen owner-authorized live matrix cases pass in one completed report with the
  expected routing, tool calls, application outcomes, responses, and terminal lifecycle, with zero
  protocol stops, response timeouts, relay crashes, or unresolved defects.
- **SC-063**: The deterministic action-vocabulary matrix reaches exactly one owning connector family
  for every representative active action, “Can you find me free events to do over the weekend?”
  produces only Free and This weekend with an empty residual query, all voice tests pass, and no
  `voice__classifyrequest` call occurs.
- **SC-064**: 100% of representative capability families return action-specific dialogue without
  the generic phrase “Done in Amble,” and every dialogue fixture is supported by validated result
  or refreshed-context evidence.
- **SC-065**: 100% of no-op, empty, unavailable, failed, clarification, and confirmation fixtures
  state the correct outcome and make zero false success claims.
- **SC-066**: 100% of dialogue follow-up fixtures contain no more than one question and offer only
  a capability proven eligible by the refreshed context.
- **SC-067**: Event search with eligible plan capacity names at most three authoritative top events
  and offers to add one; the same result without plan capacity names the events without offering an
  unavailable plan action.
- **SC-068**: An active empty-transcript completion produces zero capability proposals, one fixed
  retry response, a settled transcription reservation, and leaves the relay session and global
  voice-admission gate available for the next turn.

## Assumptions

- The initial audience includes Singapore residents and tourists who may be uncertain about what they want to do.
- “Every application feature” means every user-facing action present in the first-release interface, not internal administration or operational tooling.
- Voice activation is always explicit; continuous listening and gaze tracking are not inferred from the request.
- Safe reversible actions include navigation, map movement, selection, opening and closing panels, and changing reversible filters; the final classification will be enumerated in the voice-action inventory.
- Consequential actions include destructive changes, external submissions, purchases or bookings if later present, and sharing precise personal data.
- MRT is visual orientation context by default and becomes a recommendation input only after an explicit user request.
- Existing approved content, identity, lifecycle, and provenance rules remain authoritative over model-generated reasoning.
- The owner-approved realtime API exception is limited to this feature and does not authorize unrelated paid services or removal of cost and shutdown safeguards.
- The USD 10 allowance is cumulative for the feature rather than monthly and has no automatic reset.
- The deterministic event classifier is application search logic shared by direct and connected
  voice entry points; it is not an offline conversational voice fallback.
- The MCP work in this amendment is a disabled contract-projection foundation only. Enabling a
  network server requires a separate approved specification covering identity, authorization,
  rate limits, session isolation, remote confirmation, exposure, logging, and operations.
- The first-release response deadline is 30 seconds. It is a reliability boundary, not a response
  token or content-length ceiling, and does not alter the provider/model intrinsic output limit.
- “Local development” means the Node development relay process started by the developer; browser
  runtime flags and request payloads cannot activate content diagnostics.
