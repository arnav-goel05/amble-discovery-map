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
- Cap exhaustion, either kill switch, or provider failure ends active voice work and preserves
  local text and direct-interface controls without calling another paid model.

## Retention

Anonymous plans expire seven days after defined activity. Telegram verification data is
deleted when the complete challenge session becomes terminal, or after seven days when a
session is abandoned. The service stores no photo bytes and no product telemetry.

Realtime audio, transcripts, exact location, screenshots, interface context, and confirmations are
session-only and are never written to application storage or logs. Provider-side processing and
retention are disclosed before microphone access; clearing application state does not imply that the
provider has deleted its independently governed safety records.

# Conversational map context assets

`data/discovery-areas.geojson` is generated from the URA Master Plan subzone boundary dataset. `data/transit-context.geojson` is generated from LTA MRT station exits plus URA rail-line and Master Plan 2025 rail-station-name datasets listed in `data/map-context-sources.json`. These Singapore Government datasets are used under the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence).

Run `npm run build:map-context` before a release when the catalogue changes. Generation hashes the exact downloaded responses, validates Singapore WGS84 geometry and stable source identities, and writes review-stage outputs below `outputs/map-context-staging/`. Publish each GeoJSON asset together with its manifest only after source, identity, geometry, station-consolidation, licence, build, browser, and benchmark gates pass. A source outage, rate limit, feature loss, or failed gate must preserve the last approved pair.

The runtime presents MRT stations and lines as visual context by default. Merely showing or hiding them must not affect discovery ranking; a transit constraint is activated only by an explicit user request. Location remains in memory, exposes only coarse area to assistant context by default, and is cleared on terminal cleanup.
