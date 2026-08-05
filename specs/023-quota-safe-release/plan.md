# Implementation Plan: Quota-Safe Direct Release Pipeline

**Branch**: `develop` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

## Summary

Split automation into a zero-production-access ordinary CI mode and an explicitly invoked
release mode. Ordinary CI uses a compact, checked-in geometry contract, comprehensive local
logic tests, broad Chromium interaction coverage, targeted mobile coverage, and a local
production build. Release verification pins one immutable `develop` SHA, hydrates approved
production geometry once, runs the complete six-project browser and production gates, then
fast-forwards `main` to that exact SHA. A `main` update remains the sole Cloudflare deployment
trigger. A once-daily uptime workflow opens one deduplicated issue; a later Codex automation
may prepare a tested fix on `develop` but cannot release it.

## Technical Context

**Language/Version**: Node.js 24, ECMAScript modules, GitHub Actions YAML

**Primary Dependencies**: npm, Node test runner, Playwright 1.61, Vite 8, Wrangler 4,
GitHub Actions, Cloudflare Workers/R2

**Storage**: Checked-in JSON/binary test fixtures; GitHub workflow and issue state; existing
Cloudflare R2 and deployment state

**Testing**: `node --test`, ESLint, Prettier changed-file checks, Playwright Chromium/WebKit/
Firefox desktop and mobile projects, production build and bounded deployment smoke checks

**Target Platform**: GitHub-hosted Ubuntu runners, Cloudflare Workers/R2, modern desktop and
mobile browsers

**Project Type**: Single web application with automation scripts and Cloudflare worker

**Performance Goals**: Superseded ordinary runs cancel; fixture remains below 10 MiB; ordinary
CI makes zero production-service requests; uptime and post-deploy checks execute once

**Constraints**: No pull request requirement, no automatic main update outside explicit
release, no force push, no high-cardinality public probes, no live paid-provider tests, no
new paid services, and failure preserves main and production

**Scale/Scope**: Two protected long-lived branches, 100+ Node test files, 19 Playwright specs,
six release browser projects, one production host, and one daily incident lifecycle

## Constitution Check

_Gate result before research: PASS. Re-check after design: PASS._

- **Branch workflow**: All work remains on `develop`; no feature branch is created.
- **Evidence**: Git SHA, checked-in fixture hashes, approved production geometry manifests,
  workflow check conclusions, R2 control-plane inventory, Wrangler deployment output, and the
  bounded production smoke response are authoritative. Missing/corrupt evidence fails closed.
- **Automation**: Node scripts enforce fixture integrity, CI policy, immutable candidate
  identity, ancestry, and budgets. GitHub Actions orchestrates deterministic commands. Codex is
  limited to one issue-scoped diagnostic pass and tested `develop` fixes.
- **Identity and publication**: The immutable commit SHA is the release identity. A failed or
  incomplete gate performs no branch or deployment mutation. Promotion is an exact fast-forward;
  Cloudflare retains its existing change-only geometry synchronization and fresh verification.
- **Boundaries**: Git owns revision state, GitHub Actions owns gate state, Cloudflare owns runtime
  and R2 state, and GitHub Issues owns incident state. Scripts are thin validated adapters.
- **Shared capabilities**: No product capability contract changes. Existing event, voice, map,
  and plan capabilities are exercised through their current production-equivalent entry points.
- **Quality and security**: Ordinary CI has a zero-request production budget. Release permits one
  full hydration pass, bounded R2 control-plane inventory (one visitor-facing integrity request),
  no Cloudflare duplicate tests, one application build, one deployment, and one post-deployment smoke pass. Uptime permits at most
  one application attempt. Secrets remain in GitHub/Cloudflare stores and are never reported.
- **UX and performance**: Ordinary CI provides broad Chromium desktop interaction plus targeted
  mobile coverage. Release runs Chromium, WebKit, and Firefox desktop/mobile and the existing
  rendering/performance gates. No UI implementation changes are required.
- **Operations and privacy**: No new provider, telemetry, or content-bearing diagnostics are
  introduced. Reports contain technical identifiers and bounded sanitized evidence only.

## Project Structure

### Documentation

```text
specs/023-quota-safe-release/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Implementation

```text
.github/workflows/
├── ci.yml
├── release-production.yml
└── production-uptime.yml

.agents/skills/release-production/
├── SKILL.md
└── agents/openai.yaml

scripts/
├── prepare-ci-geometry-fixture.mjs
├── verify-ci-policy.mjs
├── verify-ci-geometry-fixture.mjs
└── verify-release-candidate.mjs

tests/
├── ci-cd-policy.test.mjs
└── fixtures/geometry-release/

AGENTS.md
main.js
package.json
playwright.config.mjs
vite.config.cjs
```

**Structure Decision**: Keep automation alongside the repository's existing workflows,
scripts, Node tests, and repository-local agent skills. No new application subsystem or
dependency is warranted.

## Complexity Tracking

No constitution violations require justification.
