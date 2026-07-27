# UI Contract: Guided Event Filter Builder

## Public component contract

`createLandmarkEventSearch` remains the scene-owned event-discovery component. Its public
surface continues to expose:

- `input`: the option-narrowing input element
- `refresh()`: recompute discovery from current filters
- `refreshViewport()`: reproject a cached discovery result when geography is unchanged
- `setDiscoveryModel(model)`: replace and reconcile the active option catalog
- `dispatch(actionId, args)`: retain supported direct-action compatibility
- `destroy()`: remove listeners and DOM

The scene additionally supplies:

- a synchronous current-map-bounds reader
- an asynchronous one-shot current-location request

Neither callback may persist or log exact user location.

## Interaction contract

1. Focusing an empty input opens one compact option card on What values, with remaining
   When, Where, and Price step labels inside the card.
2. Activating a remaining step or a bold sentence phrase shows values from only that
   dimension in the same card.
3. Selecting a value commits it as a bold borderless sentence phrase, updates results
   immediately, omits filled single-value steps, and advances to the next unfilled step.
4. Typing shows compact source-backed suggestions. Enter or the round arrow classifies the
   complete draft locally, commits structured matches, and preserves meaningful unmatched
   text as a bold What query.
5. Up/Down moves the active choice, Enter activates a focused choice or commits the draft,
   Escape closes the popup, and Backspace on an empty input removes the last phrase.
6. Pointer/touch activation selects the same option as keyboard activation.
7. A valid selection or phrase removal immediately projects filter state, calls discovery,
   updates pills and minimap, and re-renders results.
8. Bold phrases are borderless buttons with accessible edit names. Their dimension view
   provides a clearly named removal action.
9. Venue, landmark, and area values appear only in the Where view or in typed matches.
10. The desktop card uses one compact column and does not stretch to the full application
    shell width.

## Local classifier contract

1. Classification is a pure synchronous function over bounded text and the current option
   catalog; it performs no network, storage, logging, or time-dependent lookup.
2. Explicit date/price grammar outranks catalog labels; longer exact catalog labels outrank
   shorter overlapping labels; deterministic aliases rank below exact labels.
3. Only source-backed catalog options or fixed application presets can become structured
   matches.
4. Equal-confidence conflicts are returned in `ambiguous` and are not silently applied.
5. Connector words around accepted phrases may be discarded; all meaningful unmatched
   text remains in `residualQuery`.

## Option contract

### What

- Values: categories returned by the active discovery model.
- Multiplicity: zero or more.
- Composition: inclusive within What, intersected with other dimensions.

### When

| ID                  | Label        | Discovery projection               |
| ------------------- | ------------ | ---------------------------------- |
| `when:today`        | Today        | Current local day                  |
| `when:this-weekend` | This weekend | Saturday through Sunday local time |
| `when:7-days`       | Next 7 days  | Seven local days including today   |
| `when:30-days`      | Next 30 days | Thirty local days including today  |
| `when:custom`       | Choose dates | Applied start/end date inputs      |

Multiplicity: zero or one.

### Where

| ID                       | Label                          | Discovery projection               |
| ------------------------ | ------------------------------ | ---------------------------------- |
| `where:near-me`          | Near me                        | Current coordinate within 3 km     |
| `where:map-area`         | Current map area               | Current visible map bounds         |
| `where:anywhere`         | Anywhere in Singapore          | No geographic restriction          |
| `where:mystery-location` | Mystery Location               | Existing secret/TBA placement view |
| source-backed IDs        | Area, landmark, or venue label | Exact source-backed predicate      |

Multiplicity: zero or one.

### Price

| ID               | Label     | Discovery projection         |
| ---------------- | --------- | ---------------------------- |
| `price:free`     | Free      | Existing free classification |
| `price:under-25` | Under $25 | Existing nonzero band        |
| `price:25-50`    | $25–$50   | Existing band                |
| `price:50-100`   | $50–$100  | Existing band                |
| `price:100-plus` | Over $100 | Existing band                |

Multiplicity: zero or one.

## Result and recovery contract

- Ready results retain current activity ordering and event result selection behavior.
- Empty results display useful single-phrase removal buttons with exact restored counts.
- If no single removal restores results, Clear all is present.
- Permission denial leaves prior filters/results intact, announces the reason, and keeps
  other Where choices usable.
- Unexpected errors retain the existing non-destructive error presentation and emit
  `event-search:error`.

## Responsive and accessibility contract

- Mobile controls have at least a 44 by 44 CSS px activation area.
- Inline phrases wrap and remain visible at 320 CSS px width and enlarged text.
- Text/icon contrast meets 4.5:1 for normal text; selection is not communicated by color
  alone.
- Focus is not moved automatically except as a direct result of arrow-key list navigation
  or removal of the currently focused phrase.
- Live result counts and permission/stale/error messages use polite announcements.
