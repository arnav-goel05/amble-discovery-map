# Quickstart: Proving Pipeline Optimizations

## 1. Run focused contract tests

```bash
node --test tests/event-pipeline-optimization.test.mjs
node --test tests/event-pipeline-comparison.test.mjs
```

## 2. Run the relevant existing regression set

```bash
npm run test:event-pipeline
node --test tests/event-venue-recovery.test.mjs tests/event-dashboard-sync.test.mjs
```

Run POI/build/browser gates only for categories that change their inputs:

```bash
npm run test:poi-separation
npm run build
npm run test:event-ui
```

The final Feature 017 convergence used the combined Node regression (216 tests), the
production build, POI/background separation, and the staged browser publication test.

## 3. Inspect category evidence

Each category writes an equivalence report with:

- canonical surface hashes and any path-level differences;
- before/after external calls, bytes, artifacts, gate executions, and blocking time;
- activated/rejected decision and reason.

Do not proceed to the next category when the report contains an unexplained difference or
does not improve its declared resource.

## 4. Full-run rule

Do not start a live full pipeline merely to benchmark a category. Use saved evidence and
staged fixtures first. Run `npm run event-pipeline -- start` only when the final convergence
audit identifies an end-to-end behavior that focused evidence cannot prove; if invoked, the
repository runner contract requires continuing until the CLI reports `complete: true` or a
genuine documented external blocker remains.

Feature 017 did not require a new live run: saved-run canonical parity plus the isolated
staged publication covered every changed contract without introducing live-provider noise.
