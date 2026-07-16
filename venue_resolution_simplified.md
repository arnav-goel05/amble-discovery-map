# Simplified Venue Resolution

## Goal

Give every venue one correct terminal outcome without forcing uncertain events onto the wrong OneMap building.

The only terminal outcomes are:

- `resolved`: a fixed Singapore venue is linked to a verified OneMap building.
- `not_mappable`: the venue is mobile, outdoors without a target building, outside Singapore, or represents multiple venues.
- `needs_review`: the available evidence cannot distinguish between two or more plausible buildings.

## Retained workflow

### 1. Reuse an approved mapping

Normalize the incoming venue name and check the approved alias registry.

If an approved entry exists, reuse its canonical venue, OneMap GML ID, and evidence. Do not search again.

Success: the registry entry is approved and references a OneMap building still present in the local metadata.

Failure: no approved entry exists or its building no longer exists. Continue to step 2.

### 2. Establish the venue's real location

Use location details already present in the event. If they are incomplete, search the venue's official website. Prefer, in order:

1. The venue or operator's official website.
2. The host building's official website.
3. A Singapore government, tourism, institution, or event-organizer page.

Extract the full address, postal code, unit number, parent building, and any coordinates provided.

Do not treat generic search snippets, social posts, or business directories as sufficient evidence on their own.

Success: one current physical location is supported by authoritative evidence.

Failure outcomes:

- Return `not_mappable` when the source confirms multiple venues, a mobile venue, a non-building outdoor area, or a location outside Singapore.
- Return `needs_review` when sources conflict or no authoritative location can be found.

### 3. Map the verified location to OneMap geometry

Use the verified address or coordinates to find the containing local OSM footprint and nearby OneMap 3D buildings. OSM is a geographic bridge, not the source of venue identity.

Select a OneMap building only when:

- The address or coordinates agree with the verified location.
- The geometry contains the location or is the unambiguous parent building.
- No competing OneMap building is equally plausible.

Success: exactly one OneMap building is supported by the location and geometry.

Failure: return `needs_review` with the competing candidates and evidence. Never select merely the nearest building.

### 4. Persist and report the result

For `resolved`, store the normalized alias, raw venue name, canonical venue, address, OneMap GML ID, accepted OneMap names, coordinates, evidence URLs, and verification date in the approved registry.

For `not_mappable` and `needs_review`, store the reason and evidence so later runs do not repeat identical work unless the source data changes.

Success: the result can be reproduced from stored evidence and future runs reuse it without another web search.

Classify downstream work as `create`, `update`, or `noop`. Reuse unchanged geometry, replace changed events by stable source-event identity, and skip extraction, generated-data writes, and landmark-specific browser checks for a content-hash match.

At each run boundary, remove events whose final known date has passed. Remove the pipeline-managed location only when no current or future events remain; retain undated records for review.

Failure: do not publish a highlight, pill, or event panel for that venue. Report the missing or conflicting evidence as the next action.

## Methods removed from the primary workflow

These are implementation details or weak fallbacks, not independent resolution stages:

- Standalone fuzzy-name matching.
- Repeated attempts using the same query.
- Subagents repeating unresolved searches.
- Nearest-building selection without containment evidence.
- OSM business-name matching as final proof.
- Manual parent-landmark guessing.
- Separate event-metadata enrichment passes after an authoritative address is known.

Name normalization remains useful only for registry lookup. Direct OneMap name matches may accelerate step 3, but they must satisfy the same geographic verification criteria.

## Overall success criteria

- Every input ends as `resolved`, `not_mappable`, or `needs_review`.
- Every `resolved` input has authoritative identity evidence and one verified OneMap building.
- No unresolved or ambiguous input changes frontend highlights or event details.
- Approved resolutions are cached and reused.
- Re-running the same unchanged input produces the same outcome without repeating web research.

## Overall failure criteria

The workflow has failed if it:

- Attaches an event to a building based only on similar words or proximity.
- Treats an outdoor, mobile, foreign, or multi-venue event as a fixed Singapore building.
- Hides ambiguity instead of returning `needs_review`.
- Repeats web research for an unchanged, previously reviewed venue.
- Publishes frontend data before venue resolution is `resolved`.
