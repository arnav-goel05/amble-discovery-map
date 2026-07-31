# Data Model: Simplify Single-Session Event Details

## Activity Detail

- `activityId`: stable selected activity identity
- `occurrences`: normalized approved occurrences
- `venueGroups`: normalized venue grouping
- `scheduleSummary`: approved aggregate schedule label
- approved detail values: date, time, venue, address, sources, and optional descriptive fields

## Schedule Choice State

Derived from `occurrences.length`:

- `single`: zero or one selectable occurrence; no schedule-selection section
- `multiple-complete`: two or more occurrences with complete date and time values; unique dates and selected-date times render in linked rows
- `multiple-flexible`: two or more occurrences with an incomplete date or time; exact occurrences render in a combined fallback row

The state is presentational and does not change stored data or identities.

## Capability Eligibility

`event.selectoccurrence` is eligible only when:

- event details are open;
- the target event is current;
- the target occurrence belongs to the event;
- the event exposes at least two occurrence identities.

Changing from one dataset to another recomputes eligibility from authoritative current context.
