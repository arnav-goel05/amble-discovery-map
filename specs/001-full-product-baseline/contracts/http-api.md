# HTTP API Contract

All routes are same-origin. JSON responses use UTF-8. Unsupported methods return 404 or
405 without exposing stack traces. Mutation requests have bounded bodies and validated
content types. Public routes never return secrets, chat identifiers, raw evidence payloads,
or filesystem paths.

## Common response forms

```json
{
  "schemaVersion": "1.0",
  "data": {},
  "fetchedAt": "2026-07-14T00:00:00.000Z",
  "stale": false,
  "warning": null,
  "source": { "id": "approved-provider", "costClass": "free" }
}
```

```json
{
  "schemaVersion": "1.0",
  "error": { "code": "stable_reason_code", "message": "Actionable public message" }
}
```

Stale data is allowed only when `data` is the last approved applicable result. HTTP status
200 may carry `stale: true`; a request with no approved fallback returns 503 and an
`unavailable` error. Internal errors return a correlation-safe reason code, not internals.

## Public snapshot

### `GET /api/snapshot`

Returns the active approved snapshot metadata and public event/POI references. It never
returns a staged or partially verified snapshot.

Response fields: `snapshotId`, `publishedAt`, `coveredWindow`, `freshness`, `staleAfter`,
sanitized `sourceHealth`, `landmarksRef`, `poisRef`, `tilesetRef`, and `contentHash`.

## Restaurants

### `GET /api/restaurants?bbox=minLat,minLng,maxLat,maxLng`

Returns at most the configured public limit for the requested valid Singapore viewport.
The common envelope records fresh, stale exact, stale overlap, or unavailable behavior.

### `POST /api/restaurant-deals/batch`

Request:

```json
{ "restaurantIds": ["osm-node-123"], "viewportKey": "optional-current-view" }
```

Returns per-restaurant job state and approved deal result envelopes. IDs are bounded and
deduplicated. A batch cannot cause use of a provider absent from the free/open allowlist.

### `GET /api/restaurant-deals?id=osm-node-123`

Returns `idle`, `pending`, `success`, `unavailable`, or `error`. A stale deal includes its
last checked time and validity state. An expired deal is not returned as current.

## Anonymous plans and games

### `POST /api/plans`

Creates a challenge-ready anonymous plan from 1–20 validated event/restaurant stops.
Returns `planId`, normalized summary, `lastActivityAt`, and `expiresAt`. Creation establishes
activity and expiry seven days later. It does not create an account.

### `GET /api/plans/{planId}`

Returns a current, unrevoked anonymous plan or 404/410 for missing/expired/revoked plans.
Read-only retrieval does not update activity or extend retention.

### `POST /api/games`

Request fields: `planId`, theme (`explorer`, `detective`, or `foodie`), and nullable bounded
timer minutes. Returns immutable game summary and optional Telegram launch URL.
Successful game creation refreshes the source plan's activity and expiry in the same
transaction; failed or repeated read-only requests do not.

### `GET /api/games/{gameId}`

Returns the immutable public game snapshot without player chat/session data.

### `GET /api/game-readiness`

Returns only non-secret availability fields for the optional Telegram features.

## Telegram and health

### `POST /api/telegram/webhook`

Requires the configured Telegram secret-token header, bounded JSON, update idempotency, and
rate limits. A valid duplicate returns the previous safe result without advancing state.

### `GET /health/live`

Returns process liveness only.

### `GET /health/ready`

Returns database readiness, feature availability, and queue health. It contains no product
metrics, personal data, or privileged configuration.

## Private admin authentication

Admin routes require a valid opaque server-side session cookie and CSRF token for mutation.
Login attempts are throttled. The cookie is Secure, HttpOnly, SameSite=Strict, path-scoped,
and never readable by browser JavaScript.

### `POST /api/admin/session`

Request: `{ "password": "..." }`.

Success sets the session cookie and returns `{ authenticated: true, csrfToken, expiresAt }`.
Failure returns the same generic 401 response for unknown account/password states.

### `GET /api/admin/session`

Returns authenticated session status and a rotated or current CSRF token.

### `DELETE /api/admin/session`

Requires CSRF, revokes the server session, and clears the cookie. Repetition is idempotent.

## Private venue reviews

### `GET /api/admin/venue-reviews?status=pending&cursor=...`

Returns a bounded page of sanitized review summaries.

### `GET /api/admin/venue-reviews/{reviewId}`

Returns source venue names, official address evidence, evidence hash, bounded recovery
attempts, OneMap candidates, tile/GML evidence, distances, and uncertainty reasons.

### `POST /api/admin/venue-reviews/{reviewId}/decision`

Requires CSRF and an idempotency key.

```json
{
  "decision": "approve",
  "evidenceHash": "sha256",
  "candidateGmlId": "SLA_BLDG2_...",
  "reason": "Official address and unique building evidence agree",
  "idempotencyKey": "opaque-client-key"
}
```

`decision` is `approve`, `reject`, or `defer`. Approval requires a current candidate GML
identity. A stale evidence hash returns 409 and does not decide or publish the review.
Success returns the stored decision and `pipelineReconciliationRequired: true`.

## Private photo reviews and revocation

### `GET /api/admin/photo-reviews?status=needs_review&cursor=...`

Returns minimal uncertain-verification evidence without photo bytes.

### `POST /api/admin/photo-reviews/{submissionId}`

Requires CSRF and an idempotency key. Accepts `accepted` or `rejected` plus a reason. A
completed/deleted task returns 409 and does not recreate retained data.

### `POST /api/admin/plans/{planId}/revoke`

### `POST /api/admin/games/{gameId}/revoke`

Require CSRF and are idempotent. Game revocation performs terminal privacy cleanup in the
same transaction.

## Compatibility and deprecation

Existing public plan, game, restaurant, health, and Telegram route shapes remain compatible
unless a versioned response adds fields. Existing `X-Operator-Secret` routes are transitional
operational interfaces only; they cannot authenticate the admin browser UI and must be
removed after session-authenticated operator workflows pass production validation.
