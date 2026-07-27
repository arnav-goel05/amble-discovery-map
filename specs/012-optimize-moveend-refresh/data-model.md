# Data Model: Optimize Map-Move Event Refresh

## Cached discovery result

The latest successful result of complete event discovery for the active model and filters.

- `matchedEvents`: count matching current filters
- `query`: normalized search query
- `results`: unprojected activity results used by viewport placement
- `filter generation`: implicitly replaced whenever data or filters change

Lifecycle:

1. Starts absent.
2. A complete discovery pass replaces it.
3. A viewport refresh reads it without mutation.
4. Event-data reconciliation installs a new model and immediately replaces it through a
   complete refresh.
5. Component destruction releases it.

## Refresh mode

- `viewport`: production default; reuse cached discovery and reapply map-dependent work.
- `full`: diagnostic legacy comparison; repeat discovery before map-dependent work.
- `off`: diagnostic isolation; do not refresh after movement.

The mode is runtime-only and never persisted.
