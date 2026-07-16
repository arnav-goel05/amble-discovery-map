---
name: landmark-event-pill
description: Adjudicate event-pill visual usability only when deterministic rendering, content, lifecycle, accessibility, interaction, and screenshot tests pass but a subjective visual criterion remains inconclusive.
---

# Event Pill Visual Adjudication

Code and Playwright own pill input validation, compact content, projection, zoom visibility, edge clamping, rotation, reconciliation, lifecycle, keyboard behavior, accessibility, and evidence capture.

Use this skill only for an `inconclusive_visual` intervention. Inspect the supplied close, overview, viewport-edge, and focus/expanded screenshots. Judge whether the pill is visually attached to its landmark, readable, and does not unreasonably obscure the primary landmark view.

Return only a structured `pass`, `fail`, or `needs_review` verdict with evidence references and a concise reason. Do not edit components, styles, snapshots, handoffs, or pipeline state and do not claim automated checks that are absent.
