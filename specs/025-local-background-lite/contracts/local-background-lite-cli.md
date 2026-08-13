# Contract: Local Background-Lite CLI

## Commands

```bash
npm run background-lite:local -- preflight --output <absolute-directory>
npm run background-lite:local -- reclaim --target <exact-absolute-path> --confirm <token>
npm run background-lite:local -- build --output <absolute-directory> [--batch-size N] [--concurrency N]
npm run background-lite:local -- overlays --output <absolute-directory>
npm run background-lite:local -- validate --output <absolute-directory>
npm run background-lite:local -- switch-local --output <absolute-directory>
npm run background-lite:local -- rollback-local --output <absolute-directory>
npm run background-lite:local -- status --output <absolute-directory>
```

## Preflight result

Returns a versioned JSON result containing source inventory identity, source validation, active highlight count, exact deletion candidates and byte estimates, capacity/reserve estimate, proposed run identity, blockers, and a short-lived confirmation token bound to the exact resolved target and inventory.

Preflight performs no writes outside its ignored report directory and deletes nothing.

## Reclaim contract

`reclaim` accepts only the exact repository `optimized-tiles/` directory, requires a matching unexpired preflight token, re-resolves the target, rejects symlinks or mount/root boundaries, verifies `tiles/` again, and reports actual reclaimed bytes. It does not accept globs, environment-expanded broad paths, `tiles/`, `public/poi-tiles/`, the repository root, or a parent directory.

Successful reclaim sets state to `intentionally-unavailable`. Failure reports `no-op | target-changed | confirmation-invalid | source-invalid | deletion-failed` and never widens the target.

## Build and resume contract

`build` verifies run identity, capacity reserve, and all checkpoint hashes. It prints bounded progress and returns one of `checkpointed | blocked-by-capacity | failed-validation | complete | noop`. A zero exit status means a valid terminal command outcome, not necessarily full completion; the structured `complete` field is authoritative.

## Overlay contract

`overlays` reads only approved local snapshot/evidence and `tiles/`. It returns create/update/no-op/expire/review counts and refuses a complete catalogue when any active identity lacks source-backed geometry.

## Validate and switch contract

`validate` produces identity, payload, automated browser, rollback, and advisory diagnostic evidence. `switch-local` accepts only a `ready` switch manifest and changes local asset selection atomically. `rollback-local` hash-verifies and restores the recorded prior local manifest. Optional visual and repeated runtime diagnostics do not gate local completion. None of these commands invokes network, deployment, Git publication, or release tooling.

## Legacy POI deletion

Deletion of `public/poi-tiles/` is deliberately absent from the first migration command. It requires a later explicit exact-path confirmation after switch parity and rollback gates are recorded.
