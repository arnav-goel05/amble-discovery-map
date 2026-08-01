---
name: release-production
description: Safely verify and release the exact current develop revision to production through the repository's Release production GitHub workflow. Use only when the user explicitly asks to release, promote develop to main, push to main for deployment, or deploy the current approved code; never use for ordinary develop commits or pushes.
---

# Release Production

Release only through `.github/workflows/release-production.yml`. Do not create a branch or pull
request, push `main` directly, invoke Wrangler deployment locally, or reproduce the gate manually.

1. Read `AGENTS.md` and confirm the user explicitly authorized a production release in the current
   request. If not, stop and explain that ordinary work remains on `develop`.
2. Confirm the worktree is on `develop`. Preserve unrelated changes. Do not include uncommitted
   files in a release candidate.
3. Run `git fetch origin develop main`, then resolve full `origin/develop` and `origin/main` SHAs.
   Require `origin/main` to be an ancestor of `origin/develop`. Never force, merge, or rebase around
   divergence.
4. Confirm the intended code is already committed and pushed to `origin/develop`. If local
   `develop` differs, report the exact difference and stop unless the user separately authorized
   the needed commit and push.
5. Dispatch the canonical gate:

   ```sh
   gh workflow run release-production.yml --ref develop -f candidate_sha=<full-origin-develop-sha>
   ```

6. Locate the resulting `Release production` run for that SHA and wait for its terminal result.
   Do not dispatch a duplicate run. The workflow alone revalidates refs and fast-forwards the exact
   tested SHA to `main`.
7. On failure, report the failed gate and its run URL. Do not retry, update `main`, or deploy unless
   the user asks to address the failure.
8. On success, verify `origin/main` equals the candidate. Report the GitHub run and Cloudflare
   deployment evidence. The Cloudflare main-branch build owns change-only geometry synchronization,
   deployment, and its single post-deployment check.

Never expose credentials or copy unsanitized provider output into reports. A successful workflow
is not permission to make any additional production change.
