# Feature Specification: Reliable Pending Voice Selections

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-08-02

**Status**: Complete

**Input**: User description: "Implement Phase 1 of the Amble voice reliability roadmap: prioritize pending selections, resolve natural candidate references deterministically, preserve unresolved state, and recover invalid calls without ending the voice session."

## Clarifications

### Session 2026-08-02

- Q: How broadly should candidate names match? → A: Match exact titles, ordinals, and unique normalized title words or phrases; general typo-distance matching is out of scope.
- Q: What happens when the user changes topics while a selection is pending? → A: A clearly recognized new action replaces the pending selection; ambiguous replies preserve it.
- Q: How should Amble recover from an invalid tool call? → A: Keep the session alive and ask a deterministic clarification based on the pending state.
- Q: When should “that one” select an event automatically? → A: Never in this phase; it always triggers clarification.
- Q: What happens when a title fragment matches several candidates? → A: Clarify using only the matching candidates while retaining the complete pending selection internally.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Select an Offered Result Naturally (Priority: P1)

As a voice user who has just been offered several verified results, I can select one using its number, exact title, or a unique part of its title without repeating a rigid command.

**Why this priority**: This directly fixes the observed failure where an event title was rejected and routed into an unrelated action family.

**Independent Test**: Offer three events with stable identities, then verify that an ordinal, exact normalized title, and unique normalized title fragment each select the intended stored identity exactly once.

**Acceptance Scenarios**:

1. **Given** three current event candidates are pending, **When** the user says “the second one,” **Then** Amble selects only the second candidate using its stored stable identity.
2. **Given** one pending candidate is named “Reflect on Time,” **When** the user says “add Reflect on Time,” **Then** Amble selects that candidate without asking the model to reproduce its identity.
3. **Given** exactly one pending title contains the normalized word or phrase “Reflect,” **When** the user says “add Reflect,” **Then** Amble selects that unique candidate.
4. **Given** a pending selection exists, **When** the user says “that one,” **Then** Amble performs no action and asks which numbered or named candidate they mean.
5. **Given** the same reply is duplicated or delayed after resolution, **When** it arrives, **Then** the stored action is not executed a second time.

---

### User Story 2 - Clarify Without Losing the Offer (Priority: P1)

As a voice user whose answer is ambiguous, I receive a short useful clarification and can answer it without losing the original offered results.

**Why this priority**: Clearing pending state after an ambiguous reply makes the next answer impossible to resolve and sends it through unrelated routing.

**Independent Test**: Submit an ambiguous fragment, verify zero mutation and retained pending state, then answer the clarification with an ordinal and verify the original candidate is selected.

**Acceptance Scenarios**:

1. **Given** two offered titles match “Reflect,” **When** the user says “add Reflect,” **Then** Amble asks the user to choose between only those two matching candidates and performs no action.
2. **Given** a clarification was asked for a subset of matching candidates, **When** the user answers with a valid ordinal or name, **Then** Amble resolves it against that clarification while retaining the original verified identities.
3. **Given** a reply resembles a selection but matches no candidate uniquely, **When** it is processed, **Then** Amble retains the pending selection and asks one deterministic clarification.
4. **Given** an ambiguous reply is followed by another ambiguous reply, **When** Amble responds, **Then** it continues to clarify without exposing an unrelated action family or mutating application state.

---

### User Story 3 - Change Topics Intentionally (Priority: P1)

As a voice user, I can abandon an offered selection by cancelling it or clearly requesting another supported action, while an unclear answer does not silently discard my context.

**Why this priority**: Pending state must not trap the user, but it also must not disappear merely because recognition was imperfect.

**Independent Test**: Verify explicit cancellation consumes the offer, a clearly recognized restaurant request supersedes it and routes normally, and an ambiguous answer retains it.

**Acceptance Scenarios**:

1. **Given** a selection is pending, **When** the user says “never mind” or another bounded rejection, **Then** Amble consumes the pending selection and performs no action.
2. **Given** an event selection is pending, **When** the user clearly requests a supported restaurant search, **Then** Amble supersedes the event selection and processes the restaurant request through ordinary routing.
3. **Given** a selection is pending, **When** the reply is not a uniquely recognized selection, rejection, or new supported action, **Then** Amble retains the pending state and asks for clarification.
4. **Given** the authoritative candidate context changes, **When** a later answer refers to the stale offer, **Then** Amble performs no mutation and asks the user to choose from current context.

---

### User Story 4 - Recover From an Invalid Proposed Action (Priority: P1)

As a voice user, an invalid or unrelated tool proposal does not end my otherwise healthy voice session; Amble explains what it needs and continues listening.

**Why this priority**: Ordinary language ambiguity must not surface as “Voice service is currently unavailable.”

**Independent Test**: While a selection is pending, submit unknown, unavailable, and schema-invalid proposals and verify deterministic clarification, zero mutation, and a usable subsequent turn.

**Acceptance Scenarios**:

1. **Given** a current pending selection, **When** an unknown or unrelated capability is proposed for an answer-like reply, **Then** Amble rejects it, retains the pending state, and emits one deterministic clarification.
2. **Given** a proposed capability has malformed or incomplete arguments, **When** validation fails without a transport failure, **Then** Amble performs no mutation and keeps the voice session active.
3. **Given** a recoverable invalid proposal was handled, **When** the user answers the clarification correctly, **Then** the intended stored candidate can still be selected.
4. **Given** a genuine provider, connection, or protocol-integrity failure occurs, **When** it cannot be recovered as a dialogue error, **Then** the existing terminal unavailable lifecycle remains unchanged.

### Edge Cases

- Candidate titles differ only by punctuation, capitalization, spacing, or common filler words.
- A fragment uniquely matches one full candidate list but not the narrowed clarification subset.
- A spoken ordinal is outside the available candidate range.
- A reply contains both a candidate fragment and a clearly recognized unrelated action.
- A title fragment is empty after normalization or contains only non-distinctive action words.
- The pending context revision changes between interpretation and execution.
- A clarification response is duplicated, interrupted, or arrives after cancellation.
- A validation error occurs with no pending dialogue available to clarify.
- A genuine relay payload or provider error occurs at the same time as an ambiguous reply.

## Scope and Constraints _(mandatory)_

- **In scope**: Pending event-result selections; deterministic ordinal, exact-title, and unique normalized title-fragment resolution; deterministic ambiguity prompts; explicit cancellation and clear topic replacement; stable-ID execution; recoverable invalid capability and argument handling; multi-turn regression coverage.
- **Out of scope**: General edit-distance or phonetic fuzzy matching; automatic resolution of “that one”; transport migration; WebRTC adoption; Agents SDK migration; model changes; replacement of the complete action classifier; exact transcript or exact spoken-word enforcement; audio-pipeline redesign; implementation of later roadmap phases.
- **Evidence and dependencies**: The feature extends the approved conversational voice behavior in `specs/004-conversational-voice-map/` and uses only current authoritative candidate identities, labels, eligibility, capability contracts, and context revisions. It creates no new paid service or runtime research path.
- **Privacy and lifecycle**: Pending selections remain session-scoped and contain bounded verified identities and labels but no raw audio. Production diagnostics remain content-free and use existing allowlisted outcome codes. Existing explicitly enabled local diagnostic boundaries remain unchanged.
- **Experience**: Clarifications must be concise, contain no more than one question, present only the candidates needed to resolve the ambiguity, and leave the user able to answer on the next turn. Ordinary direct controls remain available.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST evaluate an active pending dialogue before general request classification or interface-overlay routing.
- **FR-002**: The system MUST deterministically resolve valid in-range ordinals to the corresponding stored candidate identity.
- **FR-003**: The system MUST deterministically resolve an exact normalized candidate title when it identifies exactly one pending candidate.
- **FR-004**: The system MUST deterministically resolve a normalized title word or contiguous phrase only when it identifies exactly one candidate in the applicable pending choice set.
- **FR-005**: General edit-distance, phonetic, or similarity-score matching MUST NOT select a candidate in this phase.
- **FR-006**: The expression “that one” and equivalent unbound pronouns MUST produce clarification and zero capability proposals even when a single candidate appears focused.
- **FR-007**: When a title fragment matches multiple candidates, the clarification MUST present only those matching candidates while the complete pending selection remains available until resolution, rejection, supersession, or context invalidation.
- **FR-008**: An answer-like reply that cannot be resolved uniquely MUST retain the pending dialogue, produce one deterministic clarification, and perform zero application mutation.
- **FR-009**: A bounded rejection MUST consume the pending dialogue and perform zero application mutation.
- **FR-010**: A clearly recognized new supported application action MUST supersede the pending dialogue and continue through its ordinary routing path.
- **FR-011**: A reply that is neither a recognized selection, rejection, nor clear new supported action MUST NOT clear the pending dialogue or fall through to an unrelated capability family.
- **FR-012**: Candidate execution MUST use the stored stable identity and owning capability from the pending dialogue and MUST pass ordinary eligibility, validation, confirmation, execution, and refreshed-context rules.
- **FR-013**: Pending dialogues MUST remain single-use and revision-bound; resolved, rejected, duplicated, interrupted, stale, or delayed replies MUST NOT execute an action more than once.
- **FR-014**: Unknown, unavailable, unrelated, or argument-invalid capability proposals caused by an answer-like reply MUST be treated as recoverable dialogue errors when session and transport integrity remain valid.
- **FR-015**: A recoverable dialogue error with pending state MUST emit one deterministic clarification, preserve the usable voice session, and perform zero application mutation.
- **FR-016**: Recoverable dialogue errors MUST NOT enter the terminal voice-unavailable lifecycle, close the connection, disable later voice admission, or clear otherwise current pending state.
- **FR-017**: Genuine provider, connection, payload-integrity, budget, kill-switch, or unrecoverable protocol failures MUST continue to use the existing terminal lifecycle.
- **FR-018**: Clarification responses MUST contain at most one question and use only verified labels from the applicable pending candidate set.
- **FR-019**: The affected pending-dialogue and capability-result contracts MUST remain versioned, typed, validated, and shared with the ordinary capability gateway.
- **FR-020**: The feature MUST preserve existing privacy-safe production logging and MUST NOT add transcripts, labels, stable target identities, arguments, precise location, provider payloads, credentials, or raw audio to production operational records.
- **FR-021**: Automated regression coverage MUST include exact title, unique fragment, ordinal, unbound pronoun, multiple matches, no match, clarification follow-up, rejection, clear topic change, stale revision, duplicate reply, unknown tool, and invalid-argument scenarios.
- **FR-022**: All existing direct controls and unaffected event, restaurant, navigation, map, plan, and voice behaviors MUST remain semantically unchanged.

### Key Entities

- **Pending Dialogue**: A session-only, revision-bound, single-use offer containing its owning capability, verified candidate stable identities and labels, current applicable choice set, expected reply classes, and lifecycle status.
- **Pending Candidate**: One verified result with a stable identity, display label, original ordinal, and normalized matching representation.
- **Applicable Choice Set**: The candidates currently presented for resolution; it may be a narrowed ambiguous-match subset without discarding the complete pending dialogue.
- **Resolution Outcome**: A closed result of resolved, clarified, rejected, superseded, stale, or unrecognized, containing no authority to bypass ordinary capability validation.
- **Recoverable Dialogue Error**: An invalid proposal or argument failure that leaves session and transport integrity intact and can be answered with deterministic clarification rather than terminal cleanup.
- **Capability Contract**: The existing versioned command or query identity, eligibility rules, validated arguments and result, confirmation class, and ordinary business executor used by conversational and direct entry points.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of representative in-range ordinal, exact normalized title, and unique normalized title-fragment fixtures resolve only the intended stored candidate identity.
- **SC-002**: 100% of unbound-pronoun, multiple-match, no-match, and out-of-range fixtures produce zero mutation and one bounded clarification.
- **SC-003**: 100% of ambiguous title-fragment clarifications present only the matching candidates, and a valid next-turn answer completes the original selection without losing its stable identity.
- **SC-004**: 100% of ambiguous and answer-like unrecognized replies retain current pending state until it is resolved, rejected, superseded, or invalidated by authoritative context.
- **SC-005**: 100% of bounded rejection and clearly recognized topic-change fixtures respectively consume or supersede pending state with no unintended execution of the earlier offer.
- **SC-006**: 100% of unknown-tool, unavailable-tool, unrelated-tool, and invalid-argument dialogue fixtures perform zero unintended mutation, keep an otherwise healthy session usable, and allow the next valid turn to complete.
- **SC-007**: Zero recoverable dialogue-error fixtures emit the terminal voice-unavailable message, terminate the connection, or disable admission for the following session.
- **SC-008**: 100% of stale, duplicated, delayed, and interrupted reply fixtures execute the stored action at most once.
- **SC-009**: 100% of new and existing pending-dialogue diagnostics pass the production privacy allowlist and contain no conversational content or target data.
- **SC-010**: All relevant existing voice, event, restaurant, navigation, plan, capability, production-policy, type-check, and build validations pass without changing the approved model, transport, or audio contract.

## Assumptions

- Candidate lists remain bounded by the existing conversational result limits.
- Existing stored stable identities, labels, owning capability, and authoritative context revision are sufficient to execute a resolved selection.
- Normalization may remove case, spacing, and punctuation differences, but common action words alone are not distinctive candidate evidence.
- “Clearly recognized new action” means an action accepted by the existing deterministic supported-action vocabulary, not an arbitrary model guess.
- Genuine transport and provider failures remain distinguishable from schema or eligibility errors at the application boundary.
