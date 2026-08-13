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

---

# Design QA: phone utility actions right alignment

- Source visual truth: `/var/folders/kt/mjsyky8537n9z1rtwl34g_l00000gn/T/TemporaryItems/NSIRD_screencaptureui_fRXvPR/Screenshot 2026-08-14 at 3.59.05 AM.png`
- Browser-rendered implementation: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/phone-actions-right/implementation-full.png`
- Focused implementation region: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/phone-actions-right/implementation-actions.png`
- Side-by-side comparison: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/phone-actions-right/comparison.png`
- Viewport: 390 × 844 CSS pixels at device scale factor 1.
- Source image: 220 × 100 pixels; implementation full image: 390 × 844 pixels; focused action container: 378 × 44 pixels.
- Density normalization: the requested change concerns trailing alignment, so the source crop and full implementation were compared at their native aspect ratios without scaling either control pair.
- State: map initialized, search closed, restaurant and plan utility actions visible.

## Full-view and focused comparison evidence

- The full phone render shows both actions directly below the search composer at the right edge, preserving the established four-pixel internal trailing inset.
- The focused measurement reports a 378-pixel action row from x=8 to x=386. The final button ends at x=382, leaving a four-pixel trailing gap.
- The side-by-side comparison shows the requested directional change from the reference's left placement to the implementation's right placement.

## Required fidelity surfaces

- Fonts and typography: unchanged; this edit does not affect labels, font family, weights, line height, or text rendering.
- Spacing and layout rhythm: passed; the 44-pixel circular controls retain their six-pixel gap and align to the right without horizontal overflow.
- Colors and visual tokens: unchanged; borders, translucent surfaces, icon color, and shadows use the existing product styles.
- Image quality and asset fidelity: unchanged; existing Phosphor restaurant and checklist icons remain sharp and no replacement assets were introduced.
- Copy and content: unchanged; accessible names, tooltips, and control behavior remain intact.

## Comparison history

1. P2 finding: the narrowest phone breakpoint overrode the normal right alignment and moved both utility actions to the left.
2. Fix: removed the max-width 420-pixel left-alignment override, allowing the existing compact layout's `flex-end` alignment and four-pixel right inset to apply.
3. Post-fix evidence: Chromium, WebKit, and Firefox mobile tests report right alignment; the 390 × 844 capture shows the pair at the right edge with no overflow or browser errors.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested alignment change.
- No P3 follow-up is required.

## Verification

- Chromium, WebKit, and Firefox mobile regression tests: 3 passed.
- Browser console and page errors: none.
- Horizontal overflow: 0 pixels.

final result: passed

---

# Design QA: compact map and search spacing

- Source visual truth: `/var/folders/kt/mjsyky8537n9z1rtwl34g_l00000gn/T/TemporaryItems/NSIRD_screencaptureui_rDJWcN/Screenshot 2026-08-01 at 7.26.50 PM.png`
- Implementation capture: `/Users/arnav/.codex/visualizations/2026/08/01/019fbd11-534a-7fc2-851c-41626fdb8595/mobile-map-spacing-after.png`
- Viewport: 390 × 377 CSS px
- Source pixels: 818 × 754 px; approximately a 409 × 377 CSS-px Retina capture
- Implementation pixels: 390 × 377 px at device scale factor 1
- Density normalization: layout proportions were compared in CSS pixels; the source's 2× density was treated as approximately half-size
- State: map loaded, compact search toolbar visible, search popover closed

## Full-view comparison evidence

The source showed a page-colored strip and scrollbar beside the right edge of the map. The corrected compact render fills the complete 390 × 377 viewport: the map and canvas both measure 390 × 377 at `(0, 0)`, while the floating search remains intentionally inset 8px on both sides.

Differences in map camera position and event markers are live-data/state differences and are not part of this spacing fix.

## Focused region comparison evidence

The right edge was checked separately because it contains the reported defect. Before the fix, the body retained the browser default 8px margin and measured 374px inside a 390px viewport. After the fix, the body measures 390px, has `margin: 0`, and uses `overflow: hidden`; the document and map have no horizontal or vertical overflow.

## Findings

- No actionable P0/P1/P2 differences remain for the reported map/search gutter.
- Fonts and typography: unchanged; search type family, weight, size, line height, and wrapping retain the existing product styles.
- Spacing and layout rhythm: passed; the root gutter is removed and the established 8px floating-control inset is preserved.
- Colors and visual tokens: unchanged; the map, frosted search surface, borders, and shadows continue to use existing tokens.
- Image quality and asset fidelity: unchanged; the map tiles, density minimap, and icons remain source assets at their native rendering quality.
- Copy and content: unchanged; `Find`, `Add filter`, and control labels remain intact.

## Comparison history

1. P1 finding: a compact/embedded viewport could expose the body background beside the fixed map because the root document retained its default margin.
2. Fix: reset `html` and `body` to full width and height, remove the default margin, and prevent document overflow.
3. Post-fix evidence: body, map, and canvas fill the 390px viewport; the search bounds are `x=8`, `width=374`; no page-colored strip or scrollbar remains.

## Implementation checklist

- [x] Remove the default root document margin.
- [x] Make the document root fill the viewport.
- [x] Prevent root overflow from exposing a gutter or scrollbar.
- [x] Preserve the existing compact-search inset and interactions.
- [x] Verify the corrected layout in the in-app browser.

## Follow-up polish

None required for this fix.

final result: passed

---

# Design QA: solid white phone utility buttons

- Source visual truth: `/var/folders/kt/mjsyky8537n9z1rtwl34g_l00000gn/T/TemporaryItems/NSIRD_screencaptureui_LPYcIy/Screenshot 2026-08-14 at 4.04.50 AM.png`
- Browser-rendered implementation: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/phone-actions-white/implementation-full.png`
- Focused implementation region: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/phone-actions-white/implementation-actions.png`
- Side-by-side comparison: `/Users/arnav/Desktop/projects/onemap-poi-highlight-spike/outputs/design-qa/phone-actions-white/comparison.png`
- Viewport: 390 × 844 CSS pixels at device scale factor 1.
- Source image: 264 × 130 pixels; implementation full image: 390 × 844 pixels; focused action container: 378 × 44 pixels.
- Density normalization: the requested change concerns button opacity, so the reference crop and implementation were compared at native aspect ratios with the same closed-search state.
- State: map initialized at the supplied camera hash, search closed, restaurant and plan actions visible.

## Full-view and focused comparison evidence

- The reference shows detailed map geometry visible through the translucent circular buttons.
- The final phone capture shows both controls as uniform solid-white circles, clearly separating their icons from the map while preserving their right alignment.
- Computed styles for both controls are `rgb(255, 255, 255)`; the page reports zero horizontal overflow and zero console or page errors.

## Required fidelity surfaces

- Fonts and typography: unchanged; no text, accessible names, weights, or icon sizing changed.
- Spacing and layout rhythm: unchanged; the two 44-pixel controls retain their position, six-pixel gap, radius, and four-pixel right inset.
- Colors and visual tokens: passed; only the narrow phone breakpoint changes from translucent white to opaque `#fff`.
- Image quality and asset fidelity: unchanged; the existing Phosphor restaurant and checklist icons remain intact and sharp.
- Copy and content: unchanged; titles, labels, and button behavior remain the same.

## Comparison history

1. P2 finding: detailed map geometry showed through the phone controls and reduced their visual separation from the map.
2. Fix: set the two utility actions to opaque white within the existing max-width 720-pixel phone rule.
3. Post-fix evidence: the final capture and computed styles confirm both backgrounds are solid white in Chromium; the same regression assertion passes in WebKit and Firefox.

## Findings

- No actionable P0, P1, or P2 difference remains for the requested phone background treatment.
- No P3 follow-up is required.

## Verification

- Chromium, WebKit, and Firefox mobile regression tests: 3 passed.
- Browser console and page errors: none.
- Horizontal overflow: 0 pixels.

final result: passed
