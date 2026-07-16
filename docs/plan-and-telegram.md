# Plans and Telegram challenges

The planner remains map-first: it builds ordered event and restaurant routes and opens them in Google Maps. It does not create public plan links or share to WhatsApp. Data is persisted only when the user selects **Start Telegram challenge**.

Before launch, the planner previews mission order, approximate route distance/travel time, venue and event warnings, restaurant-hours gaps, and Telegram readiness. Players can choose an Explorer, Detective, or Food Trail theme and an optional timer.

## Architecture

`PlanGameService` contains the game rules and accepts an injected repository. `SqliteGameRepository` is the local implementation and uses Node's built-in SQLite driver with WAL mode, foreign keys, a busy timeout, `BEGIN IMMEDIATE` transactions, schema migrations, optimistic version fields, unique idempotency keys, and leased queue claims. This boundary is the contract for a future PostgreSQL repository; PostgreSQL itself is not bundled.

The database is `${PLAN_STORE_ROOT}/game-state.sqlite` (default `outputs/plans/game-state.sqlite`). It stores plans, immutable versioned game snapshots, player sessions, active-session pointers, minimized Telegram update claims, durable outbound messages, rate-limit windows, and short-lived photo-verification records. Image bytes and product-analytics events are never stored.

Legacy JSON plans, games, sessions, active pointers, and delivery records are imported once on startup. The source JSON files are intentionally left untouched. A malformed or relationally incomplete legacy record is skipped for manual recovery.

Each Telegram update is claimed transactionally. Duplicate deliveries cannot advance a mission twice, even when two application instances receive the same update. Replies enter a durable outbox before being sent. A background worker leases due messages, retries failures with exponential backoff, and recovers expired leases after a process crash.

## Configuration

Create a bot with BotFather and set server-side environment variables:

```sh
export TELEGRAM_GAMES_ENABLED=true
export ADAPTIVE_LOCATION_VERIFICATION_ENABLED=true
export PHOTO_VERIFICATION_ENABLED=true
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_BOT_USERNAME="your_bot_username"
export TELEGRAM_WEBHOOK_SECRET="a-long-random-A_Z-a_z-0_9-secret"
export PUBLIC_BASE_URL="https://your-public-host.example"
export PLAN_STORE_ROOT="/persistent/plans"

# Optional operational and privacy controls
export TELEGRAM_RATE_LIMIT_PER_MINUTE=30
export TELEGRAM_QUEUE_INTERVAL_MS=1000
export PHOTO_VERIFICATION_TIMEOUT_MS=8000
export PHOTO_RETENTION_MS=604800000
export STRUCTURED_LOGS_ENABLED=true
```

Build, start, and register the webhook:

```sh
npm run build
npm run plans:migrate
npm run serve
npm run telegram:webhook
```

`PUBLIC_BASE_URL` must be HTTPS. The setup command registers `/api/telegram/webhook`, restricts updates to messages, retains pending Telegram updates, and configures Telegram's secret-token header. Never expose the bot token, webhook secret, operator secret, or vision-provider credentials in browser code.

`npm run plans:migrate` is safe to run repeatedly before new application instances receive traffic. It applies only unapplied numbered migrations and performs the non-destructive legacy import. Application startup also runs the same migration path as a safety net.

Feature rollout is controlled by `TELEGRAM_GAMES_ENABLED`, `ADAPTIVE_LOCATION_VERIFICATION_ENABLED`, and `PHOTO_VERIFICATION_ENABLED`; their non-secret state is reflected in the planner readiness response. Disabling adaptive location falls back to the fixed snapshotted radius. Disabling photo verification bypasses the configured vision provider but keeps Telegram identity checks and duplicate protection. A deployment can inject a server-only `visionVerifier` into `planGameApiPlugin`; it must expose async `verify({ update, message })` and return `{ status: "accepted" | "rejected" | "needs_review", reason, confidence?, verifier? }`. Provider failures and timeouts become `needs_review`, never automatic acceptance.

## Player lifecycle and verification

Supported commands are `/start`, `/help`, `/status`, `/route`, `/pause`, `/resume`, `/skip`, `/quit`, and `/recap`. Sessions survive restarts. Multiple chat IDs can play the same immutable game independently. Games have expiry and revocation fields; active snapshots do not change if the source plan later changes.

Location checks use the per-stop verification snapshot:

- venue/building polygons when supplied;
- configurable base radius (default 120 m for restaurants and 180 m for events);
- Telegram GPS accuracy to calculate a bounded adaptive radius;
- a maximum accepted accuracy and recent-message timestamp;
- an optional second consistent reading within two minutes.

If no accuracy or building footprint is available, the documented fallback is coordinate-radius verification. The session history records which method was used. Stale, future-dated, low-accuracy, and distant readings produce actionable retry messages.

Photo verification uses Telegram's stable `file_unique_id` to reject reuse within a game. The default verifier checks Telegram metadata; configured vision output can accept, reject, or mark a submission uncertain. An uncertain submission pauses the current mission so the player can send a clearer photo or await review.

Private reviewers sign in at `/admin.html`, open **Photo reviews**, inspect the minimized evidence, and accept or reject with a reason. Decisions require the authenticated session, CSRF token, and an idempotency key; terminal, deleted, or stale work is rejected. Player notifications use the same durable outbox.

The bot explains retention before verification. Only the photo identity, verifier result, and review status are stored; image bytes are never stored. `PHOTO_RETENTION_MS` defaults to seven days and expired verification data is purged by the maintenance worker. Completing, timing out, quitting, or revoking a challenge deletes its related verification data and active-session pointer transactionally. Completing one mission does not end the challenge or trigger this cleanup. Inactive nonterminal sessions and verification data are removed after seven days without activity. Settled Telegram update, delivery, and outbox records are retained for 24 hours for duplicate suppression and bounded retry, then removed.

## Operations

Health and diagnostics endpoints:

- `GET /health/live` checks the process.
- `GET /health/ready` checks the feature flag, bot username, SQLite access, and reports queue depth.
- `GET /api/game-readiness` exposes only non-secret readiness fields for the planner.
- `GET /api/admin/diagnostics` is a transitional non-browser operations endpoint and returns only storage and queue state.
- `POST /api/admin/plans/:id/revoke` and `POST /api/admin/games/:id/revoke` require `X-Operator-Secret` and are idempotent.

The service records no product analytics or product metrics. Structured operational logs contain stable event and reason codes for delivery and worker failures; they exclude Telegram content, provider response text, credentials, and verification evidence.

For one host, keep `PLAN_STORE_ROOT` on durable local storage and run a single application process when possible. SQLite supports the tested multi-process claim path on one machine, but it is not appropriate on a shared network filesystem. Horizontal multi-host deployment requires implementing the existing repository contract on PostgreSQL and running migrations before traffic; that adapter and managed database are external prerequisites.

Backup SQLite with its online backup tooling or a filesystem snapshot that includes the database and WAL consistently. Test restores into a separate `PLAN_STORE_ROOT`, start the app, check `/health/ready`, inspect `/api/admin/diagnostics`, and run a test challenge before switching traffic. Do not copy only the main database file while writes are active. Keep deployment secrets in the platform secret manager and rotate bot/webhook/operator secrets independently.

If Telegram is unavailable, leave the process running: queued replies retain their payload and retry time. Monitor `pendingMessages`, `telegram_delivery_failed`, and reason-coded worker logs. Retry remains bounded and settled delivery state is removed after its 24-hour duplicate-suppression window. If a bad game must stop immediately, revoke it through the documented operations tooling; revocation is terminal and atomically clears active-session and verification state.

## Verification

```sh
npm run test:plans
```

This runs unit/integration tests, browser planner tests, a production build, and a production smoke test. Coverage includes validation, immutable snapshots, route URLs, lifecycle commands, timers/scoring/recaps, adaptive location checks, photo uncertainty and manual review, webhook authentication, rate limiting, duplicate delivery, two-instance claims, automatic outage retry, SQLite restart recovery, legacy import, responsive planner behavior, production serving, and byte-range tile requests. A live Telegram smoke test still requires real credentials and a public HTTPS deployment.
