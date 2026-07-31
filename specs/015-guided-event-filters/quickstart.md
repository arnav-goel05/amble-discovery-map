# Quickstart: Validate Guided Event Filters

## Prerequisites

- Node.js 24 or newer
- Project dependencies installed
- Worktree on `develop`

## Automated validation

```bash
node --test tests/event-filter-options.test.mjs tests/event-query-classifier.test.mjs tests/event-discovery-model.test.mjs
PLAYWRIGHT_FULL_MATRIX=1 playwright test -c playwright.config.mjs tests/event-discovery.spec.mjs tests/event-ui.spec.mjs --project chromium-desktop --project chromium-mobile
npm run lint
npm run build
```

After targeted validation passes, run the required compatibility matrix:

```bash
PLAYWRIGHT_FULL_MATRIX=1 playwright test -c playwright.config.mjs tests/event-discovery.spec.mjs tests/event-ui.spec.mjs --project chromium-desktop --project chromium-mobile --project webkit-desktop --project webkit-mobile --project firefox-desktop --project firefox-mobile
```

## Manual scenarios

1. Open the map and focus the guided event builder.
2. Confirm the white rounded composer reads as one sentence, shows What values directly,
   and presents When, Where, and Price as small remaining-step labels in the same card.
3. Select a What value; confirm it appears as bold text without pill chrome or an X icon
   and the same card advances to When. Select This weekend and stop; results remain usable.
4. Activate Where before Price, then activate the bold When phrase and replace it; confirm
   other phrases remain undisturbed.
5. Use the phrase editing view to remove a middle phrase; confirm its step returns.
6. Type `workshops this weekend near Esplanade under $25` and commit with Enter and the
   arrow in separate runs. Confirm What, When, Where, and Price classify locally. Commit
   `romantic` and confirm it remains bold What text and filters approved event text.
7. Create a zero-result combination and use a suggested token removal; confirm its shown
   count matches the restored results.
8. Select Current map area, move the map, and confirm results reconcile to the new bounds.
9. Select Near me once with permission granted and once denied; confirm a 3 km filter in
   the first case and a non-blocking fallback in the second.
10. At 320 CSS px width, add enough phrases to wrap; confirm every phrase, input, arrow,
    and removal control remain reachable by touch and keyboard.
11. At the desktop test viewport, confirm the popup remains a compact single-column
    surface, leaves at least half the viewport outside the menu, and does not contain empty
    filler columns.

## Performance check

Use the existing performance diagnostics variant and record filter duration before and
after the change for the same approved snapshot. Selection, removal, option typing, map-area
refresh, and the largest bounded recovery calculation must each remain below the 200 ms
user-visible target.
