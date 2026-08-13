# CI Mode Contract

| Property              | Ordinary validation                    | Deliberate release                                   |
| --------------------- | -------------------------------------- | ---------------------------------------------------- |
| Trigger               | Push to any non-main branch; manual    | Explicit `workflow_dispatch` with candidate SHA      |
| Geometry              | Checked-in fixture only                | Approved production release hydrated once            |
| Production requests   | 0                                      | Declared bounded budget                              |
| Provider calls        | 0                                      | 0                                                    |
| Browser coverage      | Contract tests and checked-in fixtures | Staged Chromium event-pipeline integration           |
| Rendering/performance | Contract and local build               | Production build and staged Chromium integration     |
| Mutation              | None                                   | Exact fast-forward to main only after all gates pass |
| Failure               | Report only                            | Main and production unchanged                        |

Ordinary CI MUST fail if its workflow contains production hydration, R2 remote verification,
Wrangler deployment, or a non-empty tile fallback origin. Release CI MUST reject public
per-object HEAD verification.
