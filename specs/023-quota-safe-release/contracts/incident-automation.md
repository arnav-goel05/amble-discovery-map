# Incident Automation Contract

Schedule: once daily at 09:15 Asia/Singapore.

1. Query for the single open issue titled `[uptime] amblefinds.com is unhealthy`.
2. If absent, finish with no repository, issue, branch, provider, or deployment mutation.
3. If present, run one bounded production diagnostic check and inspect its linked workflow
   evidence.
4. Classify the cause. For non-code causes, comment with evidence and owner action.
5. For a code-correctable cause, work only on `develop`, run relevant local tests, and commit/push
   only if they pass. Comment with commit and test evidence.
6. Never update `main`, trigger/dispatch release, deploy, call live paid providers, retry the
   production check, or close an unresolved issue.
