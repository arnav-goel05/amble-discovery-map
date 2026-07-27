# Research: Diagnose Map Slowness

## Decision: Require controlled ablation before causal language

- **Decision**: Treat a component as causal only when compatible trials differ by one
  intended variable and show a repeatable material frame-time effect.
- **Rationale**: Existing broad correlations and one-run FPS readings were too noisy and
  led to changes that did not improve performance.
- **Alternatives considered**: A single full-scene trace lacks a counterfactual; informal
  visual inspection cannot separate retained, loading, and drawing work.

## Decision: Separate cold loading, warm loading, and network-idle movement

- **Decision**: Record explicit phase boundaries and do not combine their measurements.
- **Rationale**: Large transfers, decoding, GPU upload, and steady draw cost are different
  problems with different solutions.
- **Alternatives considered**: One end-to-end score is simpler but cannot identify which
  phase an optimization must address.

## Decision: Combine browser traces with application-owned scene state

- **Decision**: Capture browser frame/long-task/network/memory evidence alongside bounded
  Deck.gl/tileset state and selected resource identities.
- **Rationale**: Browser evidence locates main/compositor/GPU pressure while application
  state proves what the map was rendering and whether tile work was still active.
- **Alternatives considered**: Browser timing alone cannot identify the responsible layer;
  application counters alone cannot distinguish CPU from renderer/compositor cost.

## Decision: Profile only assets observed by valid trials

- **Decision**: Parse the model, mesh, material, texture, compression, and size structure
  of requested/selected 3D assets implicated by an expensive layer.
- **Rationale**: The full background dataset is extremely large; bounded profiling of the
  actual view is reproducible and relevant.
- **Alternatives considered**: Scanning the entire 3D dataset would be slow and would mix
  unused resources into the causal evidence.

## Decision: Keep diagnostic controls opt-in and production-inert

- **Decision**: Accept a validated diagnostic variant only when performance diagnostics
  are explicitly enabled; ordinary sessions follow the existing path.
- **Rationale**: This preserves public behavior and satisfies the prohibition on continuous
  hidden measurement work.
- **Alternatives considered**: Permanent runtime counters would add unmeasured work and
  violate the observability boundary.

## Decision: Do not choose a solution during planning

- **Decision**: Research solution families after the smallest cause is confirmed and
  include them in the audit without implementation.
- **Rationale**: Mesh simplification, texture compression, tiling changes, renderer
  upgrades, batching, and lifecycle changes address different costs.
- **Alternatives considered**: Selecting a likely optimization now would repeat the
  premature tuning that motivated this investigation.
