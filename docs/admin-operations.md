# Private administration operations

The administrator interface is served at `/admin.html`. It supports one server-configured
administrator and never accepts `X-Operator-Secret` as browser authentication.
The transitional operator-secret HTTP routes have been removed. Venue review, photo review,
plan revocation, and game revocation all require the authenticated admin session and CSRF token.

## Credentials and sessions

Set `ADMIN_PASSWORD_HASH` to a scrypt hash generated with:

```sh
node -e "const {hashAdminPassword}=require('./scripts/lib/admin-auth-service.cjs'); console.log(hashAdminPassword(process.env.ADMIN_PASSWORD))"
```

Supply `ADMIN_PASSWORD` only to that one-time command; do not save it in repository files or
browser configuration. To rotate the credential, replace `ADMIN_PASSWORD_HASH` and restart the
service. Existing opaque sessions are stored in `ADMIN_DATABASE_PATH` and can be invalidated by
deleting their rows from `admin_sessions` during a maintenance window. Logout revokes one session
immediately. Sessions expire server-side and all mutation requests require their CSRF token.

## Venue review workflow

1. Run the weekly event pipeline. Only cases still ambiguous after bounded automated recovery
   enter the durable venue-review queue.
2. Sign in at `/admin.html`, compare official address evidence, recovery attempts, competing
   OneMap candidates, GML identities, coordinates, and tile evidence.
3. Approve one candidate with a reason, reject the mapping with a reason, or defer it.
   Repeated submissions use an idempotency key. A stale evidence response refreshes the queue.
4. Run or resume the event pipeline. Approval is only a proposal: the local resolver recomputes
   the evidence hash and verifies the selected GML identity, Singapore coordinate, and current
   tile/batch evidence. The HTTP decision never writes public landmarks, POIs, or tiles.
5. Publication remains blocked until every venue is accounted for and the normal snapshot,
   geometry, build, and browser gates pass.

`ADMIN_DATABASE_PATH` defaults to ignored runtime storage under `outputs/admin/`. Back up that
database using SQLite's online backup mechanism if review audit history must survive host
replacement. Never commit the database, WAL/SHM sidecars, session tokens, or credentials.
