# Release Workflow Contract

Input: `candidate_sha` (required, full 40-character SHA).

Preconditions:

1. Candidate exists on remote `develop` and equals its head at workflow start.
2. Remote `main` is an ancestor of candidate.
3. Candidate passes ordinary validation and all release-only gates.
4. Immediately before mutation, remote `develop` and `main` still equal their recorded values.

Success: push `candidate_sha:refs/heads/main` without force. The push is the only production
deployment signal.

Failure: emit a concise failed gate and budget report; perform no branch push or deployment.

Manual GitHub dispatch and repository release skill MUST call this same workflow and MUST NOT
implement separate promotion logic.
