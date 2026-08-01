# Data Model: Quota-Safe Direct Release Pipeline

## GeometryFixtureManifest

- `schemaVersion`: fixture contract version
- `fixtureId`: stable fixture identity
- `objects[]`: relative path, role (`background`, `nested`, `highlight`, `event-highlight`),
  byte length, SHA-256
- `failureCases[]`: stable IDs for missing object, corrupt B3DM, hash mismatch, and separation
  conflict
- `budgets.maxCheckedInBytes`: hard fixture-size ceiling
- `budgets.productionRequests`: always zero

Validation: paths are relative and contained, hashes match bytes, required roles and failure IDs
are present, total bytes stay below budget, and no production URL appears.

## ReleaseCandidate

- `candidateSha`: 40-character immutable commit SHA
- `developShaAtStart`: remote `develop` identity when validation begins
- `mainShaAtStart`: remote `main` identity when validation begins
- `requestedBy`: GitHub actor
- `workflowRunId`: release evidence identity

State transitions: `requested -> identity_validated -> testing -> passed -> refs_revalidated ->
promoted`, or any non-terminal state to `failed`. Only `refs_revalidated` may transition to
`promoted`.

## ReleaseBudget

- Production hydration passes: at most 1
- Public integrity inventory requests: at most 1
- Public object HEAD requests: 0
- Geometry writes: only missing/changed objects
- Worker deployments: at most 1, triggered by main
- Post-deployment smoke attempts: 1
- Live paid-provider calls: 0

## OutageIssue

- Stable title: `[uptime] amblefinds.com is unhealthy`
- First/last failed timestamps
- Failing target and sanitized error summary
- GitHub workflow run URL and run identity
- State: `open` or `closed-recovered`

Exactly one matching issue may be open. A healthy daily check comments with recovery evidence and
closes it.

## IncidentDiagnosis

- Issue number and run identity
- One of: `code`, `configuration`, `quota`, `dns`, `external-provider`, `unknown`
- One bounded diagnostic-check result
- Changed files and relevant test evidence, if code-correctable
- Remaining owner action

The diagnosis may create a tested commit on `develop`; it cannot create a production transition.
