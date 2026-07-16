# Event pipeline responsibility boundary

The executable pipeline owns every deterministic operation. Skills are intervention protocols, not workflow engines.

| Area | Code-owned responsibility | Agent-only exception |
|---|---|---|
| Runner | Configuration, locking, source order, autonomous progression, resume/invalidation, accounting, status, reporting, and finalization | Explain a persistent external blocker or request authorization for exceptional external-state changes |
| Sources | Requests, pagination, retries, raw capture, detail fixtures, field mapping, validation, cardinality, and manifest timestamps | Investigate a documented provider contract that has changed; never invent a replacement mapping |
| Normalization | Occurrence expansion, validation, filtering, stable IDs, deduplication, provenance, source attribution, venue branches, and artifacts | None |
| Venue resolution | Alias-cache validation, local index preparation, enrichment, exact/local matching, geometry checks, evidence hashing, and cached outcomes | Research and adjudicate ambiguous or conflicting authoritative evidence that deterministic rules cannot resolve |
| POI highlight | Input validation, create/update/noop classification, extraction, collision checks, atomic publication, identity/hash/geometry validation, configuration, and automated browser checks | Subjective visual alignment adjudication only after automated geometry and screenshot checks are inconclusive |
| Event pill | Input validation, snapshot reconciliation, rendering, lifecycle, accessibility, content rules, and browser tests | None |
| Event panel | Input validation, normalization, rendering, selection, lifecycle, accessibility, responsive behavior, and browser tests | None |
| Reconciliation | Expiry, stable replacement, landmark/POI removal, background restoration, staging, and successful-snapshot atomic commit | None |
| Verification | Contract tests, POI separation, build, Playwright behavior/accessibility, console and tile errors, and evidence capture | Review an inconclusive visual diff |

An agent result must be a structured intervention artifact consumed and validated by code. An agent must not manufacture successful source, stage, browser, or test evidence.
