# Research: Reliable Pending Voice Selections

## Decision 1: Resolve application references outside the model

**Decision**: Resolve ordinals and candidate-title evidence deterministically against the verified
candidate list stored by Amble.

**Rationale**: The application already owns stable candidate identities and their display order.
Asking the Realtime model to recreate either introduces avoidable ambiguity and can expose an
unrelated tool family.

**Alternatives considered**:

- Let the model choose a candidate: rejected because the model does not own authoritative IDs.
- Add another classifier request: rejected because it increases cost and latency without adding
  authority.

## Decision 2: Use unique normalized token-span matching

**Decision**: Match exact normalized titles plus normalized title words or contiguous phrases that
identify exactly one candidate after bounded action/selection filler is removed.

**Rationale**: This accepts “Reflect” and “add Reflect on Time” while remaining explainable and
fully fixture-testable.

**Alternatives considered**:

- Edit-distance or phonetic matching: explicitly rejected for Phase 1 because thresholds can make
  the application select a surprising result.
- Exact full title only: rejected because ordinary voice replies include verbs and partial names.

## Decision 3: Preserve ambiguity as dialogue state

**Decision**: An answer-like but unresolved reply retains the pending dialogue. Multiple title
matches produce a choice prompt containing only those matches; the authoritative original
candidates remain stored.

**Rationale**: The next user answer must still resolve the original verified identities. Clearing
the state is what caused the observed follow-up failure.

**Alternatives considered**:

- Clear on every non-match: rejected because it loses the conversation.
- Repeat all candidates for every collision: rejected because it makes clarification longer than
  necessary.

## Decision 4: Supersede only for explicit supported actions

**Decision**: Use the existing deterministic action vocabulary without active-overlay fallback to
decide whether a new request clearly replaces a pending offer.

**Rationale**: The overlay is interface context, not evidence that an ambiguous phrase belongs to
that action family. Explicit “show restaurants” and “zoom in” remain usable topic changes.

**Alternatives considered**:

- Ask before every topic change: rejected by the owner as unnecessary friction.
- Preserve pending state after completing the new action: rejected because it risks executing an
  obsolete offer later.

## Decision 5: Recover application-level call errors, not integrity failures

**Decision**: When a current pending dialogue provides a safe deterministic clarification, treat
unknown/unavailable/unrelated tools and invalid argument shapes as recoverable application errors.
Continue to terminate on corrupt identifiers, accounting conflicts, oversized messages, or broken
transport/provider state.

**Rationale**: A model choosing the wrong capability is a dialogue problem; accepting malformed
protocol identity or losing billing/session invariants is a trust-boundary failure.

**Alternatives considered**:

- Terminate every invalid call: rejected because it produces avoidable voice-service outages.
- Let the model retry automatically: rejected by the owner because it can repeat the same routing
  mistake.

## Decision 6: Keep the existing transport and model

**Decision**: Make no Agents SDK, WebRTC, model, transcription, VAD, or audio-contract changes.

**Rationale**: Those are later roadmap phases. The current failure can be corrected within the
application-owned state machine and error boundary.

**Alternatives considered**:

- Migrate transport now: rejected as a larger independent project.
- Upgrade the model now: rejected because architecture and deterministic state should be evaluated
  before spending more on model capability.
