# Schedule Choice Presentation Contract

## Single occurrence

When `occurrences.length < 2`:

- do not render `.landmark-event-panel__schedule`;
- do not render `.landmark-event-panel__session`;
- retain the approved Date, Time, Venue, Address, source links, and descriptive fields;
- publish the stable selected occurrence in panel context;
- report `event.selectoccurrence` as ineligible.

## Multiple occurrences

When `occurrences.length >= 2`:

- render separate `Date` and `Time` choice rows when all occurrences have both values;
- render one date pill per unique date;
- label collapsed overflow compactly as `+N dates`;
- render only the selected date's occurrence times in the Time row;
- select the first canonical occurrence when a date pill is chosen;
- select the exact occurrence when a time pill is chosen;
- use a combined `Dates & times` fallback when dates or times are incomplete;
- do not render a standalone schedule card;
- preserve selected state, expansion behavior, keyboard and pointer interaction;
- update current detail fields and applicable source links after selection;
- report valid occurrence targets as eligible for `event.selectoccurrence`.

## Failure and compatibility

- Missing optional details remain "Not available."
- Flexible or unverified singleton schedules still omit the no-op selector.
- Existing legacy and canonical activity shapes use the same normalized occurrence count.
- No approved data, stable identity, or external-link validation changes.
