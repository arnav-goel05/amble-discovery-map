# Feature Specification: Review Questionable Event Dates

**Working Branch**: `develop`

**Created**: 2026-07-22

**Status**: Ready for planning

**Input**: Automatically assess normalized event schedules for missing, malformed,
contradictory, stale, implausibly long, or placeholder dates and route affected identities
into the existing needs-review workflow before unreliable schedules influence downstream
event processing.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Isolate Questionable Schedules (Priority: P1)

As an event-pipeline operator, I can rely on every questionable schedule being retained with
an explicit review outcome instead of being published, discarded, or allowed to influence
schedule-sensitive processing.

**Why this priority**: Incorrect dates undermine event discovery, expiry, identity matching,
and publication even when the remaining event details are correct.

**Independent Test**: Process plausible, missing, malformed, contradictory, stale,
implausibly long, and placeholder schedules and verify that only questionable identities are
held for review with exact reason codes while plausible identities continue normally.

**Acceptance Scenarios**:

1. **Given** a normalized event has a plausible schedule, **When** date-quality assessment
   completes, **Then** its lifecycle and downstream eligibility remain unchanged.
2. **Given** a normalized event has no usable date or unparseable date evidence, **When**
   assessment completes, **Then** it is retained as needs review without an invented date.
3. **Given** start fields conflict, an interval is inverted or implausibly long, or a concrete
   date is implausibly distant or a known placeholder, **When** assessment completes, **Then**
   the affected identity is held with every applicable reason code.
4. **Given** one event is held for date review, **When** the run continues, **Then** unrelated
   safe events continue through deduplication, venue processing, and publication.

---

### User Story 2 - Trace and Reconcile Date Review (Priority: P2)

As an operator reviewing pipeline results, I can see how many identities were held, why each
was held, which source supplied it, and whether later corrected evidence cleared the review.

**Why this priority**: Review decisions must be actionable and must not create permanent or
duplicate queue entries.

**Independent Test**: Run the same identity with unchanged questionable evidence, corrected
evidence, and changed questionable evidence; verify stable review identity, bounded queue
growth, automatic recovery, terminal accounting, and source/reason summaries.

**Acceptance Scenarios**:

1. **Given** the same questionable evidence appears in another run, **When** review items are
   reconciled, **Then** the existing item is reused rather than duplicated.
2. **Given** authoritative source evidence later supplies a plausible schedule, **When** the
   identity is normalized again, **Then** its obsolete date-review item is superseded and the
   event can resume normal processing.
3. **Given** a run contains date-review identities, **When** reporting and final accounting
   complete, **Then** counts reconcile by source, identity, and reason without double-counting
   records that have multiple reasons.

### Edge Cases

- A date-only end on the same Singapore calendar day as a timed start is not inverted.
- A record can carry multiple date-quality reasons but contributes once to the review total.
- Long-running exhibitions and recurring programmes may legitimately span a long interval;
  they are retained for review rather than automatically rejected.
- Intentional selectable-date or anytime schedules without a fabricated exact date preserve
  their approved schedule state and are not treated as malformed solely for lacking a fixed
  session.
- Review assessment failure holds only the affected identity and cannot silently publish it.
- A reliably dated event whose final occurrence has passed keeps the existing archived/expired
  outcome; date review does not replace a stronger, evidence-backed lifecycle decision.

## Scope and Constraints _(mandatory)_

- **In scope**: Deterministic schedule assessment after normalization; needs-review lifecycle
  routing; stable evidence-linked review items; reason/source reporting; reconciliation when
  evidence changes; focused regression and pipeline integration tests.
- **Out of scope**: Automatically correcting dates, fetching new evidence, changing source
  extraction, redesigning the admin interface, changing venue rules, or running a complete
  live collection.
- **Evidence and dependencies**: Use only the normalized source evidence already captured by
  the pipeline. Never infer or invent a replacement schedule.
- **Privacy and lifecycle**: Event evidence contains no new personal data. Review items are
  superseded when evidence is corrected, replaced, or no longer current.
- **Experience**: This is an operational pipeline change; existing public loading, stale,
  empty, and error behavior remains unchanged.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST assess every otherwise-eligible normalized event identity for
  date quality before schedule-dependent deduplication, venue processing, reconciliation,
  or publication.
- **FR-002**: The assessment MUST distinguish at least missing, unparseable, conflicting,
  inverted, implausibly long, far-future, known-placeholder, and far-future-waitlist dates.
- **FR-003**: A questionable event MUST be retained with lifecycle `held`, review status
  `needs_review`, all applicable reason codes, source provenance, and an evidence hash; it
  MUST NOT be silently excluded or assigned a fabricated date.
- **FR-004**: Plausible exact, ranged, recurring, selectable, and anytime schedules MUST
  retain their existing inclusion and lifecycle behavior.
- **FR-005**: One questionable identity MUST count once in review totals even when several
  reason codes apply, while reason-level reporting MUST retain every applicable reason.
- **FR-006**: Date-review identity MUST remain stable for unchanged source-event identity and
  evidence, and unchanged evidence MUST NOT create duplicate review entries.
- **FR-007**: Corrected evidence MUST supersede the obsolete review item and allow the event
  to resume normal processing without changing its stable parent activity identity.
- **FR-008**: Date-review uncertainty MUST be isolated to affected identities so unrelated
  safe identities continue through the pipeline.
- **FR-009**: Pipeline status, traces, and operator reporting MUST expose total reviewed
  identities plus breakdowns by source and exact reason code.
- **FR-010**: The standalone date-audit command and pipeline assessment MUST use the same
  policy implementation and produce reconcilable results for the same artifact and audit
  date.
- **FR-011**: Review policy thresholds MUST be explicit, deterministic, timezone-aware for
  Singapore, and covered by boundary tests.
- **FR-012**: The change MUST include automated tests for plausible schedules, each review
  class, multiple simultaneous reasons, date-only boundaries, isolation, stable review
  identity, automatic recovery, accounting, and failure behavior.

### Key Entities

- **Date Quality Assessment**: The deterministic result for one normalized event, including
  parsed boundaries, outcome, applicable reason codes, policy version, and audit date.
- **Date Review Item**: An evidence-linked needs-review record for one stable event identity,
  including source provenance, reasons, lifecycle, and supersession state.
- **Date Quality Summary**: Reconciled total and per-source/per-reason counts for a run.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of otherwise-eligible normalized identities receive either a plausible
  or needs-review date assessment before schedule-dependent downstream processing.
- **SC-002**: All seeded missing, malformed, contradictory, excessive-range, and placeholder
  cases are held with the expected reason codes, while reliably expired schedules retain
  their existing archive outcome and zero dates are invented.
- **SC-003**: Plausible schedule fixtures retain exactly the same downstream outcome as before
  the feature.
- **SC-004**: Reprocessing identical evidence creates zero duplicate date-review items, and
  corrected evidence clears 100% of its obsolete date-review items.
- **SC-005**: Run-level identity totals reconcile exactly across plausible and needs-review
  outcomes, and source/reason summaries are reproducible for the same input.

## Assumptions

- The existing event normalization, admin review, trace, and terminal-accounting contracts
  remain the owners of lifecycle and reporting behavior.
- The default far-future horizon is three years and the default excessive interval is more
  than 730 days; changing either requires an explicit versioned policy update.
- Long-range findings are review signals rather than proof that an event is invalid.
- This feature uses the current normalized artifacts for limited validation and does not
  require a fresh network collection.
