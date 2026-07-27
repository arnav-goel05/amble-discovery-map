# Feature Specification: Guided Event Filters

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-26

**Status**: In Progress — inline sentence and local-classifier revision

**Input**: User description: "Match the AI Autocomplete reference with one evolving
sentence, bold selected values instead of pills, and a dedicated next-step flow inside the
options panel. Preserve deviations from the recommended path, accept free text, and use a
local deterministic classifier to place recognized phrases into What, When, Where, and
Price without an external AI service."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Build a Partial Event Search (Priority: P1)

As an event explorer, I can build one readable event-search sentence whose selected values
appear as bold inline phrases, so the interface feels like composing a request rather than
managing filter controls.

**Why this priority**: Order-independent, immediately applied filters are the core
replacement for the current keyword search and deliver useful discovery after one action.

**Independent Test**: Open event discovery, follow the recommended What → When → Where →
Price sequence, and verify every selected value becomes bold within one sentence while the
options panel advances to the next unfilled dimension.

**Acceptance Scenarios**:

1. **Given** the composer has no selections, **When** the visitor opens it, **Then** one
   natural-language prompt and the What options appear without a separate dashboard of
   filter cards.
2. **Given** the visitor selects a What value, **When** the selection commits, **Then** the
   value becomes bold within the sentence and the same options panel advances to When.
3. **Given** one or more values are selected, **When** the sentence renders, **Then** it
   contains no pill backgrounds, borders, close icons, or duplicated selected-value cards.
4. **Given** the visitor selected When or Where first, **When** they stop interacting,
   **Then** the partial filter remains active and the current matching results remain usable.
5. **Given** the visitor activates a bold phrase, **When** they replace or remove it from
   its option view, **Then** the sentence and results update without disturbing other
   phrases.

---

### User Story 2 - Find and Combine Recognized Options (Priority: P2)

As an event explorer, I can type a complete or partial natural-language request and have
recognized phrases classified into the appropriate dimensions while unmatched descriptive
language remains a usable What keyword.

**Why this priority**: Free-form input permits deviations from the recommended path, while
local classification keeps common dates, prices, locations, and categories fast,
anonymous, and predictable.

**Independent Test**: Type "art workshops this weekend near Esplanade under $25", commit
the request, and verify the classifier produces What, When, Where, and Price phrases plus
any unmatched What keywords without a network request.

**Acceptance Scenarios**:

1. **Given** the options panel is open, **When** the visitor types part of an option label,
   **Then** the panel shows compact classified suggestions in the most suitable dimension.
2. **Given** typed text such as "romantic" matches no structured option, **When** the
   visitor commits it, **Then** it becomes a bold What keyword and searches approved event
   text without being forced into an unrelated option.
3. **Given** one What option is active, **When** the visitor selects another What option,
   **Then** both categories remain active and events matching either category qualify.
4. **Given** one When, Where, or Price option is active, **When** another option from the
   same dimension is selected, **Then** the newer option replaces the earlier option.
5. **Given** more inline phrases than fit on one line, **When** the builder renders, **Then**
   the sentence wraps without hiding its editable text or active selections.
6. **Given** a phrase could map to more than one source-backed option, **When** confidence
   is insufficient for automatic classification, **Then** the panel presents the
   alternatives for explicit confirmation rather than guessing.

---

### User Story 3 - Recover from Over-Filtering (Priority: P3)

As an event explorer, I receive useful recovery choices when no events match, so I can
broaden the search without manually guessing which constraint caused the empty result.

**Why this priority**: Guided recovery prevents the structured filter builder from
becoming a dead end when otherwise valid options conflict.

**Independent Test**: Select a known zero-result combination and verify the interface
offers one-click phrase removals with the number of events each removal would reveal.

**Acceptance Scenarios**:

1. **Given** active filters produce no results, **When** filtering completes, **Then** the
   interface identifies removable phrases that would restore results and shows the
   resulting event count for each useful removal.
2. **Given** a recovery suggestion, **When** the visitor selects it, **Then** the named
   phrase is removed and the restored results appear immediately.
3. **Given** no single phrase removal restores results, **When** the empty state renders,
   **Then** the interface still offers a clear-all action.

### Edge Cases

- Geolocation permission is denied or unavailable after the visitor selects Near me.
- No events expose a known price, or a particular category/location has no upcoming events.
- A selected venue or landmark no longer exists after the event dataset refreshes.
- Current map area contains no events or changes while its Where phrase is active.
- The custom date range is incomplete, reversed, or entirely in the past.
- Typing differs only by case, accents, punctuation, common aliases, or a minor spelling
  error from a recognized option.
- One sentence includes overlapping venue and category names.
- A free-text phrase contains words that resemble a date or price but are part of a title.
- Keyboard, pointer, and touch interaction must not create duplicate phrases.

## Scope and Constraints _(mandatory)_

- **In scope**: Replacing the current event keyword input with one sentence-style filter
  composer; compact progressive disclosure inside the option surface; bold editable
  phrases; live results; order-independent and partial selection; deterministic local
  classification of typed requests; residual What-keyword search; What, When, Where, and
  Price groups; empty-result recovery; keyboard, pointer, and touch use.
- **Out of scope**: External or generative AI, learned semantic inference, open-web search,
  audience suitability, personalized ranking, saved filters, and new event enrichment
  solely to create filter labels.
- **Evidence and dependencies**: What values come from existing event categories; location
  values come from approved event/landmark placement data; price and schedule filtering
  use existing event fields. Missing or unapproved values are not inferred. No paid
  service or new external API is introduced.
- **Privacy and lifecycle**: Filtering remains anonymous. Near me uses the visitor's
  current location only for the active interaction and does not persist, transmit, or log
  exact location. Filter state does not outlive the page session.
- **Experience**: The builder visually follows the approved AI Autocomplete reference: one
  white rounded sentence field, regular connector words, bold selected phrases, a circular
  commit arrow, and one compact option card beneath it. It supports the project's current
  desktop and mobile browsers, clear keyboard focus, screen-reader labels, touch targets,
  wrapped phrases, and restrained motion. Results remain available after any valid partial
  selection. Opening the builder preserves meaningful map context.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: One sentence-style guided filter composer MUST replace the current event
  keyword search as the single event-discovery entry point.
- **FR-002**: The empty builder MUST show the natural-language lead-in, an editable text
  tail, the current What values, and compact labels for the remaining When, Where, and
  Price steps inside one option surface; it MUST NOT render four dashboard cards.
- **FR-002A**: The same option surface MUST show values from only the active dimension.
  Its remaining-dimension labels MUST allow a visitor to deviate from the recommended
  sequence without returning to a separate chooser.
- **FR-003**: Visitors MUST be able to choose the four filter dimensions in any order,
  skip any dimension, and stop after any valid selection.
- **FR-004**: Every option selection, phrase replacement, and phrase removal MUST update
  results immediately. Typed text MUST commit with Enter or the circular arrow.
- **FR-005**: Active selections and committed residual text MUST appear as bold, borderless
  inline phrases in a readable sentence. They MUST NOT use pill backgrounds, close icons,
  or duplicated selected-value cards, and MUST wrap when space is constrained.
- **FR-006**: While the visitor types, the option surface MUST show compact source-backed
  suggestions in the most suitable dimension. On commit, recognized phrases MUST become
  structured selections and unmatched meaningful text MUST remain a What query rather
  than being discarded or forced into an unrelated option.
- **FR-007**: What MUST use the categories present in the active event dataset and MUST
  allow multiple category selections using inclusive matching.
- **FR-008**: When MUST offer Today, This weekend, Next 7 days, Next 30 days, and Choose
  dates. Only one When selection may be active; Choose dates MUST support a bounded custom
  start/end range.
- **FR-009**: Where MUST offer Near me, Current map area, Anywhere in Singapore, and
  recognized neighbourhood, landmark, and venue options backed by approved event placement
  data. Only one Where selection may be active.
- **FR-010**: Near me MUST default to a three-kilometre radius. If location access is
  unavailable or denied, the visitor MUST receive a non-blocking explanation and usable
  alternative Where options.
- **FR-011**: Venue, landmark, and neighbourhood values MUST NOT appear in the initial
  dimension chooser. Choosing Where MUST show Near me, Current map area, Anywhere in
  Singapore, and a compact relevant subset; typing MUST search the complete recognized
  location list.
- **FR-012**: Price MUST offer Free, Under $25, $25–$50, $50–$100, and Over $100. Only one
  Price selection may be active, and events with unknown prices MUST NOT qualify for a
  selected price band.
- **FR-013**: When a new When, Where, or Price option is chosen, it MUST replace the
  existing phrase in that dimension; choosing an active What option MUST toggle it off.
  Activating a bold phrase MUST open its dimension for replacement or removal.
- **FR-014**: The builder MUST preserve valid active selections when it opens, closes, or
  the visible results refresh.
- **FR-015**: A zero-result state MUST calculate useful single-phrase removals, label each
  with the number of results it restores, and provide a clear-all action when no single
  removal restores results.
- **FR-016**: Current map area MUST recompute against the visible map bounds when map
  movement completes while that Where selection is active.
- **FR-017**: Stale selections that disappear from a refreshed dataset MUST be removed
  safely and explained without blocking unrelated filters.
- **FR-018**: The builder MUST define and test loading, ready, empty, permission-denied,
  stale-selection, and unexpected-error states.
- **FR-019**: Classification and filtering MUST remain deterministic, run locally, and
  MUST NOT call an AI service, send typed text over the network, or infer structured
  filters beyond recognized source-backed options and explicit grammar rules.
- **FR-020**: Existing event selection, event detail, map focus, result ordering, and
  category/date/price behavior MUST remain compatible unless explicitly changed above.
- **FR-021**: On desktop, the open panel MUST remain compact enough that the map remains
  visibly usable around it, and its unequal option counts MUST NOT create empty
  dashboard-style columns.
- **FR-022**: After a value is selected, the option surface MUST advance to the next
  unfilled dimension in What → When → Where → Price order while still allowing the visitor
  to choose another remaining dimension or stop.
- **FR-023**: The option surface MUST omit already-filled single-value dimensions from its
  remaining-step labels. Activating the corresponding bold phrase MUST restore its editing
  view. Recognized typed matching MUST remain available for adding another What value or
  replacing a single-value dimension.
- **FR-024**: The local classifier MUST apply explicit date and price grammar first, then
  longest exact normalized catalog labels, then supported deterministic aliases. If
  equally credible candidates remain, it MUST present them for confirmation rather than
  guessing.
- **FR-025**: The classifier MUST tolerate case, accents, ordinary punctuation, and
  connector words while preserving the visitor's meaningful unmatched text.
- **FR-026**: Direct composer actions and shared public event-search actions MUST project
  to the same filter state and results. Background catalog refreshes with unchanged
  content MUST preserve the active option DOM and keyboard focus.

### Key Entities _(include if feature involves data)_

- **Filter option**: A recognized choice with a stable identity, dimension, user-facing
  label, availability, and source-backed value used by event filtering.
- **Active phrase**: A selected filter option or committed residual What query with its
  sentence position and any bounded parameters, such as custom dates or Near me radius.
- **Classification result**: The source text, non-overlapping structured matches,
  unmatched What query, and any ambiguous candidates requiring confirmation.
- **Filter state**: The unordered set of active What, When, Where, and Price constraints
  used to calculate the current event result set.
- **Recovery suggestion**: A removable active phrase paired with the number of events that
  would match if that phrase were removed.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A visitor can follow What → When → Where → Price, begin from any other
  dimension, or stop after one choice while retaining usable matching results.
- **SC-002**: All 24 permutations of selecting What, When, Where, and Price produce the
  same final result set for equivalent selections.
- **SC-003**: Every valid partial state from zero through all four dimensions remains
  usable and produces either matching results or an actionable empty state.
- **SC-004**: Recognized options and result counts visibly update within 200 milliseconds
  after local typing, selection, removal, or map-area reconciliation in the supported test
  dataset.
- **SC-005**: The approved classifier fixture corpus maps every explicit date, price, and
  exact catalog phrase deterministically; unmatched meaningful text remains unchanged as
  a What query.
- **SC-006**: Every tested zero-result combination either offers a one-click removal that
  restores results or a clear-all recovery action.
- **SC-007**: Core filtering and recovery flows complete using keyboard alone and at
  supported mobile widths without clipped or unreachable phrases.
- **SC-008**: At the standard desktop test viewport, opening the builder leaves at least
  half of the viewport area outside the menu and no dimension renders an empty filler
  column.
- **SC-009**: Committing a classified sentence performs zero network requests and produces
  the same classification on repeated runs.
- **SC-010**: The sentence composer and compact option flow pass the supported desktop and
  mobile browser projects without clipped text, hidden commit controls, or pill styling.

## Assumptions

- Existing categories are the complete What taxonomy for this version.
- The active event dataset and approved landmarks contain the labels and coordinates needed
  for supported venue and landmark choices; neighbourhood choices are shown only when
  approved placement data provides a recognized neighbourhood label.
- Anywhere in Singapore represents the absence of a geographic restriction and therefore
  may remove the active Where phrase while still appearing as an explicit option.
- The current event ordering remains the default ranking; this feature changes filtering,
  not recommendation ranking.
- Three kilometres is the initial Near me radius and is not user-adjustable in this
  version.
- Local classification is English-first for this version and recognizes only grammar,
  labels, and aliases explicitly shipped with the application.
