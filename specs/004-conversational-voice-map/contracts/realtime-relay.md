# Realtime Relay Contract

## Trust boundary

The browser connects only to the application's same-origin relay. The relay alone connects to
OpenAI and owns the standard API key, pinned model, instructions, tools, response creation, rate
card, reservations, and kill switches. Browser messages are untrusted.

The server-owned instructions define the model as Amble's application-scoped guide, not a
general-purpose assistant. They reject unrelated general-chat and open-web requests, prohibit
claims beyond approved application data, and require confirmed tool results before claiming an
application state change succeeded. Capability descriptions are generated from the same currently
eligible typed tools sent in each provider `session.update`; unavailable actions are not advertised.
An opening greeting uses the checked-in Amble welcome message, which introduces Singapore discovery,
area/place recommendations, application search, map control, location, and MRT context instead of
inviting general-purpose conversation.

## Session admission

`POST /api/voice/sessions`

Request:

```json
{
  "protocolVersion": "1.0",
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
    "protocolVersion": "1.0",
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

## Stream

`GET /api/voice/sessions/{sessionId}/stream` upgrades to WebSocket after same-origin and session
validation. A session may bind one browser stream and one provider stream. Messages larger than the
declared bounds close the connection.

### Browser to relay

- `turn.request`: requests a bounded input+response reservation before microphone chunks are
  accepted. Relay replies `turn.ready` or `usage_limit`.
- `audio.append`: bounded audio chunk accepted only for the active reserved turn.
- `audio.commit`: ends the audio turn; relay owns provider transcription commit and response create.
- `text.submit`: bounded plain text input for the same action/discovery path; relay reserves the
  response before forwarding.
- `action.result`: validated application result for a relay-proposed action call and matching call
  identity. It contains no arbitrary provider event type.
- `confirmation.result`: deterministic accept/reject result for the current confirmation fingerprint.
- `session.stop`: explicit terminal cleanup.

### Relay to browser

- `session.state`: one of the states in `ConversationSession`.
- `turn.ready`: reservation accepted; audio may begin.
- `transcript.delta`, `transcript.final`: bounded text keyed by item ID.
- `assistant.audio.delta`, `assistant.audio.done`: bounded audio output.
- `assistant.text.delta`, `assistant.text.done`: transcript/text fallback output.
- `action.proposed`: allowlisted action ID, canonical arguments, context revision, and call identity.
- `confirmation.required`: immutable fingerprint, target, exact effect, and expiry.
- `action.completed`: sanitized observable result.
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
8. Before authoritative interface context arrives, the provider receives only the bounded discovery
   tools. Each later context revision replaces the tool list and capability description with
   discovery plus the action IDs eligible in that revision.

## Cleanup

Explicit stop, socket close, `pagehide`, idle/duration expiry, permission revoke, cap/kill switch,
provider error, or protocol violation cancels output, closes both sockets, stops browser media,
invalidates confirmations, aborts work, and clears all application-held session content. D1 retains
only non-personal reservation/settlement records.
