# Design QA — event-density minimap

## Reference and evidence

- Source visual truth: `/var/folders/kt/mjsyky8537n9z1rtwl34g_l00000gn/T/TemporaryItems/NSIRD_screencaptureui_TbsTS2/Screenshot 2026-07-23 at 2.05.19 PM.png`
- Browser-rendered implementation: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/implementation-event-density-minimap.png`
- Focused side-by-side comparison: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/design-qa-comparison-event-density-minimap.png`
- Source image: 1168 × 606 pixels.
- Implementation image: 1280 × 720 pixels at a 1280 × 720 CSS viewport and device scale factor 1.
- Comparison normalization: both minimap regions were cropped and fitted into equal 350 × 350 comparison cells without stretching.
- State: default Singapore event map with all event filters cleared.

## Full-view and focused comparison

- The full implementation view confirms the minimap sits directly below the top-right toolbar without moving or resizing the existing controls.
- The focused side-by-side comparison confirms the intended game HUD character: coarse terrain pixels, cardinal labels, bright density blocks, and a clear Singapore-wide overview.
- The frame intentionally differs from the black Minecraft reference after user feedback: it uses Amble’s translucent white navbar surface, blur, soft border, rounded corners, and shadow.

## Required fidelity surfaces

- Fonts and typography: cardinal labels remain legible at the native 96 × 64 canvas resolution; the event count is intentionally available only through accessible text.
- Spacing and layout rhythm: the 184 × 130 desktop frame aligns with the toolbar’s right edge and sits 12 pixels below it; the map retains breathing room around the pixel canvas.
- Colors and visual tokens: terrain greens, water blues, and consistent yellow density cells preserve the game reference while the outer frame uses the existing frosted-toolbar tokens.
- Image quality and asset fidelity: the canvas is rendered at low resolution and enlarged with pixelated sampling, keeping deliberate hard-edged pixels instead of blurred imitation.
- Copy and content: accessible copy reports the filtered mapped-activity count and explains the viewport outline without adding a visible badge.

## Interaction, responsiveness, and accessibility

- The minimap has `pointer-events: none`; it cannot pan, zoom, select, or otherwise mutate the primary map.
- Event density follows the active query, category, and date filters.
- Duplicate sessions at the same activity and venue do not inflate the density.
- Events without verified coordinates do not create invented heat cells.
- The minimap never reads or displays the user’s location.
- A transparent, thin-bordered viewport box moves with the main map and changes size as the user pans or zooms.
- A compact responsive size is provided below 720 pixels without introducing another control.
- Primary behavior tested in the browser: filtering from 662 mapped activities to one, restoring all activities, and expanding the viewport box when zooming out.
- Browser console errors checked: none.

## Comparison history

- Earlier P2: the first implementation used a heavy black stepped frame that matched Minecraft but conflicted with the surrounding Amble toolbar.
- Fix: retained the pixel-art canvas while replacing the outer frame and count badge with frosted white surfaces matching the navbar.
- Post-fix evidence: the focused comparison and final browser capture show the game texture contained within Amble’s glass visual system.
- Later P2: density colors and the player marker competed with the requested passive overview.
- Fix: standardized every density cell to yellow, removed all location access and rendering, and added a transparent viewport outline driven by real map bounds.
- Post-fix evidence: the latest focused comparison shows only yellow density cells; the browser test confirms the viewport outline expands when the main map zooms out.

## Findings

- No actionable P0, P1, or P2 difference remains after the yellow-cell and viewport revision.
- P3: relative density is now communicated through marker size rather than color; this is acceptable for the requested uniform-yellow treatment.

## Verification

- Focused minimap unit tests: 4 passed.
- Focused Chromium minimap interaction test: 1 passed.
- ESLint: passed.
- Production build: passed.
- `git diff --check`: passed.

Historical result: passed

---

# Design QA — guided event-search sizing and formatting

## Reference and evidence

- Source visual truth:
  `/var/folders/kt/mjsyky8537n9z1rtwl34g_l00000gn/T/TemporaryItems/NSIRD_screencaptureui_B1AknY/Screenshot 2026-07-26 at 4.31.20 PM.png`
- Browser-rendered desktop implementation:
  `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/guided-search-implementation.png`
- Browser-rendered open options:
  `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/guided-search-implementation-open.png`
- Browser-rendered applied sentence:
  `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/guided-search-implementation-applied.png`
- Browser-rendered mobile implementation:
  `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/guided-search-implementation-mobile.png`
- Browser-rendered mobile options:
  `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/guided-search-implementation-mobile-open.png`
- Full-view normalized comparison:
  `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/guided-search-comparison.png`
- Source image: 2930 × 634 pixels, normalized to 1912 × 443 for comparison.
- Desktop implementation: 1912 × 443 pixels at the in-app Browser's available desktop
  viewport, device scale factor 1.
- Mobile implementation: 390 × 844 CSS viewport, device scale factor 1.
- States: empty sentence, open What options, applied What/When/Price sentence, closed
  mobile, and open mobile.

## Full-view and focused comparison

- The normalized full-view comparison shows the original search consuming nearly the
  entire viewport width and a disproportionate share of the map's first screen. The final
  implementation uses a centered 980-pixel shell with a 60-pixel builder.
- The focused desktop captures confirm the input, circular submit control, and two utility
  controls share one compact baseline. The 540-pixel option card aligns to the builder's
  left edge.
- The focused mobile captures confirm a 374-pixel field with no opaque empty toolbar
  beneath it. Utility actions float below the closed field and hide while the option card
  is open.

## Required fidelity surfaces

- Fonts and typography: the composer uses the existing product typeface at 18 pixels on
  desktop and 17 pixels on mobile. Prompt, placeholder, connectors, and bold phrases align
  vertically without clipping or unintended wrapping.
- Spacing and layout rhythm: desktop root is 980 × 74 pixels; builder is 860 × 60 pixels;
  submit is 44 × 44 pixels. Mobile builder is 374 × 60 pixels. The option card begins
  eight pixels below the mobile composer and produces no horizontal overflow.
- Colors and visual tokens: existing white/frosted surfaces, dark text, muted placeholder,
  gray submit, and pale selected-option treatment are preserved. Mobile removes only the
  redundant outer toolbar surface.
- Image quality and asset fidelity: no new raster or custom icon assets were required;
  existing map imagery, minimap canvas, and Phosphor icons remain sharp and unchanged.
- Copy and content: `Find`, `Add filter`, guided dimensions, option labels, selected
  sentence phrases, result counts, and recovery copy are unchanged.

## Interaction, responsiveness, and accessibility

- Tested in the in-app Browser: opening the option card, applying
  `workshops this weekend under $25`, rendering bold sentence phrases, and retaining one
  matching result.
- Mobile open state hides unrelated utility actions so the guided card attaches directly
  to the input.
- Persistent submit and mobile option targets remain at least 44 × 44 CSS pixels.
- Desktop and mobile captures report no horizontal overflow.
- Browser console errors checked: none.

## Comparison history

- Earlier P1: the toolbar stretched to almost the full viewport width, visually dominating
  the map and making the composer feel like a banner.
- Fix: constrained the shell to 980 pixels, reduced outer padding and gaps, and normalized
  the builder, typography, and circular submit control.
- Post-fix evidence: `outputs/design-qa/guided-search-comparison.png` shows the centered
  compact shell and restored map visibility.
- Earlier P2: mobile retained an opaque empty second toolbar row beneath the composer.
- Fix: made the mobile outer shell transparent, set the builder to border-box sizing, and
  hid utility actions while the guided card is open.
- Post-fix evidence: the final closed/open mobile captures show a 60-pixel field and option
  card attached at y=76 with no blank panel or overflow.

## Findings

- No actionable P0, P1, or P2 sizing, typography, spacing, color, asset, or copy mismatch
  remains.
- P3: the map itself naturally differs between captures because event/map state continued
  updating; this does not affect the search component comparison.

## Verification

- In-app Browser desktop and mobile visual/interaction checks: passed.
- Browser console error check: passed with zero errors.
- Classifier/filter unit tests: 14 passed.
- Targeted ESLint and Prettier checks: passed.
- Production build: passed.

final result: passed
