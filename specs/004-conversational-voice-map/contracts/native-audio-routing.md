# Native Audio Routing Contract

## Purpose

Convert committed native audio into the same bounded deterministic routing path used by text turns
without exposing the full application capability inventory or trusting model-generated tool
arguments to reproduce the utterance.

## Stage 0: Opening

- Tools: none.
- Tool choice: none.
- Output: the existing one-shot exact Amble greeting.

## Stage 1: Concurrent transcription and forced classification

- Input transcription: enabled once for the committed provider audio item.
- Tools: exactly one provider-only classification function.
- Tool choice: forced to that function.
- Closed arguments:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["domain", "eventQuery"],
  "properties": {
    "domain": { "enum": ["event", "other", "ambiguous"] },
    "eventQuery": {
      "description": "Closed current-catalogue event facet proposal, or null"
    }
  }
}
```

The classification schema rejects an `utterance` member. The relay binds the current authoritative application context revision used by the capability
gateway. It must not substitute an older connector-local event-composer revision. The function is
transport classification, not an application capability, direct control, registry entry, MCP
projection, or transcript source.

The final input transcript is accepted only when its provider `item_id` matches the active
committed audio item. Classification and transcription may complete in either order. Neither may
route or mutate alone; their single-use join supplies the transcript as utterance and the function
result as non-authoritative classification.

For an event request, the same forced response proposes `what`, `when`, `where`, and `price`
labels selected from the bounded current event catalogue, exact evidence grounded in the heard
request, meaningful unbound `residualQuery` terms, and any unresolved facets. This does not
create another provider response. The application treats the proposal as untrusted and accepts it
only when every label uniquely resolves in the same current facet and every evidence string occurs
in the utterance. Conflicts, invented labels, missing evidence, unresolved facets, and stale
revisions mutate nothing. Typed/direct queries omit the proposal and keep the deterministic parser.

## Stage 2: Deterministic routing

The relay submits the bounded final transcript to the existing text-turn scope and deterministic
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

Missing, malformed, duplicate, stale, or overlapping classification calls, or a missing, empty,
failed, timed-out, duplicate, or stale active transcript, terminate through the existing protocol
failure path with zero application mutation. Configuration acknowledgement, reservation,
response watchdog, interruption, budget settlement, content sanitization, and terminal cleanup
apply independently to each provider response while remaining one user turn. A user may submit any
number of turns for any duration while the session remains explicitly active and budget admission
succeeds. One user turn permits at most three sequential provider response stages and at most one
unresolved stage; this internal loop guard is not a conversation-length cap.

Documented classification shape drift is normalized before semantic verification: matching root and
nested facets, matching `event*` aliases, singleton single-value facets, and null unused non-event
facets collapse to the canonical contract. Conflicts and unknown fields still fail closed. Provider
domain labels never override the deterministic application router.
