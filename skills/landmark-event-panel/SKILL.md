---
name: landmark-event-panel
description: Adjudicate event-panel visual usability only when deterministic field, fallback, selection, focus, interaction, responsive, lifecycle, and screenshot tests pass but subjective usability remains inconclusive.
---

# Event Panel Visual Adjudication

Code and Playwright own the singleton panel, fixed field contract, `Not available` fallbacks, sorting, selection, refresh, focus restoration, keyboard controls, map interaction guards, responsive layout assertions, and evidence capture.

Use this skill only for an `inconclusive_visual` intervention. Inspect supplied desktop and narrow-viewport screenshots and judge whether the panel remains readable, preserves useful map context where space permits, and has no obvious visual obstruction not covered by assertions.

Return only a structured `pass`, `fail`, or `needs_review` verdict with evidence references and a concise reason. Do not edit components, styles, snapshots, handoffs, or pipeline state and do not claim automated checks that are absent.
