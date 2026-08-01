# Research: Quota-Safe Direct Release Pipeline

## Decision 1: Separate ordinary and release evidence

**Decision**: Ordinary CI validates a checked-in geometry fixture and forbids production
fallback. Full approved-geometry hydration and rendered fidelity checks run only in an explicit
release workflow.

**Rationale**: Runtime B3DM files are intentionally Git-ignored. The current clean-runner
hydration can fetch thousands of Worker/R2 objects. A fixture can prove parsing, integrity,
nesting, highlight/background separation, and failure behavior, but cannot prove the visual
fidelity of the complete production release; the release gate must retain that responsibility.

**Alternatives rejected**: Hydrating on every push spends quota and time. Checking large binary
geometry into Git defeats the lightweight repository policy. Skipping geometry checks entirely
would allow contract drift.

## Decision 2: Promote the exact tested commit

**Decision**: A manual release workflow accepts an immutable candidate SHA, verifies it belongs
to `develop`, checks that `main` can fast-forward, tests that checkout, re-checks both remote refs
immediately before promotion, then pushes the same SHA to `main`.

**Rationale**: A merge commit after testing would create a new, untested identity. Rechecking refs
closes the race where `develop` or `main` changes while the gate runs.

**Alternatives rejected**: Pull requests contradict the owner's chosen workflow. Force pushing or
manufacturing a merge hides divergence and invalidates evidence.

## Decision 3: Let main remain the deployment signal

**Decision**: Production deployment is triggered only by `main`; the release workflow does not
invoke a second deployment path. Existing Cloudflare build integration may continue watching
`main`, while repository policy verifies that non-main workflows contain no deploy command.

**Rationale**: One deployment signal prevents duplicate builds and keeps Cloudflare's deployment
record tied to the production branch.

## Decision 4: Use broad Chromium CI and the full release matrix

**Decision**: Ordinary CI runs all local unit/integration tests, all Playwright interaction specs
on Chromium desktop, and a named targeted mobile subset on Chromium mobile. Release runs all
relevant specs across Chromium, WebKit, and Firefox desktop/mobile, plus production geometry,
rendering, performance, inventory, and build gates.

**Rationale**: This catches routine regressions cheaply while reserving expensive compatibility
and real-geometry checks for the deliberate release boundary. Tests are grouped by risk rather
than duplicated without purpose.

## Decision 5: Bound monitoring and incident response

**Decision**: Uptime runs at 01:00 UTC (09:00 Singapore) with one attempt and a single issue title
used for deduplication. A Codex automation runs at 09:15 Singapore, exits quietly without an open
issue, and otherwise performs one diagnostic pass. It may push a tested code fix to `develop`, but
cannot update `main`, call paid providers, or deploy.

**Rationale**: A daily signal meets the owner's monitoring preference without exhausting quota.
The issue is durable coordination state, while production recovery remains deliberate.

## Decision 6: Encode policy as executable tests

**Decision**: Add repository tests that inspect workflow triggers, forbidden commands, fixture
size/hashes/failure variants, promotion semantics, schedules, and deployment exclusivity.

**Rationale**: Documentation alone drifts. Executable policy makes accidental reintroduction of
ordinary hydration, public object-head loops, or non-main deploys fail CI.
