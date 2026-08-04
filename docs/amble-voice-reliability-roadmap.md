# Amble Voice Reliability Roadmap

## Purpose

This document records the complete set of potential improvements identified for
Amble's voice integration. It is a roadmap, not authorization to implement every
change at once.

The current implementation scope is **Phase 1 only**. Later phases remain documented
for future evaluation and should not be started implicitly.

## Design principle

Let the realtime model understand speech and conduct a natural conversation. Let
Amble's application code own dialogue state, verified identifiers, action validation,
execution, and recovery.

| Responsibility                                          | Owner                                       |
| ------------------------------------------------------- | ------------------------------------------- |
| Live audio, turn detection, and conversational delivery | Realtime voice session                      |
| Natural-language understanding and friendly phrasing    | Realtime model                              |
| Offered candidates and pending follow-ups               | Amble application state                     |
| Verified event, restaurant, and navigation identifiers  | Amble application state                     |
| Action validation and execution                         | Amble tool gateway                          |
| Success or failure facts                                | Authoritative tool result                   |
| Final spoken explanation                                | Realtime model, grounded in the tool result |

## Current failure pattern

The latest event-selection failure followed this sequence:

1. Amble offered several events and created a pending selection.
2. The user referred naturally to one event by title.
3. The pending resolver did not recognize the phrase and cleared the selection.
4. General routing used the active overlay as a fallback.
5. Navigation tools were exposed for what was actually an event request.
6. The model attempted an invalid navigation call.
7. A recoverable dialogue mistake became a protocol failure and the user heard that
   the voice service was unavailable.

The roadmap addresses each boundary separately instead of relying on a model upgrade
to solve the entire chain.

## Phase 1: Reliable pending selections and recovery

**Status: current implementation scope**

**Goal:** Fix the observed multi-turn event-selection failures without changing the
transport, replacing the model, or redesigning the complete classifier.

| Change                          | Required behavior                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pending dialogue takes priority | Process a reply against an active pending selection before general classification or overlay-based routing.                          |
| Flexible ordinal matching       | Recognize phrases such as `first`, `number two`, `second one`, and `last one`.                                                       |
| Flexible title matching         | Match normalized, unique title fragments and distinctive words against only the candidates that were offered.                        |
| Verified ID resolution          | Once a candidate is selected, use its stored internal ID instead of asking the model to reproduce an ID.                             |
| Preserve ambiguous state        | If a reply looks like an answer but cannot be resolved uniquely, retain the candidates and ask a focused clarification.              |
| Explicit cancellation           | Clear pending state for explicit cancellation, rejection, or a clearly unrelated new request—not for an ordinary ambiguous answer.   |
| Recoverable invalid calls       | Convert invalid tool names or arguments into a clarification or structured failure; do not close an otherwise healthy voice session. |
| Conversation-level tests        | Test complete sequences across multiple turns, including clarification and recovery.                                                 |

### Phase 1 matching outcomes

| User reply                       | Expected outcome                                                             |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `Add Reflect on Time`            | Match the uniquely offered title and add its stored event ID.                |
| `Add Reflect`                    | Match if exactly one offered title contains the distinctive fragment.        |
| `The second one`                 | Select candidate two.                                                        |
| `That one`                       | Use the most recently focused candidate when unambiguous; otherwise clarify. |
| `The interesting one`            | Ask which candidate the user means and retain the pending list.              |
| `Second one` after clarification | Resolve the original pending selection.                                      |
| `Never mind`                     | Cancel and clear the pending selection.                                      |
| `Show restaurants instead`       | Explicitly leave event selection and begin restaurant routing.               |
| Invalid tool arguments           | Return a recoverable result and keep the voice session usable.               |

### Phase 1 completion criteria

- Exact offered titles resolve correctly.
- Unique partial titles resolve correctly.
- Ordinal references resolve correctly.
- Ambiguous answers produce a clarification without losing state.
- A clarification answer completes the original action.
- Explicit topic changes leave pending mode intentionally.
- Invalid model tool arguments do not produce a voice-service outage.
- One misunderstanding cannot terminate an otherwise healthy session.
- Existing voice, restaurant, event, and navigation tests continue to pass.

### Explicitly out of scope for Phase 1

- Migrating to the OpenAI Agents SDK.
- Replacing the Cloudflare WebSocket relay with WebRTC.
- Changing the realtime or transcription model.
- Replacing the complete action classifier.
- Redesigning every tool schema.
- Adding exact transcript or exact spoken-response enforcement.
- Reworking the entire audio-processing pipeline.

## Phase 2: Context-aware tool routing

**Goal:** Make it structurally difficult for the model to select an unrelated action.

| Change                    | Intended result                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Dynamic tool exposure     | Expose only tools valid for the current dialogue state and request family.                                                     |
| Remove overlay authority  | Treat the active UI overlay as a weak hint, not an authoritative classifier.                                                   |
| Narrow model fallback     | Use deterministic routing for high-confidence commands and a constrained model fallback only for genuinely ambiguous language. |
| Clarify unknown families  | Ask a short question when no action family can be selected confidently.                                                        |
| Concise tool descriptions | State precisely when each tool applies and document its expected result and failure shape.                                     |

Recommended routing order:

1. Active pending dialogue.
2. Deterministic high-confidence action rules.
3. Narrow, context-specific model routing.
4. Clarification instead of guessing.

## Phase 3: Grounded action responses

**Goal:** Ensure Amble speaks once and only claims facts established by execution.

| Change                           | Intended result                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No pre-action success commentary | Do not say that an action is happening or succeeded before validation and execution finish.                    |
| Structured tool results          | Return separate fields for status, verified entities, recoverability, and user-facing facts.                   |
| One post-result response         | Generate a single spoken response after the authoritative tool result.                                         |
| Semantic response guardrails     | Reject false success claims, invented entities, and duplicate result messages without enforcing exact wording. |
| Dedicated clarification results  | Give recoverable errors a stable shape that leads to an appropriate follow-up question.                        |

Target action flow:

1. Resolve intent and references.
2. Validate a proposed action.
3. Execute using verified identifiers.
4. Receive an authoritative structured result.
5. Generate one grounded response.
6. Return to listening.

## Phase 4: Session lifecycle and audio robustness

**Goal:** Reduce custom protocol failure modes and improve real-world audio behavior.

| Change                        | Intended result                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Evaluate `RealtimeSession`    | Move connection lifecycle, interruptions, history, tools, and guardrails toward maintained SDK primitives.  |
| Evaluate Cloudflare transport | Retain the trusted Worker boundary while reducing hand-maintained Realtime protocol code.                   |
| Evaluate browser WebRTC       | Use the recommended browser transport if product and security requirements permit it.                       |
| Correct WebSocket truncation  | Stop playback and remove unheard audio from conversation state after interruption.                          |
| Standardize audio input       | Use one documented sample-rate, channel, codec, gain, echo-cancellation, and noise-reduction contract.      |
| Real-environment VAD tuning   | Test different microphones, speaker leakage, pauses, and noisy environments.                                |
| Session recovery policy       | Distinguish recoverable turn errors, reconnectable transport failures, and terminal configuration failures. |

## Phase 5: Observability and evaluation

**Goal:** Make every routing or protocol failure explainable and reproducible.

| Change                    | Intended result                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Structured turn tracing   | Record transcript, prior state, exposed tools, route, call ID, arguments, result, response count, and close reason.                 |
| Privacy-aware logging     | Avoid retaining raw audio or sensitive content unless explicitly required and protected.                                            |
| Conversation replay suite | Replay multi-turn fixtures instead of testing only isolated phrases.                                                                |
| Noisy transcript variants | Test misspellings, substitutions, partial titles, hesitations, and filler words.                                                    |
| Production metrics        | Track unresolved selections, wrong-family calls, invalid arguments, duplicate speech, reconnects, and service-unavailable messages. |
| Model comparison          | Compare models only after routing and state are stable, using the same representative evaluation set.                               |

## Phase 6: Model and architecture evaluation

**Goal:** Decide whether model or pipeline changes provide measurable improvements
after application-level reliability is established.

| Option                                 | When to consider it                                                          | Trade-off                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Keep `gpt-realtime-2.1-mini`           | Routing and recovery tests meet targets                                      | Lowest cost and fast responses.                                                |
| Evaluate full `gpt-realtime-2.1`       | Remaining failures require stronger language or tool reasoning               | Higher capability with additional cost or latency.                             |
| Hybrid realtime architecture           | Natural conversation is important but actions must remain deterministic      | Good balance for Amble's interaction model.                                    |
| Fully chained STT, text agent, and TTS | Workflow predictability remains more important than speech-to-speech latency | Maximum application control with more components and potentially more latency. |

Model changes must be judged with recorded evaluation cases. They should not be used
as a substitute for deterministic state, verified IDs, narrow tool exposure, or
recoverable errors.

## Overall sequence

| Order | Phase                                    | Decision gate                                                                 |
| ----: | ---------------------------------------- | ----------------------------------------------------------------------------- |
|     1 | Reliable pending selections and recovery | Latest event-selection failures pass conversation-level tests.                |
|     2 | Context-aware tool routing               | Wrong-family tool calls are prevented by construction.                        |
|     3 | Grounded action responses                | Actions produce one accurate post-result response.                            |
|     4 | Session and audio robustness             | Transport and interruption behavior pass browser and noisy-environment tests. |
|     5 | Observability and evaluation             | Failures can be reconstructed and replayed consistently.                      |
|     6 | Model and architecture evaluation        | A measured comparison justifies any model or pipeline migration.              |

## Reference material

- [OpenAI voice-agent architecture guide](https://developers.openai.com/api/docs/guides/voice-agents)
- [OpenAI Realtime conversation lifecycle and function calling](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [OpenAI Agents SDK voice guide](https://openai.github.io/openai-agents-js/guides/voice-agents/)
- [OpenAI Agents SDK tools and error handling](https://openai.github.io/openai-agents-js/guides/tools/)
- [OpenAI Agents SDK guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)
- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-js/guides/tracing/)
- [Perplexity Realtime production case study](https://developers.openai.com/blog/realtime-perplexity-computer)
