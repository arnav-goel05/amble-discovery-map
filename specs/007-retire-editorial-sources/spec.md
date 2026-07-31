# Feature Specification: Retire Honeycombers and ArtsEquator

**Working Branch**: `develop`

**Created**: 2026-07-23

**Status**: Approved

**Input**: Remove Honeycombers and ArtsEquator from the event pipeline and Sites dashboard after auditing every current use.

## User Scenarios & Testing

### User Story 1 - Operate Only Supported Sources (Priority: P1)

As the event-pipeline operator, I want retired sources excluded from future collection and processing so weekly runs do not spend time on sources we no longer intend to use.

**Why this priority**: Continuing to collect retired sources wastes work and makes operational reporting misleading.

**Independent Test**: Start source discovery with the current configuration and verify that neither retired source is scheduled, collected, normalized, or reported as a current source.

**Acceptance Scenarios**:

1. **Given** the current source configuration, **When** a new pipeline run builds its source plan, **Then** Honeycombers and ArtsEquator are absent.
2. **Given** adapter and provider registries, **When** supported sources are enumerated, **Then** neither retired source can be selected.
3. **Given** an older approved event that was sourced only from a retired source, **When** a safe replacement snapshot is reconciled, **Then** that event is removed without affecting unrelated events.
4. **Given** an event with both a retired-source contribution and a supported-source contribution, **When** reconciliation runs, **Then** the supported contribution and event remain.

---

### User Story 2 - Show Current Sources Only (Priority: P1)

As a dashboard viewer, I want source totals, charts, and detail coverage to show only sources that remain in the pipeline so the dashboard describes current operation accurately.

**Why this priority**: Retired sources in the dashboard imply they are still monitored and distort totals.

**Independent Test**: Load the dashboard with both a current payload and a stale stored payload containing the retired source rows; neither source is displayed or included in summary totals.

**Acceptance Scenarios**:

1. **Given** a new pipeline report, **When** dashboard data is generated, **Then** it contains no Honeycombers or ArtsEquator rows or counts.
2. **Given** an older stored dashboard payload that still contains either source, **When** the dashboard is loaded, **Then** the retired rows and their source-specific counts are omitted.
3. **Given** source count text on the dashboard, **When** the retirement is complete, **Then** it reflects the remaining configured sources.

---

### User Story 3 - Preserve Audit History (Priority: P2)

As a maintainer, I want historical snapshots and completed feature records preserved so past published runs remain reproducible and explainable.

**Why this priority**: Removing operational code must not rewrite immutable evidence of earlier runs.

**Independent Test**: Compare historical snapshot and completed-spec files before and after the change and verify they are unchanged while all current operational references are removed.

**Acceptance Scenarios**:

1. **Given** immutable snapshots that mention the retired sources, **When** removal is implemented, **Then** those snapshots are not modified or deleted.
2. **Given** completed historical specifications that document their earlier inclusion, **When** removal is implemented, **Then** those documents remain intact and the new feature record documents the superseding decision.

### Edge Cases

- A retired-source-only event still exists in a landmark even though it is absent from the current event catalogue.
- A merged event contains both retired and supported source contributions.
- Removing the final current or future event from a pipeline-managed landmark may make that landmark and POI eligible for removal.
- A stale dashboard payload still contains retired rows after the pipeline configuration no longer does.
- Source labels differ by display name, provider identifier, or adapter identifier.
- An unrelated source is unavailable during the retirement publication; its still-valid identities must remain isolated from the retired-source cleanup.

## Scope and Constraints

- **In scope**: Current source configuration, provider policy, adapter registration and modules, source-specific validation and fixtures, current operational documentation, reconciliation of retired-source events, dashboard generation and stale-payload filtering, automated tests, one verified clean pipeline publication, and Sites publication.
- **Out of scope**: Replacing the retired sources, changing eligibility or venue rules for remaining sources, rewriting immutable snapshots, rewriting completed historical feature records, or re-running unrelated ad hoc recovery experiments.
- **Evidence and dependencies**: Current configuration is the authority for supported sources. Historical data remains preserved as immutable evidence. The removal adds no paid service or new external dependency.
- **Privacy and lifecycle**: No personal data is introduced. Retired-source event data is removed from current publication through normal staged reconciliation and atomic snapshot replacement.
- **Experience**: The dashboard retains its current viewport-fitted presentation and interactions; only retired rows and their contributions disappear.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST exclude Honeycombers and ArtsEquator from every new source plan and collection run.
- **FR-002**: The system MUST remove their current provider and adapter registrations so neither can be invoked indirectly.
- **FR-003**: The system MUST remove source-specific operational validation, fixtures, and current documentation while retaining generic editorial-source behavior coverage using a supported source.
- **FR-004**: Reconciliation MUST remove a current event whose only source contribution is retired, including copies embedded in landmark event arrays.
- **FR-005**: Reconciliation MUST preserve supported source contributions and stable event identity when a merged event also contains a retired-source contribution.
- **FR-006**: A pipeline-managed landmark and POI MUST be removed only when no current or future supported events remain.
- **FR-007**: Retirement MUST be isolated from unrelated source outages, venue reviews, and event identities, and an unsafe assembled snapshot MUST preserve the last approved snapshot.
- **FR-008**: Current pipeline reports and dashboard payloads MUST exclude the retired sources from rows, totals, labels, and completeness results.
- **FR-009**: The dashboard MUST defensively omit retired sources from stale stored payloads until a new payload replaces them.
- **FR-010**: Immutable historical snapshots and completed historical specifications MUST remain unchanged.
- **FR-011**: The implementation MUST provide traceable logs and terminal accounting for retirement-driven event and landmark removals.
- **FR-012**: Without recollecting source data, a verified offline migration MUST derive a new immutable current snapshot from the approved snapshot, remove retired-source content, preserve original data freshness, and atomically activate it.

### Key Entities

- **Supported source set**: The current configured sources eligible for collection, reporting, and publication.
- **Source contribution**: A source-specific claim attached to an occurrence or merged event.
- **Published event**: A current or future event in the approved catalogue and, where mapped, a landmark event array.
- **Dashboard payload**: Source rows, totals, outcomes, and completeness values derived from a pipeline run.
- **Historical snapshot**: An immutable record of an earlier approved run, including its then-current source set.

## Success Criteria

### Measurable Outcomes

- **SC-001**: New source plans and completed run reports contain zero Honeycombers and zero ArtsEquator entries.
- **SC-002**: Current approved event, landmark, and dashboard data contain zero source contributions from either retired source.
- **SC-003**: All supported-source events present before retirement remain present unless independently expired or rejected by existing rules.
- **SC-004**: Automated tests cover retired-only, mixed-source, empty-landmark, stale-dashboard, and unrelated-source isolation paths with all relevant suites passing.
- **SC-005**: Historical snapshots and completed historical feature artifacts have zero retirement-related modifications.
- **SC-006**: The production build and dashboard checks pass before publication, with zero source-network collection performed by the retirement migration.

## Assumptions

- “Remove everywhere” means current and future operational code, configuration, reports, and UI; immutable history remains intact.
- No replacement source is part of this feature.
- Current supported-source behavior should remain unchanged apart from totals caused directly by removing these two sources.
- A stale dashboard payload must be safe immediately, without waiting for the next full pipeline run.

## Clarifications

### Session 2026-07-23

- No critical clarification was required. The explicit preservation of immutable historical snapshots and completed historical specs follows the repository constitution and auditability requirements.
