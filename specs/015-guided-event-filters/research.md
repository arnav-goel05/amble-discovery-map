# Research: Guided Event Filter Sentence

## Sentence composer and local classification

- **Decision**: Use one sentence composer with bold borderless phrase buttons and a native
  input tail. Enter or the round arrow commits typed text through a pure local classifier.
- **Rationale**: This matches the approved reference while remaining fast, private,
  deterministic, accessible, and explainable.
- **Alternatives considered**: An external LLM adds network, cost, latency, privacy, and
  nondeterminism without being needed for the bounded vocabulary. A contenteditable
  sentence complicates screen-reader output, selection, deletion, and mobile keyboards.

## Classifier precedence

- **Decision**: Match explicit date and price grammar first, then the longest exact
  normalized source-backed catalog labels, then supported deterministic aliases. Resolve
  only non-overlapping matches. Equal-confidence conflicts remain ambiguous for explicit
  confirmation. Preserve meaningful residual text as the existing What query.
- **Rationale**: Longest-first prevents a short label from stealing a more specific venue
  or category phrase. Confirmation prevents silent guessing. Residual query text supports
  deviations such as "romantic" without inventing a new structured filter.
- **Alternatives considered**: Regex alone cannot cover the dynamic category/location
  catalog. Fuzzy or embedding similarity can produce unsupported high-confidence matches.

## Guided flow and multiplicity

- **Decision**: Open directly on What values with small remaining-step labels in the same
  option card. Advance through What → When → Where → Price after each selection. Allow any
  remaining label or bold phrase to be activated at any time. What remains inclusive
  multi-select; When, Where, and Price remain single-value replacements.
- **Rationale**: The recommended path teaches the available structure without locking the
  visitor into a wizard or recreating the four-column dashboard.

## Dates, price, and locations

- **Decision**: Retain the existing fixed date and price identities. Today is the local
  day; This weekend is Saturday through Sunday in Singapore time; Next 7/30 days include
  today. Retain source-backed areas, landmarks, venues, Current map area, a three-kilometre
  Near me radius, Anywhere, and Mystery Location.
- **Rationale**: Existing discovery predicates are deterministic and already tested.
  Runtime geocoding or inferred neighbourhoods would weaken the evidence boundary.

## Accessibility and layout

- **Decision**: Use native input/buttons and listbox semantics, visible focus states,
  keyboard traversal, 44 CSS px mobile targets, and wrapping sentence phrases. Selected
  values use bold text without pills or close icons. The desktop card remains a compact
  single column that leaves the map visible.
- **Rationale**: The design closely follows the reference while retaining predictable
  focus and accessible editing/removal names.

## Compatibility, privacy, and performance

- **Decision**: Keep the existing shared event actions and filter projection. Use the
  existing discovery `query` only for residual What text. Classification performs no
  fetch, storage, logging, or analytics and is covered by a deterministic fixture corpus.
  Preserve catalog fingerprints so unchanged refreshes do not replace focused option DOM.
- **Rationale**: Direct UI, voice, and internal callers continue to produce the same filter
  state. In-memory matching is comfortably within the 200 ms interaction target.
