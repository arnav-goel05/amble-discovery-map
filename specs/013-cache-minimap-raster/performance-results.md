# Performance Results: Cache Minimap Raster

**Date**: 2026-07-25
**Environment**: Headed Chromium, Apple M4 Metal renderer, 1440×900
**Route**: Checked-in 1.5-second map movement
**Trials**: Six per mode, counterbalanced in two three-trial runs

Evidence:

- `outputs/map-performance-diagnostics/issue-2-minimap-cache/report.json`
- `outputs/map-performance-diagnostics/issue-2-minimap-cache-reversed/report.json`

| Metric (median of 6) | Legacy redraw | Cached raster | Change |
| --- | ---: | ---: | ---: |
| Minimap movement render time | 701.6 ms | 1.9 ms | 99.7% lower |
| Static raster builds during movement | 45 | 0 | eliminated |
| Average FPS | 52.10 | 52.93 | 1.6% higher |
| Worst frame | 233.1 ms | 232.9 ms | effectively unchanged |
| Long-task time | 240 ms | 240 ms | unchanged |
| Median frame | 16.7 ms | 16.7 ms | unchanged |
| p95 frame | 17.7 ms | 17.6 ms | effectively unchanged |

The component-level optimization is decisive and exceeds the 80% requirement. The
whole-scene result is intentionally reported as **no material improvement**: after Issue 1,
the minimap is no longer the dominant source of the remaining worst frame.

## Correctness evidence

- Motion increases viewport composites but causes zero cache builds.
- A real filter change causes exactly one build; search focus with unchanged density causes
  none.
- Cached and legacy pixels remain perceptually equivalent across required browsers:
  no more than 2% of pixels differ, mean absolute channel error is at most 1, and the
  differences are confined to browser-specific antialiasing of cached compass glyphs.

## Success criteria

- SC-001: PASS
- SC-002: PASS
- SC-003: PASS — 99.7% less component render work
- SC-004: PASS
