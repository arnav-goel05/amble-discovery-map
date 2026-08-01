# Data Model: Conversational Voice Map Assistant

> **2026-08-01 amendment:** Provider classification and transcript/classification join fields below
> are legacy states and are no longer populated by native ingress. The active turn owns one final
> transcript, deterministic routing result, and optional scoped connector stage. Event residual
> text is empty unless the user used an explicit event keyword-search prefix.

## Persistence boundary

Only budget policy, reservations, and settlements persist in D1. Conversation content, audio,
interface context, exact location, and confirmations are memory-only and are destroyed on every
terminal session path. An explicitly activated local-development audit may retain already-sanitized
diagnostic records, including provider-generated transcript events that actually existed, inside
the bounded gitignored owner-only store below. Map assets are versioned checked-in artifacts, not
user data.

## ConversationSession (memory only)

| Field                         | Type               | Rules                                                                                                                                 |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`                   | opaque string      | Random, unique, not derived from identity                                                                                             |
| `protocolVersion`             | string             | Must match relay and client contract                                                                                                  |
| `state`                       | enum               | `idle`, `disclosure`, `connecting`, `listening`, `processing`, `speaking`, `awaiting_confirmation`, `degraded`, `stopping`, `stopped` |
| `createdAt`, `lastActivityAt` | timestamp          | Observability and ordering only; neither timestamp authorizes automatic session expiry                                                |
| `activeResponseStage`         | nullable enum      | `classification`, `domain`, or `final`; at most one unresolved provider response stage                                                |
| `activeTranscriptJoin`        | nullable object    | Active audio item, final transcript, classification result, and single-use join state; cleared terminally                             |
| `transcriptItems`             | `TranscriptItem[]` | Memory only; cleared at stop                                                                                                          |
| `intent`                      | `DiscoveryIntent`  | Memory only                                                                                                                           |
| `contextRevision`             | integer            | Monotonic revision of interface context                                                                                               |
| `pendingConfirmationId`       | nullable string    | At most one active confirmation                                                                                                       |
| `responseWatchdog`            | nullable timer     | Armed only while one provider response is active; cleared on response/session terminal paths                                          |
| `turnTrace`                   | nullable object    | Content-free current-turn phase/timing state; replaced when the next response is requested                                            |

**Transitions**: `idle → disclosure → connecting → listening`; listening and processing/speaking may
cycle while the session remains explicitly active. Any state may enter `degraded` or `stopping`; `stopping → stopped` is
terminal. `awaiting_confirmation` returns to listening after accept, reject, expiry, interruption, or
context invalidation. Provider, transport, admission, kill-switch, and budget failures transition
through `stopping → stopped` after publishing the required unavailable presentation; they never
transition into a local conversational session. A stopped session cannot resume.

## VoiceTurnTrace (memory only plus emitted operational records)

| Field                  | Type           | Rules                                                             |
| ---------------------- | -------------- | ----------------------------------------------------------------- |
| `sessionIdHash`        | one-way string | Operational correlation only; raw session ID is never emitted     |
| `turnNumber`           | integer        | Monotonic within one session                                      |
| `phase`                | bounded enum   | Approved lifecycle phase or `response_timeout` only               |
| `phaseStartedAt`       | timestamp      | Server clock                                                      |
| `elapsedMs`            | integer        | Since `response_requested`, non-negative                          |
| `sincePreviousPhaseMs` | integer        | Non-negative duration between emitted phases                      |
| `eventCode`            | nullable enum  | Allowlisted lifecycle code, never a raw provider event or payload |
| `terminalReason`       | nullable enum  | Public bounded stop reason only                                   |

The emitted record uses an exact allowlist. Audio, transcript text, prompts, tool arguments/results,
provider bodies, exact location, secrets, and raw session identifiers are structurally impossible.
Records are minimal reliability logs, not product analytics.

## LocalContentDiagnosticRecord (local process output; optional bounded audit)

| Field           | Type           | Rules                                                                   |
| --------------- | -------------- | ----------------------------------------------------------------------- |
| `schemaVersion` | exact string   | `1.0`                                                                   |
| `event`         | exact string   | `voice.content_debug`                                                   |
| `sessionIdHash` | one-way string | Correlates with phase logs; never the raw session ID                    |
| `occurredAt`    | timestamp      | Local relay clock                                                       |
| `direction`     | bounded enum   | Browser/relay/provider boundary direction                               |
| `eventType`     | bounded string | Sanitized protocol type or `unknown`                                    |
| `payload`       | JSON value     | Complete permitted message after recursive redaction and audio omission |

This record exists only when the local Node process starts with explicit content-debug activation.
It is written to that process's standard diagnostic output. When the separate persistent-audit
flag is also active, the same already-sanitized record may enter `LocalContentAuditSet`. It has no
database, cache, browser-storage, analytics, or remote-transport sink. Recursive sanitization replaces
credential/authentication/cookie/token/signing fields, raw session identities, and raw or encoded
audio before either logger receives the record. Process exit ends the diagnostic stream but does
not delete an audit file still inside its retention boundary.

## LocalContentAuditSet (local development files only)

| Field       | Type         | Rules                                                                       |
| ----------- | ------------ | --------------------------------------------------------------------------- |
| `directory` | fixed path   | `outputs/realtime-content-audit/`, gitignored, mode `0700`                  |
| `files`     | JSONL files  | At most five, each mode `0600`, each smaller than 5 MiB                     |
| `createdAt` | timestamp    | Filename and file metadata support deterministic newest-first cleanup       |
| `expiresAt` | timestamp    | No later than seven days after creation; enforced at startup and rotation   |
| `records`   | audit record | Sanitized diagnostics or bounded fingerprint/oversize markers only          |
| `transport` | exact value  | `local_file`; no uploader, analytics, telemetry, database, or browser store |

Activation transition:

`off → local_content_debug → local_content_audit`

The final transition requires the separate audit flag before relay construction. Preview,
production, browser messages, admission payloads, URLs, and headers cannot enter it. Write or
cleanup failure transitions only the audit sink to `unavailable`; the voice session continues
unchanged with a safe bounded process warning.

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

## DomainInterpretation (memory only)

| Field                  | Type                 | Rules                                                                          |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `domain`               | enum                 | `event`, `restaurant`, `plan`, or `map`; event is required in this amendment   |
| `normalizedUtterance`  | bounded string       | Plain text; never a selector, URL, or executable identifier                    |
| `outcome`              | enum                 | `applicable`, `clarification_required`, or `unsupported`                       |
| `clarificationChoices` | bounded object array | Current stable option IDs and labels only; empty unless clarification required |
| `proposedCalls`        | bounded object array | Closed capability ID/argument pairs; empty unless applicable                   |
| `baseContextRevision`  | integer              | Must still equal current authoritative revision at execution                   |
| `catalogRevision`      | nullable string      | Required when interpretation depends on an option catalogue                    |

Interpretation is pure and has no domain side effect. An ambiguous, unsupported, or stale
interpretation commits nothing. Proposed calls must still pass the ordinary capability gateway.

## EventComposerState (memory only)

| Field               | Type                 | Rules                                                                       |
| ------------------- | -------------------- | --------------------------------------------------------------------------- |
| `canonicalSentence` | bounded string       | Deterministically rendered from ordered phrases plus residual query         |
| `residualQuery`     | bounded string       | Meaningful unmatched wording projected through the existing query field     |
| `phrases`           | bounded object array | Ordered stable What/When/Where/Price IDs, facet, label, and recognized span |
| `catalogRevision`   | string               | Fingerprint of the exact recognized option catalogue used                   |
| `contextRevision`   | integer              | Authoritative application revision containing this complete composer state  |

`event.applyquery` replaces or refines this object atomically. The direct composer, connected
assistant, results projection, and `InterfaceContextSnapshot` render this same post-command object.

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

## CapabilityContract (checked-in code/contract)

| Field                     | Type            | Rules                                                               |
| ------------------------- | --------------- | ------------------------------------------------------------------- |
| `capabilityId`, `version` | string          | Stable and unique                                                   |
| `kind`                    | enum            | `query` or `command`                                                |
| `description`             | string          | User-visible semantic capability                                    |
| `connectorId`             | string          | Registered authoritative domain connector                           |
| `argumentSchema`          | JSON Schema     | Closed object; no arbitrary selectors or URLs                       |
| `eligibleStates`          | string array    | Required current registered application states                      |
| `confirmationClass`       | enum            | `none`, `reversible`, or `consequential`; queries always use `none` |
| `contextProvider`         | string          | Registered provider of eligible stable targets                      |
| `resultSchema`            | JSON Schema     | Bounded query result or observable command outcome                  |
| `undoCapabilityId`        | nullable string | Required when the direct UI offers undo                             |

## DomainConnector (code-owned adapter)

| Field                 | Type          | Rules                                                                    |
| --------------------- | ------------- | ------------------------------------------------------------------------ |
| `connectorId`         | string        | Stable identity; one authoritative domain owner                          |
| `capabilityIds`       | string array  | Non-empty subset registered by this connector                            |
| `snapshot()`          | function      | Returns bounded authoritative domain state                               |
| `subscribe(listener)` | function      | Emits after direct or assistant-originated relevant state changes        |
| `execute()`           | function      | Commands only; invokes the domain's shared executor                      |
| `query()`             | function      | Queries only; returns approved bounded projections                       |
| `availability`        | enum/function | `available`, `empty`, `disabled`, `unsupported`, or policy-derived state |

Connectors contain no duplicated business rules. `saved` and `game` capabilities are unavailable
when their registered data or direct controls are empty.

## CapabilityResult (memory only)

| Field               | Type          | Rules                                                                  |
| ------------------- | ------------- | ---------------------------------------------------------------------- |
| `capabilityId`      | string        | Must match the invoked contract                                        |
| `kind`              | enum          | `query` or `command`                                                   |
| `status`            | enum          | `completed`, `empty`, `unavailable`, `failed`, `confirmation_required` |
| `changed`           | boolean/null  | Required boolean for commands; `null` for queries                      |
| `affectedTargetIds` | string array  | Known stable identities only                                           |
| `contextRevision`   | integer       | Authoritative revision after completion                                |
| `data`              | object/null   | Must match the capability's bounded result schema                      |
| `errorCode`         | nullable enum | Public allowlisted failure identity; never a raw exception             |

Every result validates against both the common capability-result envelope and its registered
capability-specific result schema. For a changed command, `contextRevision` is greater than the
proposal revision; equality is allowed only for no-op or non-completed results.

## CapabilityProjection (checked-in descriptor fixture)

| Field                     | Type        | Rules                                               |
| ------------------------- | ----------- | --------------------------------------------------- |
| `protocol`                | enum        | `realtime_function` or `mcp_foundation`             |
| `capabilityId`, `version` | string      | Copied from one registered version-2 contract       |
| `kind`                    | enum        | `query` or `command`; never changes semantics       |
| `name`, `description`     | string      | Deterministically derived and bounded               |
| `inputSchema`             | JSON Schema | Exact closed registered argument schema             |
| `resultSchema`            | JSON Schema | Exact registered capability-specific result schema  |
| `enabled`                 | boolean     | Always `false` for `mcp_foundation` in this release |

The projection has no executor. A fixture invocation resolves the capability ID through the shared
gateway; it cannot call a connector directly or introduce transport/authentication behavior.

## InvocationContext (memory only)

| Field              | Type    | Rules                                                      |
| ------------------ | ------- | ---------------------------------------------------------- |
| `callerOrigin`     | enum    | `direct`, `voice`, `same_session_text`, or `mcp_fixture`   |
| `proposalRevision` | integer | Validated by the same gateway for every origin             |
| `sessionId`        | string? | Opaque and memory-only when an active voice session exists |

Caller origin is diagnostic metadata, not authority. It cannot alter eligibility, confirmation,
privacy, validation, execution, or result semantics.

## CatalogSearchResult (memory only)

| Field             | Type                      | Rules                                                          |
| ----------------- | ------------------------- | -------------------------------------------------------------- |
| `query`           | normalized bounded string | Plain text; never interpreted as a URL or selector             |
| `types`           | enum array                | Approved public catalogue types only                           |
| `catalogRevision` | string                    | Hash of the ordered connector provenance vector                |
| `sources`         | connector/revision array  | Approved snapshot plus participating dynamic-state revisions   |
| `total`           | integer                   | Count before the response limit                                |
| `truncated`       | boolean                   | True when `total` exceeds returned items                       |
| `items`           | `CatalogResultItem[]`     | Maximum 20, deterministic order                                |
| `nextCursor`      | nullable opaque string    | Optional bounded continuation; no caller-controlled offset SQL |

Each `CatalogResultItem` contains `targetId`, `type`, `label`, optional area/venue/date/price/status
summary, and an allowlisted attribute projection. It never includes raw HTML, arbitrary source
payloads, exact user location, or an unapproved URL. Semantic validation requires
`truncated === (total > items.length)`; `nextCursor` is non-null exactly when another bounded page
exists.

## InterfaceContextSnapshot (memory only)

| Field                                       | Type                   | Rules                                                        |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| `revision`                                  | integer                | Monotonic; action proposals bind to it                       |
| `viewport`                                  | object                 | Bounds, zoom, bearing; coordinates coarsened unless needed   |
| `visibleLayers`                             | closed boolean object  | Recommendation, location, MRT-station, and MRT-line state    |
| `visibleTargets`                            | ordered array          | Stable ID, type, ordinal, and short approved label           |
| `focusedTargetId`, `selectedTargetIds`      | nullable/string arrays | Must reference visible/registered targets                    |
| `activeOverlayId`                           | nullable string        | From overlay coordinator                                     |
| `assistantPresentation`                     | nullable enum          | Recommendations, clarification, or honest no-match state     |
| `activeFilters`                             | object                 | Allowlisted state including canonical `EventComposerState`   |
| `locationState`                             | enum/object            | Permission/freshness plus coarse relative context by default |
| `transitVisible`, `transitConstraintActive` | boolean                | Visibility never implies ranking constraint                  |
| `availableCapabilityIds`                    | string array           | Eligible registry subset                                     |
| `stateDigest`                               | string                 | Hash of assistant-relevant canonical state                   |

## CapabilityTurnScope (memory only)

| Field                       | Type         | Rules                                                                |
| --------------------------- | ------------ | -------------------------------------------------------------------- |
| `families`                  | string array | Connector families inferred from bounded request and interface state |
| `capabilityIds`             | string array | Eligible capabilities in those families only                         |
| `deterministicCapabilityId` | nullable ID  | Obvious command executed locally; excluded from provider tools       |

The relay rebuilds provider tools before each response from this scope plus the three bounded
foundational queries. A new authoritative context changes eligibility but does not itself expose
every eligible command to the model.

## PendingConfirmation (memory only)

| Field                                            | Type          | Rules                                                                   |
| ------------------------------------------------ | ------------- | ----------------------------------------------------------------------- |
| `confirmationId`                                 | random string | Single use                                                              |
| `callId`                                         | opaque string | Binds proposal, confirmation, execution, and terminal result            |
| `capabilityId`, `canonicalArguments`, `targetId` | value         | Immutable after preview                                                 |
| `fingerprint`                                    | string        | Hash of action, args, target, and context revision                      |
| `effectSummary`                                  | string        | Exact user-visible consequence                                          |
| `createdAt`, `expiresAt`                         | timestamp     | Default expiry 25 seconds                                               |
| `status`                                         | enum          | `pending`, `accepted`, `rejected`, `expired`, `invalidated`, `executed` |

Only a later final user input or direct button may move `pending → accepted`. Execution revalidates
the fingerprint and state, then atomically moves `accepted → executed`. Every other terminal status
has zero side effect. Duplicate matching terminal events return the stored in-memory result;
conflicting replays are protocol violations.

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

| Field                               | Type      | Rules                                                                                                                  |
| ----------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `policyVersion`                     | string    | Pins the native-audio response model, rates, and limits                                                                |
| `owner`                             | string    | `Arnav (project owner)`                                                                                                |
| `capMicroUsd`                       | integer   | Exactly `10_000_000`                                                                                                   |
| `spentMicroUsd`, `reservedMicroUsd` | integer   | Non-negative; sum never exceeds cap                                                                                    |
| `enabled`                           | boolean   | D1 kill switch, default false until configured                                                                         |
| `modelId`, `rateCardVersion`        | string    | `gpt-realtime-2.1-mini` and its exact reviewed rate card; no fallback                                                  |
| `maxResponseStagesPerTurn`          | integer   | At most three internal provider stages for one admitted user turn; prevents loops without limiting conversation length |
| `responseTimeoutSeconds`            | integer   | Exactly 30 in the first release; bounds one stalled provider response, not the session                                 |
| `providerMaxOutputTokens`           | integer   | Provider intrinsic maximum used only for worst-case cost reservation; never transmitted as a generation ceiling        |
| `updatedAt`                         | timestamp | Operational state only                                                                                                 |

## VoiceBudgetReservation (persisted, no conversation content)

| Field                                 | Type            | Rules                                                                                              |
| ------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `reservationId`                       | string          | Random unique identity                                                                             |
| `sessionIdHash`                       | string          | Non-reversible operational correlation only                                                        |
| `kind`                                | enum            | `response` or `input_transcription`; at most one transcription reservation per admitted audio turn |
| `reservedMicroUsd`, `settledMicroUsd` | integer         | Settled never exceeds reserved                                                                     |
| `status`                              | enum            | `reserved`, `settled`, `held`, `void`                                                              |
| `usageShapeHash`, `rateCardVersion`   | nullable/string | No transcript or provider payload                                                                  |
| `createdAt`, `settledAt`              | timestamps      | Operational reconciliation                                                                         |

**Invariant**: The transaction creating a reservation succeeds only when
`spentMicroUsd + reservedMicroUsd + requestedMicroUsd <= capMicroUsd` and `enabled = true`.
Unknown/missing usage leaves the reservation `held`; it is never optimistically released.

## NativeAudioTurn (memory only)

| Field                        | Type            | Rules                                                                       |
| ---------------------------- | --------------- | --------------------------------------------------------------------------- |
| `turnId`                     | string          | Browser-owned bounded identity                                              |
| `responseReservationId`      | string          | Reserved before audio is accepted for the turn                              |
| `transcriptionReservationId` | string          | Independently reserved once for input transcription                         |
| `contextRevision`            | integer         | Authoritative revision bound by the relay                                   |
| `activeToolMenu`             | object          | Current classification, domain, or final provider projection                |
| `inputCommitted`             | boolean         | Becomes true immediately before provider buffer commit                      |
| `providerInputItemId`        | nullable string | Binds the committed provider audio item to final transcription events       |
| `responseCreated`            | boolean         | Single-use guard against duplicate response creation                        |
| `joinState`                  | enum            | `waiting`, `classification_ready`, `transcript_ready`, `joined`, `terminal` |

State transition:

`requested → operations_reserved → audio_committed → classification_and_transcription → joined → routed → responding → settled`

Any admission, policy, network, provider, timeout, transcription, or protocol failure transitions
through existing terminal cleanup and clears both reservations and join state.

## NativeVoiceClassification (memory only)

| Field                  | Type            | Rules                                                                 |
| ---------------------- | --------------- | --------------------------------------------------------------------- |
| `domain`               | bounded enum    | Optional non-authoritative routing proposal                           |
| `eventQuery`           | nullable object | Closed proposed event facets only; never supplies utterance evidence  |
| `boundContextRevision` | integer         | Copied from authoritative relay state, never supplied by the provider |
| `state`                | enum            | `awaiting_call`, `ready`, `joined`, or `terminal`                     |

The classification exists only for the active turn. It is model interpretation used for routing,
contains no utterance, and is cleared on completion, interruption, timeout, or stop.

## FinalInputTranscript (memory only)

| Field    | Type    | Rules                                                                     |
| -------- | ------- | ------------------------------------------------------------------------- |
| `itemId` | string  | Must match the active committed provider audio item                       |
| `text`   | string  | Non-empty bounded final provider transcript; authoritative turn utterance |
| `status` | enum    | `final`, `failed`, or `terminal`                                          |
| `joined` | boolean | Single-use guard; true only after pairing with active classification      |

Partial deltas may update UI transcript state but cannot authorize routing or mutation. The final
transcript is session-scoped and is never persisted outside explicitly authorized local audit.

## NativeToolMenu (memory only)

| Field           | Type            | Rules                                                                                           |
| --------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `stage`         | enum            | `opening`, `classification`, `domain`, or `final`                                               |
| `connectorId`   | nullable string | Present only for a routed domain menu                                                           |
| `capabilityIds` | string array    | Empty, exactly one provider-only classification tool, or at most fifteen IDs from one connector |
| `toolChoice`    | enum/object     | `none`, forced classification, or `auto`                                                        |

Menu transitions require an acknowledged provider configuration. Application capability entries
remain derived from the shared registry and current authoritative eligibility.

## ProviderCapabilityAliasMap (memory only)

| Field             | Type                 | Rules                                                         |
| ----------------- | -------------------- | ------------------------------------------------------------- |
| `canonicalToWire` | immutable string map | Every registered canonical capability appears exactly once    |
| `wireToCanonical` | immutable string map | Exact inverse; every wire name matches provider grammar       |
| `revision`        | deterministic digest | Changes only when the ordered capability contract set changes |

Canonical IDs remain authoritative. Provider aliases are never emitted to the browser or stored in
capability results.

## ProviderConfigurationState (memory only)

| Field                  | Type              | Rules                                            |
| ---------------------- | ----------------- | ------------------------------------------------ |
| `nextRevision`         | integer           | Monotonic within one provider session            |
| `pendingRevision`      | nullable integer  | At most one unacknowledged update                |
| `acceptedRevision`     | integer           | Most recently acknowledged update                |
| `pendingContinuation`  | nullable function | Opening or turn response creation; single use    |
| `acknowledgementTimer` | nullable timer    | Uses the bounded provider configuration deadline |

State transition:

`idle → configuration_pending → configuration_accepted → response_requested`

Provider error, timeout, stale acknowledgement, or conflicting update transitions through the
ordinary provider-unavailable terminal cleanup.

## VoiceEventFacetProposal (session memory only)

| Field           | Type                             | Rules                                                            |
| --------------- | -------------------------------- | ---------------------------------------------------------------- |
| `domain`        | `event`, `other`, or `ambiguous` | Required on every forced native ingress                          |
| `what`          | array of facet selections        | At most six unique approved current What labels                  |
| `when`          | nullable facet selection         | At most one approved current When label                          |
| `where`         | nullable facet selection         | At most one approved current Where label                         |
| `price`         | nullable facet selection         | At most one approved current Price label                         |
| `residualQuery` | string                           | At most 200 characters; meaningful utterance-derived terms only  |
| `unresolved`    | unique facet array               | Subset of `what`, `when`, `where`, `price`; causes clarification |

Each facet selection has `{ label, evidence }`. `label` must resolve uniquely inside the current
facet catalogue. `evidence` must be a bounded non-empty span present in the model-heard utterance.
The proposal is not persisted and is not authoritative.

## EventFacetCatalogue (authoritative interface context)

| Field             | Type         | Rules                                                  |
| ----------------- | ------------ | ------------------------------------------------------ |
| `catalogRevision` | string       | Matches the current event composer catalogue           |
| `what`            | string array | Unique bounded approved category labels                |
| `when`            | string array | Unique bounded approved date-option labels             |
| `where`           | string array | Unique bounded approved placement/area/landmark labels |
| `price`           | string array | Unique bounded approved price labels                   |

The catalogue is capped by the existing 100-option event projection and serialized compactly
inside the existing 16 KiB browser-relay message bound. A later catalogue or application revision
invalidates the proposal.

State transition:

`provider proposal → schema valid → catalogue/evidence verification → verified | clarification | rejected`

Only `verified` may enter the existing atomic `event.applyquery` execution. Typed and direct
queries do not construct this entity.

## FixedSpeechDelivery (session memory only)

| Field        | Type            | Rules                                                                |
| ------------ | --------------- | -------------------------------------------------------------------- |
| `expected`   | nullable string | Relay-owned grounded text; never model-authored                      |
| `buffer`     | bounded events  | At most 2 MiB of sanitized assistant audio/text events               |
| `retryCount` | integer         | Zero or one; shares the existing three-stage per-turn response guard |

State transition:

`expected → buffered → transcript_match → released`

On mismatch, the buffer is discarded and the same fixed text is retried once. A second mismatch
terminates through protocol cleanup. Tool-stage buffers follow the same release boundary but are
discarded whenever a function call is produced.
