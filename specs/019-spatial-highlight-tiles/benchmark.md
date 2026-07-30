# Benchmark: Spatial Highlight Tiles

**Date**: 2026-07-29
**Status**: Passed

## Dataset

- Active approved venues: 136
- Existing extracted fragments: 818
- Venue/spatial branches: 143
- Representative path: introduction load, select **Let's explore**, wait for the fixed zoom to settle over the Marina Bay event viewport

## Structural Results

| Measure                                 |  Legacy | Finest spatial | Change |
| --------------------------------------- | ------: | -------------: | -----: |
| Venue-level external tileset references |     136 |              0 |  -100% |
| Direct highlight fragment references    |       0 |            143 |   +143 |
| Approved venue identities               |     136 |            136 |      0 |
| Extracted source fragments validated    |     818 |            818 |      0 |
| Reachable finest fragments              |     818 |            143 |   -675 |
| Venue/spatial branches                  |     136 |            143 |     +7 |
| Uncompressed catalogue/manifest bytes   | 458,816 |        125,372 | -72.7% |
| Gzip catalogue/manifest bytes           |  69,345 |         18,938 | -72.7% |

## Browser Results

The finest-only request check used headless Chromium at 1440 × 900 and moved the loaded map to the Marina Bay event viewport at zoom 18. It recorded every POI B3DM and venue JSON request for 15 seconds after the combined tileset loaded.

| Measure                             | Finest spatial |
| ----------------------------------- | -------------: |
| Unique visible highlight requests   |             64 |
| Finest level-0 requests             |             64 |
| Coarse highlight requests           |              0 |
| Venue manifest requests             |              0 |
| Highlight tile errors               |              0 |
| Final runtime refinement policy     |    full-detail |
| Cross-browser rendering/diagnostics | 18 checks pass |

The result is intentionally finest-only: the sparse spatial hierarchy still determines which branches are in view, but every reachable content leaf points directly to the minimum-level fragment and has no highlight LOD children.

## Gate

Passed: exact approved identity parity, all 818 source fragments validated, exactly 143 finest reachable fragments, zero coarse requests, zero external venue manifests, smaller transferred catalogue data, zero tile errors, geometry separation, production build, and desktop/mobile Chromium, WebKit, and Firefox rendering checks.
