# Validation: Publish Distinct Activities

## Dataset reconciliation

Validated against approved snapshot
`20260722T174727255Z-source-retirement-activities-v1` without recollecting
sources.

| Boundary | Result |
| --- | ---: |
| Public distinct activities | 748 |
| Public compact sessions | 11,302 |
| Public venue groups | 749 |
| Public source offers | 783 |
| Mapped public activities | 660 |
| Off-map public activities | 88 |
| Private occurrence records retained for reconciliation | 11,304 |
| Private grouping reviews withheld from publication | 2 |
| Public landmarks | 146 |
| Private mapped sessions hydrated behind landmark references | 6,198 |

The public total is 748 rather than the earlier 781 pipeline grouping total
because 33 review/non-public branches are not accepted public activities.
The private occurrence count is two greater than the accepted session count
because two grouping-review records remain isolated for operators.

All activity, session, venue-group, offer, and landmark references validated.
The browser manifest exposes `activitiesRef` and does not expose `eventsRef` or
`internalEventsRef`.

## Transfer and object volume

| Metric | Occurrence baseline | Activity-first result | Change |
| --- | ---: | ---: | ---: |
| Raw public event/activity artifact | 169,015,738 bytes | 8,176,688 bytes | -95.2% |
| Browser API transfer in release benchmark | about 59 MiB | 5.48 MiB | about -90.7% |
| Top-level browser event objects | 11,287 occurrences | 748 activities | -93.4% |
| Accepted schedules available to filters | 11,302 | 11,302 | no loss |

The 11,302 schedules are compact nested sessions rather than repeated
top-level event objects. Internal evidence and occurrence records remain in
the immutable private artifact and are not publicly addressable.

## Browser performance

The before values are the previously recorded occurrence-catalogue baseline.
The after values are from `npm run benchmark:release` on 23 July 2026; all
configured performance-budget gates passed.

| Profile | Metric | Before | After | Result |
| --- | --- | ---: | ---: | --- |
| Desktop cold | UI ready | 6,294.8 ms | 2,489.5 ms | improved 60.5% |
| Desktop cold | Average FPS | 4.2 | 4.6 | improved 9.5% |
| Desktop cold | JS heap | 956.8 MiB | 700 MiB | improved 26.8% |
| Desktop warm | UI ready | 1,489 ms | 1,811.7 ms | within budget; single-run variance |
| Desktop warm | Average FPS | 5.6 | 4.8 | within budget; single-run variance |
| Wide-area cold | UI ready | 7,385.2 ms | 3,227.6 ms | improved 56.3% |
| Wide-area cold | Average FPS | 5.5 | 8.0 | improved 45.5% |
| Map-context cold | UI ready | 5,942.9 ms | 2,348.7 ms | improved 60.5% |
| Map-context cold | Average FPS | 4.1 | 7.5 | improved 82.9% |

The warm-profile movement figures remain noisy because 3D tile loading varies
between runs; they remain within the checked release guardrails. The material
event-transfer reduction is deterministic.

## Verification

- Focused activity publication, immutable snapshot, pipeline reconciliation,
  deduplication, Cloudflare, baseline-contract, and source-retirement tests:
  passed.
- Full Node unit suite: 572 passed.
- Event pipeline regression subset: 131 passed.
- Activity and snapshot focused subset: 32 passed.
- Event-discovery browser matrix: 42 passed across desktop/mobile Chromium,
  WebKit, and Firefox.
- ESLint: passed.
- Vite production build: passed.
- Release performance budget: passed.
- Generated Cloudflare snapshot: regenerated from the active activity-first
  snapshot.
- Generated-artifact policy: passed with public activity and private
  reconciliation assets explicitly classified.
