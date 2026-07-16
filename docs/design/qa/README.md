# Feature Tour Design QA

- Source visual truth: `qa-feature-tour-reference.png`
- Implementation screenshot: `qa-feature-tour-implementation.png`
- Responsive screenshot: `qa-feature-tour-mobile.png`
- Combined comparison evidence: `qa-feature-tour-comparison.png`
- Desktop viewport and state: 1440 × 900, feature tour step 1 of 7 after the intro camera movement
- Responsive viewport and state: 390 × 844, feature tour step 1 of 7

**Findings**

- No actionable P0, P1, or P2 findings remain.
- The implementation preserves the target's frosted surface, teal spotlight, compact coach mark, strong title hierarchy, dimmed map context, and visible primary toolbar.
- The seven-step progress count intentionally differs from the three-step concept because the implementation covers every currently operable primary feature requested by the user.

**Required Fidelity Surfaces**

- Fonts and typography: passed. The existing product font stack, heavy navy heading, compact uppercase progress label, readable body copy, and button weights preserve the target hierarchy without clipping at either checked viewport.
- Spacing and layout rhythm: passed. The coach mark remains compact, uses the existing 22px radius language, stays within viewport bounds, and moves beside each highlighted control. On mobile it becomes a bottom sheet with 14px edge clearance.
- Colors and visual tokens: passed. Existing `#087f84` teal, navy foregrounds, translucent white glass, subtle teal focus ring, and restrained dimming match the selected direction and current application.
- Image quality and asset fidelity: passed. The live 3D map remains the visual hero; no map imagery, brand assets, or icons were replaced. Phosphor icons are reused for navigation and help controls.
- Copy and content: passed. Seven concise stops explain event labels, search, categories, dates, restaurants, itinerary planning, and map navigation. Copy describes real application behavior.

**Comparison History**

- Initial P2: the Back action appeared on step one because component button display styling overrode the native hidden state.
- Fix: added an explicit hidden-button rule for tour actions.
- Post-fix evidence: `qa-feature-tour-implementation.png` and `qa-feature-tour-comparison.png` show only Skip tour and Next on step one; the Back action enters from step two onward.
- Responsive follow-up: the existing mobile stylesheet hid the entire map-guidance group, which also hid the new replay action.
- Fix: mobile now retains only the feature-tour help control while continuing to hide zoom and rotate controls intended for desktop.
- Post-fix evidence: `qa-feature-tour-mobile.png` shows the 390 × 844 tour within viewport bounds, and browser inspection measured the card at left 14px, right 376px, bottom 830px.
- Copy refinement: removed the inherited global paragraph gradient, stroke, and shadow from feature-tour descriptions. Computed browser styles now report `text-shadow: none`.
- Dismissal refinement: replaced the lower “Skip tour” text action with a Phosphor close icon in the card’s top-right corner while preserving the accessible name “Skip tour”.
- Post-refinement evidence: `qa-feature-tour-implementation.png` and the vertically composed `qa-feature-tour-comparison.png` show the flat copy and top-right close control.
- Spotlight refinement: when several event pills are visible, step one now ranks their on-screen centres by distance from the viewport centre and spotlights the nearest one. Browser verification found four visible pills and confirmed the selected Esplanade pill was the closest, with its spotlight centre within 3px of the pill centre.

**Primary Interactions Tested**

- Intro dismissal and delayed tour start after the camera movement.
- All seven Next transitions and their expected headings.
- Final completion and persisted completed state.
- Replay from the map help control.
- Desktop and 390 × 844 responsive layout.
- Feature-tour interactions produced no errors. Browser inspection also surfaced a pre-existing MapLibre restaurant-cluster glyph validation error unrelated to this change.

**Open Questions**

- None blocking. The visual target includes a price control not present in the current production toolbar; the tour correctly documents only controls users can operate today.

**Implementation Checklist**

- [x] Start after the intro camera movement.
- [x] Anchor every step to the live interface.
- [x] Support Skip, Back, Next, Escape, arrow keys, and focus containment.
- [x] Remember completion and provide replay.
- [x] Keep desktop and mobile layouts within the viewport.
- [x] Preserve reduced-motion behavior.

**Follow-up Polish**

- P3: a small directional leader between spotlight and coach mark could make the relationship even more explicit when they are separated by a large gap.

final result: passed

---

# Amble Wordmark Integration Design QA

- Source visual truth: [`public/brand/amble-wordmark.png`](../../../public/brand/amble-wordmark.png)
- Implementation screenshots: `qa-amble-wordmark-desktop.jpg`, `qa-amble-wordmark-mobile.jpg`, and `qa-amble-wordmark-small-phone.jpg`
- Combined comparison evidence: `qa-amble-wordmark-comparison.png`
- Viewports and state: 1440 × 900, 768 × 1024, 390 × 844, and 320 × 568; intro loading state

**Findings**

- No actionable P0, P1, or P2 findings remain.
- The selected option 2 letterforms are preserved, the white background is transparent, and the wordmark reads cleanly over the frosted map surface.
- The wordmark stays above the intro headline without crowding the loading state or introducing horizontal or vertical overflow.

**Required Fidelity Surfaces**

- Fonts and typography: passed. The raster wordmark preserves the exact selected custom lettering and its dark navy treatment; the existing intro headline typography remains unchanged.
- Spacing and layout rhythm: passed. The brand group keeps responsive gaps and remains vertically centered. Browser measurements confirmed the content fits at all four checked viewports.
- Colors and visual tokens: passed. The navy wordmark matches the intro foreground and remains legible against the frosted glass background.
- Image quality and asset fidelity: passed. The 1422 × 449 RGBA source has transparent corners, full opacity in the letter interiors, intrinsic dimensions in markup, and no visible background rectangle in the rendered page.
- Copy and content: passed. The exact wordmark `Amble` and the existing intro headline/loading copy are preserved.

**Comparison History**

- Initial asset extraction left a faint edge fringe against a black transparency preview.
- Fix: the selected source was reprocessed with border-sampled soft alpha, cropped to the visible wordmark with a 12px safety margin, and checked on the actual frosted intro surface.
- Post-fix evidence: `qa-amble-wordmark-comparison.png` and all three implementation screenshots show a clean integrated edge with no visible white panel.

**Primary Interactions Tested**

- Intro loading state and wordmark preload.
- Intro readiness and dismissal through the existing Playwright intro test.
- Desktop, tablet, standard mobile, and small-phone responsive layout.
- Zero horizontal or vertical document overflow at every checked viewport.
- Browser console checked. One pre-existing MapLibre restaurant-cluster glyph-style validation error remains; it is unrelated to the wordmark and does not affect the intro layout or asset rendering.

**Implementation Checklist**

- [x] Preserve the selected option 2 wordmark.
- [x] Remove the white background and store the RGBA asset in the project.
- [x] Preload and render the logo in both static and dynamically created intro markup.
- [x] Keep the existing navigation and post-intro map UI unchanged.
- [x] Verify production build and intro behavior.

**Follow-up Polish**

- None required for handoff.

final result: passed
