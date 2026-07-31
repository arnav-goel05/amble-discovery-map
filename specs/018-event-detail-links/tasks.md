# Tasks: Expose Canonical Event Details

**Input**: Design documents from `/specs/018-event-detail-links/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/event-detail-projection.md, quickstart.md

## Phase 1: Setup

**Purpose**: Establish regression fixtures and the executable projection contract.

- [x] T001 Create canonical activity, multi-session, scoped-offer, missing-field, unsafe-URL, and legacy compatibility fixtures in tests/event-detail-projection.test.mjs

---

## Phase 2: Foundational

**Purpose**: Create the shared pure projection boundary required by every user story.

- [x] T002 Implement the normalized event-detail result shape and safe legacy fallback in activity-scenes/event-detail-projection.js
- [x] T003 Replace panel-local normalization with the shared projector in activity-scenes/landmark-event-panel.js

**Checkpoint**: Both map-style canonical inputs and legacy inputs pass through one independently testable projection boundary.

---

## Phase 3: User Story 1 - Open source and ticket links from map details (Priority: P1) 🎯 MVP

**Goal**: Expose every applicable approved source offer from direct map event details.

**Independent Test**: Open a FunVee-shaped canonical activity from a map-style panel call and verify that "Fever Singapore" links to the approved Fever URL.

- [x] T004 [US1] Add failing activity-wide, multiple-source, session-scoped, duplicate, and unsafe source-offer assertions in tests/event-detail-projection.test.mjs
- [x] T005 [US1] Preserve offer identity, label, URL, scope, and applicable occurrence coverage in activity-scenes/event-detail-projection.js
- [x] T006 [US1] Add a direct map-panel canonical source-offer regression scenario to tests/event-ui.spec.mjs

**Checkpoint**: Valid approved links render for direct map openings and unsafe or inapplicable links do not.

---

## Phase 4: User Story 2 - See complete canonical schedules and details (Priority: P2)

**Goal**: Present the same sessions, venues, dates, times, and descriptive fields from map and search entry points.

**Independent Test**: Project a multi-session canonical activity and verify complete session count, venue membership, separate date/time values, approved descriptive fields, and unavailable missing fields.

- [x] T007 [US2] Add failing multi-session, multi-venue, date/time, descriptive-field, and missing-field assertions in tests/event-detail-projection.test.mjs
- [x] T008 [US2] Expand canonical sessions and venue groups and derive approved date/time values in activity-scenes/event-detail-projection.js
- [x] T009 [US2] Add map/search session and field parity coverage to tests/event-ui.spec.mjs

**Checkpoint**: Canonical event details no longer depend on whether the visitor started from a map highlight or search.

---

## Phase 5: User Story 3 - Preserve direct and conversational event-action parity (Priority: P3)

**Goal**: Keep direct reference links and `event.openreference` eligibility synchronized with selected panel state.

**Independent Test**: Select sessions with different scoped offers and verify panel context publishes the current stable reference identities used by the shared action executor.

- [x] T010 [US3] Add selected-session reference identity and eligibility assertions to tests/event-ui.spec.mjs
- [x] T011 [US3] Ensure panel context republishes applicable stable reference identities after open and session selection in activity-scenes/landmark-event-panel.js
- [x] T012 [US3] Verify event connector reference eligibility remains compatible in tests/assistant-event-connector.test.mjs

**Checkpoint**: Direct and conversational reference actions expose the same current eligible identities.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete feature and record executable proof.

- [x] T013 Run the focused pure, discovery, browser, assistant-connector, lint, formatting, and production-build commands from specs/018-event-detail-links/quickstart.md
- [x] T014 Record final validation results and any non-blocking environment limitations in specs/018-event-detail-links/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on T001 and blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on the shared projector and is the MVP.
- **User Story 2 (Phase 4)**: Depends on the shared projector; may build on the canonical offer expansion from US1.
- **User Story 3 (Phase 5)**: Depends on US1 reference identities and US2 session selection.
- **Polish (Phase 6)**: Depends on all user stories.

### User Story Dependency Graph

```text
Setup → Foundational → US1 → US2 → US3 → Polish
```

### Parallel Opportunities

- Browser fixture preparation for T006 can proceed independently of pure implementation after T004 defines expected offer behavior.
- Assistant connector compatibility inspection for T012 is read-only until T011 establishes final panel context.
- Final lint, focused Node tests, and documentation review can run in parallel after code stabilizes; the browser suite and production build remain bounded verification gates.

## Implementation Strategy

### MVP First

1. Complete T001-T003 to establish the shared projection boundary.
2. Complete T004-T006 to expose canonical links for direct map openings.
3. Verify the FunVee regression before expanding schedule parity.

### Incremental Delivery

1. **MVP**: Canonical source offers render safely from the map panel.
2. **Schedule parity**: Canonical sessions, venues, date, time, and descriptive fields align.
3. **Capability parity**: Current reference identities remain synchronized with conversational actions.
4. **Release proof**: Focused tests, lint, formatting, and production build pass.
