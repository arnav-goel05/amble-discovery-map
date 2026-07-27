# Convergence Log: Diagnose Map Slowness

## Round 1 — measurement validity

- Found: headless Chromium used SwiftShader software WebGL and produced
  non-representative single-digit FPS.
- Action: recorded graphics device/features and added headed hardware runs.
- Result: Metal-backed measurements separated benchmark artifacts from real
  main-thread stalls.

## Round 2 — broad workload attribution

- Found: full-page variants changed selected 3D tiles between trials.
- Action: froze tile traversal and performed same-page, same-scene ablations.
- Result: discovery refresh, minimap redraw, highlighted 3D, and background 3D
  have independent measured effects.

## Round 3 — smallest application operations

- Found: movement triggered a full discovery/session projection and complete
  minimap terrain redraw.
- Action: added opt-in counters, duration capture, CPU sampling, and targeted
  diagnostic controls.
- Result: 11,302 session expansions per `moveend`; `getImageData` and static
  canvas reconstruction run repeatedly during `move`.

## Round 4 — smallest 3D asset class

- Found: highlighted layer cost remained broad.
- Action: inspected only B3DM assets observed in the hardware trial.
- Result: largest assets are 99.8% embedded imagery, include 3–4K PNGs,
  decode to about 1.36 GB for the largest 30, include incorrect TIFF MIME
  declarations, and frequently disable mipmapping due NPOT dimensions.

## Round 5 — ordinary-session impact and validation

- Found: timing dataset writes could add instrumentation overhead to ordinary
  minimap frames.
- Action: gated detailed timing/counter work behind the explicit performance
  diagnostic mode.
- Result: ordinary event and map UI behavior remains unchanged; focused tests,
  lint, and production build pass.

## Final status

Converged. The audit identifies concrete, independently measured causes and
authoritative solution options. No optimization was applied.
