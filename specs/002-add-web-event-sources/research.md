# Research: Expand Singapore Event Discovery

## Decision 1: Treat the weekly period as minimum coverage, not an ingestion cutoff

**Decision**: Run collection weekly and guarantee coverage for the current date through the
following seven days, while retaining every active and future eligible record exposed by each
configured bounded source surface.

**Rationale**: Users want the full choice available from each website, and date filters belong
in discovery rather than destructive ingestion. This remains compatible with Constitution
v2.3.0.

**Alternatives considered**: Weekly-only ingestion (discards useful future records); unbounded
historical crawling (unnecessary and operationally unsafe).

## Decision 2: Represent schedule semantics instead of fabricating occurrences

**Decision**: Preserve exact, ranged, recurring, selectable, anytime, and unverified schedule
states. Materialize only finite source-provided sessions; store recurrence rules rather than
generating an unlimited future list.

**Rationale**: Book-anytime experiences are valid activities, while fake dates and infinite
expansion damage identity, expiry, and deduplication.

**Alternatives considered**: Reject undated records; assign collection date; generate a fixed
number of recurring duplicates.

## Decision 3: Exclude behavior, not broad activity keywords

**Decision**: Exclude a listing only when its primary product is continuously offered general
entry to a permanent fixed attraction during normal operations and it adds no distinct named
programme, seasonal overlay, limited run, facilitated workshop, tour, or participatory
experience. A selectable entry time alone remains ordinary admission. Also exclude expired,
online/overseas, and pure-promotion records. Include distinct special/seasonal programmes,
book-anytime experiences, waitlisted activities, and access-restricted programmes with their
availability/access metadata.

**Rationale**: Broad keyword rules previously removed unusual activities that match the
product goal. A detail page and its schedule selector are stronger evidence than surrounding
category or document text.

**Alternatives considered**: Hardcoded attraction title lists; reject all open-date products;
accept every admission product.

## Decision 4: Keep source adapters interpretive, with one shared policy

**Decision**: Adapters extract website-specific structures and evidence. Shared pure policy
owns inclusion, schedule, location, expiry, and reason-code decisions. Within a source,
specific detail evidence outranks its selector, listing entry, and general page text.

**Rationale**: This prevents source-specific drift while preserving deterministic parsing.

**Alternatives considered**: One generic heuristic scraper; independent business policy in
every adapter.

## Decision 5: Use editorial corroboration first, then editorial sufficiency

**Decision**: For Honeycombers, ArtsEquator, and Time Out, reuse a compatible collected direct
record or explicit official activity page when available. Otherwise publish a current,
specific, internally consistent Singapore activity with usable schedule and location states
as `editorial_authoritative`.

**Rationale**: Mandatory organizer confirmation loses the distinctive activities these
sources contribute. Trust remains explicit and testable without pretending editorial
repetition is organizer ownership.

**Alternatives considered**: Never publish editorial-only records; publish every article
mention; keep editorial sources permanently non-publishing pilots.

## Decision 6: Separate event authority from building authority

**Decision**: Editorial or direct evidence may establish that an activity is publishable,
but a building highlight still requires one compatible OneMap building supported by reliable
address evidence. A valid event may publish off-map.

**Rationale**: Event confidence cannot repair weak geography, and weak geography should not
hide a valid activity.

**Alternatives considered**: Require a building for every event; map the nearest plausible
building; trust a directory address alone.

## Decision 7: Make off-map a first-class location state

**Decision**: Model public placement (`mapped`, `off_map`, `none`) separately from mapping
status (`approved`, `not_required`, `pending_review`). Secret/location-TBA, unresolved
multiple-location, mobile, broad-area, and geometry-missing records are off-map with mapping
not required. Exact-building ambiguity with reliable Singapore scope and a usable general
location is off-map with pending review. Uncertainty about Singapore scope or any usable
general location is held with no public placement.

**Rationale**: These states distinguish an intentional product representation from an
administrative problem.

**Alternatives considered**: One `not_mappable` bucket; reject every non-building event;
send every off-map record to admin.

## Decision 8: Model parent activities, sessions, and venue occurrences separately

**Decision**: One parent activity owns finite sessions and venue occurrences. Reliable
venue-to-session pairs split into separate occurrences; unresolved pairings remain one
multiple-location off-map activity.

**Rationale**: This avoids both duplicate parent listings and hidden venue-specific sessions.

**Alternatives considered**: One event per source card; one event per date regardless of
parent; collapse all venue occurrences.

## Decision 9: Deduplicate conservatively across every source and state

**Decision**: Collapse same-source repeats first. Cross-source merge requires compatible
identity plus the strongest schedule/location evidence available. Anytime and off-map records
need stronger organizer, official-link, distinctive-title, description, or booking-destination
agreement. Uncertain candidates stay distinct and enter non-blocking review.

**Rationale**: Exact date/building evidence is absent for some valid activities, but title
similarity alone remains unsafe.

**Alternatives considered**: Require the same building for every merge; fuzzy-title auto
merge; never deduplicate off-map activities.

## Decision 10: Preserve stable anchors independently of source membership

**Decision**: Source record, parent activity, session/venue occurrence, and published event
identities remain separate. A matched prior published anchor survives source contribution,
schedule-detail, evidence-level, and location-state changes.

**Rationale**: Corroboration or venue revelation must enrich the existing activity instead of
creating a replacement.

**Alternatives considered**: Hash current source membership; use current title/date as the
public identity.

## Decision 11: Reconcile isolated failures per identity

**Decision**: A complete source may create, update, no-op, expire, or review its identities.
An unavailable/incomplete source applies no unproven deletions or replacements and carries
forward its still-active approved source contributions as stale. Freshness is independent of
lifecycle and placement, so a mapped or off-map activity may be stale, and compatible current
contributions may still update a merged activity. Unsafe new records and material identity
conflicts are held individually.

**Rationale**: One outage or venue ambiguity should not block unrelated safe coverage, while
silent loss from an incomplete source remains impossible.

**Alternatives considered**: Catalogue-wide block for every review/outage; silently omit the
failed source; publish partial source output.

## Decision 12: Keep atomic activation as the release-wide boundary

**Decision**: Assemble safe updates, explicit holds, archives, and stale carry-forward into
one immutable staged snapshot. Activate only after schema, accounting, identity, geometry,
build, security, and browser gates pass. Any failure making the assembled snapshot unsafe
preserves the complete previous snapshot.

**Rationale**: Per-identity isolation and atomic publication solve different problems and are
both required.

**Alternatives considered**: Mutate production per source; remove atomic staging; retain the
old catalogue for every isolated issue.

## Decision 13: Extend the existing singleton search for off-map discovery

**Decision**: Project mapped and off-map records through the existing discovery model and
singleton search component. Add mapped, `Secret / Location TBA`, and `Multiple locations`
views beside search, with this-week, this-month, later, and anytime filters.

**Rationale**: A second event application would duplicate search, filtering, detail, loading,
stale, and error responsibilities.

**Alternatives considered**: Hide off-map events; add a separate page/application; force
placeholder map points.

## Decision 14: Retain the existing free rendered transport and bounded traversal

**Decision**: Continue using approved TinyFish Fetch for checked-in known listing/detail URLs,
with canonical capture reuse, destination validation, batching, bounded pagination, response
limits, timeouts, retries, and redacted traces. Do not introduce paid search/agent/browser
fallbacks.

**Rationale**: The current implementation already supplies the required deterministic safety
boundary and real credential integration.

**Alternatives considered**: General web search; paid agent/browser retrieval; a second
transport stack.

## Decision 15: Keep Roots/HAN explicitly unavailable

**Decision**: Retain Roots/HAN in configuration and reporting but skip collection until its
changed source contract is revalidated with representative evidence.

**Rationale**: Explicit unavailability is more honest and safer than fabricated success or
old-run reuse.

**Alternatives considered**: Remove the source silently; reuse historical capture; bypass the
contract change.

## Decision 16: Defer ArtEvents.sg

**Decision**: Keep ArtEvents.sg outside this feature.

**Rationale**: The approved source set is already bounded, and adding another source requires
its own evidence and adapter review.

**Alternatives considered**: Add it without a separate source decision.

## Decision 17: Account for each surface without publishing partial collection

**Decision**: Continue bounded independent listing surfaces after a recoverable surface error,
retain completed surface evidence and terminal diagnostics, then return the source as blocked if
any configured surface remains incomplete.

**Rationale**: Operators can identify the failing surface and reuse same-run evidence safely,
while reconciliation never mistakes a partial scrape for authoritative absence.

**Alternatives considered**: Fail on the first surface; publish healthy surfaces as complete;
treat a failed surface as zero results.

## Decision 18: Deduplicate cross-surface repeats with multiple identity signals

**Decision**: A same-source record with a different listing parent is a merge candidate only
when title, schedule, venue, and organizer or descriptive evidence strongly agree. Existing
sibling ambiguity safeguards remain authoritative.

**Rationale**: Editorial roundups often link one event through different URLs, but title and
date alone are insufficient to merge distinct sessions or editions.

**Alternatives considered**: Never merge different same-source parents; merge on fuzzy title;
canonicalize every source URL to one parent.

## Decision 19: Expose appearance and overlap accounting

**Decision**: Report per-surface appearances and unique pointers, plus source-wide exact pointer
overlap collapsed before detail retrieval.

**Rationale**: A low unique-event count can be explained as extraction loss, overlap, or policy
instead of an opaque total.

**Alternatives considered**: Log only unique details; infer overlap from raw captures manually.

## Decision 20: Treat HTTP 469 as provider policy, not empty data

**Decision**: Preserve the numeric status as redacted diagnostic metadata and use the existing
provider-policy blocker class without retrying the non-transient response.

**Rationale**: This is an external access outcome, not evidence that the source has no events.

**Alternatives considered**: Retry as a server outage; special-case Catch as success; log the
response body.

## Decision 21: Keep unavailable sources executable only after contract revalidation

**Decision**: Roots/HAN stays explicit and disabled, with zero network attempts, until its
adapter contract is deliberately revalidated.

**Rationale**: Visible unavailability is safer than silent removal or synthetic data.

**Alternatives considered**: Remove it from reporting; reuse old captures; enable best-effort
scraping.

## Primary References

- [spec.md](spec.md) and [policy-review.md](policy-review.md)
- Existing event source, normalization, venue, deduplication, reconciliation, snapshot,
  reporting, admin review, and frontend discovery modules named in [plan.md](plan.md)
- `skills/event-pipeline-runner/references/` runtime contracts
- Current approved provider and source configuration under `data/`
