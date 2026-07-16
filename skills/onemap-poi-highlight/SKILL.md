---
name: onemap-poi-highlight
description: Adjudicate POI highlight alignment only when executable extraction, identity separation, geometry, browser, and screenshot checks pass but visual placement remains inconclusive.
---

# POI Highlight Visual Adjudication

Code owns input validation, create/update/noop classification, clean-tile extraction, collision detection, atomic publication, manifests, exact GML separation, hashes, geometry counts, frontend configuration, tile-error checks, and screenshot capture.

Use this skill only when the pipeline emits an `inconclusive_visual` intervention with those checks attached. Never edit extractor definitions, tiles, manifests, POI configuration, or handoffs during adjudication.

Inspect the supplied close and wider-zoom evidence. Judge only whether the highlighted building is visually aligned with the basemap and whether an obvious duplicate, offset, ghost, or unrelated highlighted neighbor remains. Exact GML identity and geometry evidence override repeated names.

Return a narrow structured verdict with inspected evidence references, `pass`, `fail`, or `needs_review`, and a concise reason. Do not claim zero tile errors, successful extraction, or browser execution unless those results are present in the intervention.
