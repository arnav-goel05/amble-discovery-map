# Rendered event source fixtures

Fixtures are immutable, redacted TinyFish-style rendered envelopes. Each source directory must cover listing completion, duplicate links, valid details, exclusions/review, multi-performance identity, malformed/layout failure, timeout/retry, and resume.

Policy-v3 fixtures are versioned separately from source parser fixtures:

- `policy-v3/manifest.json` covers parent activities, schedule states, sessions, venue occurrences, independent placement/mapping/lifecycle/freshness states, and v2 snapshot migration.
- `authority/policy-v3-manifest.json` covers direct, editorial, and unavailable source roles plus deterministic editorial sufficiency and evidence upgrades.

The manifests are synthetic contract evidence, not live runtime data. Prior-snapshot entries model migration and stale carry-forward without copying an older pipeline run.

Live responses, credentials, cookies, authorization headers, and routine run traces must never be committed.
