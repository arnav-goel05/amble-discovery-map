# Data Model: Diagnose Map Slowness

## DiagnosticVariant

- `id`: stable allowlisted variant identity
- `label`: readable description
- `phase`: `cold`, `warm`, or `network_idle`
- `workloads`: explicit states for basemap, overlays, interface, background 3D,
  highlighted 3D, lighting, materials, and tile traversal
- `comparisonGroup`: variants eligible for direct comparison
- `intendedDifference`: the single variable changed from the group control
- Validation: unknown variants or workload keys fail before navigation

## DiagnosticTrial

- `schemaVersion`
- `trialId`, `variantId`, `runNumber`
- `environment`: browser, viewport, device scale, visibility, reduced-motion, revision,
  dirty state
- `controls`: camera route, dataset/snapshot, readiness, cache, phase boundaries
- `validity`: `valid` or `invalid`, plus reasons
- `motion`: frame intervals, average FPS, median/p95/worst frame, slow-frame counts
- `mainThread`: long-task intervals and trace category durations
- `renderer`: map/Deck layers, draw/update counters when supported, selected/renderable
  tile counts, traversal/refinement state
- `network`: requests, bytes, failures, active requests by phase and resource identity
- `memory`: JavaScript heap and renderer/GPU capability values when available
- `assets`: selected/requested 3D resource identities
- State: `prepared` → `running` → `valid` or `invalid`

## CausalComparison

- `controlVariantId`, `candidateVariantId`
- `compatible`: whether all non-target controls match
- `validTrialCounts`
- `controlStatistics`, `candidateStatistics`
- `effect`: median frame-time/FPS difference, direction, per-run values
- `consistency`: number and proportion of trials matching the median direction
- `classification`: `confirmed`, `contributing`, `inconclusive`, or `non_cause`
- Validation: cannot be `confirmed` without compatible controls and repeated valid trials

## AssetProfile

- `resourceId`, `path`, `encodedBytes`
- `container`: B3DM/GLB version and compression extensions
- `geometry`: nodes, meshes, primitives, accessors, vertex/index counts
- `materials`: count and texture bindings
- `textures`: count, formats, encoded bytes, dimensions, estimated decoded bytes
- `sceneUse`: variants/trials selecting or requesting the asset
- `limitations`: unsupported or ambiguous fields

## RootCauseFinding

- `id`, `title`, `affectedPhase`
- `smallestCause`: renderer operation, lifecycle action, or asset class
- `classification`, `confidence`
- `supportingComparisons`, `supportingAssets`, `traceEvidence`
- `counterEvidence`, `limitations`, `residualInteraction`

## SolutionOption

- `id`, `findingIds`
- `approach`, `mechanism`
- `expectedAffectedMetrics`, `unaffectedMetrics`
- `authoritativeSources`
- `tradeoffs`, `risks`, `validationNeeded`
- `implementationStatus`: always `not_implemented` for this feature
