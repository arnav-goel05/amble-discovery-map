# Implementation Plan: Reliable Pending Voice Selections

**Branch**: `develop` | **Date**: 2026-08-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/024-reliable-pending-dialogue/spec.md`

## Summary

Strengthen the existing relay-owned `PendingDialogue` state machine so candidate answers are
resolved before general routing, exact titles and unique normalized title fragments use stored
stable identities, ambiguous answers retain state and receive bounded deterministic choices, and
application-level invalid proposals recover without terminating a healthy voice session. Preserve
the current Cloudflare WebSocket transport, approved Realtime models, capability gateway, budget
controls, privacy boundaries, and unrelated action behavior.

## Technical Context

**Language/Version**: JavaScript ESM on Node.js 24+ and Cloudflare Workers

**Primary Dependencies**: Existing capability registry and validators, Ajv 8, OpenAI Realtime relay protocol; no new dependency

**Storage**: Session memory only; no database, filesystem, browser-storage, or production-log additions

**Testing**: Node built-in test runner, existing voice/capability unit suites, ESLint, Vite production build

**Target Platform**: Current desktop and mobile browsers connected to the Cloudflare Worker relay

**Project Type**: Existing browser application plus server-side realtime relay

**Performance Goals**: Pending selection resolution remains local and bounded to at most three candidates; no additional provider request or network round trip is added

**Constraints**: Work only on `develop`; implement Phase 1 only; preserve provider model, transport, budget, kill switch, response limits, privacy-safe logs, and terminal-failure policy; no edit-distance matching

**Scale/Scope**: One active pending dialogue per voice session, at most three verified candidates, four focused P1 user stories, and the existing voice regression surface

## Constitution Check

- **Branch workflow — PASS**: Work remains on `develop`; SpecKit feature numbering does not create or switch a Git branch.
- **Evidence — PASS**: Candidate labels and identities come only from validated capability results and refreshed authoritative interface context. Ambiguity produces clarification, never fabricated identity.
- **Automation — PASS**: Matching, state transitions, topic supersession, validation, and recovery remain deterministic and bounded. No agent or manual runtime intervention is introduced.
- **Identity and publication — PASS**: Stored stable target identities remain authoritative and single-use. This feature publishes no catalogue or geometry data and changes no reconciliation pipeline.
- **Boundaries — PASS**: `scripts/lib/pending-dialogue.mjs` owns pure interpretation; `cloudflare/realtime-relay.mjs` owns session routing and provider adaptation; the existing capability gateway owns validation and execution.
- **Shared capabilities — PASS**: The owning canonical capability and ordinary validators/executor remain unchanged. Direct controls are not reimplemented. Context revision and post-command refresh rules remain authoritative in every environment.
- **Conversational feedback — PASS**: Clarification is deterministic, uses verified labels, contains at most one question, and distinguishes ambiguity from terminal unavailability. No success is announced before a validated result.
- **Quality and security — PASS**: Regression coverage includes success, ambiguity, rejection, stale state, duplicate replies, invalid proposals, recovery, privacy allowlists, and unaffected connector behavior. No production platform request is required (`0` request budget).
- **UX and performance — PASS**: No UI rendering change or continuous work is introduced. Local bounded matching adds no provider call. Existing browser compatibility remains unaffected.
- **Operations and privacy — PASS**: The previously approved Feature 004 Realtime exception, owner, USD 10 lifetime cap, server-side credentials, disable control, and direct fallbacks remain unchanged. No output-token ceiling, content-bearing production diagnostic, persistent data, or new external service is introduced.

Post-design re-check: **PASS**. The data model and contract keep all state session-only, retain the
existing capability boundary, define closed outcomes, and add no constitutional exception.

## Project Structure

### Documentation (this feature)

```text
specs/024-reliable-pending-dialogue/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── pending-dialogue-resolution.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
scripts/lib/
└── pending-dialogue.mjs

cloudflare/
└── realtime-relay.mjs

tests/
├── realtime-relay.test.mjs
└── assistant-capability-turn-scope.test.mjs
```

**Structure Decision**: Extend the existing pure pending-dialogue interpreter and relay session
orchestration. Do not create another classifier, executor, state store, or provider adapter.

## Implementation Design

### Candidate interpretation

1. Normalize the utterance and verified labels using the existing Unicode, case, punctuation, and
   whitespace normalization boundary.
2. Resolve bounded rejection and mixed-condition language before candidate selection.
3. Resolve a valid ordinal against the active applicable choice set.
4. Treat bare affirmatives as before: resolve a sole reversible candidate and clarify a multi-
   candidate offer.
5. Treat unbound pronouns, including “that one,” as clarification in every candidate-count state.
6. Compare exact normalized titles and candidate-label token spans against candidate evidence left
   after bounded selection/action filler is removed.
7. Resolve only one unique candidate. If multiple candidates match, return their original indices
   as the narrowed clarification set. If no candidate matches but the reply is answer-like, retain
   the full pending state and clarify.
8. Do not use edit distance, phonetics, embeddings, or a provider classifier.

### State and routing

- `PendingDialogue` remains immutable. A clarification does not replace or consume its verified
  candidate identities.
- Interpretation returns a narrowed candidate subset for speech only; later replies may resolve
  against the full original pending dialogue unless an explicit applicable-choice mapping is
  needed to interpret a numbered narrowed prompt.
- A reply classified by the existing deterministic vocabulary as a clear supported application
  action supersedes pending state. Overlay-only fallback is not sufficient to supersede it.
- Any other unresolved reply remains inside pending mode and receives deterministic clarification.

### Recoverable errors

- Unknown, unrelated, unavailable, malformed, or schema-invalid provider proposals are recoverable
  only when current pending dialogue makes a deterministic clarification possible and transport/
  session integrity is otherwise valid.
- Recovery discards unsafe provider output, performs no capability proposal, preserves pending
  state, and schedules one fixed clarification response.
- Invalid call IDs, duplicate terminal-call conflicts, oversized payloads, broken response
  accounting, connection errors, and other integrity failures retain the terminal protocol path.

## Complexity Tracking

No constitutional violation or new complexity exception is required.
