# Frontend performance baseline

Measurements were captured on 2026-07-14 on Apple Silicon macOS 26.5.1 using headless Chromium. The original reference is the checked-in `outputs/performance-baseline/latest.json` from before the baseline work; the current four-profile capture was produced with `node scripts/benchmark-frontend-performance.mjs --runs 1`, an 8-second settled observation, and 2-second controlled movement.

| Comparable desktop-cold metric |     Original |   Current |   Change |
| ------------------------------ | -----------: | --------: | -------: |
| UI ready                       |     989.9 ms | 1100.7 ms |   +11.2% |
| Network transfer               |    271.0 MiB |  60.3 MiB |   -77.7% |
| Used JS heap                   |    805.4 MiB | 471.7 MiB |   -41.4% |
| Worst long task                |       940 ms |    498 ms |   -47.0% |
| Movement FPS                   |          7.0 |       8.1 |   +15.7% |
| Full quality restored          | not asserted |       yes | new gate |

Current additional profiles:

| Profile      | UI ready | Transfer | Movement FPS | Full quality restored |
| ------------ | -------: | -------: | -----------: | --------------------- |
| Desktop warm | 613.6 ms | 38.1 MiB |          7.5 | yes                   |
| Mobile cold  | 332.3 ms | 54.4 MiB |         18.3 | yes                   |
| Mobile warm  | 576.4 ms | 33.5 MiB |         15.0 | yes                   |

The 111 ms desktop-cold startup increase is accepted for this baseline because startup now validates and exposes one approved snapshot and its freshness before composition. There is no fixed startup deadline, while transfer, heap, and worst-task reductions are materially larger. Warm startup is substantially faster. The map still has low movement FPS under the fully loaded 3D fixture; this remains a performance risk, not a reason to lower settled visual quality. Every profile now fails the benchmark if the configured background and POI screen-space error is not restored after movement.

Routine output stays under ignored `outputs/performance-baseline/`; release evidence is summarized here rather than committing raw machine-specific reports.

## Runtime diagnostics

Runtime diagnostics are a local developer tool, not product analytics. Enable them
explicitly:

```text
http://127.0.0.1:5173/?performanceDiagnostics=1
```

The compact panel reports:

- navigation completion;
- transferred bytes, request count, resource groups, and largest sanitized paths;
- long tasks, LCP, CLS, and INP when the browser exposes them;
- motion-only FPS and p95 frame time;
- JavaScript heap when supported; and
- active/configured POI layers and loaded tile counters.

Green means within the panel's diagnostic range, amber means warning, red means over its
diagnostic range, grey means pending or unsupported. Background-tab and reduced-motion
states are labelled because they affect frame interpretation.

Closing the panel or removing the map disconnects its observers, stops its timer and any
motion frame loop, detaches map/document listeners, and removes the interface. Without
`performanceDiagnostics=1`, the diagnostics module is not imported.

`Export snapshot` downloads a schema-versioned local JSON file. It contains aggregate
performance measurements and sanitized resource paths only. It does not contain or upload
location, search terms, snapshot or content identifiers, event or restaurant details,
plans, conversations, credentials, or URL queries. The file is bounded below 100 KiB and
is retained only if the developer chooses to keep it.

## Manual performance guardrails

`config/frontend-performance-budgets.json` defines checked-in per-profile red-line
guardrails. They are deliberately loose regression limits based on current/historical
measurements; they are not acceptable performance targets.

```sh
npm run benchmark:frontend
npm run benchmark:release
```

The first command records budget outcomes but does not fail on a breach. The second
command enforces them and fails after preserving the completed JSON and Markdown reports.
Both commands are advisory developer tools and are not invoked by the production release
workflow.
Every evaluation names the profile, metric, measured value, comparison direction,
threshold, severity, required status, and result. A missing required browser measurement
is explicit and fails enforcement; an optional unsupported measurement remains visible.
The separate context setup gate remains 10%; the wide-area setup red line is 35% after
current-snapshot measurements ranged from negligible contention to approximately 26%.

Benchmark reports use schema version 2 and record browser version, Node/OS/CPU context, git
revision and dirty state, complete resource attribution, heap, long tasks, navigation,
motion frames, map workload, visual-quality restoration, scenario correctness, and budget
evaluations. Compare runs from similar machines and conditions; one headless run is a
guardrail, not a user-experience SLO.
