# Feature Specification: Diagnose Map Slowness

**Working Branch**: `develop` unless the user explicitly requested another branch

**Created**: 2026-07-25

**Status**: Draft

**Input**: User description: "Use Spec Kit to add observability and debugging, identify the exact root causes of application slowness, drill down to the smallest reproducible cause, research exact solutions, and deliver an audit without implementing a performance fix."

## User Scenarios & Testing

### User Story 1 - Attribute Interactive Slowness (Priority: P1)

A developer can run controlled map scenarios and determine which individual rendering,
loading, or application workload causes slow camera movement instead of relying on a broad
label such as "3D buildings."

**Why this priority**: Previous tuning attempts changed visible behavior without producing
a consistent frame-rate improvement because the exact cost was not isolated.

**Independent Test**: Run repeated foreground camera-motion trials against a fixed route,
viewport, data snapshot, and readiness state while enabling one workload at a time, then
verify that the report ranks components by their repeatable effect on frame time.

**Acceptance Scenarios**:

1. **Given** the complete application and a fixed diagnostic environment, **When** the
   controlled isolation matrix runs, **Then** it reports frame timing, main-thread work,
   rendering workload, memory, and active tile state separately for each component
   combination.
2. **Given** a suspected component, **When** that component alone is removed or replaced
   by a diagnostic substitute, **Then** the report quantifies the resulting change across
   repeated trials with all other controlled conditions recorded.
3. **Given** a broad subsystem remains expensive, **When** its internal resources are
   analyzed, **Then** the investigation continues to the smallest measurable resource,
   rendering operation, or lifecycle behavior supported by the evidence.

---

### User Story 2 - Separate Loading from Rendering Cost (Priority: P2)

A developer can distinguish startup/network/decoding delays from steady-state rendering
cost so that a fast or slow measurement is not attributed to the wrong phase.

**Why this priority**: A large tile transfer can delay readiness without being the cause of
low steady-state frame rate, while cached geometry can remain expensive after downloads
finish.

**Independent Test**: Compare bounded cold, warm, and network-idle motion trials and verify
that transferred bytes, request timing, decode/upload work, long tasks, and motion frame
timings are reported as separate phases.

**Acceptance Scenarios**:

1. **Given** a cold session, **When** the diagnostic run completes, **Then** it attributes
   requests, bytes, tile readiness, long tasks, and motion frames to explicit time windows.
2. **Given** a warm network-idle session, **When** the same camera route runs, **Then** its
   report identifies whether slow frames persist without active transfer or tile selection.
3. **Given** a result affected by background throttling, readiness timeout, failed assets,
   or inconsistent scene contents, **When** the report is finalized, **Then** the trial is
   marked invalid rather than averaged into causal evidence.

---

### User Story 3 - Review Exact Solution Options (Priority: P3)

A developer receives an audit that connects every confirmed cause to technically suitable
solution families, their trade-offs, and authoritative implementation guidance without
changing production behavior.

**Why this priority**: Solutions should be selected only after the responsible operation is
known, and this investigation is not authorized to implement an optimization.

**Independent Test**: Review the audit and verify that every proposed solution traces to a
confirmed measurement, cites authoritative technical material, describes expected impact
and risk, and is clearly labeled as unimplemented.

**Acceptance Scenarios**:

1. **Given** a confirmed root cause, **When** solution research is presented, **Then** each
   option explains which measured cost it addresses and which costs it does not address.
2. **Given** an unconfirmed hypothesis, **When** the audit is finalized, **Then** it remains
   labeled as a hypothesis with the missing evidence stated explicitly.
3. **Given** the investigation is complete, **When** the working tree is reviewed, **Then**
   it contains observability, diagnostic tests, and audit artifacts but no production
   performance optimization.

### Edge Cases

- A trial with a single extreme frame, failed tile, hidden tab, or interrupted camera route
  is retained as diagnostic evidence but excluded from comparative medians.
- A layer that is visually hidden but continues updating or loading is measured as active
  work rather than assumed absent.
- A layer removed after initial loading is tested separately from a session in which that
  layer never initializes, distinguishing retained resources from ongoing rendering.
- GPU timing support may be unavailable; the audit must distinguish measured GPU evidence
  from inferences based on controlled ablation and frame/main-thread timing.
- Large source textures or meshes shared by multiple tiles are counted by stable resource
  identity so request duplication does not distort attribution.

## Scope and Constraints

- **In scope**: Local developer observability, controlled diagnostic scene variants,
  repeated performance experiments, resource/model inspection, trace analysis, regression
  tests for instrumentation, authoritative solution research, and an evidence-backed audit.
- **Out of scope**: Applying mesh, texture, tile, renderer, caching, UI, map, data, or
  deployment optimizations; changing public visual quality; collecting user analytics;
  publishing benchmark results remotely.
- **Evidence and dependencies**: Reuse existing local benchmark and runtime diagnostics,
  browser/renderer inspection capabilities, checked-in map data, and free/open diagnostic
  tooling. Technical solution research must prefer official specifications,
  documentation, or upstream project guidance.
- **Privacy and lifecycle**: Diagnostic output remains local and ignored unless the audit
  is intentionally checked in. It contains aggregate technical measurements and stable
  asset paths only, never location history, search text, conversation content,
  credentials, or personal data.
- **Experience**: Normal application behavior remains unchanged unless an explicit local
  diagnostic mode is selected. Instrumentation must be bounded and inactive for public
  sessions.

## Requirements

### Functional Requirements

- **FR-001**: The diagnostic workflow MUST define fixed, reproducible camera, viewport,
  dataset, readiness, foreground, and sampling conditions.
- **FR-002**: The workflow MUST execute at least three valid trials per diagnostic variant
  and report medians plus dispersion or individual trial values.
- **FR-003**: The workflow MUST separately measure startup/loading, active tile
  selection/transfer, network-idle motion, and settled rendering phases.
- **FR-004**: The diagnostic matrix MUST independently isolate the basemap, transit
  overlays, event interface, background 3D buildings, highlighted 3D buildings, and
  texture/material contribution where technically measurable.
- **FR-005**: Each trial MUST report frame count and distribution, long tasks, script time,
  renderer/layer state, tile counts, requests and bytes, failed resources, memory
  capability, and scene-content identity needed to compare like with like.
- **FR-006**: Trials with hidden/background execution, incomplete readiness, inconsistent
  scene contents, failed camera routes, or measurement corruption MUST be marked invalid.
- **FR-007**: A root-cause claim MUST be supported by a controlled single-variable
  comparison with a repeatable material effect; correlation alone MUST remain a
  hypothesis.
- **FR-008**: If a confirmed subsystem remains broad, the investigation MUST inspect its
  constituent tiles, models, meshes, materials, textures, draw/update lifecycle, and
  resource sizes until no smaller measurable cause can be isolated with available tools.
- **FR-009**: Diagnostic instrumentation MUST distinguish a hidden layer from a layer that
  is absent, unloaded, retained in memory, selecting tiles, or issuing draw work.
- **FR-010**: Machine-readable evidence MUST use a versioned schema and record environment,
  diagnostic variant, controls, validity, measurements, and causal comparison metadata.
- **FR-011**: Automated tests MUST cover variant selection, lifecycle cleanup, invalid-trial
  classification, schema validation, aggregation, and causal-ranking behavior.
- **FR-012**: Instrumentation MUST remain opt-in, bounded, local-only, and inactive during
  ordinary application use.
- **FR-013**: The audit MUST distinguish confirmed causes, contributing factors,
  non-causes, unresolved hypotheses, and measurement limitations.
- **FR-014**: Every researched solution MUST trace to a confirmed or explicitly labeled
  suspected cause and cite authoritative technical guidance.
- **FR-015**: The investigation MUST NOT implement or activate a production performance
  optimization.

### Key Entities

- **Diagnostic Variant**: A named, versioned combination of enabled application workloads
  and diagnostic substitutions with one intended variable difference.
- **Diagnostic Trial**: One bounded execution containing environment controls, phase
  timings, frame/long-task/resource measurements, renderer state, validity, and failures.
- **Causal Comparison**: A pairing of compatible variants with trial statistics, effect
  size, consistency, and a confirmed/inconclusive result.
- **Asset Profile**: Technical measurements for a tile, model, mesh, material, texture, or
  other resource implicated by a confirmed subsystem comparison.
- **Root-Cause Finding**: A claim with scope, smallest isolated operation, supporting
  comparisons, counter-evidence, confidence, and affected user phase.
- **Solution Option**: An unimplemented approach linked to findings, authoritative sources,
  expected effect, constraints, risks, and validation needed.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every diagnostic variant completes at least three valid trials under recorded
  equivalent controls or is explicitly reported as unable to produce valid evidence.
- **SC-002**: The audit attributes at least 90% of the measured median motion frame-time
  difference between the full scene and the lightest valid scene to individually tested
  components, or reports the residual as an explicit unresolved interaction.
- **SC-003**: Every confirmed root cause has at least one compatible single-variable
  comparison whose direction is consistent across a majority of valid trials and whose
  practical effect is stated in milliseconds per frame and frames per second.
- **SC-004**: Loading and steady-state motion conclusions use separate measurements and do
  not infer one from the other.
- **SC-005**: The smallest confirmed cause is identified at the level of a specific
  renderer operation, tile/model/mesh/material/texture class, or bounded lifecycle action,
  rather than only a product subsystem.
- **SC-006**: All observability code passes lint, deterministic tests, schema validation,
  and a focused browser diagnostic run.
- **SC-007**: The final audit provides prioritized solution options for every confirmed
  cause while the production application behavior remains unoptimized and unchanged.

## Assumptions

- The current `develop` working tree is the baseline under investigation, including the
  previously requested movement-time tile-traversal experiment.
- Local browser and hardware results are sufficient to identify code and asset bottlenecks
  but are not treated as universal device performance.
- Browser GPU timers may be unavailable or unsafe to compare; controlled ablation remains
  acceptable causal evidence when main-thread and scene controls are recorded.
- Diagnostic modes may alter rendering only for the duration of local trials and must not
  become public defaults.
