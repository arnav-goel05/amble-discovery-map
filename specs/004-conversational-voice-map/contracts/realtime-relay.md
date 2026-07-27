# Realtime Relay Contract

**Target protocol version**: `1.1`

Version 1.1 generalizes the existing action bridge into the shared capability bridge. Voice
sessions require an exact protocol match; version 1.0 sessions are not resumed across the atomic
client/Worker deployment.

## Trust boundary

The browser connects only to the application's same-origin relay. The relay alone connects to
OpenAI and owns the standard API key, pinned model, instructions, tools, response creation, rate
card, reservations, and kill switches. Browser messages are untrusted.

The server-owned instructions define the model as Amble's application-scoped guide, not a
general-purpose assistant. They reject unrelated general-chat and open-web requests, prohibit
claims beyond approved application data, and require confirmed tool results before claiming an
application state change succeeded. Capability descriptions are generated from the same currently
eligible typed query and command tools sent in each provider `session.update`; unavailable
capabilities are not advertised.
An opening greeting uses the checked-in Amble welcome message, which introduces Singapore discovery,
area/place recommendations, application search, map control, location, and MRT context instead of
inviting general-purpose conversation.

## Session admission

`POST /api/voice/sessions`

Request:

```json
{
  "protocolVersion": "1.1",
  "disclosureAccepted": true,
  "capabilities": {
    "audioInput": true,
    "audioOutput": true,
    "text": true
  }
}
```

Successful response (`201`):

```json
{
  "ok": true,
  "data": {
    "sessionId": "opaque",
    "protocolVersion": "1.1",
    "streamPath": "/api/voice/sessions/opaque/stream",
    "expiresAt": "2026-07-18T12:05:00.000Z",
    "limits": {
      "maxSessionSeconds": 300,
      "idleSeconds": 60,
      "maxResponses": 6
    }
  }
}
```

The endpoint validates same origin, content type, body size, runtime/environment kill switches,
provider policy, rate-card identity, available reservation capacity, and anonymous admission rate.
It never returns provider credentials, provider call IDs, remaining dollar balance, or internal
usage payloads.

Failure codes: `voice_disabled`, `usage_limit`, `provider_unavailable`, `invalid_request`,
`origin_rejected`, `rate_limited`, `policy_mismatch`.

For `voice_disabled`, `usage_limit`, `provider_unavailable`, `rate_limited`, or
`policy_mismatch`, the browser presents exactly “Voice service is currently unavailable. Please
try again later.” and completes terminal cleanup. It does not submit captured speech or transcript
text to a local/offline voice interpreter. Retrying requires a new explicit activation.

## Stream

`GET /api/voice/sessions/{sessionId}/stream` upgrades to WebSocket after same-origin and session
validation. A session may bind one browser stream and one provider stream. Messages larger than the
declared bounds close the connection.

### Browser to relay

- `turn.request`: requests a bounded input+response reservation before microphone chunks are
  accepted. Relay replies `turn.ready` or `usage_limit`.
- `audio.append`: bounded audio chunk accepted only for the active reserved turn.
- `audio.commit`: ends the audio turn; relay commits transcription, then waits for the final
  transcript before selecting the turn's connector families and creating the response.
- `text.submit`: bounded plain text input for the same action/discovery path; relay reserves the
  response before forwarding.
- `capability.result`: validated query result or observable command outcome for a matching
  relay-proposed capability call. Query payloads obey their bounded projection; command payloads
  include the resulting context revision. It contains no arbitrary provider event type.
- `confirmation.pending`: browser-gateway-owned confirmation identity, fingerprint, target, exact
  effect, and expiry for the current consequential call. The relay validates and echoes this as
  `confirmation.required`; it never invents or approves the confirmation.
- `confirmation.result`: deterministic accept/reject result for the current confirmation fingerprint.
- `deterministic.result`: validated result of an obvious command selected and executed by the
  browser application interpreter. The relay waits for this result before asking the model to
  phrase an acknowledgement.
- `session.stop`: explicit terminal cleanup.

### Relay to browser

- `session.state`: one of the states in `ConversationSession`.
- `turn.ready`: reservation accepted; audio may begin.
- `transcript.delta`, `transcript.final`: bounded text keyed by item ID.
- `assistant.audio.delta`, `assistant.audio.done`: bounded audio output.
- `assistant.text.delta`, `assistant.text.done`: bounded assistant transcript output while the
  online session is active; not an offline fallback after termination.
- `capability.proposed`: allowlisted capability ID, kind, canonical arguments, context revision,
  and call identity.
- `confirmation.required`: immutable fingerprint, target, exact effect, and expiry.
- `capability.completed`: sanitized validated result.
- `error`: public code and safe message.
- `session.stopped`: terminal reason (`user`, `pagehide`, `idle`, `duration`, `permission`, `disabled`,
  `usage_limit`, `provider`, `network`, `protocol`).

## Billable-event rules

1. Provider automatic response creation is disabled.
2. The relay atomically reserves the maximum configured input-transcription cost before accepting a
   billable audio turn.
3. The relay atomically reserves the maximum response cost before emitting provider
   `response.create`.
4. Only trusted provider completion usage settles reservations.
5. Missing, oversized, unknown-model, unknown-rate, or malformed usage holds the full reservation
   and disables further work until owner reconciliation.
6. `spent + reserved` can never exceed `10_000_000` micro-USD.
7. Client messages cannot change model, rates, instructions, token limits, tools, VAD response
   creation, or provider event types.
8. Before authoritative interface context arrives, the provider receives only `app.inspect`,
   `catalog.search`, and `catalog.get`; target-changing commands remain unavailable.
9. Before every response, the relay intersects current eligible capability IDs with connector
   families inferred from the bounded request and current interface state. It does not send the
   complete eligible registry.
10. An obvious command recognized by the deterministic application interpreter is excluded from
    provider tools for that turn and executes through the shared browser capability gateway. The
    relay does not create the model response until `deterministic.result` validates; the model may
    then acknowledge or phrase the verified outcome but is not the action-selection authority.
11. The provider model is exactly `gpt-realtime-2.1-mini`; no fallback model is configured or
    attempted.
12. Each later context revision replaces the tool list and capability description with the
    foundational queries plus command IDs eligible in that revision.
13. Query results contain at most the contract limit, use stable approved identities, and exclude
    raw HTML, arbitrary source payloads, unapproved URLs, and exact user location.

## Capability-call ordering

The relay permits at most one unresolved capability call. A state-changing command remains
unresolved until the browser returns a schema-valid outcome with a context revision greater than or
equal to the proposal revision. The relay updates the provider's eligible tool set and authoritative
context before allowing a dependent call or prompting the provider to continue the response.

Queries may return without changing the revision, but their `catalogRevision` or `stateDigest` and
result bounds
must validate. A query or command result that violates its registered schema terminates the session
as a protocol failure rather than becoming model context.

For a command whose validated result has `changed: true`, `contextRevision` MUST be greater than the
proposal revision. Equality is allowed only for `changed: false`, `empty`, `unavailable`, or
`failed`. Query results use the current revision and validate their `catalogRevision` or
`stateDigest` instead.

## Consequential capability state machine

1. `capability.proposed` binds `callId`, capability ID, canonical arguments, target IDs, and proposal
   context revision.
2. The browser gateway creates one `confirmationId` and fingerprint over those values, marks the
   original call `awaiting_confirmation`, and sends `confirmation.pending`. The relay validates the
   still-pending consequential call and echoes `confirmation.required`. The call remains unresolved.
3. `confirmation.result` MUST carry the same `callId`, `confirmationId`, fingerprint, final-user-
   input status, and accept/reject decision.
4. Reject, expiry, interruption, context change, or mismatched identity terminally resolves the call
   with no domain execution. Duplicate events return the stored terminal result and have no effect.
5. Acceptance moves the same record atomically to `accepted`; the browser gateway, not the model,
   immediately revalidates eligibility and executes the original canonical call once.
6. The resulting `capability.result` carries the same `callId`. Its validated result and refreshed
   context move `accepted → executed`.
7. A replayed acceptance, result, or function call for a terminal `callId` is idempotently answered
   from the in-memory terminal record; conflicting replay data is a protocol violation.

The relay never prompts the model to reissue a consequential function call after confirmation.
Terminal call records exist only for the session lifetime and contain no persisted conversation or
location data.

## Cleanup

Explicit stop, socket close, `pagehide`, idle/duration expiry, permission revoke, cap/kill switch,
provider error, or protocol violation cancels output, closes both sockets, stops browser media,
invalidates confirmations, aborts work, and clears all application-held session content. D1 retains
only non-personal reservation/settlement records.

After cleanup, the ordinary event composer, search, and direct controls remain usable outside the
voice session. The voice UI exposes an explicit retry action but does not preserve or replay the
failed utterance.
