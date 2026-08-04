# Pending Dialogue Resolution Contract

## Inputs

The interpreter receives:

- one active, revision-bound pending dialogue;
- the current finalized utterance;
- the current authoritative context revision.

The interpreter has no network, provider, application-execution, or persistence authority.

## Closed outcomes

| Outcome | Required fields | Relay behavior |
| --- | --- | --- |
| `resolved` | exact stored candidate | Atomically consume, then propose through the ordinary capability gateway |
| `clarified` | reason, optional original candidate indexes | Preserve pending state and speak one fixed verified-label question |
| `rejected` | none | Consume and confirm no change |
| `stale` | none | Invalidate and request a fresh choice |
| `unrecognized` | `answerLike` boolean | Clarify if answer-like; otherwise test only explicit supported-action supersession |

## Resolution precedence

1. Validate current active status and context revision.
2. Recognize bounded rejection.
3. Recognize selection plus unresolved condition.
4. Recognize bare affirmative behavior.
5. Resolve ordinals against the applicable choice set.
6. Force unbound pronouns to clarification.
7. Match exact normalized titles and unique normalized candidate token spans.
8. Return narrowed matching indexes when several candidates match.
9. Return unrecognized with answer-like evidence for every other selection-shaped reply.

## Topic supersession

An unrecognized pending reply can supersede the dialogue only when the existing deterministic
action vocabulary identifies one supported action family without active-overlay inference. A
provider guess or overlay-only family is insufficient.

## Recoverable tool error

If current pending state exists and transport/session integrity is intact, an unknown,
unavailable, unrelated, malformed-argument, or schema-invalid provider proposal produces:

- zero capability proposals;
- zero application mutation;
- discarded unsafe provider output;
- preserved pending state;
- one deterministic clarification response;
- continued voice-session admission.

Malformed call identity, duplicate call conflict, accounting failure, provider error, oversized
payload, and connection failure remain terminal.

## Privacy

Operational records may emit only the existing closed pending-dialogue outcome code and ordinary
content-free trace metadata. They must not contain utterances, candidate labels or identities,
arguments, provider payloads, exact location, credentials, authorization material, or raw audio.

