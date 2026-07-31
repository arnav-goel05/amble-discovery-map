# Tasks: Simplify Single-Session Event Details

**Input**: Design documents from `/specs/020-single-session-details/`

## Phase 1: Setup

- [x] T001 Add single-occurrence and multi-occurrence schedule presentation fixtures to tests/event-ui.spec.mjs

---

## Phase 2: Foundational

- [x] T002 Define current-context singleton and multiple-occurrence eligibility assertions in tests/assistant-event-connector.test.mjs

---

## Phase 3: User Story 1 - Read a concise single-session event (Priority: P1) 🎯 MVP

**Goal**: Remove the redundant schedule-selection card when no schedule choice exists.

**Independent Test**: Open a one-occurrence activity and verify the schedule card and session buttons are absent while Date, Time, Venue, and source details remain.

- [x] T003 [US1] Add a failing single-session schedule omission regression in tests/event-ui.spec.mjs
- [x] T004 [US1] Conditionally omit singleton schedule-selection markup in activity-scenes/landmark-event-panel.js
- [x] T005 [US1] Make singleton `event.selectoccurrence` ineligible in activity-scenes/assistant/connectors/event-connector.js

---

## Phase 4: User Story 2 - Choose among multiple sessions (Priority: P2)

**Goal**: Preserve the complete schedule card and selection behavior for genuine choices.

**Independent Test**: Open same-date/different-time and different-date activities with two sessions and verify both retain selectable schedule controls.

- [x] T006 [US2] Add same-date multi-time and different-date multi-session preservation coverage to tests/event-ui.spec.mjs
- [x] T007 [US2] Verify multi-session occurrence selection remains eligible in tests/assistant-event-connector.test.mjs

---

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T008 Run focused browser, connector, lint, formatting, and production-build gates from specs/020-single-session-details/quickstart.md
- [x] T009 Record validation results and non-blocking limitations in specs/020-single-session-details/quickstart.md

---

## Phase 6: Inline Multiple Sessions

- [x] T010 Add regressions requiring multi-session controls inside the detail fields
- [x] T011 Move multi-session controls into a `Dates & times` row and remove duplicated Date and Time rows
- [x] T012 Adapt schedule-field styling while preserving responsive behavior
- [x] T013 Re-run browser, connector, lint, formatting, and production-build gates

---

## Phase 7: Linked Date and Time Choices

- [x] T014 Add regressions for unique date pills and selected-date time filtering
- [x] T015 Split complete multi-session schedules into linked Date and Time rows
- [x] T016 Preserve a combined fallback for incomplete date or time values
- [x] T017 Derive legacy times from valid start timestamps
- [x] T018 Re-run focused/full browser, projector, connector, lint, formatting, and build gates

---

## Phase 8: Compact Date Overflow

- [x] T019 Replace the collapsed date overflow label with `+N dates`
- [x] T020 Verify expansion behavior, lint, and formatting

---

## Phase 9: Date Overflow Visual Consistency

- [x] T021 Match the date overflow control to the neutral date-choice button style
- [x] T022 Verify computed style parity and quality gates

---

## Dependencies & Execution Order

```text
Setup → Foundational → US1 → US2 → Polish
```

- US1 is the independently deployable MVP.
- US2 protects existing multi-session behavior and follows the singleton rule.
- Browser and connector tests are separate-file validation opportunities until final integration.

## Implementation Strategy

1. Add failing singleton and multi-session expectations.
2. Apply the smallest panel condition and matching capability predicate.
3. Verify single-session detail retention and multi-session interaction preservation.
4. Run the full focused event UI and production gates.
