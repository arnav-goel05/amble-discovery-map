<!--
Sync Impact Report
- Version change: 2.5.0 -> 2.6.0
- Modified principles:
  - Testable, Secure Changes: credentials, authorization material, cookies, and raw audio
    are explicitly prohibited from every diagnostic surface.
  - Product, Data, and Privacy Constraints: added an owner-approved, explicit,
    local-development-only content diagnostic exception for Feature 004. It is disabled by
    default, unavailable in production, non-persistent, session-bounded, and redacted.
  - Development and Release Workflow: review must reject production content tracing,
    implicit activation, persistent debug capture, or logging of prohibited secret/audio
    material.
- Added sections: none.
- Removed sections: none.
- Templates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
  - ✅ .specify/templates/commands/ (directory absent; no command templates to update)
- Dependent artifacts:
  - ✅ AGENTS.md (reviewed; no runtime-command change required)
  - ✅ README.md (reviewed; no architecture overview change required before implementation)
  - ✅ docs/production-configuration.md
  - ✅ specs/004-conversational-voice-map/{spec,plan,research,data-model,quickstart}.md
  - ✅ specs/004-conversational-voice-map/contracts/realtime-relay.md
  - ✅ specs/004-conversational-voice-map/tasks.md
- Deferred items: none.
-->

# What's Here Constitution

## Core Principles

### I. Evidence Before Publication

Every published event, venue, restaurant, and deal MUST be traceable to an approved,
authoritative source. Venue publication MUST include an approved geographic match and
supporting OneMap identity or tile evidence. Restaurant deals and event details MUST link
back to an official source page. Ambiguous venue matches MUST complete the automated
recovery process and then receive manual approval in the private admin interface before
publication. Missing optional fields MUST remain empty or display "Not available"; the
system MUST NOT invent values. Evidence and decisions MUST be retained in reusable,
versioned registries so approved research is not repeated.

Rationale: incorrect locations and fabricated details directly undermine a map-based
discovery product and are more harmful than incomplete data.

### II. Deterministic Automation Owns Workflow

Repeatable work MUST be implemented in executable, resumable code rather than left to
agent interpretation. Agents MAY intervene only for genuine ambiguity or changed external
contracts, and their decisions MUST be emitted as structured evidence that deterministic
code validates before use. Pipelines MUST define bounded retries, explicit success and
failure states, status reports, and safe resume behavior. A full pipeline command MUST run
through collection, normalization, resolution, publication stages, verification, and
finalization unless a documented external blocker remains.

Rationale: executable contracts make weekly operation reliable across people and models.

### III. Stable Identity and Atomic Reconciliation

Published entities MUST use stable source and location identities. Every reconciliation
MUST classify data as create, update, no-op, expire, or review. Unchanged records MUST be
reused without extraction or rewriting; changed event content MUST replace the matching
stable event rather than create duplicates. Expired events MUST be removed, while a
pipeline-managed location MUST remain until it has no current or future events. Undated
events MUST be held for review instead of being deleted speculatively. New snapshots MUST
be staged and verified before atomic publication. An unresolved source, event, or venue
branch MUST carry forward its still-valid approved identities or hold only the affected new
identities; it MUST NOT delete, replace, or block unrelated safe identities. A release-wide
failure that makes the assembled snapshot invalid, internally inconsistent, unsafe, or
unverifiable MUST preserve the last approved production dataset.

Rationale: stable reconciliation prevents duplicate highlights, stale events, visual
layering defects, and partially published production state.

### IV. Domain Boundaries, Shared Capabilities, and Explicit Contracts

Event discovery, venue resolution, map presentation, planning and games, restaurant
discovery, persistence, and external adapters MUST have explicit ownership boundaries.
Business rules SHOULD be pure and independently testable; network, filesystem, database,
map, and browser work MUST remain in thin boundary adapters. External input MUST be
validated at its boundary, and persisted formats MUST carry an explicit schema version
when they can evolve. UI components MUST own their structure and interaction behavior;
pipelines supply validated data and MUST NOT generate component-specific markup. Venue-
specific behavior MAY exist only in reviewed evidence registries or test fixtures.

Every user-facing application capability MUST be represented by a versioned, typed command
or query contract in one capability registry shared by direct UI controls, conversational
interfaces, and any external protocol adapter. Queries MUST read authoritative application
or approved-catalogue state and return bounded, validated domain results with stable
identities. Commands MUST execute through the same business executor used by direct
controls and return a validated observable outcome rather than a success assertion alone.
After every state-changing command, the application MUST publish refreshed authoritative
interface context, and assistant tool eligibility MUST be derived from that current state.
Local, preview, test, and production environments MUST expose semantically equivalent
catalogue and capability contracts; approved data and environment policy MAY differ.

MCP and other external protocols MAY expose the shared capability registry, but they MUST
remain thin adapters. They MUST NOT duplicate application business rules or bypass
validation, provenance, authorization, confirmation, privacy, or lifecycle controls. A new
or changed user-facing capability is incomplete until the capability inventory and
automated parity coverage prove that direct and conversational entry points reach the same
observable result, including failure and unavailable-state behavior.

Rationale: one authoritative capability architecture prevents UI/assistant drift, gives
conversational interfaces enough grounded state to complete tasks, and keeps optional
integration protocols from becoming a second application backend.

### V. Testable, Secure Changes

Every production change MUST pass the production build and all relevant automated tests
before it is complete. Changed behavior MUST have regression coverage for its success,
failure, recovery, and lifecycle paths in proportion to risk. Publication and migration
changes MUST test rollback or recovery. Secrets and privileged credentials MUST remain
server-side and outside the repository. Credentials, API keys, authorization headers,
cookies, session tokens, signing material, and raw audio MUST NOT be written to
operational or diagnostic logs in any environment. External URLs and content MUST be constrained by
provenance, robots rules, request limits, and server-side request-forgery protections.
Anonymous public users MUST NOT gain administrative capability. The single private admin
account MUST use authenticated sessions and securely managed password credentials.

Rationale: a public service needs proof of correctness and secure defaults, not informal
confidence.

### VI. Intentional UX and Performance

The public experience SHOULD work in current Chrome, Safari, Firefox, and Edge on desktop
and mobile. Automated desktop/mobile Chromium, WebKit, and Firefox coverage MUST be the
required compatibility release gate; branded-browser, simulator, and emulator checks are
optional supporting evidence and MUST NOT block a release when unavailable. Apple Human
Interface Guidelines MUST inform hierarchy, spacing, clarity,
feedback, touch targets, and motion while preserving the What's Here identity and
cross-browser behavior. Reusable singleton components MUST provide consistent event pills,
panels, planning, restaurant, loading, empty, stale, and error states. Continuous polling,
animation, layout measurement, or hidden rendering work MUST NOT be introduced without a
measured need. Performance-sensitive changes MUST record a before-and-after benchmark and
MUST restore full visual quality after temporary movement optimizations. Accessibility is
a best-effort design consideration, not a release gate.

Rationale: map usability depends on responsiveness and visual restraint, but the project
does not impose a fixed initial-load deadline.

### VII. Simplicity and Operational Clarity

The smallest design that completely satisfies the contract MUST be preferred. New modules
SHOULD remain below 400 lines; when materially changing a larger module, a coherent
responsibility SHOULD be extracted when this lowers risk. Generated artifacts MUST be
clearly classified: approved event and venue datasets required for reproducible deployment
MUST be version-controlled, while downloads, caches, intermediate runs, and routine reports
MUST remain untracked. Operational commands MUST be idempotent, documented, and safe to
resume. Complexity, new dependencies, background workers, and permanent caches MUST each
have a stated owner and justification.

Rationale: the system must remain understandable enough for reliable weekly operation and
future iteration.

## Product, Data, and Privacy Constraints

- The service is a public production product for Singapore residents and tourists.
- Public event discovery and plan creation MUST remain anonymous and MUST NOT require an
  account.
- Only free services, free APIs, and open data MAY be used. Paid services and paid fallback
  paths are prohibited except for the narrow exception below. A source that ceases to be
  usable for free MUST be disabled until a free replacement is approved.
- The OpenAI Realtime API MAY be used only for the conversational voice and map assistant
  defined in `specs/004-conversational-voice-map/`. This exception was approved by the
  project owner on 2026-07-18 and does not authorize any other paid API or paid fallback.
  Before implementation research begins, the plan MUST name an operational owner and define
  concrete usage and spending limits. Before production use, server-side credential
  handling, an immediate service-disable control, limit-exhaustion behavior, and equivalent
  text and direct-interface fallbacks MUST be implemented and verified. The application
  MUST NOT impose or transmit a per-response output-token ceiling for this Realtime
  experience; responses use the provider/model intrinsic maximum. That intrinsic maximum
  MAY be pinned solely as the conservative budget-reservation bound and MUST be updated
  with reviewed provider evidence when the approved model changes. Session duration,
  response-count, idle, context, spending, interruption, and kill-switch boundaries remain
  mandatory.
- Event and restaurant/deal collection MUST run weekly. Each event run MUST cover at least
  the run date through the following seven days and MAY retain all active and future events
  exposed by configured bounded source surfaces.
- Conversational search and discovery MUST query approved application catalogue data and
  MUST NOT perform open-web research at runtime unless a separately specified and
  owner-approved constitutional exception defines its provenance, cost, security, privacy,
  latency, failure, and fallback boundaries.
- When an external source is unavailable, the last approved data MAY remain visible but
  MUST be clearly marked as potentially outdated.
- Telegram photos and related personal verification data MUST be deleted when the associated
  challenge session reaches `completed`, `timed_out`, `quit`, or `revoked`. Completion of an
  individual mission is not the retention boundary. Data for a challenge session abandoned
  before a terminal state MUST be deleted within seven days. Image bytes MUST NOT be retained.
- Inactive anonymous plans MUST be deleted within seven days.
- The product MUST NOT collect user analytics or product telemetry. Minimal operational
  logs MAY be retained only for reliability and security and MUST avoid unnecessary
  personal data.
- Feature 004 MAY emit content-bearing diagnostic records only in an explicitly activated
  local-development session owned by the developer. This exception MUST default off, MUST
  be structurally unavailable in production and preview deployments, MUST write only to
  the active local process output, MUST stop when that process or voice session ends, and
  MUST NOT create application files, database rows, caches, browser storage, remote
  telemetry, or background uploads. It MAY include transcripts, prompts, tool arguments
  and results, and redacted provider/browser event bodies needed to reproduce a defect.
  Credentials, API keys, authorization material, cookies, session tokens, signing
  material, and raw audio remain prohibited. Audio events MAY record only byte counts,
  timing, format, and lifecycle metadata. Production and preview MUST retain the closed
  privacy-safe operational phase schema defined by Feature 004.
- Initial production deployment targets one application host and local durable storage.
  Automatic daily backups are not required. Any future multi-host design is a separately
  specified architectural change.

## Development and Release Workflow

1. New feature work MUST be performed on the `develop` branch. Agents and automation MUST
   NOT create or switch to another branch unless the user explicitly requests a different
   branch or explicitly authorizes creating one.
2. A change starts with a testable specification containing bounded scope, acceptance
   scenarios, failure behavior, data lifecycle, measurable outcomes, and the typed
   command/query contracts for every affected user-facing capability.
3. The implementation plan MUST pass every Constitution Check before research or coding.
   Any exception MUST be documented in Complexity Tracking with a rejected simpler option.
4. Tasks MUST include relevant automated tests, data/provenance handling, privacy cleanup,
   security controls, lifecycle reconciliation, documentation, performance validation,
   capability-inventory updates, direct/conversational parity coverage, rich query-result
   validation, post-command context synchronization, and local/production contract parity.
5. Generated data MUST be staged separately from the approved production snapshot.
6. Publication requires source validation, identity and geometry checks where applicable,
   the production build, all relevant automated tests, complete affected capability
   coverage, environment-parity verification, and successful finalization.
7. Every run MUST report unresolved work. Isolated source, event, deduplication, or venue
   uncertainty MUST preserve or hold only its affected identities while safe identities MAY
   publish in the same atomically verified snapshot. A failure that makes the assembled
   snapshot invalid, internally inconsistent, unsafe, or unverifiable MUST preserve the
   last approved production state. A run MUST NOT be labeled fully successful merely
   because finalization executed.
8. Code review MUST reject fabricated evidence, venue-specific hardcoding outside approved
   registries or fixtures, unbounded recovery loops, silent data loss, unverified
   generated-data changes, duplicated UI/assistant business logic, success-only tool
   results, stale post-command assistant context, and untested capability drift. For the
   approved Realtime exception, review MUST also reject application-generated
   `max_output_tokens` fields or equivalent per-response token ceilings in provider session
   or response requests. Review MUST also reject content-bearing voice diagnostics outside
   explicitly activated local development, any production/preview activation path,
   persistent debug capture, or diagnostic output containing credentials, authorization
   material, cookies, session tokens, signing material, or raw audio.

## Governance

This constitution supersedes conflicting repository practices and generated guidance.
Amendments require a written rationale, an impact review of dependent templates and runtime
documentation, approval by the project owner, and a migration plan for any affected data or
workflow. Version changes follow semantic versioning: MAJOR for incompatible principle or
governance changes, MINOR for new principles or materially expanded obligations, and PATCH
for non-semantic clarification. Every specification, plan, implementation review, and
release MUST verify compliance. Unjustified violations block completion. Runtime-specific
instructions remain in `AGENTS.md` and domain documentation but MUST conform to this file.

**Version**: 2.6.0 | **Ratified**: 2026-07-14 | **Last Amended**: 2026-07-29
