# Production configuration

Amble initially runs as one Node process on one HTTPS host with durable local storage.
Use the deployment platform's secret store; never commit populated environment files.

## Required runtime values

- `HOST` and `PORT` select the private listen address behind the HTTPS proxy.
- `PUBLIC_BASE_URL` is the public HTTPS origin.
- `PLAN_STORE_ROOT` is a durable local directory for SQLite and maintenance state.
- `ADMIN_PASSWORD_HASH` configures the sole private administrator. Session and CSRF tokens are generated randomly and only their hashes are stored.
- Admin session cookies are Secure by default. `ADMIN_SECURE_COOKIES=0` is reserved for the
  local HTTP browser-test server and must never be set on the production host.

## Optional Telegram values

Telegram remains disabled until `TELEGRAM_GAMES_ENABLED`, bot identity, token, webhook secret,
and public HTTPS origin are configured. Tokens and chat-related data are server-only.

## Provider policy

An API key does not authorize spending. A provider is callable only when its checked-in entry
in `data/provider-policy.json` is approved with cost class `free` or `open`, except for the
OpenAI Realtime API narrowly authorized by constitution v2.2.0 for
`specs/004-conversational-voice-map/`. That exception requires a named operational owner,
concrete usage and spending limits, server-side credentials, an immediate disable control,
defined limit-exhaustion behavior, and equivalent text and direct-interface fallbacks before
production use. All other paid providers and paid fallbacks remain prohibited. Disable a free
provider if its free terms cease to apply.

## Realtime voice exception

Feature 004 is owned operationally by Arnav and has one cumulative lifetime ceiling of USD 10
(`10_000_000` micro-USD). It never resets automatically. Increasing or resetting the ceiling
requires another explicit owner-approved policy change.

- `OPENAI_API_KEY` is a server-only secret and must never appear in browser configuration,
  responses, bundles, logs, or checked-in files.
- `REALTIME_ENABLED` is the environment master switch and defaults to disabled unless set to
  `true`. The D1 runtime switch must also be enabled before a session can start.
- Routine development, CI, and browser tests use deterministic mock traffic and spend USD 0.
- The server reserves a conservative worst-case amount before accepting each billable turn.
  Unknown rates, models, usage shapes, or missing settlement events fail closed.
- Realtime session and response requests do not set `max_output_tokens`; generation uses the
  approved model's intrinsic maximum. The policy uses that documented provider maximum only to
  reserve a conservative worst-case response cost before work begins.
- Cap exhaustion, either kill switch, or provider failure ends active voice work and preserves
  local text and direct-interface controls without calling another paid model.

### Voice reliability logs and response timeout

Each provider response has a 30-second server-side watchdog independent of the 60-second idle
limit, five-minute session limit, and provider output-token maximum. `response.done`, browser
interruption, and every terminal session path clear the watchdog. If the provider never completes,
the relay attempts `response.cancel`, records `response_timeout`, conservatively holds the pending
reservation, and terminates through the standard voice-unavailable lifecycle.

Worker and local relay logs emit one JSON record per applicable phase:
`audio_committed`, `transcription_completed`, `response_requested`, `response_created`,
`first_audio`, `response_done`, `response_timeout`, or `session_terminal`. Use `sessionIdHash` and
`turnNumber` to correlate records, then compare `elapsedMs` and `sincePreviousPhaseMs` to locate the
delay. For example, a long gap between `response_created` and `first_audio` is provider
generation/audio latency; a missing `response_created` after `response_requested` is a provider
acceptance stall.

The record schema is deliberately closed to `schemaVersion`, `event`, `sessionIdHash`,
`turnNumber`, `phase`, `occurredAt`, `elapsedMs`, `sincePreviousPhaseMs`, `eventCode`, and
`terminalReason`. Never add audio, transcripts, prompts, tool arguments/results, provider bodies,
exact location, raw session IDs, credentials, or other user content. These records are minimal
reliability logs and must not be repurposed as product analytics.

### Local content-debug mode

Detailed voice protocol content is available only from an explicitly activated local development
process:

```bash
NODE_ENV=development REALTIME_CONTENT_DEBUG=true npm run dev
```

This emits `voice.content_debug` JSON records to the active terminal for
`browser_to_relay`, `relay_to_provider`, `provider_to_relay`, and `relay_to_browser` messages.
Permitted transcripts, prompts, tool arguments/results, and provider/browser fields are included so
ordering and malformed-payload failures can be reproduced. Credential, authorization, cookie,
token, password, secret, signing/private-key, raw-session-identity, and audio values are
recursively replaced before the logger receives the record.

The mode is off unless both startup values match exactly. It cannot be activated by the browser and
is not wired into the Cloudflare Worker, preview, or production adapters. It writes no file,
database, cache, browser storage, analytics, or remote telemetry. Do not redirect or tee this
terminal output into a file; stop the local process when debugging is complete. Production and
routine local operation continue to use only the closed privacy-safe phase records above.

### Realtime protocol 1.1 rollout

The shared capability bridge is an atomic browser/relay contract. Protocol `1.0` clients cannot
resume against a protocol `1.1` Worker, and a protocol `1.1` client must reject a `1.0` admission
response.

1. Keep `REALTIME_ENABLED=false` and the D1 runtime switch disabled.
2. Deploy the browser bundle, local relay, Worker admission route, provider relay, capability
   registry, schemas, and parity fixtures from the same verified source revision.
3. Run the mocked capability-contract, connector-parity, browser-matrix, production-build, and
   secret-scan gates against that revision.
4. Verify that admission requires exact protocol `1.1`, exposes only `app.inspect`,
   `catalog.search`, and `catalog.get` before authoritative context, and rejects protocol `1.0`.
5. Enable the D1 switch and then `REALTIME_ENABLED` only after the owner confirms the pinned policy,
   rate card, remaining reservation capacity, and optional live-smoke authorization.

To stop or roll back, disable `REALTIME_ENABLED` first and then the D1 switch. Active sessions must
terminate and clear browser-held audio, transcript, exact-location, context, and confirmation state.
Restore the last verified browser and Worker artifacts together; never roll back only one side of
the protocol. Text and direct controls remain available throughout the disabled interval.

## Retention

Anonymous plans expire seven days after defined activity. Telegram verification data is
deleted when the complete challenge session becomes terminal, or after seven days when a
session is abandoned. The service stores no photo bytes and no product telemetry.

Realtime audio, transcripts, exact location, screenshots, interface context, and confirmations are
session-only and are never written to application storage or routine/production logs. The explicit
local content-debug mode may print permitted sanitized content to the active terminal only; it
creates no application persistence. Provider-side processing and retention are disclosed before
microphone access; clearing application state does not imply that the provider has deleted its
independently governed safety records.

# Conversational map context assets

`data/discovery-areas.geojson` is generated from the URA Master Plan subzone boundary dataset. `data/transit-context.geojson` is generated from LTA MRT station exits plus URA rail-line and Master Plan 2025 rail-station-name datasets listed in `data/map-context-sources.json`. These Singapore Government datasets are used under the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence).

Run `npm run build:map-context` before a release when the catalogue changes. Generation hashes the exact downloaded responses, validates Singapore WGS84 geometry and stable source identities, and writes review-stage outputs below `outputs/map-context-staging/`. Publish each GeoJSON asset together with its manifest only after source, identity, geometry, station-consolidation, licence, build, browser, and benchmark gates pass. A source outage, rate limit, feature loss, or failed gate must preserve the last approved pair.

The runtime presents MRT stations and lines as visual context by default. Merely showing or hiding them must not affect discovery ranking; a transit constraint is activated only by an explicit user request. Location remains in memory, exposes only coarse area to assistant context by default, and is cleared on terminal cleanup.
