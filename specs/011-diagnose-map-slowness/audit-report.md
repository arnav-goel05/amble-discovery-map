# Map Slowness Root-Cause Audit

**Date:** 25 July 2026  
**Branch:** `develop`  
**Scope:** diagnosis and solution research only; no performance optimization was
implemented.

## Executive finding

The lag is not one generic “heavy map” problem. It is the sum of three concrete
costs on the browser main/render threads:

1. **A complete discovery-result rebuild runs after every map movement.**
   `moveend` calls `eventSearch.refresh()`, which filters the unchanged event
   corpus and expands **11,302 session objects** across the visible discovery
   activities again. The measured refresh takes **495–800 ms** in the same
   hardware-rendered scene.
2. **The 96×64 density minimap redraws its static terrain on every `move`
   frame.** Each redraw reconstructs the Singapore polygon mask, performs a
   synchronous `getImageData()` readback, repaints the pixel terrain, density,
   compass, and viewport, even though only the viewport rectangle changed.
3. **The highlighted 3D venue layer is texture-bound.** A representative view
   transferred **466 MB across 162 highlighted-POI B3DM requests**, plus
   **123 MB across 440 background B3DM requests**. In the 30 largest observed
   assets, **258.1 of 258.7 MB** was imagery. Those images decode to about
   **1.36 GB of RGBA pixels**; geometry was only 114,775 vertices and about
   68,166 triangles.

With the exact same loaded scene and camera route:

| Same-scene stage | Median FPS | Median frame | Median p95 | Median worst frame |
| --- | ---: | ---: | ---: | ---: |
| Full application | 8.6 | 65.7 ms | 650.2 ms | 650.2 ms |
| No `moveend` discovery rebuild | 14.6 | 66.7 ms | 117.4 ms | 183.4 ms |
| Also no per-frame minimap redraw | 17.8 | 50.2 ms | 84.0 ms | 84.1 ms |
| Also no highlighted 3D venue layer | 25.3 | 33.5 ms | 65.7 ms | 66.7 ms |
| Also no background 3D layer | 60.0 | 16.7 ms | 17.6 ms | 17.7 ms |

These are diagnostic ablations, not proposed product behavior.

## Measurement correction

The first automated trials used Playwright's headless Chromium. CDP reported
SwiftShader, software GPU compositing, and software WebGL, so their 3–10 FPS
results were not valid estimates of the user-visible application. The corrected
matrix used headed Chromium on the Apple M4 Metal renderer, where the full
1440×900 scene reached a median **44.9 FPS** but still produced a **483 ms**
median worst frame from the discovery refresh.

The final attribution table above used the in-app browser's hardware renderer
and a 2560×1440 canvas. The scene was loaded once, tile traversal was frozen,
and each workload was removed in place. This kept camera, 3D selection, cache,
viewport, and data identical across stages.

## Cause 1 — invariant event data is rebuilt on `moveend`

### Exact execution path

`activity-scenes/esplanade-performance.js`

`map moveend` → `eventSearch.refresh()` → `activeDiscoveryModel.filter()` →
`groupActivities()` → `activityResult()` → recreate every canonical session →
`densityMinimap.setDiscoveryResult()` → `pillLayer.applyDiscoveryResult()`.

The map position changes distance and in-view ordering, but it does not change
event title, schedule, venue, category, source offers, or session grouping.
Nevertheless, `activityResult()` maps all canonical sessions and creates a
new nested projection. Venue-group construction then scans the sessions again.

### Evidence

- One refresh per completed movement.
- **11,302 sessions expanded** and **11,304 venue-membership checks** per
  refresh in the current public frontend snapshot.
- **495–800 ms** measured filter duration.
- Hardware CPU sampling attributed the largest JavaScript self-time to
  `activity-scenes/events/event-discovery-model.js` (**418.8 ms** in the
  repeatable headed profile).
- Removing only the refresh reduced the median worst frame from **650.2 ms**
  to **183.4 ms**.

### Exact solution options (not implemented)

1. **Preferred:** split invariant filtering/grouping from viewport ranking.
   Build the activity/session projection once when data or filters change.
   On `moveend`, update only `distanceFromCenter`, `inView`, and result order.
2. Cache grouped results by `(snapshotId, query, category, date, price,
   placement)` so moving the map reuses the same immutable activity objects.
3. If full regrouping remains necessary, move the pure projection to a Web
   Worker or yield it in bounded chunks. This reduces blocking but does not
   remove the redundant work.

MapLibre documents that `move` fires repeatedly during transitions and
`moveend` fires immediately after a transition; it does not imply that
non-spatial data should be recomputed at either event
([MapLibre events](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapEventType/)).
Tasks over 50 ms block interaction, while this path is roughly ten times that
threshold ([web.dev long-task guidance](https://web.dev/articles/optimize-long-tasks)).

## Cause 2 — static minimap terrain is regenerated per movement frame

### Exact execution path

`activity-scenes/event-density-minimap.js`

`map move` → requestAnimationFrame → `render()` → `drawTerrain()` →
recreate mask canvas → redraw all discovery polygons → `getImageData()` →
scan mask pixels → redraw all terrain cells → redraw density/viewport/compass.

Only the translucent viewport rectangle changes during map motion. Terrain,
event-density cells, and compass are invariant until filters or source data
change.

### Evidence

- Full same-scene runs performed **7–16 complete minimap renders** per
  1.5-second motion.
- With discovery refresh already disabled, disabling only viewport tracking
  reduced median worst frame from **183.4 ms** to **84.1 ms**.
- Hardware CPU sampling directly attributed time to `getImageData`,
  `projectCoordinate`, terrain polygon drawing, and compass drawing.
  `getImageData` alone accounted for **239.8 ms** of sampled self-time and
  `drawCompass` for **183.5 ms** in that profile; the latter includes canvas
  text rasterization/upload time attributed at its call site.
- Chrome explicitly documents that `getImageData()` can be very slow
  ([Chrome Canvas2D](https://developer.chrome.com/blog/canvas2d/)).

### Exact solution options (not implemented)

1. **Preferred:** pre-render static terrain, density, and compass once to an
   offscreen/backing canvas. During `move`, redraw only the old and new
   viewport rectangle or composite the cached background plus the rectangle.
2. Maintain separate background and foreground canvases so viewport movement
   never clears or reconstructs terrain. This follows the browser guidance to
   pre-render repeated content and render only changed regions
   ([web.dev canvas performance](https://web.dev/articles/canvas-performance)).
3. Remove the pixel readback entirely by rasterizing the land mask once at
   build time. If runtime reads remain, request the mask context with
   `{willReadFrequently: true}`; this is a secondary mitigation, not a
   substitute for eliminating per-frame reconstruction.
4. OffscreenCanvas in a Worker can isolate any remaining static rasterization
   from the UI thread
   ([web.dev OffscreenCanvas](https://web.dev/articles/offscreen-canvas)).

## Cause 3 — highlighted 3D assets are dominated by oversized textures

### Exact asset facts

- Combined highlighted tileset root: **64 external venue tileset children**.
- Representative hardware trial:
  - highlighted POI: **162 B3DM**, **466.2 MB**
  - background: **440 B3DM**, **123.4 MB**
- 30 largest B3DM assets:
  - total: **258.7 MB**
  - embedded images: **258.1 MB (99.8%)**
  - estimated decoded RGBA: **1.36 GB**
  - geometry: **114,775 vertices / 68,166 triangles**
- Common textures are 3074–4096 pixels on a side. Examples:
  - Millenia Walk: one 4096×4096 PNG, 13.0 MB compressed / 64 MB RGBA
  - National Library: one 4096×4096 PNG, 12.7 MB / 64 MB RGBA
  - South Beach: 3074×3558 PNG, 10.5 MB / 41.7 MB RGBA, despite only
    276 vertices and 168 triangles
- Seven inspected images declare `image/tiff` but contain PNG bytes. Core glTF
  uses PNG/JPEG image resources; the mismatch should be rejected by asset
  validation
  ([glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)).
- The ordinary browser gate emitted **dozens of luma.gl warnings that mipmaps
  were disabled for non-power-of-two textures**. This application currently
  receives a WebGL 1 context; WebGL 1 cannot mipmap NPOT textures, and
  non-mipmapped 3D textures have worse minification/cache behavior
  ([WebGL texture guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Using_textures_in_WebGL),
  [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)).
- Geometry already uses `KHR_draco_mesh_compression`; further geometry work
  is not the first-order opportunity.

### Runtime evidence

After removing discovery refresh and minimap redraw in the same frozen scene:

- Both 3D layers: **17.8 FPS / 50.2 ms median frame**
- Remove highlighted 3D only: **25.3 FPS / 33.5 ms**
- Remove remaining background 3D: **60 FPS / 16.7 ms**

The highlighted layer therefore has a separately measurable steady render
cost, while the background layer accounts for the remaining gap to 60 FPS.
The asset inspection shows the highlighted layer's loading/memory pressure is
specifically texture-dominated.

### Exact solution options (not implemented)

1. **Preferred asset fix:** rebuild highlighted venue B3DM/GLB assets with
   bounded, power-of-two texture dimensions based on expected screen coverage,
   generated mipmaps, correct image MIME declarations, and asset-validator
   gates.
2. Convert texture payloads to KTX 2.0 / Basis Universal through
   `KHR_texture_basisu`, after an end-to-end loader compatibility test.
   Khronos documents that KTX2 reduces download size and GPU memory and avoids
   runtime use of uncompressed PNG/JPEG textures
   ([Khronos KTX](https://www.khronos.org/ktx/),
   [glTF KTX guidance](https://www.khronos.org/gltf/)).
3. Retile the highlighted layer so refinement selects the smallest spatial
   set needed for the current viewport. Validate child bounding regions and
   geometric errors; do not merely lower the memory cap.
4. Tune `maximumScreenSpaceError`, `maximumMemoryUsage`, request concurrency,
   and stationary `updateTransforms` only after asset correction. loaders.gl
   notes that lower screen-space error refines deeper and can exceed the
   memory cap if those tiles are required
   ([Tileset3D reference](https://loaders.gl/docs/modules/tiles/api-reference/tileset-3d)).
5. Test device-pixel-ratio limits after the above. deck.gl notes that high-DPI
   rendering can create four times the fragment work, but reducing it changes
   visual quality and does not address the 466 MB highlighted payload
   ([deck.gl performance](https://deck.gl/docs/developer-guide/performance)).

## Contributing factors and non-causes

| Item | Classification | Evidence |
| --- | --- | --- |
| 3D polygon count | Not primary for highlighted loading | Largest 30 assets have modest geometry; 99.8% of bytes are images. |
| Draco decode | Contributing loading cost, not primary byte cause | Geometry is already Draco-compressed; profile contains decode/upload work, but imagery dominates transfer and decoded memory. |
| MRT/water/restaurant/discovery map overlays | Not a primary cause | With both 3D layers removed, the same overlays and interface sustain 60 FPS. |
| Browser software rendering | Benchmark artifact | Headless SwiftShader caused misleading single-digit FPS; hardware Metal measurements supersede it. |
| Network activity during motion | Excluded from final causal comparison | Final same-scene attribution froze 3D traversal before measuring. |
| `maximumMemoryUsage` alone | Not a complete solution | Required visible tiles may exceed the cap to meet screen-space error, per loaders.gl. |

## Recommended order for a future implementation

1. Remove invariant discovery/session rebuilding from `moveend`.
2. Cache/static-layer the minimap and update only its viewport rectangle.
3. Correct and compress highlighted textures, then validate the combined
   tileset's spatial selection.
4. Re-measure on hardware; only then tune screen-space error, memory,
   concurrency, and device pixel ratio.

This order addresses measured mechanisms from lowest product risk to the
largest asset-pipeline change.

## Evidence and reproducibility

- Headed hardware matrix:
  `outputs/map-performance-diagnostics/hardware-root-cause/report.json`
- Repeatable headed CPU profile:
  `outputs/map-performance-diagnostics/hardware-cpu-profile/report.json`
- Same-page paired hardware ablation:
  `outputs/map-performance-diagnostics/hardware-root-cause/paired-hardware.json`
- Observed-asset inspection:
  `outputs/map-performance-diagnostics/hardware-root-cause/assets.json`
- Diagnostic command:
  `npm run diagnose:map-performance -- --headed --runs 3`
- Asset command:
  `npm run diagnose:map-assets -- --report <report.json> --output <assets.json>`

Raw evidence stays ignored because it is large and machine-specific. The
instrumentation, contracts, and this audit are checked-in project artifacts.

## Limitations

- FPS is viewport- and hardware-dependent; causal direction was established
  with same-page ablations, not by treating the absolute number as universal.
- The 30-asset inspection intentionally covers the largest observed files,
  not all 112 GB of source tiles.
- Texture decoded-size estimates use width × height × 4 and exclude mipmaps,
  driver padding, and duplicate GPU residency, so actual GPU memory can be
  higher.
- No recommended optimization was applied or visually approved in this work.
