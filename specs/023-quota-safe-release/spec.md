# Feature Specification: Quota-Safe Direct Release Pipeline

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-08-01

**Status**: Approved for implementation

**Input**: User description: "Implement a direct-push develop-to-main CI/CD workflow with quota-safe ordinary tests, deliberate release verification, automatic Cloudflare deployment, daily uptime issue creation, and daily Codex-assisted incident remediation."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Validate Everyday Changes Without Spending Production Quotas (Priority: P1)

As the repository owner, I can commit and push changes directly to `develop` or an explicitly requested feature branch without creating a pull request, and receive relevant automated validation that does not hydrate production geometry, mutate production data, deploy code, or call paid providers.

**Why this priority**: This is the routine workflow and the primary protection against exhausting production request, storage, provider, and build allowances.

**Independent Test**: Push a representative change to a non-production branch and verify that all ordinary validation completes against compact local evidence while recorded production-service request and mutation counts remain zero.

**Acceptance Scenarios**:

1. **Given** a change on `develop`, **When** the owner requests commit and push, **Then** the current branch is pushed directly without a pull request or any update to `main`.
2. **Given** an explicitly requested feature branch, **When** the branch is pushed, **Then** the same quota-safe validation runs without creating a pull request.
3. **Given** ordinary validation, **When** geometry-dependent checks execute, **Then** they use a compact checked-in fixture and cannot silently fall back to production geometry.
4. **Given** a superseded branch revision, **When** a newer revision starts validation, **Then** obsolete work is cancelled so capacity is not wasted.

---

### User Story 2 - Deliberately Release the Exact Tested Revision (Priority: P2)

As the repository owner, I can explicitly promote the latest approved `develop` revision to `main` without a pull request, only after the exact revision passes the complete release gate, after which production deploys automatically.

**Why this priority**: Production must remain deliberate, reproducible, and protected from untested commits while preserving the requested no-PR workflow.

**Independent Test**: Select an exact `develop` revision, run release verification, and prove that failure leaves `main` and production unchanged while success permits a fast-forward of `main` to the identical tested revision and initiates one deployment.

**Acceptance Scenarios**:

1. **Given** a passing `develop` revision and an explicit release request, **When** release verification succeeds, **Then** `main` advances to that exact revision without a new merge commit or pull request.
2. **Given** any failing release check, **When** release verification finishes, **Then** `main`, production, and the last approved deployment remain unchanged.
3. **Given** `main` is not an ancestor of the release candidate, **When** release is attempted, **Then** promotion stops and reports the divergence instead of manufacturing an untested merge.
4. **Given** `main` advances successfully, **When** deployment runs from its clean checkout, **Then** it relies on the release gate's single approved remote-geometry verification, repeats no GitHub test suite, compiles the promoted application once, uploads it once, and checks it once before success is reported.

---

### User Story 3 - Detect and Prepare a Safe Outage Fix (Priority: P3)

As the repository owner, I receive one actionable issue when the daily production check detects an outage, and a later daily automation diagnoses the issue and may prepare a validated fix on `develop` without changing production.

**Why this priority**: Automated diagnosis shortens recovery time while keeping production changes under explicit owner control.

**Independent Test**: Simulate one failed daily check, verify that exactly one outage issue is opened, then run the incident automation and confirm it either prepares a tested `develop` fix or records a non-code diagnosis without updating `main`.

**Acceptance Scenarios**:

1. **Given** production is healthy, **When** the daily check runs once, **Then** no issue or recovery action is created.
2. **Given** production is unhealthy, **When** the daily check runs once, **Then** one deduplicated outage issue records the failure and no retry, rollback, or deployment occurs.
3. **Given** an outage issue and a code-correctable cause, **When** incident automation completes and relevant tests pass, **Then** it may commit and push the fix to `develop` and documents the evidence on the issue.
4. **Given** an outage caused by configuration, quota, DNS, or an external provider, **When** incident automation completes, **Then** it records the diagnosis and required owner action without inventing a code change.
5. **Given** a prepared outage fix, **When** no explicit release instruction exists, **Then** `main` and production remain unchanged.

### Edge Cases

- A release request targets a `develop` revision that changes while verification is running.
- Ordinary validation attempts to access a production geometry or provider endpoint.
- The compact fixture is incomplete, corrupt, or accidentally too large for routine use.
- A release passes ordinary validation but fails production geometry, staged browser, or production-build checks.
- Production deployment partially synchronizes mutable objects before a later gate fails.
- The daily check fails while an outage issue is already open.
- The daily incident automation runs before the outage workflow has completed.
- The automation cannot authenticate to the repository or cannot safely classify the cause.
- `main` and `develop` diverge or a force-push changes a previously verified identity.
- External allowance exhaustion prevents release verification or deployment.

## Scope and Constraints _(mandatory)_

- **In scope**: Direct branch pushes without automatic pull requests; quota-safe ordinary validation; compact checked-in geometry evidence; deliberate full release verification; exact-revision promotion from `develop` to `main`; automatic production deployment from `main`; one daily production check at 09:00 Singapore time; one daily incident automation at 09:15 Singapore time; outage issue lifecycle; repository release instructions and reusable release procedure.
- **Out of scope**: Automatic production rollback; automatic incident promotion to `main`; paid monitoring services; live provider tests; high-cardinality public object probing; automatic branch creation; automatic pull-request creation; deployment from non-production branches.
- **Evidence and dependencies**: The repository, its approved geometry manifests, checked-in test evidence, branch identities, validation results, deployment reports, and production health responses are authoritative. Quota-limited platforms must use bounded inventory or control-plane evidence. No new paid service is authorized.
- **Privacy and lifecycle**: Validation and incident reports must exclude credentials, authorization material, cookies, personal data, raw audio, and provider secrets. Operational reports retain only bounded technical evidence needed to diagnose and reproduce failures.
- **Experience**: The workflow is optimized for a solo repository owner. Direct development remains fast, release remains an explicit act, and failures provide concise actionable evidence.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST default repository work to `develop` and MUST NOT create or switch branches unless explicitly requested.
- **FR-002**: An ordinary commit-and-push request MUST push directly to the current branch without creating a pull request.
- **FR-003**: An ordinary development action MUST NOT update `main` or start a production deployment.
- **FR-004**: Ordinary validation MUST run for `develop` and explicitly created feature branches.
- **FR-005**: Ordinary validation MUST cover formatting, linting, all local logic and integration tests, event-source contracts, voice capability parity, geometry separation, and a production-equivalent local build.
- **FR-006**: Ordinary validation MUST use compact checked-in geometry evidence and MUST record zero production hydration, production mutation, live paid-provider, and deployment operations.
- **FR-007**: The compact geometry evidence MUST cover valid background, nested, point-of-interest, and event-highlight geometry plus missing, corrupt, hash-mismatch, and separation failure cases.
- **FR-008**: Ordinary validation MUST fail closed if a geometry-dependent check attempts to fall back to production evidence.
- **FR-009**: Superseded validation runs MUST be cancelled.
- **FR-010**: Full production geometry hydration MUST require an explicit release context and MUST NOT run in ordinary validation.
- **FR-011**: High-cardinality public object probes MUST be rejected in routine validation and deployment.
- **FR-012**: A release MUST target an immutable `develop` revision and MUST require an explicit owner action.
- **FR-013**: Release verification MUST include ordinary validation, production geometry validation, staged Chromium event-pipeline integration, bounded remote inventory checks, and a production-equivalent build.
- **FR-014**: Every release verification MUST report bounded production-service request, read, write, and deployment budgets.
- **FR-015**: A failed or incomplete release verification MUST leave `main` and production unchanged.
- **FR-016**: Promotion MUST stop when `main` cannot fast-forward to the exact verified revision.
- **FR-017**: Successful promotion MUST update `main` to the exact verified revision without a pull request or unverified merge commit.
- **FR-018**: Only updates to `main` MAY start production deployment.
- **FR-019**: Release verification MUST verify the already-approved remote geometry with one manifest-based inventory request. The connected production build MUST rely on that evidence, repeat no GitHub test or remote inventory gate, compile the promoted application once, upload it once, and perform one bounded post-deployment check without synchronizing ignored local B3DM files.
- **FR-020**: The production check MUST run once daily at 09:00 Singapore time with no immediate retry.
- **FR-021**: A failed daily production check MUST open one deduplicated outage issue containing the timestamp, failing target, failure evidence, and run identity, and MUST NOT roll back or redeploy.
- **FR-022**: A later healthy daily check MUST document recovery and close the matching open outage issue.
- **FR-023**: Incident automation MUST run once daily at 09:15 Singapore time and exit quietly when no matching outage issue is open.
- **FR-024**: When an outage issue is open, incident automation MUST perform one bounded diagnostic pass, classify the cause, and record its evidence.
- **FR-025**: Incident automation MAY commit and push a code fix to `develop` only after relevant tests pass.
- **FR-026**: Incident automation MUST NOT update `main`, deploy production, spend live provider allowance, or conceal unresolved work.
- **FR-027**: The same release gate MUST govern both owner-invoked and manually dispatched releases.
- **FR-028**: Branch safeguards MUST prohibit force pushes and deletion of `develop` and `main` while permitting the approved direct-push and exact-revision promotion workflow.
- **FR-029**: Documentation and repository agent instructions MUST describe the implemented workflow without contradicting automation behavior.
- **FR-030**: All reports and logs MUST exclude secrets and unnecessary personal or content-bearing data.

### Key Entities

- **Validation Run**: A bounded evaluation of one immutable revision, including mode, revision identity, local/remote evidence classification, checks, budgets, and outcome.
- **Geometry Fixture**: Compact checked-in evidence with explicit identity, object inventory, hashes, failure variants, and size/request ceilings.
- **Release Candidate**: The immutable `develop` revision selected for full verification and possible promotion.
- **Release Report**: Evidence that the candidate passed every required gate and stayed within declared external-operation budgets.
- **Deployment Record**: The promoted revision, deployed version identity, changed-object counts, bounded external operations, and post-deployment result.
- **Outage Issue**: The single open incident record for daily production-check failures and later recovery evidence.
- **Incident Diagnosis**: A bounded classification of an outage, supporting evidence, attempted safe changes, validation outcome, and remaining owner action.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Every ordinary branch validation completes with zero production geometry downloads, zero production data mutations, zero deployments, and zero live paid-provider calls.
- **SC-002**: The checked-in geometry evidence remains below 10 MiB while exercising every required valid and failure geometry scenario.
- **SC-003**: One immutable release revision has a single auditable result covering 100% of required release gates before production can change.
- **SC-004**: A failed release attempt causes zero changes to `main` and zero application deployments.
- **SC-005**: Every successful production deployment identifies the exact validated revision and completes one bounded post-deployment check.
- **SC-006**: Daily uptime monitoring performs exactly one application check attempt per run and creates no duplicate outage issues.
- **SC-007**: Incident automation performs no more than one diagnostic production check per daily incident run and never updates production.
- **SC-008**: Routine direct pushes require zero automatically created pull requests, while 100% of production updates remain explicitly owner initiated.
- **SC-009**: All required functional requirements have automated or executable validation evidence before the feature is complete.

## Assumptions

- The repository owner prefers fast-forward production promotion and accepts stopping when branch history diverges.
- Existing production credentials, remote bindings, and approved Cloudflare account configuration remain authoritative and are not copied into the repository.
- GitHub-hosted validation capacity is available, but superseded work must be cancelled and expensive release checks remain manual.
- A daily scheduled workflow uses UTC scheduling equivalent to 09:00 Singapore time, and incident automation uses the equivalent of 09:15 Singapore time.
- The incident automation has standing authority to commit and push validated fixes to `develop`, but not to promote or deploy them.
- Existing unrelated working-tree changes are user-owned and must be preserved.
