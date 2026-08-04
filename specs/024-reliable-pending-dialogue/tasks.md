# Tasks: Reliable Pending Voice Selections

**Input**: Design documents from `specs/024-reliable-pending-dialogue/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Branch**: Execute feature tasks on `develop`; do not create or switch branches unless the user explicitly requests it.

**Tests**: Tests are required and must be written before the corresponding implementation. This feature changes the approved Realtime path, so existing model-policy, output-token, budget, privacy, lifecycle, and recovery fixtures must remain passing.

## Phase 1: Setup and Baseline

**Purpose**: Confirm the current pending-dialogue behavior and feature boundary before edits.

- [X] T001 Run the focused baseline `node --test tests/realtime-relay.test.mjs` and record the pre-change result in `specs/024-reliable-pending-dialogue/quickstart.md`
- [X] T002 Verify the current interpreter, relay, and tests use the existing shared capability gateway and identify no required schema migration outside `scripts/lib/pending-dialogue.mjs`, `cloudflare/realtime-relay.mjs`, and `tests/realtime-relay.test.mjs`

---

## Phase 2: Foundational Pending-Dialogue Contract

**Purpose**: Establish the closed state and matching helpers used by every story.

**⚠️ CRITICAL**: Complete before user-story implementation.

- [X] T003 Add failing contract fixtures for expected reply classes, immutable applicable-choice indexes, verified labels, stable identities, and privacy-safe values in `tests/realtime-relay.test.mjs`
- [X] T004 Implement the bounded applicable-choice representation and closed resolution outcome fields in `scripts/lib/pending-dialogue.mjs`

**Checkpoint**: Pending state can represent a narrowed clarification without discarding original candidates.

---

## Phase 3: User Story 1 - Select an Offered Result Naturally (Priority: P1) 🎯 MVP

**Goal**: Resolve ordinals, exact titles, and unique normalized title fragments using stored identities while always clarifying unbound pronouns.

**Independent Test**: Exact-title, unique-fragment, ordinal, and “that one” fixtures reach only the specified resolution outcome.

### Tests for User Story 1

- [X] T005 [US1] Add failing exact-title-with-action-words, unique-word, unique-phrase, punctuation/case, ordinal, out-of-range, duplicate-reply, and always-clarify-pronoun fixtures in `tests/realtime-relay.test.mjs`

### Implementation for User Story 1

- [X] T006 [US1] Implement bounded action-filler removal, exact normalized title matching, unique candidate token-span matching, valid ordinal resolution, and pronoun clarification without edit distance in `scripts/lib/pending-dialogue.mjs`
- [X] T007 [US1] Run `node --test tests/realtime-relay.test.mjs` and mark User Story 1 complete only when its fixtures and existing single-use behavior pass

**Checkpoint**: Natural offered-result references resolve without model routing or invented IDs.

---

## Phase 4: User Story 2 - Clarify Without Losing the Offer (Priority: P1)

**Goal**: Preserve pending state across ambiguity and narrow the spoken choice list to matching candidates.

**Independent Test**: A shared fragment produces a two-candidate prompt, then a numbered next turn resolves the correct original stable identity.

### Tests for User Story 2

- [X] T008 [US2] Add failing multiple-match, no-match answer-like, narrowed-ordinal follow-up, repeated ambiguity, and full-state retention fixtures in `tests/realtime-relay.test.mjs`

### Implementation for User Story 2

- [X] T009 [US2] Return matching original candidate indexes and retain answer-like unresolved outcomes in `scripts/lib/pending-dialogue.mjs`
- [X] T010 [US2] Preserve pending dialogue, apply narrowed applicable choices, and generate verified-label deterministic clarification speech in `cloudflare/realtime-relay.mjs`
- [X] T011 [US2] Run `node --test tests/realtime-relay.test.mjs` and mark User Story 2 complete only when the next-turn narrowed selection executes the stored identity once

**Checkpoint**: Ambiguity remains a recoverable multi-turn dialogue rather than falling into general routing.

---

## Phase 5: User Story 3 - Change Topics Intentionally (Priority: P1)

**Goal**: Consume explicit rejection, supersede only for a clearly recognized supported action, and retain all other unresolved replies.

**Independent Test**: “Never mind” rejects, “show restaurants” and “zoom in” supersede, and an unclear selection phrase retains pending state without overlay routing.

### Tests for User Story 3

- [X] T012 [US3] Add failing cancellation, explicit restaurant action, explicit map action, ambiguous reply, overlay-only fallback, and stale-context fixtures in `tests/realtime-relay.test.mjs`

### Implementation for User Story 3

- [X] T013 [US3] Add a non-overlay deterministic supported-action supersession check and keep unresolved replies inside pending routing in `cloudflare/realtime-relay.mjs`
- [X] T014 [US3] Run `node --test tests/realtime-relay.test.mjs tests/assistant-capability-turn-scope.test.mjs` and mark User Story 3 complete only when ordinary explicit actions still route through their existing capability family

**Checkpoint**: Pending state neither traps the user nor disappears because of ambiguous language or UI overlay context.

---

## Phase 6: User Story 4 - Recover From an Invalid Proposed Action (Priority: P1)

**Goal**: Convert application-level provider tool mistakes into deterministic clarification when current pending state permits safe recovery.

**Independent Test**: Unknown, unrelated, malformed-argument, and schema-invalid proposals produce no mutation, one clarification, and a usable next turn; integrity failures remain terminal.

### Tests for User Story 4

- [X] T015 [US4] Add failing recoverable unknown-tool, unrelated-tool, malformed-argument, invalid-schema, next-valid-turn, and terminal-integrity-boundary fixtures in `tests/realtime-relay.test.mjs`

### Implementation for User Story 4

- [X] T016 [US4] Add bounded pending-dialogue tool-error recovery that discards unsafe output, preserves state, requests one fixed clarification, and bypasses terminal cleanup only for application-level errors in `cloudflare/realtime-relay.mjs`
- [X] T017 [US4] Run `node --test tests/realtime-relay.test.mjs` and mark User Story 4 complete only when recoverable errors preserve admission and genuine protocol failures still terminate

**Checkpoint**: An ordinary tool-selection or argument mistake no longer surfaces as voice-service unavailability when deterministic pending recovery is available.

---

## Phase 7: Polish and Cross-Cutting Validation

**Purpose**: Prove privacy, capability parity, lifecycle safety, unchanged provider policy, and Phase 1 scope.

- [X] T018 Add or update privacy assertions proving pending-dialogue operational records contain no utterance, label, target identity, arguments, provider payload, precise location, credentials, or raw audio in `tests/realtime-relay.test.mjs`
- [X] T019 Run `npm run test:voice` and resolve every failure without expanding beyond `specs/024-reliable-pending-dialogue/spec.md`
- [X] T020 Run `npm run test:unit` to verify affected capability, connector, policy, budget, output-token, logging, and direct/conversational parity behavior
- [X] T021 Run `npm run lint` and resolve every lint error in the feature scope
- [X] T022 Run `npm run build:ci` and verify the production build succeeds with the existing Realtime models, WebSocket transport, and audio contract
- [X] T023 Verify the final diff contains no Agents SDK, WebRTC, model, transcription, VAD, exact-word enforcement, new dependency, production diagnostic-content, or later-roadmap implementation and record the completed validation commands in `specs/024-reliable-pending-dialogue/quickstart.md`
- [X] T024 [CONVERGENCE] Add and pass a one-candidate clarification fixture so every bounded applicable set produces grammatical speech with one question
- [X] T025 [CONVERGENCE] Preserve terminal handling for reused or overlapping provider call identities even when a current pending dialogue could otherwise recover an application-level tool mistake

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 has no dependency.
- Phase 2 depends on Phase 1 and blocks all user stories.
- User Stories 1–4 modify shared interpreter/relay files and therefore execute sequentially in story order.
- Phase 7 depends on all four user stories.

### User-story dependencies

- **US1** depends on the foundational applicable-choice representation.
- **US2** depends on US1 matching outcomes and adds retained/narrowed clarification.
- **US3** depends on US2 distinguishing unresolved pending replies from explicit new actions.
- **US4** depends on the deterministic clarification path established by US2 and the supersession boundary established by US3.

### Parallel opportunities

The implementation touches two shared runtime files and one shared test file, so correctness requires sequential edits. Documentation validation and final diff inspection can be evaluated alongside long-running test commands only after all implementation tasks are complete.

## Implementation Strategy

### MVP first

1. Establish the applicable-choice contract.
2. Implement and validate US1 matching without relay migration.
3. Stop and verify the pure interpreter behavior before adding retained clarification.

### Incremental delivery

1. US1: natural deterministic selections.
2. US2: retained and narrowed ambiguity.
3. US3: explicit cancellation/topic supersession.
4. US4: invalid-proposal recovery.
5. Full voice, unit, lint, build, privacy, and scope validation.

## Notes

- Tests precede each implementation task.
- Mark each task `[X]` only after its described evidence exists.
- No commit or push is included; those require a separate user request.
- Convergence runs after implementation and may append further traceable tasks.

## Phase 8: Convergence

- [X] T026 Normalize internal candidate-title punctuation and add collision-safe exact/fragment fixtures per FR-003 and FR-004 (partial)
- [X] T027 Implement and validate the versioned closed `unrecognized` resolution outcome, including `answerLike`, and route it without the legacy `unrelated` shape per FR-019 and `contracts/pending-dialogue-resolution.md` (partial)
- [X] T028 Add an unavailable-current-tool pending recovery fixture that proves zero mutation and a usable next turn per SC-006 and plan: recoverable errors (partial)
