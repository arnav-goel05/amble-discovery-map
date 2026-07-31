# Native Audio Routing Contract

## Purpose

Convert committed native audio into the same bounded deterministic routing path used by text turns
without exposing the full application capability inventory or adding a transcription service.

## Stage 0: Opening

- Tools: none.
- Tool choice: none.
- Output: the existing one-shot exact Amble greeting.

## Stage 1: Forced ingress

- Tools: exactly one provider-only function named `voice__submitutterance`.
- Tool choice: forced to that function.
- Closed arguments:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["utterance", "domain", "eventQuery"],
  "properties": {
    "utterance": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "domain": { "enum": ["event", "other", "ambiguous"] },
    "eventQuery": {
      "description": "Closed current-catalogue event facet proposal, or null"
    }
  }
}
```

The relay binds the current authoritative application context revision used by the capability
gateway. It must not substitute an older connector-local event-composer revision. The function is
transport ingress, not an application capability, direct control, registry entry, MCP projection,
or authoritative transcript.

For an event request, the same forced response proposes `what`, `when`, `where`, and `price`
labels selected from the bounded current event catalogue, exact evidence copied from the
utterance, meaningful unbound `residualQuery` terms, and any unresolved facets. This does not
create another provider response. The application treats the proposal as untrusted and accepts it
only when every label uniquely resolves in the same current facet and every evidence string occurs
in the utterance. Conflicts, invented labels, missing evidence, unresolved facets, and stale
revisions mutate nothing. Typed/direct queries omit the proposal and keep the deterministic parser.

## Stage 2: Deterministic routing

The relay submits the bounded utterance to the existing text-turn scope and deterministic
interpreter boundary.

- Deterministic event sentence: propose `event.applyquery` directly.
- Obvious map, transit, or protected local session command: use its existing deterministic route.
- Clarification or unsupported result: mutate nothing and proceed to a no-tool response.
- Non-deterministic but classified request: configure one connector-family menu.

`app.inspect`, broad `catalog.search`, and unrelated connector tools are absent while an event or
restaurant route is selected.

## Stage 3: Scoped domain menu

- Tools: currently eligible registry-derived tools from exactly one connector family.
- Maximum: 15.
- Optional read-only addition: `catalog.get` only when visible authoritative target identities are
  required for the routed request.
- Tool choice: auto.

The provider alias map, argument schema, eligibility, confirmation, execution, result validation,
and refreshed-context requirements remain unchanged.

## Stage 4: Final response

After a deterministic result or completed domain action:

- Tools: none.
- Tool choice: none.
- Output: grounded spoken acknowledgement or failure based only on the validated result.
- Delivery: fixed speech is buffered until its transcript matches the relay-owned expected text.
  Delimiters, preambles, omissions, and unrelated wording are never released. One bounded retry is
  allowed inside the existing per-turn stage guard.

## Failure and lifecycle

Missing, malformed, duplicate, stale, or overlapping ingress calls terminate through the existing
protocol failure path with zero application mutation. Configuration acknowledgement, reservation,
response watchdog, interruption, budget settlement, content sanitization, and terminal cleanup
apply independently to each provider response while remaining one user turn. A user may submit any
number of turns for any duration while the session remains explicitly active and budget admission
succeeds. One user turn permits at most three sequential provider response stages and at most one
unresolved stage; this internal loop guard is not a conversation-length cap.

Documented provider shape drift is normalized before semantic verification: matching root and
nested facets, matching `event*` aliases, singleton single-value facets, and null unused non-event
facets collapse to the canonical contract. Conflicts and unknown fields still fail closed. Provider
domain labels never override the deterministic application router.
