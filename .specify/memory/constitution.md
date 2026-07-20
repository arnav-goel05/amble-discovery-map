<!--
Sync Impact Report
- Version change: 2.2.0 -> 2.3.0
- Modified principles:
  - III. Stable Identity and Atomic Reconciliation: isolated source/event uncertainty now
    carries forward or holds only affected identities; release-wide failures still roll back.
  - Product, Data, and Privacy Constraints: weekly runs may retain all active and future
    events while continuing to cover the mandatory current seven-day period.
  - Development and Release Workflow: publication gates now distinguish branch-level
    isolation from failures that make the assembled snapshot unsafe.
- Added sections: none.
- Removed sections: none.
- Templates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
  - ✅ .specify/templates/commands/ (directory absent; no command templates to update)
- Dependent artifacts:
  - ✅ AGENTS.md
  - ✅ docs/weekly-operations.md
  - ✅ specs/002-add-web-event-sources/policy-review.md
  - ✅ specs/002-add-web-event-sources/{spec,plan,research,data-model,quickstart,tasks}.md
  - ✅ specs/002-add-web-event-sources/contracts/rendered-event-source.md
- Deferred items: runtime runner references remain aligned to current implementation until
  implementation tasks T141-T142 update them with the approved v3 behavior.
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

### IV. Domain Boundaries and Explicit Contracts

Event discovery, venue resolution, map presentation, planning and games, restaurant
discovery, persistence, and external adapters MUST have explicit ownership boundaries.
Business rules SHOULD be pure and independently testable; network, filesystem, database,
map, and browser work MUST remain in thin boundary adapters. External input MUST be
validated at its boundary, and persisted formats MUST carry an explicit schema version
when they can evolve. UI components MUST own their structure and interaction behavior;
pipelines supply validated data and MUST NOT generate component-specific markup. Venue-
specific behavior MAY exist only in reviewed evidence registries or test fixtures.

Rationale: clear contracts reduce accidental coupling in a product with multiple data and
interaction pipelines.

### V. Testable, Secure Changes

Every production change MUST pass the production build and all relevant automated tests
before it is complete. Changed behavior MUST have regression coverage for its success,
failure, recovery, and lifecycle paths in proportion to risk. Publication and migration
changes MUST test rollback or recovery. Secrets and privileged credentials MUST remain
server-side and outside the repository. External URLs and content MUST be constrained by
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
  text and direct-interface fallbacks MUST be implemented and verified.
- Event and restaurant/deal collection MUST run weekly. Each event run MUST cover at least
  the run date through the following seven days and MAY retain all active and future events
  exposed by configured bounded source surfaces.
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
- Initial production deployment targets one application host and local durable storage.
  Automatic daily backups are not required. Any future multi-host design is a separately
  specified architectural change.

## Development and Release Workflow

1. New feature work MUST be performed on the `develop` branch. Agents and automation MUST
   NOT create or switch to another branch unless the user explicitly requests a different
   branch or explicitly authorizes creating one.
2. A change starts with a testable specification containing bounded scope, acceptance
   scenarios, failure behavior, data lifecycle, and measurable outcomes.
3. The implementation plan MUST pass every Constitution Check before research or coding.
   Any exception MUST be documented in Complexity Tracking with a rejected simpler option.
4. Tasks MUST include relevant automated tests, data/provenance handling, privacy cleanup,
   security controls, lifecycle reconciliation, documentation, and performance validation.
5. Generated data MUST be staged separately from the approved production snapshot.
6. Publication requires source validation, identity and geometry checks where applicable,
   the production build, all relevant automated tests, and successful finalization.
7. Every run MUST report unresolved work. Isolated source, event, deduplication, or venue
   uncertainty MUST preserve or hold only its affected identities while safe identities MAY
   publish in the same atomically verified snapshot. A failure that makes the assembled
   snapshot invalid, internally inconsistent, unsafe, or unverifiable MUST preserve the
   last approved production state. A run MUST NOT be labeled fully successful merely
   because finalization executed.
8. Code review MUST reject fabricated evidence, venue-specific hardcoding outside approved
   registries or fixtures, unbounded recovery loops, silent data loss, and unverified
   generated-data changes.

## Governance

This constitution supersedes conflicting repository practices and generated guidance.
Amendments require a written rationale, an impact review of dependent templates and runtime
documentation, approval by the project owner, and a migration plan for any affected data or
workflow. Version changes follow semantic versioning: MAJOR for incompatible principle or
governance changes, MINOR for new principles or materially expanded obligations, and PATCH
for non-semantic clarification. Every specification, plan, implementation review, and
release MUST verify compliance. Unjustified violations block completion. Runtime-specific
instructions remain in `AGENTS.md` and domain documentation but MUST conform to this file.

**Version**: 2.3.0 | **Ratified**: 2026-07-14 | **Last Amended**: 2026-07-18
