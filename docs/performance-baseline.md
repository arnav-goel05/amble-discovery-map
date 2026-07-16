# Frontend performance baseline

Measurements were captured on 2026-07-14 on Apple Silicon macOS 26.5.1 using headless Chromium. The original reference is the checked-in `outputs/performance-baseline/latest.json` from before the baseline work; the current four-profile capture was produced with `node scripts/benchmark-frontend-performance.mjs --runs 1`, an 8-second settled observation, and 2-second controlled movement.

| Comparable desktop-cold metric | Original | Current | Change |
| --- | ---: | ---: | ---: |
| UI ready | 989.9 ms | 1100.7 ms | +11.2% |
| Network transfer | 271.0 MiB | 60.3 MiB | -77.7% |
| Used JS heap | 805.4 MiB | 471.7 MiB | -41.4% |
| Worst long task | 940 ms | 498 ms | -47.0% |
| Movement FPS | 7.0 | 8.1 | +15.7% |
| Full quality restored | not asserted | yes | new gate |

Current additional profiles:

| Profile | UI ready | Transfer | Movement FPS | Full quality restored |
| --- | ---: | ---: | ---: | --- |
| Desktop warm | 613.6 ms | 38.1 MiB | 7.5 | yes |
| Mobile cold | 332.3 ms | 54.4 MiB | 18.3 | yes |
| Mobile warm | 576.4 ms | 33.5 MiB | 15.0 | yes |

The 111 ms desktop-cold startup increase is accepted for this baseline because startup now validates and exposes one approved snapshot and its freshness before composition. There is no fixed startup deadline, while transfer, heap, and worst-task reductions are materially larger. Warm startup is substantially faster. The map still has low movement FPS under the fully loaded 3D fixture; this remains a performance risk, not a reason to lower settled visual quality. Every profile now fails the benchmark if the configured background and POI screen-space error is not restored after movement.

Routine output stays under ignored `outputs/performance-baseline/`; release evidence is summarized here rather than committing raw machine-specific reports.
