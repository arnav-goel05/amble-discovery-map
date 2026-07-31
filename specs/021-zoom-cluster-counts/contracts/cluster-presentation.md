# UI Contract: Event Location Cluster Presentation

## Ownership

- The event pill layer owns current landmarks, event matches, stable identities, and the
  pill visibility threshold.
- The cluster presentation owns only derived overview groups and their count controls.
- The map boundary supplies projection, current zoom, and navigation.

This contract does not add or change a versioned public capability command/query.

## Input Contract

Each position reconciliation supplies:

- current finite zoom;
- pill visibility threshold;
- viewport width and height;
- zero or more landmarks with stable identity, label, finite anchor, filter-match state,
  and navigation-target state;
- a projection result with finite screen coordinates for each valid landmark.

Invalid, unmatched, off-viewport, ordinary detail-level, and explicit navigation-target
locations do not participate.

## Output Contract

In overview mode, each rendered control exposes:

- a visible positive integer equal to distinct member locations;
- a transient key derived from member identities;
- a descriptive accessible label using "event location" or "event locations";
- a screen position derived from member positions;
- pointer/touch activation;
- Enter and Space activation;
- navigation data covering every member.

At the detail threshold, the settled output contains zero cluster controls.

## Interaction Contract

- Multi-location activation increases detail without exceeding the existing pill threshold
  and centers toward the represented locations.
- Single-location activation centers that location at the pill threshold.
- Activation preserves current search and category filters.
- Cluster controls do not open event panels directly.
- Focused controls are not replaced while their stable membership key remains unchanged.

## Lifecycle Contract

Reconcile after existing map move, zoom, resize, landmark reconciliation, filter change,
and navigation-target change events. Remove all controls on empty state, detail mode, or
layer destruction. Do not poll or animate counts continuously.

## Observable Assertions

1. Every eligible location identity appears in exactly one cluster membership.
2. Displayed totals equal eligible distinct locations.
3. A location never appears in an ordinary cluster and ordinary pill simultaneously.
4. A navigation target is excluded from count membership.
5. Destroy leaves no cluster controls or cluster-owned listeners/timers.
