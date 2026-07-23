# Validation: Coarsen Moving Buildings

## Before change

- Runtime movement screen-space error: 12
- Full-detail screen-space error: 4
- Restoration delay: 350 ms
- Benchmark capture: 2026-07-23T09:11:57.145Z

| Profile | Average FPS | P95 frame | UI mounted | 3D tile transfer |
| --- | ---: | ---: | ---: | ---: |
| Desktop cold | 4.6 | 649.8 ms | 2489.5 ms | 170 MiB |
| Desktop warm | 4.8 | 466.7 ms | 1811.7 ms | 316 MiB |
| Wide-area cold | 8.0 | 466.6 ms | 3227.6 ms | Not observed |
| Map-context cold | 7.5 | 432.9 ms | 2348.7 ms | 173 MiB |

## After change

- Runtime movement screen-space error: 24
- Full-detail screen-space error: 4
- Restoration delay: 350 ms
- Benchmark capture: 2026-07-23T10:24:47.834Z

| Profile | Before FPS | After FPS | Change | After P95 frame | After UI mounted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desktop cold | 4.6 | 11.0 | +139.1% | 283.3 ms | 2699.4 ms |
| Desktop warm | 4.8 | 13.5 | +181.3% | 266.7 ms | 1379.4 ms |
| Wide-area cold | 8.0 | 11.8 | +47.5% | 300.0 ms | 2649.0 ms |
| Map-context cold | 7.5 | 10.4 | +38.7% | 316.5 ms | 1930.4 ms |

All configured performance-budget evaluations passed. These are single-run controlled-motion measurements and remain subject to 3D tile-loading variance.

## Validation gates

| Gate | Result |
| --- | --- |
| Test-first assertion | Failed as expected with observed values `4, 12` before implementation |
| 3D lifecycle unit test | 5/5 passed |
| Chromium map synchronization | 1/1 passed; observed movement 24 and restored detail 4 |
| Production build | Passed |
| Real-browser smoke | Passed; map, 3D buildings, highlighted venue, MRT context, controls, search, voice control, and minimap rendered |
| Release benchmark | Passed every enforced budget; full quality restored in every profile |
| Scope review | Runtime diff is one constant; the only test diff updates its two direct layer assertions |
