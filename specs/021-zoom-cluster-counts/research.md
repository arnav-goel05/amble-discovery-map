# Research: Zoom-Aware Event Cluster Counts

## Decision 1: Cluster projected screen points by proximity

**Decision**: Group matching visible landmark anchors using their current projected screen
positions and a bounded pixel-space proximity threshold. Derive each cluster's member
count, center, and geographic extent from its unique landmark members.

**Rationale**: Projected distances automatically expand as users zoom in, so broad groups
split without hand-maintained geographic zoom bands. The current approved catalogue is
small enough for a clear deterministic in-memory grouping pass, and the method uses the
same map projection as pill placement.

**Alternatives considered**:

- A new map-source clustering dependency was rejected because the source of truth already
  exists in the event pill layer and no large-dataset index is needed.
- Fixed longitude/latitude grid bands were rejected because their apparent screen density
  varies with zoom and latitude.
- Server-generated clusters were rejected because grouping is viewport-specific,
  presentation-only, and must follow current client-side filters.

## Decision 2: Keep counts and ordinary pills mutually exclusive

**Decision**: Below `LANDMARK_PILL_MIN_ZOOM`, ordinary matching states participate in
clusters and their pills remain hidden. At or above the threshold, clusters are removed and
ordinary matching pills are shown. An explicit navigation-target pill retains its existing
exception and is excluded from clustering.

**Rationale**: One representation per location preserves visual clarity and stable user
expectations while respecting existing navigation behavior.

**Alternatives considered**:

- Showing both counts and pills near the boundary was rejected because it duplicates
  locations and makes totals ambiguous.
- Removing the existing navigation-target exception was rejected because it would regress
  current event-navigation behavior.

## Decision 3: Reconcile keyed count buttons on existing position passes

**Decision**: Give a cluster a transient key derived from sorted stable member landmark
identities. On each existing scheduled map/filter/reconciliation pass, create, update, or
remove count elements by key. Do not add timers or independent map listeners.

**Rationale**: This reuses the event-driven rendering contract, prevents idle work, and
avoids replacing unchanged elements unnecessarily.

**Alternatives considered**:

- Rebuilding all count DOM on every event was rejected because keyed reconciliation is
  equally simple at this scale and preserves focus when membership is unchanged.
- Polling projection state was rejected by the performance constitution and is unnecessary.

## Decision 4: Use one-step progressive navigation

**Decision**: Activating a multi-location cluster moves toward its geographic center and
increases zoom by a bounded step up to the pill threshold. Activating a single-location
cluster centers it at the pill threshold. Preserve active search/category filters.

**Rationale**: Every activation makes visible progress while preventing a surprising jump
past intermediate groups. The same callback supports pointer, touch, Enter, and Space.

**Alternatives considered**:

- Opening an event panel from a cluster was rejected because a cluster does not identify
  one event.
- Always jumping directly to full-pill zoom was rejected because dense groups benefit from
  progressive refinement.

## Decision 5: Validate exact representation and idle cost

**Decision**: Add pure count/membership tests and integrated browser tests for transitions,
filter recomputation, selection, accessibility, cleanup, and no idle update loop. Record
the repository's frontend benchmark before and after implementation, then run the focused
event UI suite, lint for changed modules, and the production build.

**Rationale**: Exact membership is easiest to prove below the DOM boundary, while map event
and accessibility behavior require a rendered browser. The benchmark satisfies the
constitution's performance evidence requirement.

**Alternatives considered**:

- Screenshot-only validation was rejected because it cannot prove exact location
  representation or lifecycle cleanup.
- Full browser matrix during every implementation iteration was rejected in favor of
  focused Chromium feedback followed by the repository's existing release gates.
