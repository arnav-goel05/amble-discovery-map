# Research: Expose Canonical Event Details

## Decision 1: Treat the approved activity catalogue as authoritative

- **Decision**: Project source offers, sessions, venue groups, and descriptive fields from the canonical activity record already delivered to the browser.
- **Rationale**: The active snapshot contains valid links and details. Recollection or snapshot mutation would add risk without addressing the presentation defect.
- **Alternatives considered**: Re-run source collection; add hard-coded website lookup; inject URLs into landmarks. All were rejected because they duplicate or bypass approved evidence.

## Decision 2: Use one pure panel projection for map and search entry points

- **Decision**: Normalize canonical activities and legacy fixtures through one pure event-detail projector before rendering.
- **Rationale**: The current map path handles a canonical activity as one legacy event while search pre-expands sessions. A shared projector prevents continued parity drift and makes the business rules independently testable.
- **Alternatives considered**: Add only `eventUrl` in the map adapter. Rejected because it would fix the screenshot while leaving missing sessions, times, scoped offers, and duplicated projection logic.

## Decision 3: Preserve offer scope by projecting per applicable session

- **Decision**: Expand sessions first, attach only activity-wide or matching session-scoped offers to each normalized occurrence, then derive aggregate coverage for panel rendering.
- **Rationale**: The panel already filters session-scoped references using selected occurrence identity. Preserving applicability prevents a ticket link from appearing on the wrong session.
- **Alternatives considered**: Display all activity offers for every session. Rejected because it can misrepresent ticket availability.

## Decision 4: Derive display time from approved schedules

- **Decision**: Use explicit legacy time text when present; otherwise derive localized time from a valid schedule start. Use schedule display text or the date portion of the valid start for the date field.
- **Rationale**: Exact canonical schedules already carry the necessary values. This exposes rather than invents data.
- **Alternatives considered**: Keep the time field unavailable; duplicate time in the date field only. Both were rejected as incomplete presentation.

## Decision 5: Keep URL validation at the UI boundary

- **Decision**: Continue accepting only HTTP(S) URLs and preserve a safe legacy fallback.
- **Rationale**: Approved data should be valid, but boundary validation prevents malformed or unsafe values from becoming actionable if a fixture or future payload regresses.
- **Alternatives considered**: Trust all approved payload strings. Rejected because external navigation remains security-sensitive.
