# Weekly refresh operations

Automatic weekly refresh is currently disabled with `"enabled": false` in
`data/weekly-refresh-config.json`. Scheduled invocations exit successfully without
starting either extraction pipeline. Set it to `true` to re-enable the workflow.

Run the complete workflow from the repository root:

```sh
npm run weekly:refresh
```

The wrapper owns `outputs/weekly-refresh/.lock`, completes every event-pipeline continuation, and only then refreshes each bounded region in `data/weekly-refresh-config.json`. It writes an immutable combined report under `outputs/weekly-refresh/runs/<run-id>/status.json` and updates `outputs/weekly-refresh/latest.json`. Partial, blocked, failed, and overlapping runs exit non-zero. The event pipeline preserves the previous approved snapshot unless every publication gate passes.

Install either `deploy/amble-weekly.cron` or the `deploy/amble-weekly.service` and `deploy/amble-weekly.timer` pair after replacing the example working directory and checking the Node/npm paths. Both use free single-host scheduling; do not install both.

For recovery, open `latest.json` and its `statusRef`. Remove `.lock` only after confirming its PID is not alive. Resolve the first failed domain and rerun the wrapper; never copy an older run. Restaurant coverage resumes where possible, while events execute the exact continuation returned by the orchestrator.

`GET /api/weekly-refresh/status` exposes only terminal domain status and coverage counts. It never returns paths, commands, evidence, or credentials.
