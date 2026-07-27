# Event Search Refresh Contract

## Complete refresh

Triggered by initial mounting, query/category/date/price/placement filter changes, and
event-data reconciliation.

Guarantees:

- Calls the active discovery model exactly once.
- Replaces the cached discovery result after a successful call.
- Applies map-dependent placement and ordering.
- Renders current status and results.

## Viewport refresh

Triggered by production map `moveend`.

Guarantees:

- Does not call the discovery model.
- If no cached result exists, returns safely without changing the UI.
- Reapplies map-dependent placement, visibility, distance, and ordering to the cached
  result.
- Renders the refreshed nearest-first result order without duplicating entries.

## Diagnostic comparison

The diagnostic controller may select `full`, `viewport`, or `off`. This control is
available only when performance diagnostics are explicitly enabled. Normal users always
receive `viewport`.
