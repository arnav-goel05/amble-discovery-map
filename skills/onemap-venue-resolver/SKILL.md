---
name: onemap-venue-resolver
description: Adjudicate a venue only when executable alias, address, local OSM, and OneMap geometry resolution remains ambiguous or conflicting. Do not use for routine or exact/local venue matches.
---

# Ambiguous OneMap Venue Adjudication

Code owns alias reuse, evidence hashing, local-index preparation, enrichment, exact matching, spatial candidate generation, cache reuse, and handoff validation. Act only on a structured unresolved-venue intervention containing the complete event IDs and executable local evidence.

## Research

Inspect authoritative sources in this order:

1. Venue or operator official site.
2. Host-building official site.
3. Singapore government, tourism, institution, or event-organizer source.

Record both required paths, `venue_official` and `host_or_authority`, with the exact query, timestamp, outcome, and credible URLs. Generic search snippets, directories, social posts, OSM business identity, fuzzy words, or nearest-building distance are insufficient.

Compare the authoritative address or coordinates with every executable OneMap candidate. Code may combine repeated same-name GML parts only when authoritative evidence explicitly names that host building, every part lies within one 100-metre building-scale group, and every clean tile/batch identity is proven. Generic estate names remain ambiguous unless the authoritative evidence names that estate building. Otherwise approve only when one fixed Singapore building is unambiguous. The pipeline reopens every claimed pristine tile and rejects approval unless each selected batch has an accepted GML name and one of the exact approved identities.

When a OneMap postal lookup returns multiple named rows, select coordinates only when exactly one row's `searchValue` matches the authoritative place, tenant, start-point, or pickup-point name. Do not choose the first row. If none or several match, leave coordinates empty and record the ambiguity.

Treat differently named OneMap rows whose coordinates are within two metres as one geographic pin; executable recovery consolidates them automatically.

Treat one unique OneMap result at the verified street address as valid host-building evidence even when OneMap names the building or complex rather than the tenant unit. The executable recovery command performs this deterministic enrichment.

Executable recovery automatically classifies a verified MRT exit, platform, gantry, or passage as `no_target_building`; never submit its coordinate as a building target.

The orchestrator handles explicit multi-location source records as `multi_venue` before adjudication. Never select one listed stop as the whole event venue.

Return `not_mappable` only with affirmative authoritative evidence for `outside_singapore`, `mobile_venue`, `multi_venue`, or `no_target_building`. Otherwise return `needs_review`; never turn a local miss into `not_mappable`.

## Result

Edit only the intervention's supplied `recoveryTemplate`, then run its exact `recoveryCommand`. The executable orchestrator reruns local matching and creates the resolver handoff, including all candidate and recovery fields. Do not create, search for, or submit a resolver-stage result manually.

Do not modify registries, tiles, frontend data, stage files, or orchestration state directly. The executable pipeline validates and persists the result.
