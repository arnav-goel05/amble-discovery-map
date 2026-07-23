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

final result: passed
