# Implementation Plan: Simplify Single-Session Event Details

**Branch**: `develop` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-single-session-details/spec.md`

## Summary

Render simple Date and Time text rows for single-occurrence activities. For complete multi-session schedules, render unique date pills in the Date row and only the selected date's exact occurrence times in the Time row. Retain a combined fallback for incomplete schedules, without restoring the standalone card. Align `event.selectoccurrence` eligibility with the occurrence-count rule and add focused browser and connector regressions.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js 24+

**Primary Dependencies**: Browser DOM, existing event-detail projector and panel, existing assistant event connector, Playwright 1.61

**Storage**: N/A; approved snapshot data remains read-only

**Testing**: Playwright event UI tests, Node assistant connector tests, ESLint, Prettier, Vite production build

**Target Platform**: Current desktop and mobile Chromium, WebKit, Firefox, Safari, and Edge-compatible browsers

**Project Type**: Browser-based map application

**Performance Goals**: Remove redundant DOM for singleton activities; add no polling, measurement, layout loop, or network work

**Constraints**: Preserve multi-session behavior, session-specific source links, stable identities, direct/conversational parity, and unrelated working-tree changes

**Scale/Scope**: One conditional event-panel rendering branch, its existing styles, and one capability eligibility predicate

## Constitution Check

- **Branch workflow — PASS**: Work remains on `develop`.
- **Evidence — PASS**: Approved occurrence count and approved detail values remain authoritative; no content is inferred or removed from the detail rows.
- **Automation — PASS**: A deterministic occurrence-count predicate owns presentation and eligibility; no manual runtime intervention exists.
- **Identity and publication — PASS**: Stable activity and occurrence identities remain unchanged. No snapshot or reconciliation behavior changes.
- **Boundaries — PASS**: The event-detail projector owns normalized occurrences, the panel owns DOM presentation, and the assistant connector consumes bounded published context.
- **Shared capabilities — PASS**: Existing `event.selectoccurrence` uses current panel context. Direct controls and conversational eligibility both require at least two exposed occurrences.
- **Quality and security — PASS**: Focused singleton, same-date multi-time, different-date multi-session, capability-parity, lint, formatting, and production-build checks are required. No external content or secret boundary changes.
- **UX and performance — PASS**: The change removes a no-op choice and follows clear, concise hierarchy while retaining genuine multi-session controls. Existing release coverage supplies the full browser matrix.
- **Operations and privacy — PASS**: No service, cost, personal data, retention, generated artifact, or deployment changes.

**Post-design re-check**: PASS. The design uses the smallest existing-state predicate and introduces no exception.

## Project Structure

### Documentation (this feature)

```text
specs/020-single-session-details/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── schedule-choice-presentation.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
activity-scenes/
├── landmark-event-panel.js
└── assistant/connectors/event-connector.js

style.css

tests/
├── event-ui.spec.mjs
└── assistant-event-connector.test.mjs
```

**Structure Decision**: Keep conditional rendering in the panel, layout styling in the existing stylesheet, and matching eligibility in the existing connector. The rule is too small to justify another module or dependency.

## Complexity Tracking

No constitution violations or additional complexity are required.
