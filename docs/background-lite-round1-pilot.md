# Background-lite round-one pilot

## Outcome

The reversible 20-tile pilot removed embedded images, texture objects, material
texture bindings, and runtime texture-coordinate semantics from non-highlighted
OneMap B3DM tiles. It retained the original compressed geometry buffer views,
triangle counts, normals, transforms, bounding volumes, B3DM feature/batch
tables, and GML identities. It did not simplify meshes, retile geometry, or
change the production background release.

The generated artifacts live in the ignored directory
`outputs/background-lite-pilot/round1-20/`.

## Reproduce

```sh
npm run pilot:background-lite
VITE_AMBLE_E2E_OFFLINE_MAP=1 BACKGROUND_LITE_PILOT=1 PLAYWRIGHT_RETRIES=0 \
  npx playwright test -c playwright.config.mjs \
  tests/background-lite-pilot.spec.mjs --project chromium-desktop
```

## Selection

The script excludes every source tile referenced by the 64 approved highlighted
POIs before selection. From 24,454 eligible background tiles it selects:

- eight of the largest assets;
- six assets around the median size;
- four small assets from distinct size percentiles; and
- two structurally complex assets, using triangle count plus B3DM batch count
  over a size-stratified 96-tile sample.

The exact paths, reasons, source hashes, output hashes, identities, bounds, and
per-tile measurements are recorded in `manifest.json`.

## Asset result

| Measurement                       |    Original | Background-lite |        Change |
| --------------------------------- | ----------: | --------------: | ------------: |
| Total encoded B3DM bytes          | 442,750,852 |       4,655,332 |       -98.95% |
| Browser-successful tile responses |       20/20 |           20/20 | no regression |
| Browser tile errors               |           0 |               0 | no regression |
| Median time to visible            |  5,571.7 ms |      4,991.1 ms |        -10.4% |
| p95 time to visible               |  8,796.6 ms |      5,767.1 ms |        -34.4% |

All 20 records passed these integrity checks:

- feature and batch table hashes are unchanged;
- ordered GML IDs and names are unchanged;
- retained non-image GLB buffer-view hashes are unchanged;
- triangle counts and required `POSITION`, `NORMAL`, and `_BATCHID` semantics
  are unchanged;
- no image, texture, material texture binding, or active `TEXCOORD_*`
  semantic remains; and
- `KHR_draco_mesh_compression` remains required.

Because the original Draco buffer is preserved exactly, compressed UV values
may remain as unreachable bits inside a shared Draco buffer. Their semantic
mapping is removed, so the loader does not materialize them. Physically removing
those final bits would require geometry re-encoding; an initial re-encode trial
changed triangle topology and was rejected by the pilot's integrity gate.

## Visual result

The expected trade-off is visible: facade and roof imagery disappears, leaving
neutral lit building massing. Building silhouettes and roof geometry remain.
Three review pairs were captured:

- heavy: `screenshots/01-heavy-original.png` and
  `screenshots/01-heavy-lite.png`;
- medium: `screenshots/09-medium-original.png` and
  `screenshots/09-medium-lite.png`; and
- complex: `screenshots/19-complex-original.png` and
  `screenshots/19-complex-lite.png`.

At a 12-channel-difference threshold, changed-pixel ratios were 25.95% for the
heavy view, 11.41% for the medium view, and 8.97% for the complex view. This is
not geometry loss; it is primarily the intentional removal of photographic
texture and the use of a uniform neutral material.

## Frame indicators

The one-pass browser frame samples are directional, not a release benchmark.
Median movement FPS across the three captured cases was 16.27 for the originals
and 15.48 for background-lite, so this run does not show a movement-FPS win.
Median settled FPS was 20.41 versus 32.93 and median settled p95 frame time was
216.0 ms versus 134.1 ms. A repeated hardware matrix is required before making
a broad FPS claim. JavaScript heap reporting was too coarsely rounded to show a
meaningful difference; removal of image upload/mipmap warnings is the stronger
memory-pressure indicator in this pilot.

## Screen-space-error result

Screen-space error was tested against the unchanged complete background
hierarchy, separately from the 20 transformed assets, at the same camera.

| SSE | B3DM requests | Response bytes | Time to visible | Tile errors |
| --: | ------------: | -------------: | --------------: | ----------: |
|   4 |            91 |    148,174,648 |      9,867.4 ms |           0 |
|   6 |            81 |    100,488,676 |      9,809.5 ms |           0 |
|   8 |            76 |     93,029,264 |      9,810.0 ms |           0 |
|  10 |            73 |     91,029,208 |     10,116.0 ms |           0 |

SSE 8 reduced responses by 16.5% and response bytes by 37.2% relative to SSE 4
in this camera while keeping time to visible effectively unchanged. This is one
camera sample and needs a multi-route visual check before any default changes.

## Recommendation

The asset transformation is worth continuing: its byte reduction is large,
all 20 browser loads succeeded, and identity/geometry contracts stayed exact.
Do not switch production yet. First get product acceptance for the deliberately
textureless neutral appearance, then run a repeated multi-camera hardware
benchmark. If accepted, process a larger non-production sample and evaluate SSE
8 as the leading background-only refinement candidate. Keep highlighted venues
and pristine OneMap source assets full quality.
