# Design QA — activity location presentation

## Reference and evidence

- Source visual truth: `/var/folders/kt/mjsyky8537n9z1rtwl34g_l00000gn/T/TemporaryItems/NSIRD_screencaptureui_9BLnFP/Screenshot 2026-07-20 at 11.37.11 AM.png`
- Browser-rendered implementation: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/.tmp-event-location-filter-qa.png`
- Focused comparison: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/.tmp-event-location-comparison.png`
- Viewport: 1280 × 720 desktop.
- State: Singapore-wide map, event controls open, default location filter state.

## Full-view and focused comparison

- Full view confirms the event toolbar remains within the frosted top control surface and does not obscure the map.
- Focused comparison confirms `All`, `Mapped`, and `Multiple locations` were removed and the remaining control is renamed `Mystery Location`.
- A separate focused crop was sufficient because the requested visual change is confined to the event toolbar; map behavior was verified through the DOM and focused browser tests.

## Required fidelity surfaces

- Fonts and typography: the remaining label reuses the existing toolbar font, weight, and single-line treatment.
- Spacing and layout rhythm: removing three pills closes the unused horizontal space without changing the search input, category controls, date control, radius, or toolbar height.
- Colors and visual tokens: the retained control uses the existing frosted surface, navy text, border, and selected-state tokens.
- Image quality and asset fidelity: no image or icon assets were introduced or replaced.
- Copy and content: the visible label is `Mystery Location`; exceptional location types are shown in results and the activity detail panel.

## Interaction and accessibility checks

- `Mystery Location` is a toggle button with `aria-pressed`, not a misleading tab.
- Activating it filters to secret-location activities; activating it again restores all activities.
- Activity details expose `Location type` as `Mystery Location`, `Multiple locations`, or `Single location`.
- Multi-location activities display `Multiple locations` on each verified mapped venue pill.
- Unresolved venues remain off-map; the UI does not invent coordinates.
- No new browser console errors were observed during the checked flow.

## Comparison history

- Earlier P2: four location tabs consumed most of the toolbar and hid location semantics behind filtering.
- Fix: replaced the tab row with one optional secret-location toggle and moved location semantics into activity results, details, and mapped venue pills.
- Post-fix evidence: the focused comparison shows only the mystery-location toggle, while browser tests confirm detail and multi-venue map labels.

## Findings

- No actionable P0, P1, or P2 mismatch remains for the requested change.
- P3: activities with unresolved multiple venues can only be labelled in search/details until verified coordinates exist.

## Verification

- Event discovery model: 8 passed.
- Focused event UI: 2 passed.
- Focused location behavior: 2 passed; one timing-sensitive panel assertion passed on retry.
- Primary interactions tested: secret toggle on/off, secret detail, multiple-location detail, and labels at two mapped venues.

final result: passed
