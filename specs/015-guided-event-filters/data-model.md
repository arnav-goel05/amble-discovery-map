# Data Model: Guided Event Filters

## FilterOption

Represents one selectable, source-backed choice.

| Field             | Meaning                                                           | Validation                                   |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `id`              | Stable option identity                                            | Dimension-prefixed, non-empty, unique        |
| `dimension`       | `what`, `when`, `where`, or `price`                               | Required enum                                |
| `value`           | Discovery-model value                                             | Required and valid for the dimension         |
| `label`           | Visible option label                                              | Non-empty source-backed or fixed preset text |
| `searchableLabel` | Normalized label used only to narrow options                      | Derived, never user-authored                 |
| `kind`            | Optional subtype such as landmark, venue, area, radius, or bounds | Valid for its dimension                      |
| `availableCount`  | Unfiltered activities represented by the option                   | Non-negative integer                         |

Fixed When and Price options have stable application-defined identities. What and Where
identities derive from existing category, landmark, venue, or area identities.

## ActivePhrase

Represents a selected option in the visible sentence. The implementation may retain the
existing `filterTokens` compatibility name at its public action boundary.

| Field            | Meaning                                                  | Validation                             |
| ---------------- | -------------------------------------------------------- | -------------------------------------- |
| `optionId`       | Reference to a current FilterOption                      | Must resolve or be reconciled as stale |
| `dimension`      | Copied dimension                                         | Must match referenced option           |
| `label`          | Current visible label                                    | Refreshed from option catalog          |
| `selectionOrder` | Position in the inline sentence                          | Unique increasing integer              |
| `parameters`     | Bounded custom dates, bounds, or ephemeral center/radius | Valid for option kind                  |
| `state`          | active, pending-permission, stale, or error              | Required enum                          |

What permits multiple active option IDs. When, Where, and Price each permit at most one.

## ClassificationResult

| Field           | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `sourceText`    | Original committed text, bounded to the input limit            |
| `matches`       | Non-overlapping structured option matches with confidence data |
| `residualQuery` | Meaningful unmatched What text in original readable order      |
| `ambiguous`     | Equal-confidence candidates that need explicit confirmation    |

Each match includes `optionId`, `dimension`, `label`, `matchedText`, `start`, `end`,
`confidence`, and `source` (`grammar`, `catalog`, or `alias`). Classification results are
ephemeral and never stored or transmitted.

## FilterState

The complete ephemeral filter selection.

| Field             | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| `tokens`          | ActivePhrase structured selections in sentence order            |
| `query`           | Committed residual What text                                    |
| `optionQuery`     | Uncommitted text used to classify and narrow FilterOptions      |
| `activeDimension` | Dimension whose values are currently disclosed, or none         |
| `customDateDraft` | Unapplied date input values                                     |
| `status`          | idle, loading, ready, empty, permission-denied, stale, or error |

The state is held only for the current page session. It contains no durable user identity.

## DiscoveryFilter

Projection consumed by event discovery.

| Field                               | Meaning                                      |
| ----------------------------------- | -------------------------------------------- |
| `query`                             | Residual What text from local classification |
| `categories`                        | Zero or more selected What values            |
| `dateRange`, `dateStart`, `dateEnd` | One selected When value                      |
| `priceRange`                        | One selected Price value                     |
| `where`                             | Optional source-backed geographic predicate  |
| `placementView`                     | Existing placement compatibility filter      |

`where` is one of:

- `{ kind: "radius", center: [longitude, latitude], radiusKm: 3 }`
- `{ kind: "bounds", west, south, east, north }`
- `{ kind: "area", areaId }`
- `{ kind: "landmark", landmarkId }`
- `{ kind: "venue", venueKey }`
- absent for Anywhere in Singapore

## RecoverySuggestion

| Field           | Meaning                           | Validation                           |
| --------------- | --------------------------------- | ------------------------------------ |
| `tokenId`       | Active token proposed for removal | Must resolve to current active token |
| `label`         | Concise removal action            | Includes token label                 |
| `restoredCount` | Activities matching after removal | Positive integer                     |

Suggestions are recalculated from the current FilterState and are not persisted.

## State Transitions

```text
idle -> loading -> ready
idle -> choosing-option -> choosing-option
choosing-option -> classifying -> choosing-option
idle -> pending-permission -> ready
pending-permission -> permission-denied
ready -> loading -> ready | empty | error
empty -> loading -> ready | empty
ready | empty -> stale -> loading -> ready | empty
```

- Selecting What toggles that category without changing other What tokens.
- Choosing a dimension changes disclosure state only and never changes discovery results.
- Selecting a recognized value advances disclosure to the next unfilled dimension.
- Selecting When, Where, or Price removes the existing token in that dimension and appends
  the new token in the current selection position.
- Selecting Anywhere removes the existing Where restriction.
- Removing any token projects and applies the remaining state immediately.
- Committing typed text replaces matching single-value dimensions, adds unique What
  options, and replaces the residual query in one atomic render/update.
- Snapshot replacement reconciles tokens by option ID; missing source-backed tokens are
  removed and announced as stale.
