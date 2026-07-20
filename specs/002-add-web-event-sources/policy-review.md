# Event Inclusion Policy Review

**Purpose**: Maintain the event-selection decisions being reviewed group by group before they are consolidated into the feature specification and implementation plan.

**Last updated**: 2026-07-18

**Overall status**: All policy groups agreed; ready for specification consolidation

## Review status

| Group | Topic                                       | Status |
| ----- | ------------------------------------------- | ------ |
| 1     | What counts as an event or activity         | Agreed |
| 2     | Date and schedule handling                  | Agreed |
| 3     | Singapore and physical-location eligibility | Agreed |
| 4     | Source-specific interpretation              | Agreed |
| 5     | Editorial discovery confirmation            | Agreed |
| 6     | Deduplication and event identity            | Agreed |
| 7     | Venue evidence and OneMap resolution        | Agreed |
| 8     | Publication, review, and failure safety     | Agreed |

## Group 1 — What counts as an event or activity

**Status**: Agreed

### Policy

Include every genuine event or activity available from each configured source. Do not limit ingestion to the current week. Exclude only expired listings, pure promotions, and ordinary admission to fixed standard attractions.

| Listing type                                                                                         | Handling                               |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| One-off or limited-time event                                                                        | Include                                |
| Recurring scheduled event                                                                            | Include                                |
| Book-anytime activity or experience                                                                  | Include                                |
| Active future event outside the current week                                                         | Include                                |
| Continuously available general admission to a permanent fixed attraction, with no distinct programme | Exclude                                |
| Special programme at a standard attraction                                                           | Include                                |
| Seasonal experience at a standard attraction                                                         | Include                                |
| Pure discount, sale, membership offer, or advertisement with no distinct event or activity           | Exclude                                |
| Listing whose final occurrence has passed                                                            | Remove from the active feed or archive |

### Examples

| Example                                              | Handling |
| ---------------------------------------------------- | -------- |
| Standard Universal Studios admission                 | Exclude  |
| Halloween Horror Nights at Universal Studios         | Include  |
| Standard Bird Paradise admission                     | Exclude  |
| Special photography walk at Bird Paradise            | Include  |
| Book-anytime perfume workshop                        | Include  |
| Murder-mystery experience with selectable dates      | Include  |
| Concert taking place three months later              | Include  |
| Ticket discount without a distinct event or activity | Exclude  |

Dates are collected and normalized for availability, sorting, filtering, updating, and expiry. They do not restrict ingestion to a weekly window.

## Group 2 — Date and schedule handling

**Status**: Agreed

### Policy

Preserve all schedule information provided by a source without inventing missing dates. Collect active and future listings outside the current week, represent open-ended activities honestly, and archive listings only after their final known occurrence has passed.

| Schedule situation                                      | Handling                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Exact date and time                                     | Include and store the exact date and time in the Singapore time zone                |
| Multi-day date range                                    | Include from the stated start through final date                                    |
| Recurring schedule                                      | Store one event and its recurrence instead of generating unlimited duplicate events |
| Several selectable dates or sessions                    | Store one activity with its available sessions rather than duplicating the listing  |
| Book-anytime or open-ended activity                     | Include and label as `anytime`; do not invent a date                                |
| Date-dependent event with a missing or unclear schedule | Retain as `schedule_unverified` for review rather than discard it                   |
| Future event outside the current week                   | Include                                                                             |
| Event whose final occurrence has passed                 | Remove from the active feed or archive                                              |
| Existing event whose schedule changes                   | Update it using stable source identity rather than create a duplicate               |
| Conflicting dates on the same source                    | Prefer the event detail page; if the conflict remains, retain it for review         |

### Examples

| Example                                                 | Result                                  |
| ------------------------------------------------------- | --------------------------------------- |
| Concert on 20 September at 8:00 pm                      | Dated event                             |
| Exhibition running from August through December         | Date-range event                        |
| Comedy show every Friday                                | One recurring event                     |
| Workshop offering five selectable sessions              | One event with five sessions            |
| Perfume workshop available by appointment               | Anytime activity                        |
| Genuine date-dependent event with no published schedule | Schedule unverified                     |
| Event whose final occurrence ended yesterday            | Archived or removed from active results |

### Terminology

- `anytime` means the source intentionally offers an activity without a fixed event date.
- `schedule_unverified` means the listing appears to require a schedule, but no reliable schedule can be established.
- Date filters such as “This week,” “This month,” “Later,” and “Anytime” are presentation choices and must not cause otherwise valid active or future records to be discarded during ingestion.

## Group 3 — Singapore and physical-location eligibility

**Status**: Agreed

### Policy

Include genuine activities that take place physically in Singapore even when they cannot yet be attached to one exact building. Location quality determines whether an activity appears on the map, in an off-map list, or in administrative review; it does not by itself determine whether the activity is valid.

| Location situation                                                | Handling                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| One named physical venue in Singapore                             | Include and send to venue resolution for mapping                                                                                         |
| Hybrid event with a physical Singapore venue                      | Include and map the physical venue                                                                                                       |
| Secret or not-yet-announced Singapore venue                       | Include in a dedicated off-map `Secret / Location TBA` view; move it onto the map when authoritative venue information becomes available |
| Several Singapore venues with a reliable venue-to-session pairing | Split into separate venue occurrences while preserving one parent event identity                                                         |
| Several Singapore venues without a reliable pairing               | Include once in an off-map `Multiple locations` view until the occurrences can be separated safely                                       |
| Mobile event, route, or moving vehicle                            | Include off-map with its meeting point or route description; map a meeting point only when it is explicitly authoritative                |
| Broad outdoor area without one building                           | Include off-map with its stated area; do not force it onto an arbitrary building                                                         |
| Venue text is ambiguous or conflicting                            | Retain for location review; do not guess                                                                                                 |
| Online-only event                                                 | Exclude from the Singapore physical-activities experience                                                                                |
| Event physically outside Singapore                                | Exclude, even if marketed to a Singapore audience                                                                                        |
| Event with both Singapore and overseas occurrences                | Include only its Singapore occurrences                                                                                                   |

### Examples

| Example                                                                 | Result                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Performance at Esplanade Theatre                                        | Include and attempt to map the theatre building                                           |
| Livestream plus an audience session at NUS                              | Include and map the NUS venue                                                             |
| Dinner experience whose address is revealed after booking               | Include under `Secret / Location TBA`                                                     |
| Film programme at five cinemas with a cinema listed for every screening | Split into cinema-specific occurrences                                                    |
| Festival advertised only as “at various venues across Singapore”        | Include once under `Multiple locations`                                                   |
| Heritage walk from an officially stated meeting point                   | Include; map the meeting point and retain the route description                           |
| Nature activity stated only as “East Coast Park”                        | Include off-map as a broad outdoor area unless an authoritative meeting point is supplied |
| Online webinar                                                          | Exclude from this physical discovery experience                                           |
| Johor event promoted by a Singapore publication                         | Exclude                                                                                   |

### Location-state principle

Public placement and mapping review are independent:

1. Public placement is `mapped`, `off_map`, or `none`.
2. Mapping status is `approved`, `not_required`, or `pending_review`.
3. Exact-building ambiguity with reliable Singapore scope/general location stays off-map with
   pending review; uncertainty about Singapore scope or any usable location is held with no
   placement.

Changing either dimension must update the existing activity identity rather than create a duplicate.

## Group 4 — Source-specific interpretation

**Status**: Agreed

### Policy

Source-specific rules may interpret the structure and terminology of a website, but they must not override the agreed event, schedule, or location policies. A source adapter must apply the shared rules after extracting the best available listing and detail-page evidence. A keyword alone is not sufficient reason to exclude a record when the underlying event or activity is valid.

| Source                 | Handling                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catch.sg               | Treat event and performance pages as direct event evidence. Preserve separate performances and apply the shared inclusion, schedule, location, and expiry rules.                                                                                       |
| SISTIC                 | Treat public event and ticket pages as direct event evidence. Preserve separate dates, times, and venues without creating duplicates from ticket categories.                                                                                           |
| Fever Singapore        | Read each individual activity page rather than classifying it from unrelated page text. Include selectable-date and book-anytime activities. A waitlist is an availability state, not an automatic exclusion, when a valid underlying activity exists. |
| Visit Singapore        | Extract individual happenings from event pages and guides. Split multi-event articles into separate candidates where their boundaries are reliable; archive genuinely historical content.                                                              |
| Singapore Film Society | Include public and member-restricted screenings or programmes, recording any membership requirement as an access condition rather than treating it as a non-event. Preserve screening-level schedules and cinemas.                                     |
| Roots/HAN              | Keep the source explicitly unavailable while its website contract cannot be processed reliably. Report it in every run; do not fabricate or reuse old records.                                                                                         |
| Honeycombers           | Treat each identifiable event or activity as a discovery candidate. Split roundups where possible; exclude only pure promotions or non-activity editorial content under the shared rules.                                                              |
| ArtsEquator            | Treat identifiable arts events as discovery candidates. Open calls, grants, residencies, and competitions are not physical activities unless they contain a distinct attendable programme.                                                             |
| Time Out Singapore     | Treat individual events and activities, including entries inside roundups, as discovery candidates. Do not reject a valid activity merely because the surrounding page is a guide or evergreen article.                                                |

### Cross-source rules

| Situation                                                                             | Handling                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Pure promotion containing no distinct activity                                        | Exclude under Group 1                                                                   |
| Promotion for a distinct underlying event                                             | Retain the event; record the offer only as optional metadata                            |
| Book-anytime or selectable-date listing                                               | Include under Groups 1 and 2                                                            |
| Waitlist for a real activity                                                          | Include the activity with `waitlist` availability when sufficient event evidence exists |
| Member-only activity                                                                  | Include with a visible access restriction                                               |
| Editorial roundup                                                                     | Extract separate candidates where their boundaries and links are reliable               |
| Source wording triggers a keyword rule but the detail evidence shows a valid activity | Follow the detail evidence, not the keyword                                             |
| Record cannot be interpreted reliably after bounded extraction                        | Retain an explicit source-review outcome rather than silently discard or invent data    |

### Evidence precedence within one source

When pages from the same source disagree, use evidence in this order:

1. The specific event, activity, or performance detail page.
2. A structured schedule or booking selector belonging to that detail page.
3. The individual listing card or roundup entry.
4. General category, search, guide, or homepage text.

If equally specific evidence still conflicts, retain the record for review. The source adapter must log which evidence was selected and why.

## Group 5 — Editorial discovery confirmation

**Status**: Agreed

### Policy

Honeycombers, ArtsEquator, and Time Out Singapore are trusted editorial discovery sources. First try to corroborate their activities with a direct source or official page. If no corroborating page is available, sufficiently detailed and internally consistent editorial evidence may itself authorize publication. Lack of separate organizer confirmation must not automatically discard or block a valid activity.

### Confirmation sequence

1. Look for the same activity in an already-collected direct source or through an explicit official link.
2. When found, use the direct or official page as primary evidence and retain the editorial page as supporting provenance.
3. When not found, assess whether the editorial record contains sufficient evidence to stand on its own.
4. Publish sufficient editorial-only records as `editorial_authoritative`; retain insufficient or conflicting records for review.

### Sufficient editorial evidence

An editorial-only record may publish when it has all applicable evidence below:

- a specific identifiable event or activity rather than a vague recommendation;
- a current detail page or a clearly bounded entry within a roundup;
- Singapore scope, including an explicit valid `secret`, `multiple locations`, or other `off_map` state;
- a usable schedule, recurrence, selectable-date calendar, or intentional `anytime` state;
- no material contradiction within the available evidence; and
- content that is more than a pure promotion, announcement, or copied fragment.

### Confirmation outcomes

| Situation                                                                                                | Handling                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Found on Catch.sg, SISTIC, Fever, Visit Singapore, Singapore Film Society, or a compatible official page | Use the direct source as primary evidence and merge the editorial contribution                          |
| Found independently on several editorial sources but no direct source                                    | Publish when at least one record has sufficient evidence; retain all compatible sources as provenance   |
| Found only on one detailed and sufficient editorial source                                               | Publish as `editorial_authoritative`                                                                    |
| Editorial evidence lacks required activity, schedule, or Singapore-scope information                     | Retain as `editorial_evidence_incomplete` for review                                                    |
| Editorial and direct or official evidence materially conflict                                            | Prefer the direct or official evidence for current facts and send material identity conflicts to review |
| The editorial publication organizes the activity itself                                                  | Treat its specific activity page as direct authoritative evidence                                       |
| A direct or official source becomes available later                                                      | Upgrade the existing event's evidence state without creating a duplicate                                |

### Evidence boundaries

- Multiple compatible editorial sources increase confidence but do not become organizer-owned evidence merely through repetition.
- Search snippets, business directories, map listings, generic homepages, and social posts may locate evidence but cannot alone establish a publishable activity.
- Editorial authority for an activity does not automatically prove an exact OneMap building. Venue evidence is assessed separately; a reliable Singapore activity may publish off-map while exact-building review remains pending.
- Missing optional fields are preserved as unavailable and are never invented.

## Group 6 — Deduplication and event identity

**Status**: Agreed

### Policy

Users should see one logical activity rather than one copy per source, ticket type, schedule card, or editorial mention. Deduplication applies across Catch.sg, SISTIC, every new source, and the existing published data. Every contributing source remains attached as provenance even when only one event is shown.

### Identity levels

| Level                       | Meaning                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Source record               | The stable listing or detail record supplied by one source                                 |
| Parent activity             | The overall activity, production, exhibition, or programme                                 |
| Session or venue occurrence | A distinct scheduled session or venue-specific occurrence belonging to the parent activity |
| Published event             | The single user-facing activity assembled from compatible source records                   |

These identities must remain separate. Merging source records must not collapse genuinely different sessions, venues, editions, or sibling performances.

### Matching rules

| Situation                                                                                       | Handling                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Same canonical source record encountered repeatedly                                             | Reuse one source record                                                               |
| Same source lists one activity in several categories or ticket types                            | Collapse the repeated listing and retain the categories or ticket options as metadata |
| Same activity appears across different sources with compatible identity, schedule, and location | Merge into one published event and retain every source contribution                   |
| Direct and editorial sources describe the same activity                                         | Prefer direct evidence for current facts and attach editorial provenance              |
| Titles differ slightly but organizer, schedule, and location agree                              | Merge and preserve the alternate titles                                               |
| One source provides better dates, description, or access details                                | Enrich the existing event rather than create another event                            |
| Selectable sessions belong to the same activity                                                 | Keep one parent activity with its sessions                                            |
| Multi-location activity has reliably paired venue occurrences                                   | Keep one parent activity and distinct venue occurrences under it                      |
| Edition, year, venue, date, organizer, or programme materially differs                          | Keep separate unless stronger evidence proves they are the same activity              |
| Generic titles such as “Workshop” or “Live Music”                                               | Do not merge from title similarity alone                                              |
| Similarity is plausible but insufficient                                                        | Keep separate and record a possible-duplicate review candidate                        |
| Previously merged activity gains or loses a source                                              | Update the existing published identity; do not create a replacement duplicate         |

### Evidence used for matching

Evidence may include canonical links, official event identity, normalized title, organizer, edition, schedule or recurrence, Singapore venue or location state, description, and source-provided identifiers. No single weak field—especially title or raw venue text—may authorize a merge by itself.

For `anytime`, secret-venue, or other records without ordinary date-and-building evidence, merging requires stronger agreement from the remaining identity evidence, such as the same organizer, official link, distinctive title, description, or booking destination.

### Safe-merge principle

When uncertain, keep records separate and flag the possible duplicate. A false duplicate is inconvenient; an incorrect merge can hide a distinct activity or session. All merge and non-merge decisions must be traceable, deterministic, and repeatable on the same evidence.

## Group 7 — Venue evidence and OneMap resolution

**Status**: Agreed

### Policy

Mapping is a separate decision from event validity. A valid activity receives a building highlight only when reliable evidence identifies one logical OneMap building. Public placement and mapping status remain separate so reliable Singapore activities can stay off-map while exact-building review is pending.

### Address-evidence preference

Evidence for a venue address is preferred in this order:

1. The official venue or operator website.
2. The official host-building website.
3. An official government, tourism, institution, or organizer page.
4. A specific trusted event or editorial page, corroborated by the OneMap building record and without conflicting official evidence.

Search-result snippets, business directories, user-generated map listings, and copied address fragments may help locate evidence, but they are not sufficient proof by themselves.

### Resolution process

1. Preserve the published venue name, address, postal code, unit number, and coordinates without inventing missing values.
2. Resolve venue aliases only when evidence shows that they refer to the same physical venue or parent building.
3. Compare the address evidence with OneMap candidates.
4. Approve mapping only when the address, postal code, coordinates when available, and building identity agree without a material conflict.
5. Preserve the evidence and decision so unchanged venues can reuse it; re-evaluate when relevant evidence changes.

### Outcomes

| Situation                                                                                         | Handling                                                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Evidence identifies one compatible OneMap building                                                | Use mapped placement with approved mapping                                  |
| Unit such as `#03-30` is inside a uniquely identified building                                    | Map the parent building and retain the unit as venue detail                 |
| Official event page names a venue and the official venue page supplies its address                | Combine the compatible evidence and map the confirmed building              |
| Venue has a known alias that already resolves to the same approved building                       | Reuse the approved parent-building relationship                             |
| Mall, campus, or complex has several buildings but Singapore scope/general location is reliable   | Keep off-map with pending mapping review                                    |
| Address/postal code or coordinates conflict but Singapore scope/general location remains reliable | Keep off-map with pending mapping review                                    |
| Conflict makes Singapore scope or every usable location uncertain                                 | Hold with no public placement and pending review                            |
| Reliable venue exists but no compatible OneMap building geometry is available                     | Keep off-map with mapping not required and record the limitation            |
| Secret venue, broad outdoor area, mobile route, or unresolved multi-location listing              | Use off-map placement with mapping not required                             |
| Venue evidence later becomes complete or changes                                                  | Update the existing event and mapping decision without creating a duplicate |

### Positive and negative examples

| Evidence case                                                                                          | Decision                                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Official theatre page gives `1 Esplanade Drive, Singapore 038981`, matching one OneMap building        | Map the building                                                      |
| Workshop page says `Funan, #03-30`; Funan's official page and postal code identify the parent building | Map Funan and retain `#03-30`                                         |
| Event says only `Orchard Road`                                                                         | Keep off-map as a broad area                                          |
| Event says `NUS`, with no faculty, building, address, or meeting point                                 | Send to location review                                               |
| A directory supplies an address but the official venue provides a different one                        | Use the official evidence and review the conflict before mapping      |
| Official meeting point for a walking tour identifies one building entrance                             | Map the meeting point and retain the route as activity detail         |
| Secret dinner reveals its venue later                                                                  | Begin off-map, then update the same event onto the confirmed building |

### Mapping-safety principle

One exact building match is required for a building highlight. Confidence in the event itself does not compensate for weak location evidence. Conversely, failure to resolve a building does not invalidate an otherwise valid Singapore activity.

## Group 8 — Publication, review, and failure safety

**Status**: Agreed

### Policy

Publish every independently safe event and location branch without allowing an unrelated source outage, venue review, or possible duplicate to block the entire catalogue. Build each release as one atomic snapshot, but reconcile source and event outcomes independently. Preserve previously approved data wherever a current run cannot replace it safely.

### Event outcome dimensions

| Dimension        | Values                                       | Meaning                                     |
| ---------------- | -------------------------------------------- | ------------------------------------------- |
| Lifecycle        | `active`, `held`, `archived`, `excluded`     | Whether the activity is publicly eligible   |
| Public placement | `mapped`, `off_map`, `none`                  | Where an active activity appears            |
| Mapping status   | `approved`, `not_required`, `pending_review` | Whether exact-building work remains         |
| Freshness        | `current`, `stale`                           | Whether source/field evidence was refreshed |

### Isolation rules

| Situation                                                                            | Handling                                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| One venue cannot resolve to a building, but the activity is otherwise valid          | Publish it off-map or hold only that location branch; publish unrelated mapped events                 |
| Exact building is uncertain but Singapore activity and general location are reliable | Publish off-map and queue the mapping for review                                                      |
| Available evidence leaves the activity identity or Singapore scope uncertain         | Hold only that activity for review                                                                    |
| Possible duplicate lacks enough merge evidence                                       | Keep the activities separate, flag the pair, and publish other safe records                           |
| One source is unavailable during an update                                           | Retain its still-active previously approved records as stale; continue reconciling successful sources |
| A source is unavailable on its first run                                             | Publish nothing from that source, report the outage, and continue with successful sources             |
| Roots/HAN remains intentionally unavailable                                          | Report it as unavailable without blocking other sources                                               |
| A source succeeds but one record is malformed                                        | Isolate and report that record when accounting proves the remainder is complete                       |
| A source fails in a way that makes its accounting incomplete                         | Do not apply deletions or replacements from that source; carry forward its prior safe records         |
| An activity's final known occurrence has passed                                      | Archive it using the last reliable schedule evidence                                                  |
| Safe approved events pass all release-wide validation                                | Include them in the next atomic snapshot                                                              |

### When the whole snapshot must be preserved

A new snapshot must not replace the current approved snapshot when any release-wide condition below fails:

- the assembled snapshot is invalid, internally inconsistent, or loses records without an explained outcome;
- event identities or deduplication decisions cannot be reconciled deterministically;
- approved mapped events reference missing, conflicting, or invalid geometry;
- required build, data-contract, security, or user-interface validation fails;
- secrets or unsafe retrieval behavior are detected; or
- the atomic snapshot write or activation cannot complete safely.

These failures differ from an isolated source, event, or venue issue: they make the assembled release itself unsafe.

### Review-queue behavior

- Each review item must identify the affected source record, event, session, or venue branch and the exact reason for review.
- Resolving one item must update only its affected identity and must not duplicate the activity.
- Stale or superseded review items must be removed automatically.
- Review counts must distinguish event-evidence, schedule, deduplication, and location issues.
- An operator must be able to trace every collected record to publication, carry-forward, review, exclusion, or archive.

### Publication-safety principle

Atomic publication protects the catalogue from a partially written release; it does not require every source and every activity to be perfect simultaneously. Isolated uncertainty stays isolated. Only a failure that makes the assembled snapshot unsafe preserves the entire previous snapshot.

### Modeling clarification

The approved outcomes above are independent dimensions rather than one mutually exclusive
status. An active activity may be mapped or off-map, current or stale, and may separately have
a pending mapping review. In particular, reliable Singapore activities with an uncertain
exact building remain publicly off-map while their mapping review is pending; uncertainty
about Singapore scope or any usable general location holds the activity instead.

## Consolidation note

After all policy groups are reviewed, agreed decisions in this file must be incorporated into the main feature specification, requirements, tests, and implementation plan. Until then, an agreed decision here supersedes conflicting selection-policy language in those documents; proposed decisions do not.
