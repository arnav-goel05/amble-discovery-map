# Data Model: Coarsen Moving Buildings

This feature adds no persistent data or public contract.

## Runtime refinement state

The existing runtime state remains:

- `moving-coarse`: both 3D tilesets use the temporary movement error of 24.
- `settling`: movement has ended and the existing 350 ms delay is active.
- `refining`: both tilesets have returned to full-detail error 4 while selected tiles settle.
- `full-detail`: both tilesets are confirmed at error 4.

## Invariants

- Background and highlighted-venue tilesets always receive the same movement value.
- Full-detail values and restoration timing do not change.
- Repeated movement cancels pending restoration and re-enters `moving-coarse`.
- Destruction clears existing timers and layer references.
