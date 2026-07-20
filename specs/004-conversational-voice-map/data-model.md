# Data Model: Conversational Voice Map Assistant

## Persistence boundary

Only budget policy, reservations, and settlements persist in D1. Conversation content, audio,
transcripts, interface context, exact location, and confirmations are memory-only and are destroyed
on every terminal session path. Map assets are versioned checked-in artifacts, not user data.

## ConversationSession (memory only)

| Field                                      | Type               | Rules                                                                                                                                 |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`                                | opaque string      | Random, unique, not derived from identity                                                                                             |
| `protocolVersion`                          | string             | Must match relay and client contract                                                                                                  |
| `state`                                    | enum               | `idle`, `disclosure`, `connecting`, `listening`, `processing`, `speaking`, `awaiting_confirmation`, `degraded`, `stopping`, `stopped` |
| `createdAt`, `lastActivityAt`, `expiresAt` | timestamp          | Maximum five minutes; idle expiry sixty seconds                                                                                       |
| `responseCount`                            | integer            | Between 0 and 6                                                                                                                       |
| `transcriptItems`                          | `TranscriptItem[]` | Memory only; cleared at stop                                                                                                          |
| `intent`                                   | `DiscoveryIntent`  | Memory only                                                                                                                           |
| `contextRevision`                          | integer            | Monotonic revision of interface context                                                                                               |
| `pendingConfirmationId`                    | nullable string    | At most one active confirmation                                                                                                       |

**Transitions**: `idle → disclosure → connecting → listening`; listening and processing/speaking may
cycle while limits permit. Any state may enter `degraded` or `stopping`; `stopping → stopped` is
terminal. `awaiting_confirmation` returns to listening after accept, reject, expiry, interruption, or
context invalidation. A stopped session cannot resume.

## TranscriptItem (memory only)

| Field       | Type      | Rules                                                    |
| ----------- | --------- | -------------------------------------------------------- |
| `itemId`    | string    | Provider item ID or local text ID; unique within session |
| `role`      | enum      | `user`, `assistant`, `system`                            |
| `modality`  | enum      | `audio`, `text`                                          |
| `text`      | string    | Plain text; bounded length                               |
| `status`    | enum      | `partial`, `final`, `cancelled`                          |
| `createdAt` | timestamp | Session lifetime only                                    |

Partial events update an existing item by `itemId`; they never append duplicate transcript rows.

## DiscoveryIntent (memory only)

| Field                                         | Type                 | Rules                                                       |
| --------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `freeTextSummary`                             | string               | Bounded, model/local-parser summary; not persisted          |
| `interests`, `exclusions`                     | string arrays        | Values normalized against approved candidate attributes     |
| `timeWindow`, `priceRange`, `crowdPreference` | nullable constraints | Explicit or inferred with confidence                        |
| `transitConstraint`                           | nullable object      | Absent by default; present only after explicit user request |
| `specificity`                                 | enum                 | `area`, `place`, `item`                                     |

## RecommendationCandidate (memory or approved source data)

| Field              | Type         | Rules                                                                                         |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------- |
| `candidateId`      | string       | Stable approved entity identity                                                               |
| `candidateType`    | enum         | `event`, `venue`, `restaurant`, `deal`, `plan_stop`, `game`, or registered future public type |
| `sourceSnapshotId` | string       | Approved snapshot/result identity                                                             |
| `areaId`           | string       | Approved URA subzone code                                                                     |
| `coordinates`      | pair         | Approved longitude/latitude; never model-generated                                            |
| `attributes`       | object       | Allowlisted facts only                                                                        |
| `evidenceRefs`     | string array | Approved source identities/URLs already held by domain                                        |

## SuggestedArea (memory plus static geometry reference)

| Field                          | Type         | Rules                                                  |
| ------------------------------ | ------------ | ------------------------------------------------------ |
| `areaId`                       | string       | Stable URA subzone code                                |
| `areaName`, `planningAreaName` | string       | From approved map asset                                |
| `geometryRef`                  | string       | Reference to runtime asset feature, not model geometry |
| `rank`, `confidence`           | number       | Deterministically bounded and ordered                  |
| `reasonEvidence`               | object array | Each reason names supplied candidate attributes        |
| `tradeoffs`                    | object array | Supported limitations only                             |
| `candidateIds`                 | string array | Non-empty, known candidates in the area                |
| `status`                       | enum         | `create`, `update`, `noop`, `review`, `expire`         |

## VoiceActionContract (checked-in code/contract)

| Field                 | Type            | Rules                                          |
| --------------------- | --------------- | ---------------------------------------------- |
| `actionId`, `version` | string          | Stable and unique                              |
| `description`         | string          | User-visible semantic action                   |
| `argumentSchema`      | JSON Schema     | Closed object; no arbitrary selectors or URLs  |
| `eligibleStates`      | string array    | Required current application states            |
| `confirmationClass`   | enum            | `reversible` or `consequential`                |
| `contextProvider`     | string          | Registered provider of eligible stable targets |
| `resultSchema`        | JSON Schema     | Observable success/failure result              |
| `undoActionId`        | nullable string | Required when the direct UI offers undo        |

## InterfaceContextSnapshot (memory only)

| Field                                       | Type                   | Rules                                                        |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| `revision`                                  | integer                | Monotonic; action proposals bind to it                       |
| `viewport`                                  | object                 | Bounds, zoom, bearing; coordinates coarsened unless needed   |
| `visibleTargets`                            | ordered array          | Stable ID, type, ordinal, and short approved label           |
| `focusedTargetId`, `selectedTargetIds`      | nullable/string arrays | Must reference visible/registered targets                    |
| `activeOverlayId`                           | nullable string        | From overlay coordinator                                     |
| `activeFilters`                             | object                 | Allowlisted current filter state                             |
| `locationState`                             | enum/object            | Permission/freshness plus coarse relative context by default |
| `transitVisible`, `transitConstraintActive` | boolean                | Visibility never implies ranking constraint                  |
| `availableActionIds`                        | string array           | Eligible registry subset                                     |

## PendingConfirmation (memory only)

| Field                                        | Type          | Rules                                                                   |
| -------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `confirmationId`                             | random string | Single use                                                              |
| `actionId`, `canonicalArguments`, `targetId` | value         | Immutable after preview                                                 |
| `fingerprint`                                | string        | Hash of action, args, target, and context revision                      |
| `effectSummary`                              | string        | Exact user-visible consequence                                          |
| `createdAt`, `expiresAt`                     | timestamp     | Default expiry 25 seconds                                               |
| `status`                                     | enum          | `pending`, `accepted`, `rejected`, `expired`, `invalidated`, `executed` |

Only a later final user input or direct button may move `pending → accepted`. Execution revalidates
the fingerprint and state, then atomically moves `accepted → executed`. Every other terminal status
has zero side effect.

## UserLocationState (memory only)

| Field                           | Type               | Rules                                         |
| ------------------------------- | ------------------ | --------------------------------------------- |
| `permission`                    | enum               | `prompt`, `granted`, `denied`, `unavailable`  |
| `status`                        | enum               | `idle`, `locating`, `fresh`, `stale`, `error` |
| `coordinates`, `accuracyMeters` | nullable values    | Browser-supplied; never persisted             |
| `observedAt`                    | nullable timestamp | Used to mark stale data                       |
| `coarseAreaId`                  | nullable string    | Preferred assistant context                   |

## RuntimeMapAssetManifest (checked in)

| Field                             | Type          | Rules                         |
| --------------------------------- | ------------- | ----------------------------- |
| `schemaVersion`, `assetId`        | string        | Stable contract identity      |
| `sourceDatasetIds`                | string array  | data.gov.sg identities        |
| `sourceObservedAt`, `generatedAt` | timestamp     | Provenance and freshness      |
| `sourceHashes`, `contentHash`     | string/object | Immutable evidence            |
| `featureCount`                    | integer       | Validated non-negative count  |
| `status`                          | enum          | `approved`, `stale`, `review` |

## VoiceBudgetPolicy (checked-in policy plus D1 singleton)

| Field                                                                 | Type      | Rules                                              |
| --------------------------------------------------------------------- | --------- | -------------------------------------------------- |
| `policyVersion`                                                       | string    | Pins model, transcription model, rates, and limits |
| `owner`                                                               | string    | `Arnav (project owner)`                            |
| `capMicroUsd`                                                         | integer   | Exactly `10_000_000`                               |
| `spentMicroUsd`, `reservedMicroUsd`                                   | integer   | Non-negative; sum never exceeds cap                |
| `enabled`                                                             | boolean   | D1 kill switch, default false until configured     |
| `modelId`, `rateCardVersion`                                          | string    | Exact allowlisted values                           |
| `maxSessionSeconds`, `idleSeconds`, `maxResponses`, `maxOutputTokens` | integer   | Server-enforced bounds                             |
| `updatedAt`                                                           | timestamp | Operational state only                             |

## VoiceBudgetReservation (persisted, no conversation content)

| Field                                 | Type            | Rules                                       |
| ------------------------------------- | --------------- | ------------------------------------------- |
| `reservationId`                       | string          | Random unique identity                      |
| `sessionIdHash`                       | string          | Non-reversible operational correlation only |
| `kind`                                | enum            | `input_transcription`, `response`           |
| `reservedMicroUsd`, `settledMicroUsd` | integer         | Settled never exceeds reserved              |
| `status`                              | enum            | `reserved`, `settled`, `held`, `void`       |
| `usageShapeHash`, `rateCardVersion`   | nullable/string | No transcript or provider payload           |
| `createdAt`, `settledAt`              | timestamps      | Operational reconciliation                  |

**Invariant**: The transaction creating a reservation succeeds only when
`spentMicroUsd + reservedMicroUsd + requestedMicroUsd <= capMicroUsd` and `enabled = true`.
Unknown/missing usage leaves the reservation `held`; it is never optimistically released.
