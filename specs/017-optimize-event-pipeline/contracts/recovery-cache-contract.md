# Recovery Cache Contract 1.0

The cache key is derived from normalized location evidence, source evidence hashes, recovery
policy, adapter contract, geographic provider context, and relevant event horizon. It must
not contain event-title, venue-name, organizer-name, or source-name exceptions.

Positive and evidence-backed terminal outcomes are reusable while every declared input
matches. Negative `not_found` outcomes additionally expire:

- after 7 days when the event starts within 30 days;
- after 30 days when the event is later or undated.

Any evidence, policy, adapter, or geographic-context change invalidates immediately.
Cache reuse emits the original provenance, freshness decision, and zero external recovery
requests. Expired or invalid entries are retained for audit but never returned as current.
