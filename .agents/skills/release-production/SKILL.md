---
name: release-production
description: Safely bootstrap the canonical release workflow when separately authorized, then verify and release the exact current develop revision to production through the repository's Release production GitHub workflow. Use only when the user explicitly asks to release, promote develop to main, push to main for deployment, deploy the current approved code, or fix a blocked first release; never use for ordinary develop commits or pushes.
---

# Release Production

Release only through `.github/workflows/release-production.yml`. Do not create a branch or pull
request, push `main` directly, invoke Wrangler deployment locally, or reproduce the gate manually,
except for the narrowly authorized read-only integrity Worker bootstrap below.

1. Read `AGENTS.md` and confirm the user explicitly authorized a production release in the current
   request. If not, stop and explain that ordinary work remains on `develop`.
2. Confirm the worktree is on `develop`. Preserve unrelated changes. Do not include uncommitted
   files in a release candidate.
3. Run `git fetch origin develop main`, then resolve full `origin/develop` and `origin/main` SHAs.
   Require `origin/main` to be an ancestor of `origin/develop`. Never force, merge, or rebase around
   divergence.
4. Confirm the intended code is already committed and pushed to `origin/develop`. If local
   `develop` differs, report the exact difference and stop unless the user separately authorized
   the needed commit and push. When that authorization exists, create the candidate commit first,
   then run the changed-file formatter across the complete production candidate before pushing:

   ```sh
   CI_BASE_SHA="$(git rev-parse origin/main)" \
     CI_HEAD_SHA="$(git rev-parse HEAD)" \
     npm run format:check
   ```

   This checker compares committed revisions. Never treat a run made before the candidate commit
   exists as formatting evidence. Fix failures in a new commit, re-run the check, and only then
   push the final candidate to `origin/develop`.

   If no commit or push is needed, run the same full-range check against the immutable remote
   candidate before dispatch:

   ```sh
   CI_BASE_SHA="$(git rev-parse origin/main)" \
     CI_HEAD_SHA="$(git rev-parse origin/develop)" \
     npm run format:check
   ```

   Require the latest ordinary `CI` run for that exact `origin/develop` SHA to be completed with a
   `success` conclusion. A run for another SHA, a pending run, or a partially successful job is not
   sufficient. Stop before release dispatch if exact-candidate ordinary CI is missing or not green;
   this prevents release-only geometry hydration and external quota use for a candidate that has
   not passed the zero-external fixture suite.

   Confirm `main` branch protection requires the stable ordinary `Quality checks` context. Do not
   require the release workflow's own `Release verification` job as a branch context: GitHub
   evaluates that same workflow while its promotion job is still running, which creates a circular
   "expected" check and rejects the exact-SHA fast-forward. The canonical workflow's `needs:
verify` dependency remains the release-verification enforcement boundary.

5. Before dispatch, check whether the canonical workflow exists on the default branch:

   ```sh
   git cat-file -e origin/main:.github/workflows/release-production.yml
   ```

   If it exists, continue to dispatch. If it does not exist, do not attempt dispatch and do not
   surface the resulting GitHub 404 as a release failure. Follow **First-release bootstrap** below.

6. Dispatch the canonical gate:

   ```sh
   gh workflow run release-production.yml --ref main -f candidate_sha=<full-origin-develop-sha>
   ```

7. Preserve the run URL returned by dispatch and wait for that exact run's terminal result. The
   workflow run's `headSha` identifies the `main` revision that owns the workflow, not the candidate
   input, so do not locate it by comparing `headSha` with `origin/develop`. Do not dispatch a
   duplicate run. The workflow alone revalidates refs and fast-forwards the exact tested SHA to
   `main`.
8. On failure, report the failed gate and its run URL. Do not retry, update `main`, or deploy unless
   the user asks to address the failure.
9. On success, verify `origin/main` equals the candidate. The Cloudflare main-branch build may
   compile the promoted application once, but it must not repeat GitHub tests or verifiers, geometry
   hydration, remote inventory, or synchronization. Its deploy phase owns exactly one application
   upload and one post-deployment check.
10. Wait for the Cloudflare check attached to the candidate SHA and verify a new `amble` deployment
    was created after promotion. Inspect the active version metadata and require the application
    bindings (`ASSETS`, `RUNTIME_DB`, and `TILES_BUCKET`). Do not accept a green GitHub release alone
    as deployment evidence.
11. Cloudflare Workers Builds has a hard 20-minute execution limit. Allow at most five additional
    minutes for GitHub status propagation. If the check remains non-terminal after 25 minutes and
    no new deployment exists, classify it as stale/timed out and stop polling. Never report success
    or start a manual/parallel deployment. When the user authorized fixing release blockers, fix the
    connected build on `develop`, pass exact-candidate ordinary CI, and restart this skill from step
    1 with one new candidate release.

## First-release bootstrap

GitHub permits `workflow_dispatch` only when the workflow exists on the repository's default
branch. When the workflow is present on `origin/develop` but absent from `origin/main`, treat this
as a one-time repository bootstrap prerequisite, not a failed release.

A request to release is not authorization to change the repository's default branch. Stop and ask
for explicit authorization to temporarily set the GitHub default branch to `develop` solely to
queue the canonical release workflow. Do not bootstrap by directly committing or pushing the
workflow to `main`; that would bypass the gate, risk a production build, and make `main` diverge
from `develop`.

After the user explicitly authorizes the bootstrap in the current request:

1. Re-run steps 1–4 and confirm all of the following:
   - GitHub's current default branch is `main`.
   - The canonical workflow is absent from `origin/main` and present at the exact candidate SHA.
   - `origin/main` is an ancestor of that candidate.
2. Record the repository owner/name and current default branch. Temporarily change only the GitHub
   repository default branch to `develop`. Do not alter branch protection, commits, or Cloudflare.
3. Dispatch the canonical gate exactly once from the temporary workflow-owning branch and preserve
   the returned run URL:

   ```sh
   gh workflow run release-production.yml --ref develop -f candidate_sha=<full-origin-develop-sha>
   ```

4. As soon as the run is located, restore the GitHub default branch to `main`, even if later gate
   steps fail. If dispatch or run lookup fails, restore `main` before reporting the blocker.
5. Wait for that same run and continue with steps 8–9. Never dispatch a replacement automatically.

The temporary default-branch change exists only to let GitHub queue the canonical workflow. It is
not permission to push `main`, skip checks, deploy separately, or leave `develop` as the default.

## Read-only integrity Worker bootstrap

The release gate's single bounded R2 inventory request depends on the isolated
`amble-tile-integrity` Worker. For the first production release, that Worker may not exist yet
because the `main`-owned Cloudflare deployment has never run. Treat this as a one-time control-plane
bootstrap prerequisite only when all of the following are true:

- an exact-candidate release run passed POI separation and local R2 inventory;
- its single public inventory request failed with `404 Not Found` at the configured
  `amble-tile-integrity` Workers URL;
- `origin/main` was not updated and no application deployment occurred;
- the user explicitly authorized fixing the release blocker and retrying the release; and
- the local worktree is clean on `develop` and equals the exact successful ordinary-CI candidate.

After confirming those conditions:

1. Run the local Cloudflare contract tests for the candidate.
2. Confirm Wrangler is authenticated to the intended account.
3. Run `npm run cloudflare:tile-integrity:deploy` exactly once. This may publish only the isolated
   read-only inventory Worker configured by `wrangler.tile-integrity.jsonc`. It must not deploy the
   application Worker, mutate R2 geometry, update `main`, or invoke `cloudflare:cloud:deploy`.
4. Do not probe the endpoint separately; the next canonical release run owns the one bounded
   inventory request and supplies the verification evidence.
5. Re-run steps 1-7 against the current immutable `origin/develop` SHA. Dispatch one new run only
   when the user's authorization includes addressing the failed gate; never rerun the failed job or
   dispatch two runs for the same fix.

Once the Worker exists, this exception is no longer applicable. Routine releases rely on the
existing endpoint. The `main`-owned application build must not deploy the integrity Worker because
Workers Builds can attach a nested Wrangler upload to the connected `amble` application service.
It must rely on the successful exact-SHA release evidence instead of repeating tests or the remote
inventory request after promotion.

Never expose credentials or copy unsanitized provider output into reports. A successful workflow
is not permission to make any additional production change.
