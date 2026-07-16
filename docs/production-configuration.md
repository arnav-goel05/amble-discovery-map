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
in `data/provider-policy.json` is approved with cost class `free` or `open`. Paid providers and
paid fallbacks remain prohibited. Disable a provider if its free terms cease to apply.

## Retention

Anonymous plans expire seven days after defined activity. Telegram verification data is
deleted when the complete challenge session becomes terminal, or after seven days when a
session is abandoned. The service stores no photo bytes and no product telemetry.
