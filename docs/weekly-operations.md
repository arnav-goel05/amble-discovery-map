# Weekly refresh operations

Automatic weekly refresh is currently disabled with `"enabled": false` in
`data/weekly-refresh-config.json`. Scheduled invocations exit successfully without
starting either extraction pipeline. Set it to `true` to re-enable the workflow.

Run the complete workflow from the repository root:

```sh
npm run weekly:refresh
```

The wrapper owns `outputs/weekly-refresh/.lock`, completes every event-pipeline continuation, and only then refreshes each bounded region in `data/weekly-refresh-config.json`. It writes an immutable combined report under `outputs/weekly-refresh/runs/<run-id>/status.json` and updates `outputs/weekly-refresh/latest.json`. Terminal status is `success` for a newly activated event snapshot, `stale` when a completed partial event run safely preserves the prior snapshot, and `release_failed` when event validation/activation fails; overlap remains separate. A stale event result skips restaurant mutation for that wrapper run, while a release failure exits non-zero.

Install either `deploy/amble-weekly.cron` or the `deploy/amble-weekly.service` and `deploy/amble-weekly.timer` pair after replacing the example working directory and checking the Node/npm paths. Both use free single-host scheduling; do not install both.

For recovery, open `latest.json` and its `statusRef`, then inspect event publication, per-source terminal counts, off-map/review/stale/archive totals, and the first release-wide failed gate. Remove `.lock` only after confirming its PID is not alive. Resolve the failed source/gate and rerun; never copy an older run. Review items are keyed by current evidence hash, and recovered/replaced/expired items are superseded automatically. Events always execute the exact continuation returned by the orchestrator.

`GET /api/weekly-refresh/status` exposes only terminal domain status and coverage counts. It never returns paths, commands, evidence, or credentials.
