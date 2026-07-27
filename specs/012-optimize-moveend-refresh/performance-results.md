# Performance Results: Optimize Map-Move Event Refresh

**Date**: 2026-07-25
**Environment**: Headed Chromium, Apple M4 Metal renderer, 1440×900 viewport
**Route**: Checked-in deterministic 1.5-second map movement
**Trials**: Three per mode
**Evidence**: `outputs/map-performance-diagnostics/issue-1-moveend-refresh-primed/report.json`

Both modes completed the same full discovery pass before motion, closed the search UI, and
then ran the same map route. The only changed workload was the move-end refresh mode.

| Metric (median of 3) | Legacy full refresh | Viewport-only refresh | Change |
| --- | ---: | ---: | ---: |
| Move-end refresh duration | 449.6 ms | 11.4 ms | 97.5% lower |
| Full discovery count after route | 3 | 2 | 1 repeated pass removed |
| Average FPS | 44.87 | 52.85 | 17.8% higher |
| Worst frame | 483.3 ms | 201.4 ms | 58.3% lower |
| Long-task time | 484 ms | 216 ms | 55.4% lower |
| Median frame | 16.7 ms | 16.7 ms | unchanged |
| p95 frame | 18.7 ms | 18.6 ms | effectively unchanged |

The two pre-route discovery passes are intentional and identical: one initializes the
density model and one primes the search result. Only the legacy mode performs the third
full pass at `moveend`.

An additional unprimed production run measured the safe startup case at 0.0 ms because no
search result existed yet and viewport refresh correctly returned without work.

## Success criteria

- SC-001: PASS — zero additional full discovery passes during optimized movement.
- SC-002: PASS — refresh duration improved 97.5%, exceeding the 80% target.
- SC-003: PASS — focused and full event-discovery browser behavior passed.
- SC-004: PASS — relevant tests, cross-browser matrix, lint, and build passed.
