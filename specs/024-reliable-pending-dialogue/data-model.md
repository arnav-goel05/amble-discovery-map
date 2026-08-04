# Data Model: Reliable Pending Voice Selections

All entities are session-memory values. Nothing in this feature is written to production storage,
browser storage, analytics, or content-bearing operational logs.

## PendingDialogue

| Field | Type | Rule |
| --- | --- | --- |
| `dialogueId` | bounded string | Unique within the voice session and single-use |
| `kind` | closed enum | Existing offer or candidate-choice kind |
| `capabilityId` | canonical capability ID | Owns the eventual ordinary gateway proposal |
| `candidates` | one to three `PendingCandidate` values | Immutable verified candidates in original display order |
| `applicableCandidateIndexes` | optional bounded integer array | Narrowed prompt order mapped back to original candidates; defaults to every candidate |
| `expectedReplies` | closed string array | Includes affirmation, rejection, ordinal, exact name, title fragment, unbound pronoun, and constraint |
| `contextRevision` | non-negative integer | Must equal current authoritative context before execution |
| `createdAtMs` | finite number | Diagnostic lifecycle metadata only; elapsed time does not expire the offer |
| `status` | closed enum | `active`, `resolved`, `rejected`, `superseded`, `stale`, or `consumed` |
| `clarificationSpeech` | nullable bounded string | Existing verified result-backed wording where available |

## PendingCandidate

| Field | Type | Rule |
| --- | --- | --- |
| `targetId` | bounded stable string | Verified identity from a capability result or refreshed context |
| `label` | bounded string | Verified user-facing label |
| `arguments` | closed object | Stored canonical arguments for the owning capability |
| normalized label | derived string | Unicode-normalized, lower-case, punctuation/spacing normalized; never authoritative identity |
| original ordinal | derived integer | Position in the complete candidate array |

## Applicable choice set

The complete candidate list remains authoritative. A clarification may narrow the presented list
to matching original candidate indexes. Numbered replies to that clarification resolve through
the mapping rather than renumbering or copying identities.

Example:

```text
complete candidates: [0 Reflect on Time, 1 Reflections at the Gallery, 2 Ballet]
matching indexes:     [0, 1]
clarification “second”: complete candidate index 1
```

## ResolutionOutcome

| Status | Additional data | Mutation allowed |
| --- | --- | --- |
| `resolved` | one stored candidate | Ordinary validated capability proposal only |
| `clarified` | reason and optional matching indexes | No |
| `rejected` | none | No; consume dialogue |
| `superseded` | clear supported action evidence | Only the new action through ordinary routing |
| `stale` | none | No |
| `unrecognized` | answer-like flag | No |

## State transitions

```text
created → active
active → resolved → consumed
active → clarified → active
active → rejected → consumed
active → superseded → consumed
active → stale → consumed
```

A duplicated, delayed, or interrupted reply cannot move `consumed` back to `active`.

## RecoverableDialogueError

| Field | Type | Rule |
| --- | --- | --- |
| `kind` | closed enum | `tool_not_available`, `tool_unrelated`, `arguments_malformed`, or `arguments_invalid` |
| `dialogueId` | current pending dialogue identity | Required for deterministic recovery |
| `clarificationCandidates` | verified candidate indexes | Used only to construct fixed clarification speech |
| `mutation` | constant | Always `none` |
| `sessionDisposition` | constant | `continue` |

Errors involving malformed call identity, duplicate-call conflict, budget/accounting integrity,
oversized messages, provider errors, or connection failure are not `RecoverableDialogueError`.

