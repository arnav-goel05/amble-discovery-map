# Quickstart: Correct Event Schedule Semantics

1. Run the focused schedule parser and adapter tests.
2. Run the activity projection and discovery-model tests under multiple process timezones.
3. Stage the local schedule repair without activation.
4. Inspect its audit, integrity checks, and the known two-date event.
5. Activate only the verified staged snapshot.
6. Run approved-snapshot tests and the production build.

Expected known result:

- “Memory Palace” has exact sessions on 26 July and 2 August 2026.
- It does not match a 27 July 2026 filter.
- Its date-filter result exposes only the sessions for the selected date and projected
  venue.
- No website is recollected during repair.
