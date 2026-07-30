# Canonical Equivalence Contract 1.0

An optimization may activate only when baseline and candidate are equal on:

- per-source terminal accounting and invalid/excluded reason identities;
- accepted source occurrences and stable identities;
- deduplication membership and primary decisions;
- activity, session, venue-group, source-offer, and contribution relationships;
- evidence, field completeness, freshness, lifecycle, placement, and review decisions;
- venue outcome, OneMap/POI identity, aliases, coordinates, and evidence references;
- landmarks, public/internal event catalogues, snapshot manifest relationships;
- required verification-gate outcomes;
- unchanged generated asset hashes.

Canonicalization may remove only:

- run IDs and approved snapshot IDs when identity mapping is recorded;
- creation/update/completion timestamps;
- trace ordering and deterministic collection ordering;
- absolute temporary paths;
- explicitly declared provider request IDs.

Arrays representing sets are sorted by their stable identity. Ordered semantic arrays,
including sessions and priority evidence, preserve order. Unknown differences fail parity.

The report records hashes for each surface and a bounded path-level diff. Count equality
alone never establishes equivalence.
