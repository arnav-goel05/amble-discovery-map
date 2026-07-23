# Research: Coarsen Moving Buildings

## Decision: Increase only movement-time refinement coarseness

- **Decision**: Change the shared movement-only screen-space error from 12 to 24 for the background and highlighted-venue 3D tilesets.
- **Rationale**: The current benchmark shows 3D tiles dominate transfer and rendering work. A larger error selects less detailed geometry during active movement while the existing state machine restores error 4 afterward.
- **Alternatives considered**: Hiding buildings during movement would be more visually disruptive; permanently reducing quality would violate the constitution; changing request limits or pixel ratio would broaden the implementation and regression surface.

## Decision: Preserve restoration and opacity behavior

- **Decision**: Keep the 350 ms movement-settle delay, full-detail error 4, fade behavior, layer opacity, and request limit unchanged.
- **Rationale**: This isolates the experiment to one reversible parameter and preserves the already-tested appearance outside active movement.
- **Alternatives considered**: Retuning multiple parameters together would make benchmark attribution and visual regression diagnosis ambiguous.

## Decision: Use the existing validation stack

- **Decision**: Update the direct synchronization assertion, run focused unit/Playwright checks and the production build, inspect the real browser, then execute the existing release benchmark.
- **Rationale**: These checks already cover state transitions, full-quality restoration, rendering alignment, application loading, and comparable performance metrics.
- **Alternatives considered**: A new benchmark or observability path would duplicate existing capabilities and exceed scope.
