# CI Mode Contract

| Property              | Ordinary validation                                   | Deliberate release                                     |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Trigger               | Push to any non-main branch; manual                   | Explicit `workflow_dispatch` with candidate SHA        |
| Geometry              | Checked-in fixture only                               | Approved production release hydrated once              |
| Production requests   | 0                                                     | Declared bounded budget                                |
| Provider calls        | 0                                                     | 0                                                      |
| Browser coverage      | All specs Chromium desktop + targeted Chromium mobile | Required Chromium/WebKit/Firefox desktop/mobile matrix |
| Rendering/performance | Contract and local build                              | Full real-geometry render and enforced benchmark       |
| Mutation              | None                                                  | Exact fast-forward to main only after all gates pass   |
| Failure               | Report only                                           | Main and production unchanged                          |

Ordinary CI MUST fail if its workflow contains production hydration, R2 remote verification,
Wrangler deployment, or a non-empty tile fallback origin. Release CI MUST reject public
per-object HEAD verification.
