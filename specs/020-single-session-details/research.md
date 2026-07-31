# Research: Simplify Single-Session Event Details

## Decision 1: Hide the entire redundant schedule card

- **Decision**: Omit the Dates & venues section when an activity has one normalized occurrence.
- **Rationale**: The Date, Time, and Venue fields immediately below already present the same approved information. Retaining a card without a choice duplicates content and adds a misleading button.
- **Alternatives considered**: Hide only the button while retaining the heading, summary, and venue. Rejected because the remaining card would still duplicate the detail rows.

## Decision 2: Use normalized occurrence count

- **Decision**: Treat two or more normalized occurrences as a genuine schedule choice, regardless of whether dates or venues repeat.
- **Rationale**: Normalization already owns deduplication and stable session identity. Same-date sessions may still have distinct times or ticket applicability.
- **Alternatives considered**: Compare display strings. Rejected because formatting collisions could hide distinct approved sessions.

## Decision 3: Align conversational eligibility

- **Decision**: Make `event.selectoccurrence` ineligible when the current event exposes fewer than two occurrence identities.
- **Rationale**: A conversational action must not offer a choice that the direct interface intentionally omits.
- **Alternatives considered**: Leave the command eligible for re-selecting the only occurrence. Rejected as a no-op capability drift.

## Decision 4: Link unique dates to exact times

- **Decision**: For complete multi-session schedules, show unique date pills separately from the selected date's exact time pills. Selecting a date selects its first canonical occurrence.
- **Rationale**: This removes repeated dates, makes the date-to-time relationship explicit, and retains stable occurrence identity for venue, ticket, and planning behavior.
- **Alternatives considered**: Keep combined date-time pills. Rejected because repeated dates make larger schedules harder to scan. Independently selected date and time values with no occurrence mapping were also rejected because they could produce combinations that do not exist.
- **Fallback**: If any occurrence lacks a date or time, keep exact combined occurrence pills so incomplete schedules are never fabricated.
