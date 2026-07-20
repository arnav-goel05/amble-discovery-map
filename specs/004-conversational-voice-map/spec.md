# Feature Specification: Conversational Voice Map Assistant

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-18

**Status**: Draft — product decisions and constitutional dependency resolved; ready for implementation planning

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

---

### User Story 4 - Speak Naturally in Public or Noisy Places (Priority: P2)

As a mobile user, I can choose voice-first interaction while retaining a visible transcript, text input, interruption controls, and a clear microphone state.

**Why this priority**: Voice should feel natural without making the application unusable on public transport, in noisy environments, or when microphone access is unavailable.

**Independent Test**: A user can begin, pause, resume, correct, interrupt, and continue a conversation using voice or text while always understanding whether the microphone is active.

**Acceptance Scenarios**:

1. **Given** voice is available, **When** the user explicitly activates it, **Then** the application clearly indicates listening, processing, speaking, muted, and stopped states.
2. **Given** a voice exchange, **When** either participant speaks, **Then** a readable transcript stays visible inside the expanded voice pill without presenting a text-chat composer.
3. **Given** the assistant is speaking, **When** the user interrupts, **Then** playback stops promptly and the new request becomes the active conversational turn.
4. **Given** microphone permission is denied or audio quality is insufficient, **When** the user attempts voice interaction, **Then** the application explains the limitation and preserves full text-based access to the same actions.

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
- The user leaves or closes the application during a voice session.

## Scope and Constraints _(mandatory)_

- **In scope**: Voice-first and text-fallback conversation; vague-intent discovery; area-first recommendations and reasoning; contextual references to visible interface elements; voice equivalents for every existing user-facing action in the first release; safe-action execution; confirmation for consequential actions; clear location state; and MRT stations and lines as visual context.
- **Out of scope**: General-purpose chat, open-web research, unrestricted browser/device control;
  creating new booking, payment, messaging, or transport-routing capabilities that do not already
  exist; continuous always-listening behavior; inferring eye gaze; allowing generated claims to
  override approved source data; and making MRT access a default ranking factor.
- **Evidence and dependencies**: Recommendations MUST be grounded in approved application data and retain the source/evidence rules already governing events, venues, restaurants, and deals. Constitution v2.2.0 permits a feature-scoped exception to use the OpenAI realtime voice API. Arnav is the operational owner. The feature has one cumulative lifetime spending ceiling of USD 10 with no automatic reset; increasing or resetting it requires explicit owner approval. The experience MUST fall back to local text and direct controls without calling another paid model when the voice service is unavailable, disabled, or at its cap.
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
- **FR-016**: The system MUST provide voice-first interaction with a visible transcript and an equivalent text input within the same conversation.
- **FR-017**: The system MUST clearly communicate microphone listening, processing, responding, muted, unavailable, and stopped states.
- **FR-018**: The system MUST preserve equivalent text and direct-interface access when microphone access or the realtime voice service is unavailable.
- **FR-019**: The system MUST show user location as visually distinct from every recommendation, place marker, area highlight, and transit symbol.
- **FR-020**: The system MUST communicate location accuracy and stale, denied, approximate, and unavailable states without implying false precision.
- **FR-021**: The system MUST show MRT stations and lines as visual context at appropriate map scales while preserving the hierarchy of the active task.
- **FR-022**: MRT proximity MUST NOT influence recommendation ranking unless the user explicitly introduces transit accessibility as a preference or constraint.
- **FR-023**: The system MUST stop microphone capture and clear session-scoped audio, transcript, exact-location, and interface-context state when the user ends the session or leaves the application.
- **FR-024**: The system MUST enforce bounded usage and a documented disable mechanism for the approved realtime voice service exception.
- **FR-025**: The system MUST define stable identity and create/update/no-op/expire/review behavior for changing recommendation evidence and voice-action contracts.
- **FR-026**: The system MUST preserve the last approved application data and direct interaction experience when recommendation or voice dependencies cannot be safely used.
- **FR-027**: The system MUST define testable listening, processing, loading, empty, missing-data, stale, denied-permission, ambiguous-reference, usage-limit, and service-error states.
- **FR-028**: The assistant MUST identify and behave as Amble's application-scoped guide, refuse
  unrelated general-chat and open-web requests, describe capabilities only from the currently
  eligible typed action registry, and MUST NOT claim an application action succeeded before its
  validated result confirms success.

### Key Entities

- **Conversation Session**: A temporary voice/text interaction containing the current intent, refinements, transcript, permission state, and lifecycle state.
- **Discovery Intent**: The inferred and explicitly stated interests, constraints, exclusions, time context, and requested level of specificity.
- **Suggested Area**: A geographic region recommended for the current intent, including confidence, supporting reasons, trade-offs, and eligible places.
- **Recommendation Candidate**: An approved place, event, restaurant, deal, plan, or other discoverable item with evidence and its fit to the current intent.
- **Voice Action Contract**: The voice-accessible equivalent of a user-facing action, including eligible state, required target, result, reversibility, confirmation class, and failure response.
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
- **SC-009**: When voice service or microphone access is unavailable, 100% of tested voice-accessible tasks remain completable through text or the direct interface.
- **SC-010**: In tests where transit is not requested, recommendation order remains unchanged when MRT visualization is toggled; when transit is requested, the resulting constraint is visibly and verbally disclosed.
- **SC-011**: No application-retained raw audio, session transcript, exact-location state, or interface-context state remains after the session lifecycle completes.

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
