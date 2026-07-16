# Module responsibility audit

The baseline touched four previously large composition modules.

| Module | Current role and decision |
| --- | --- |
| `scripts/event-pipeline.mjs` | Remains the executable orchestration composition root. Run-state, reporting, evidence hashing, and CLI parsing/window contracts are extracted under `scripts/lib/event-pipeline/`. Splitting individual stage mutations further during the release pass would separate shared lock/artifact invariants and increase publication risk. |
| `scripts/lib/restaurant-pipeline-core.cjs` | Retains restaurant discovery and official-deal collection. Provider allowlisting and atomic runtime JSON storage are now separate boundary modules, allowing policy/storage tests without network collection. |
| `activity-scenes/restaurant-explorer.js` | 271-line composition controller; API, map marker lifecycle, and detail rendering are already separate modules under `activity-scenes/restaurants/`. |
| `activity-scenes/plan-builder.js` | 351-line composition controller; pure plan state and rendering are already separated under `activity-scenes/planning/`. |

The two browser controllers are below the 400-line guideline. The two executable pipeline roots remain larger because their remaining code is tightly ordered orchestration; further extraction requires a separately tested refactor rather than mechanical file splitting.
