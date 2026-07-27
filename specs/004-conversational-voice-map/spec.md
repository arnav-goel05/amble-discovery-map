# Feature Specification: Conversational Voice Map Assistant

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-18

**Status**: Draft — amended for constitution v2.4.0 shared-capability, deterministic-interpreter,
and MCP-foundation architecture

**Input**: User description: "Replace research-heavy search with open-ended conversational discovery, highlight suitable areas when zoomed out, make user location and Singapore MRT context clear, and let users control every user-facing application feature by voice."

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

---

### User Story 4 - Speak Naturally in Public or Noisy Places (Priority: P2)

As a mobile user, I can choose voice-first interaction while retaining a visible transcript, text input, interruption controls, and a clear microphone state.

**Why this priority**: Voice should feel natural without making the application unusable on public transport, in noisy environments, or when microphone access is unavailable.

**Independent Test**: A user can begin, pause, resume, correct, interrupt, and continue a conversation using voice or text while always understanding whether the microphone is active.

**Acceptance Scenarios**:

1. **Given** voice is available, **When** the user explicitly activates it, **Then** the application clearly indicates listening, processing, speaking, muted, and stopped states.
2. **Given** a voice exchange, **When** either participant speaks, **Then** a readable transcript
   stays visible and a same-session text input remains available without obscuring the map.
3. **Given** the assistant is speaking, **When** the user interrupts, **Then** playback stops promptly and the new request becomes the active conversational turn.
4. **Given** microphone permission is denied or audio quality is insufficient, **When** the user attempts voice interaction, **Then** the application explains the limitation and preserves full text-based access to the same actions.
5. **Given** the online voice service is unavailable, disabled, over budget, or terminates
   unexpectedly, **When** the failure is known, **Then** the application says “Voice service is
   currently unavailable. Please try again later.”, stops microphone capture and audio playback,
   clears the voice session and pending voice work, and does not silently hand the utterance to a
   local or offline voice assistant.

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
- **Privacy and lifecycle**: Microphone use MUST begin only after explicit user action and MUST be visibly indicated. Continuous background listening is prohibited. Raw audio MUST NOT be retained by the application. Conversation transcripts, exact location, and current interface context MUST remain session-scoped unless the user explicitly invokes an existing persistence feature. Provider-side retention and processing behavior MUST be disclosed before voice activation. No voice, transcript, or location analytics may be collected.
- **Experience**: The feature MUST support the project’s required current desktop and mobile browsers. Voice is the primary conversational entry, but every voice interaction MUST have a text and direct-interface alternative. Spoken output, transcript updates, map motion, and selection changes MUST not compete for attention or obscure the active task.

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
  interaction with a visible transcript and an equivalent text input within that same conversation.
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
- **FR-037**: Consent, push-to-talk, interruption, mute, stop, and confirmation controls MUST remain
  protected browser-owned lifecycle controls. Spoken stop, mute, unmute, and interrupt requests MAY
  use a deterministic local `session.*` router, but the model MUST NOT invoke consent or confirm its
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
- **FR-049**: Before each model response, the relay MUST expose only foundational queries and the
  eligible capabilities belonging to connector families relevant to the bounded request and
  current interface state. A deterministically routed capability MUST be excluded from provider
  tools for that turn.

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
- **Invocation Context**: Bounded metadata such as caller origin and proposal revision that aids
  auditing but never changes capability semantics or authority.
- **Interface Context**: The session-scoped set of visible, focused, selected, ordered, and recently discussed elements used to resolve expressions such as “this” or “the second one.”
- **Confirmation Request**: A pending consequential action with its target, effect, expiry, and explicit approval or rejection state.
- **User Location State**: The current permission, position, accuracy, freshness, and availability state used for map orientation.
- **Transit Context**: MRT stations and lines relevant to the visible map, plus whether transit has been explicitly activated as a recommendation constraint.

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
  connector families, and audio responses are not created before the final transcript is scoped.

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
