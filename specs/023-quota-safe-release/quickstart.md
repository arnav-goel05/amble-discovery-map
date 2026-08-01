# Quickstart: Quota-Safe Direct Release Pipeline

## Everyday development

Work on `develop` unless a different branch was explicitly requested. Run `npm run ci:local`.
Commit and push the current branch only when requested. Do not create a pull request. A push to a
non-main branch starts ordinary quota-safe validation and cannot deploy.

## Release

Use the repository release skill or manually dispatch `Release production` with the full current
`origin/develop` SHA. The workflow validates that exact revision, runs the complete release gate,
and fast-forwards `main` only on success. Do not push `main` manually around the gate.

## Incidents

At 09:00 Singapore time, uptime checks production once. Failure opens or updates one outage issue;
no retry, rollback, or redeploy occurs. At 09:15, the Codex automation may diagnose and prepare a
tested fix on `develop`. Releasing that fix still requires the explicit release procedure.

## Local validation

```sh
npm run ci:policy
npm run geometry:fixture:verify
npm run ci:local
```

The first two commands must work without credentials or network access. Release-only commands
require repository and Cloudflare credentials and must not be used as ordinary validation.
