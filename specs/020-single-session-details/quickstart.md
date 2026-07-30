# Quickstart: Simplify Single-Session Event Details

## Focused validation

1. Run singleton and multi-session browser scenarios:

   ```sh
   npx playwright test -c playwright.config.mjs tests/event-ui.spec.mjs --project chromium-desktop --grep "single-session schedule|multiple-session schedule"
   ```

   Expected: singleton activities retain text Date, Time, and Venue fields; complete multi-session activities expose unique Date pills and selected-date Time pills; incomplete schedules retain exact combined choices.

2. Run assistant event-connector tests:

   ```sh
   node --test tests/assistant-event-connector.test.mjs
   ```

   Expected: singleton session selection is ineligible and multi-session selection remains eligible.

3. Run regression, lint, formatting, and build gates:

   ```sh
   npx playwright test -c playwright.config.mjs tests/event-ui.spec.mjs --project chromium-desktop
   npx eslint activity-scenes/landmark-event-panel.js activity-scenes/assistant/connectors/event-connector.js tests/event-ui.spec.mjs tests/assistant-event-connector.test.mjs
   npx prettier --check activity-scenes/landmark-event-panel.js activity-scenes/assistant/connectors/event-connector.js tests/event-ui.spec.mjs tests/assistant-event-connector.test.mjs specs/020-single-session-details
   npm run build
   ```

## Manual check

Open a one-session event and confirm Date, Time, and Venue remain plain details. Open a multi-session event, select a date, and confirm the Time pills update to only that date's sessions. Select a time and confirm Venue, source links, and planning use that exact occurrence.

## Validation results

- Focused singleton, linked date/time, flexible fallback, exact identity, and expansion regressions: passed (4 tests).
- Event projection and assistant event connector suites: passed (11 tests).
- Full Chromium desktop event UI suite: passed (36 tests).
- ESLint: passed.
- Prettier check: passed.
- Production build: passed.
- Compact `+N dates` overflow regression: passed.
- Date overflow computed-style parity with unselected date choices: passed.
- Non-blocking existing build warnings remain for the loaders.gl direct `eval` dependency and the main bundle size.
