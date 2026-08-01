# Tasks: Quota-Safe Direct Release Pipeline

**Input**: Design documents in `specs/023-quota-safe-release/`

**Tests**: Required because the feature is an automation safety boundary. Policy, fixture,
candidate identity, schedule, mutation, and quota behavior must be executable.

## Phase 1: Setup

- [x] T001 Confirm the worktree remains on `develop` and record unrelated user changes without modifying them
- [ ] T002 [P] Add CI/release script entries to `package.json` without changing application dependencies
- [ ] T003 [P] Add feature validation commands and expected evidence to `specs/023-quota-safe-release/quickstart.md`

---

## Phase 2: Foundational safety controls

- [ ] T004 Add failing workflow-policy and release-candidate tests in `tests/ci-cd-policy.test.mjs`
- [ ] T005 Add deterministic workflow policy validation in `scripts/verify-ci-policy.mjs`
- [ ] T006 Add exact-SHA, develop-head, main-ancestry, and ref-race validation in `scripts/verify-release-candidate.mjs`
- [ ] T007 Add quota budgets and fail-closed forbidden-operation checks to the policy tests and scripts
- [ ] T008 Update `AGENTS.md` with direct-push, no-PR, no-main, explicit-release, and no-unrequested-push rules

**Checkpoint**: Policy and release identity controls pass locally before workflows use them.

---

## Phase 3: User Story 1 - Quota-safe everyday validation (Priority: P1)

**Goal**: Run comprehensive routine checks without production hydration, mutation, providers, or deployment.

**Independent Test**: `npm run ci:local` and `npm run ci:policy` pass with production request budget zero.

### Tests for User Story 1

- [ ] T009 [P] [US1] Add compact geometry fixture success and failure cases under `tests/fixtures/geometry-release/`
- [ ] T010 [P] [US1] Add fixture manifest integrity, roles, separation, corrupt, missing, hash, size, and production-URL tests in `tests/geometry-ci-fixture.test.mjs`
- [ ] T011 [US1] Add deterministic fixture verification in `scripts/verify-ci-geometry-fixture.mjs`
- [ ] T012 [US1] Prove the fixture verifier fails closed for every required negative case in `tests/geometry-ci-fixture.test.mjs`

### Implementation for User Story 1

- [ ] T013 [US1] Replace production hydration and remote R2 checks in `.github/workflows/ci.yml` with fixture verification and zero-external policy validation
- [ ] T014 [US1] Run all Node tests, lint, formatting, production-equivalent local build, and broad Chromium desktop specs in `.github/workflows/ci.yml`
- [ ] T015 [US1] Add a targeted Chromium mobile suite for discovery, voice, plan, and responsive device behavior in `.github/workflows/ci.yml`
- [ ] T016 [US1] Make ordinary CI cover pushes to `develop` and explicitly created non-main branches, cancel superseded revisions, and never deploy
- [ ] T017 [US1] Disable runtime production tile fallback during browser CI and verify no production geometry URL is requested

**Checkpoint**: Ordinary CI is comprehensive but records zero production-service operations.

---

## Phase 4: User Story 2 - Deliberate exact-revision release (Priority: P2)

**Goal**: Fully verify one immutable develop SHA, then fast-forward main and let main deploy once.

**Independent Test**: Candidate guard and workflow contract tests prove failures cannot mutate main and success promotes the identical SHA.

### Tests for User Story 2

- [ ] T018 [P] [US2] Test invalid SHA, stale develop head, divergent main, changed refs, and exact promotion command behavior in `tests/ci-cd-policy.test.mjs`
- [ ] T019 [P] [US2] Test the release workflow contains every full gate and bounded budget but no per-object public HEAD loop
- [ ] T020 [P] [US2] Test that only a main update can activate the production deploy path

### Implementation for User Story 2

- [ ] T021 [US2] Add explicit `candidate_sha` release orchestration in `.github/workflows/release-production.yml`
- [ ] T022 [US2] Add one production geometry hydration, local/background separation, bounded R2 inventory, production build, render, performance, and six-project browser gates
- [ ] T023 [US2] Revalidate remote develop/main identities and fast-forward the exact tested SHA to main without force or pull request
- [ ] T024 [US2] Record the release external-operation budget and keep deployment exclusively tied to main
- [ ] T025 [US2] Read the `skill-creator` instructions and scaffold `.agents/skills/release-production/` using its required generator
- [ ] T026 [US2] Implement the reusable release skill so Codex and manual dispatch use the same workflow and never bypass a failed gate
- [ ] T027 [US2] Adjust GitHub branch safeguards to permit direct pushes while retaining no-force/no-delete and required checks

**Checkpoint**: Release verification is deliberate, race-safe, exact-revision, and deployment-exclusive.

---

## Phase 5: User Story 3 - Daily outage issue and safe fix preparation (Priority: P3)

**Goal**: Check once daily, maintain one outage issue, and let Codex prepare only tested develop fixes.

**Independent Test**: Workflow tests simulate health, first failure, duplicate failure, and recovery; automation instructions prohibit release mutations.

### Tests for User Story 3

- [ ] T028 [P] [US3] Test 09:00 Singapore cron, one attempt, deduplicated issue, recovery close, and no rollback/redeploy in `tests/ci-cd-policy.test.mjs`
- [ ] T029 [P] [US3] Test the incident prompt's no-issue exit, single diagnostic pass, develop-only tested fix, and prohibited operations

### Implementation for User Story 3

- [ ] T030 [US3] Update `.github/workflows/production-uptime.yml` to run once daily at 09:00 Singapore and enrich sanitized failure evidence without retry
- [ ] T031 [US3] Preserve one deduplicated outage issue and document/close recovery on a later healthy daily check
- [ ] T032 [US3] Create the daily 09:15 Singapore Codex automation with the validated incident contract

**Checkpoint**: Monitoring is quota-bounded and automated repair cannot release itself.

---

## Phase 6: Documentation and end-to-end validation

- [ ] T033 [P] Update operational CI/CD documentation with test tiers, budgets, manual release, deployment, uptime, and incident behavior
- [ ] T034 Run formatter, lint, full Node tests, fixture tests, policy tests, local build, and relevant Chromium desktop/mobile tests
- [ ] T035 Run SpecKit analysis across spec, plan, tasks, contracts, and implementation; remediate every finding
- [ ] T036 Repeat policy, automated tests, and SpecKit analysis until no issue remains
- [ ] T037 Review the final diff for unrelated-file preservation, secrets, forbidden endpoints, workflow permissions, and unrequested pushes/deployments

---

## Dependencies and Execution Order

- Setup precedes foundational controls.
- Foundational controls block every user story because workflows must consume tested policy.
- US1 establishes ordinary checks consumed by US2.
- US2 and US3 are operationally independent after US1, but are implemented sequentially to keep
  workflow-policy evidence easy to audit.
- Documentation and final validation depend on all stories.

## Parallel Opportunities

- T002 and T003 are independent.
- T009 and T010 can proceed together after the fixture schema is fixed.
- T018, T019, and T020 are independent contract tests.
- T028 and T029 cover separate operational artifacts.
- T033 can begin after workflow interfaces stabilize.

## Implementation Strategy

Deliver the smallest safe vertical slice first: executable policy plus fixture-backed ordinary CI.
Then add exact-revision release promotion and finally daily incident handling. Each checkpoint must
be locally testable without mutating GitHub branches, Cloudflare production, or provider state.
