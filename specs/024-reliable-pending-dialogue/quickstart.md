# Quickstart: Validate Reliable Pending Voice Selections

## Prerequisites

- Node.js 24 or newer
- Repository dependencies installed
- Current branch is `develop`
- No live provider credential is required

## Focused validation

Baseline before Phase 1 implementation (2026-08-02):

- Command: `node --test tests/realtime-relay.test.mjs`
- Result: 70 passed, 0 failed.

Run the pure interpreter and relay regression suite:

```bash
node --test tests/realtime-relay.test.mjs
```

Expected outcomes include:

- `the second one` selects the second stored candidate;
- `add Reflect on Time` selects the exact offered title;
- `add Reflect` selects only a unique matching offered title;
- `that one` always clarifies with zero mutation;
- a fragment shared by two titles presents only those two choices;
- an ambiguous reply retains pending state and the next ordinal resolves it;
- `never mind` rejects and consumes the offer;
- an explicit restaurant or map action supersedes and routes normally;
- an invalid tool or argument with recoverable pending context clarifies without stopping;
- duplicated and stale replies never execute twice.

## Voice and routing regression

```bash
npm run test:voice
node --test tests/assistant-capability-turn-scope.test.mjs
```

Expected: all existing voice action families, dialogue, lifecycle, privacy, model-policy, and
turn-scoping fixtures pass.

## Static and build validation

```bash
npm run lint
npm run build:ci
```

Expected: no lint errors and a successful production build using the existing model, transport,
and audio contract.

## Privacy check

Inspect the pending-dialogue operational-log assertions in `tests/realtime-relay.test.mjs`.
Expected: records contain closed outcome codes and content-free metadata only; no utterance,
candidate label, target identity, arguments, provider body, precise location, secret, or raw audio.

## Scope check

Confirm the diff contains no Agents SDK, WebRTC, model, transcription, VAD, audio-gate, or exact-
word enforcement changes. Those remain later roadmap phases.

## Completed validation (2026-08-02)

- `node --test tests/realtime-relay.test.mjs tests/assistant-capability-turn-scope.test.mjs`: 100 passed, 0 failed.
- `npm run test:voice`: 261 passed, 0 failed.
- `npm run test:unit`: 962 passed, 0 failed.
- `npm run lint`: completed with 0 errors.
- `npm run build:ci`: completed successfully after the unit snapshot generator finished.
- `git diff --check`: completed with no whitespace errors.
- Added-line scope scan: no Agents SDK, WebRTC, model, transcription, VAD, output-token, audio-gate, exact-word, or dependency changes.

The first repeated build was intentionally run concurrently with `npm run test:unit` and observed
the unit snapshot generator replacing one POI tile while Vite copied it. The authoritative
sequential build immediately afterward passed; this was a validation-command concurrency race,
not a product-code failure.
