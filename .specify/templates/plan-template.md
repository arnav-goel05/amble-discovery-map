# Implementation Plan: [FEATURE]

**Branch**: `develop` unless the user explicitly requested another branch | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **Branch workflow**: Confirm work remains on `develop`, or cite the user's explicit
  instruction authorizing another branch.
- **Evidence**: Identify authoritative sources, provenance, approval boundaries, and how
  missing or ambiguous data is represented without fabrication.
- **Automation**: Assign deterministic workflow steps to code and bound any agent or manual
  intervention with structured inputs and outputs.
- **Identity and publication**: Define stable identities, create/update/no-op/expire/review
  behavior, per-identity carry-forward or hold behavior, staging, atomic publication, and
  release-wide rollback.
- **Boundaries**: Name domain owners, validated contracts, evolving schema versions, and
  thin external adapters.
- **Shared capabilities**: Inventory every affected user-facing capability; define its
  versioned command or query contract, authoritative state owner, bounded validated result,
  stable identities, contextual eligibility, post-command context refresh, and direct/
  conversational observable-state parity. Keep MCP or other protocols as thin adapters
  over the same registry, and verify semantic parity across local, test, preview, and
  production environments.
- **Conversational feedback**: Define the grounded dialogue matrix for success, no-op, empty,
  unavailable, failed, clarification, and confirmation outcomes; identify which verified labels,
  counts, settings, and currently eligible next steps each response may use.
- **Quality and security**: Identify required tests, build gates, recovery coverage,
  secret handling, administrative authorization, and external-content protections. Declare
  the maximum request count for every quota-limited production-platform check; use bounded
  binding or control-plane inventory instead of visitor-facing requests for exhaustive
  Cloudflare/R2 verification; require fresh per-run evidence after mutable-object operations,
  and define rate-limit stop behavior.
- **UX and performance**: Cover the required automated desktop/mobile Chromium, WebKit,
  and Firefox matrix, Apple HIG-informed interaction, consistent component states, and
  before/after benchmarks for rendering changes. Treat branded-browser checks as optional.
- **Operations and privacy**: Use free/open sources unless the constitution names a scoped
  exception. For an exception, cite its approval and define its operational owner, concrete
  usage and spending limits, credential boundary, disable control, limit-exhaustion behavior,
  and free fallback. For the Realtime exception, verify that provider requests contain no
  application-imposed output-token ceiling and that conservative reservations use only the
  reviewed provider/model intrinsic maximum. If content-bearing diagnostics are requested,
  prove they are explicit, local-development-only, disabled by default, unavailable in
  production/preview, session-bounded, and structurally redact credentials, authorization
  material, cookies, session tokens, signing material, and raw audio. If persistent local audit
  files are requested, prove the separate activation flag, fixed gitignored location, restrictive
  permissions, sanitized-before-write boundary, 5 MiB rotation, five-file maximum, seven-day
  deletion, and absence of databases, browser storage, remote sinks, or background uploads. Also
  define retention, cleanup, stale-data behavior, generated-artifact policy, and single-host
  constraints.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |
