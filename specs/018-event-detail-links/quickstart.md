# Quickstart: Expose Canonical Event Details

## Prerequisites

- Use the `develop` branch.
- Preserve unrelated working-tree changes.
- Use the checked-in approved activity snapshot; do not run or publish the event pipeline.

## Focused validation

1. Run the pure event-detail projection tests:

   ```sh
   node --test tests/event-detail-projection.test.mjs
   ```

   Expected: canonical activity-wide and session-scoped offers, session expansion, derived date/time, missing fields, unsafe URLs, and legacy inputs pass.

2. Run event discovery model tests:

   ```sh
   node --test tests/event-discovery-model.test.mjs
   ```

   Expected: discovery results retain canonical identities and source offers.

3. Run focused browser scenarios:

   ```sh
   npx playwright test -c playwright.config.mjs tests/event-ui.spec.mjs --project chromium-desktop
   ```

   Expected: direct map-style opening and search-style opening expose identical sessions and references; FunVee-style canonical input shows its Fever link; action context publishes the same reference identity.

4. Run formatting, lint for changed files, and the production build:

   ```sh
   npm run format:check
   npx eslint activity-scenes/event-detail-projection.js activity-scenes/landmark-event-panel.js tests/event-detail-projection.test.mjs tests/event-ui.spec.mjs
   npm run build
   ```

## Manual check

Open the Marina Square highlight and select **FunVee Singapore: Day Tour by Open-Top Bus**. Confirm:

- "Fever Singapore" appears under **Sources & tickets**;
- it links to `https://feverup.com/m/137694`;
- the date and separate time fields use approved schedule data;
- no unavailable field is fabricated.

## Validation results

Completed on 2026-07-29:

- Pure projection, discovery model, and assistant connector: 25 tests passed.
- Chromium desktop event UI: 34 tests passed; one unrelated empty-snapshot startup scenario timed out on its first attempt and passed its automatic retry.
- Canonical active-catalogue audit: 566/566 activities projected, 724/724 approved offers exposed, and 12,006/12,006 sessions retained.
- Exact schedule audit: 11,910/11,910 exact sessions with start timestamps exposed a separate time.
- Field-presence audit: venue 12,006/12,006, address 159/159, description 496/496, category 17/17, organizer 0/0, and price 312/312 matched approved-data availability.
- ESLint and explicit Prettier checks passed.
- `npm run format:check` could not run outside CI because the repository command requires `CI_BASE_SHA`; the equivalent explicit changed-file Prettier check passed.
- Production build passed. Existing third-party direct-eval and large-chunk warnings remained non-blocking.
