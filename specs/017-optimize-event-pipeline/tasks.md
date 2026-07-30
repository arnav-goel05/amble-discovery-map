# Tasks: Optimize Event Pipeline

**Input**: Design documents in `specs/017-optimize-event-pipeline/`

**Branch**: `develop`

## Phase 1: Baseline and foundational contracts

- [x] T001 Record the approved saved-run baseline, canonical surfaces, artifact hashes, and
      resource measurements in `specs/017-optimize-event-pipeline/baseline.md`.
- [x] T002 [US1] Add failing canonical equivalence fixtures and tests in
      `tests/event-pipeline-optimization.test.mjs`.
- [x] T003 [US1] Implement canonical surface comparison in
      `scripts/lib/event-pipeline/equivalence.mjs` and integrate it with
      `scripts/compare-event-pipeline-runs.mjs`.
- [x] T004 [US1] Add failing checkpoint identity, output-integrity, invalidation, and atomic
      write tests in `tests/event-pipeline-optimization.test.mjs`.
- [x] T005 [US1] Implement stage input manifests, checkpoints, dependency invalidation, and
      resource metrics in `scripts/lib/event-pipeline/stage-checkpoints.mjs` and
      `scripts/lib/event-pipeline/resource-metrics.mjs`.
- [x] T006 [US3] Prove generalized execution-context/configuration fixtures contain no
      event-, venue-, organizer-, source-name-, or Singapore-specific orchestration branches.
- [x] T007 Run focused tests plus `npm run test:event-pipeline` and comparison regressions;
      record Category A parity/resource evidence before continuing.

## Phase 2: Persistent recovery reuse and independent scheduling

- [x] T008 [US2] Add failing tests for cross-run positive/negative recovery reuse, 7/30-day
      expiry, immediate invalidation, provenance, and zero external calls.
- [x] T009 [US2] Implement an atomic persistent evidence-keyed recovery cache in
      `scripts/lib/event-sources/tinyfish-venue-recovery.mjs` using the contract in
      `contracts/recovery-cache-contract.md`.
- [x] T010 [US2] Add orchestration tests proving an ambiguous branch is held for
      review while unrelated safe branches continue deterministically.
- [x] T011 [US2] Integrate cross-run cache reuse into the normal pipeline path and preserve
      terminal review-branch isolation without changing approval or source semantics.
- [x] T012 Run focused tests plus event venue/source/pipeline regression suites; record
      Category B parity and external-call/blocking-time evidence before continuing.

## Phase 3: Incremental frontend assets and authoritative gate reuse

- [x] T013 [US1] Add failing fixtures with 12 changed and at least 100 unchanged POIs,
      asserting unchanged asset hashes and changed-only extraction.
- [x] T014 [US1] Implement immutable content-addressed frontend asset planning/reuse in
      `scripts/event-frontend-snapshot.mjs` and `scripts/event-pipeline.mjs`.
- [x] T015 [US1] Add failing tests for exact-input gate receipts, output tampering,
      code/config invalidation, retry-after-one-failed-gate, and one authoritative barrier.
- [x] T016 [US1] Separate frontend assembly from gate execution and reuse exact successful
      gate receipts in `scripts/event-pipeline.mjs` and `scripts/lib/event-pipeline/run-state.mjs`.
- [x] T017 Run focused tests plus POI separation, build, event UI, and staged browser tests;
      record Category C parity, asset-byte, extraction, and gate-execution evidence.

## Phase 4: Idempotent finalization and complete observability

- [x] T018 [US2] Add failing tests for unchanged finalization retry, changed destination or
      payload, failed delivery retry, and bounded redacted metrics.
- [x] T019 [US2] Implement content-keyed admin reconciliation/publication/dashboard delivery
      receipts in `scripts/event-pipeline.mjs` and
      `scripts/lib/event-pipeline/dashboard-sync.mjs`.
- [x] T020 [US2] Instrument stage duration, wait/blocking time, external calls, cache hits,
      bytes, artifacts, and gate reuse through the existing trace/status surfaces.
- [x] T021 Run focused tests plus dashboard, reconciliation, approved-snapshot, and pipeline
      regressions; record Category D parity and side-effect/observability evidence.

## Phase 5: Convergence and release proof

- [x] T022 Run Spec Kit analysis/convergence against every functional requirement and success
      criterion; append and complete any missing work.
- [x] T023 Scan general orchestration for new case-specific hardcoding and verify all cache
      keys/invalidation inputs are complete.
- [x] T024 Run the combined focused and existing regression suite and production build.
- [x] T025 Compare the final staged candidate with the approved baseline using canonical
      equivalence and unchanged-asset hashes.
- [x] T026 Decide from documented evidence whether a complete live pipeline is necessary; if
      necessary, execute it to terminal completion under the repository runner contract.
- [x] T027 Update `quickstart.md`, optimization evidence, and final convergence report with
      retained/rejected categories, measured improvements, known limits, and no unproved claims.

## Dependencies and execution order

- T001–T007 establish the proof system and block later category activation.
- T008–T012 complete Category B before Category C begins.
- T013–T017 complete Category C before Category D begins.
- T018–T021 complete Category D before convergence.
- Within each category, failing tests precede implementation; focused and relevant existing
  tests plus parity evidence must pass before the next category starts.
- A full live run is not a routine task and is executed only under T026 when focused evidence
  cannot prove a remaining end-to-end requirement.
