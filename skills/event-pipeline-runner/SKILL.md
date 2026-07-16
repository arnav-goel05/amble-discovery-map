---
name: event-pipeline-runner
description: Handle structured intervention requests emitted by the executable event pipeline. Use only when code reports an external provider-contract change, ambiguous venue evidence, inconclusive visual verification, or an exceptional external-state action requiring authority.
---

# Event Pipeline Intervention Runner

The executable pipeline owns configuration, source collection, pagination, raw capture, normalization, local resolution, extraction, reconciliation, browser tests, reporting, resume, and finalization. Do not manually perform or emulate those operations and do not manufacture result files.

Read `skills/event-pipeline-runner/references/pipeline-contract.md`, `skills/event-pipeline-runner/references/stage-handoffs.md`, `skills/event-pipeline-runner/references/source-adapters.md`, and `skills/event-pipeline-runner/references/executable-orchestrator.md` completely before handling an intervention. These are repository-root-relative paths.

Run `next.command` exactly while `mustContinue` is true. `next.action` is always `run-command`; internal stages are intentionally hidden and owned by the executable orchestrator. Never infer another action, inspect stage files, or search for a handoff. Stop normal execution only when the CLI emits a structured `intervention` object.

## Allowed interventions

### Provider contract changed

Inspect the official configured endpoint and current response. Determine whether the documented provider contract changed. Record the exact missing or changed field and current-run evidence. Do not substitute another endpoint, scrape an unofficial source, or synthesize records. Adapter code and fixtures must be updated and tested before collection resumes.

### Ambiguous venue evidence

Use `onemap-venue-resolver` only for the unresolved branch named by the intervention. Return structured authoritative evidence. Never force a match.

An evidence-backed unresolved venue is terminal for that branch, but `needs_review` blocks publication of the candidate snapshot. Continue processing and verifying every other branch so the report and review queue are complete, while preserving the previous active snapshot. Only an affirmatively evidenced `not_mappable` outcome is safely accounted without a highlight.

Handle one emitted branch at a time. Never generate unresolved results in a batch, reuse templated research claims, or describe a search that was not actually performed. Search-result pages are discovery tools, not evidence URLs. When the local result contains alternatives, carry those candidates into the review record and assess them explicitly before returning `needs_review`.

Treat the intervention's `recoveryFieldFormats` as the complete submission schema. Do not search repository files, caches, or older outputs for field examples.

Use `host_or_authority` for supplied Catch.sg, SISTIC, and SG Culture Pass listing/event pages. Use `venue_official` only for the actual venue or operator website. Never swap these roles. If that official address conflicts with a saved provider-page location clue, discard the conflicting clue instead of geocoding or preserving it.

The intervention is the complete working context. On every new branch, first open both exact paths in `allowedLocalReads`; never reuse a prior venue's patch, template content, URLs, or evidence. Use the branch-scoped `evidenceBundle`, then edit only its pre-created `recoveryTemplate`. During an ambiguous-venue intervention, the only permitted local reads are the paths in `allowedLocalReads`: never run `rg`, `find`, `ls`, or another search under `outputs/event-pipeline`, inspect implementation code, or read another run. Inspect `officialCandidatePages` before searching: if the provider identifies an operator, organiser, booking site, studio, or tenant, resolve that actual host before a generic parent estate or landmark. Open the supplied host/authority page and one actual venue-official page. OneMap is geographic evidence, not a substitute for the venue/operator's official page. Use `npm run web-evidence -- --url '<url>' --terms '<comma-separated terms>'` for raw HTTP or shortened map links; it follows redirects and returns bounded metadata, snippets, relevant official navigation links, and coordinates. After an official page establishes an address but supplies no pin, use `npm run onemap-geocode -- --query '<verified address>'`; do not discover or handcraft OneMap endpoints. Always quote URLs and queries. Never print raw page bodies with `curl`, `head`, `sed`, or `rg`. When an official page exposes a map or directions link, record its published pin as coordinate evidence instead of leaving coordinates empty. If an operator has multiple outlets, use only the outlet explicitly tied to this event by its official product page, start-point label, or published map link; never default to the first address or flagship. Leave genuinely unavailable optional fields empty; record the inspected evidence and outcome instead of inventing values. If authoritative evidence corrects the supplied venue to a fixed physical building, recover that building's address and coordinates; do not classify the incorrect source label as `no_target_building`. Use `no_target_building` only when the verified event location itself is an MRT platform, gantry, passage, standalone exit, or another location without an exact OneMap building GML; never attach it to a nearby building. Edit only the template, then execute the exact `recoveryCommand`. Each inspected evidence entry includes `sourceType`, `label`, actual `query`, `checkedAt`, `outcome`, and the opened page `url`. The command feeds recovered address, postal-code, and coordinate evidence through the local OSM/OneMap resolver and automatically records `needs_review` when ambiguity remains; do not search for or manually manufacture a second resolver handoff. If the intervention already has a non-null `recoveryEvidenceRef`, use that checkpoint and do not repeat web recovery.

When OneMap returns multiple rows for one postal code, use a coordinate only when exactly one row's `searchValue` matches the authoritative place, tenant, start-point, or pickup-point name. Never choose the first row by order. If none or several match, leave coordinates empty and record the ambiguity.

For a coordinate returned by `onemap-geocode`, use `source: "onemap_public_exact_address"` and copy its `requestUrl` into `recordRef`. Never attribute that coordinate to a venue page that exposed no pin.

Treat differently named OneMap rows whose coordinates are within two metres as one geographic pin. The executable recovery command consolidates this case automatically.

When authoritative evidence names a single host building that OneMap splits into repeated same-name GML parts, the executable resolver may approve the complete code-proven geometry group. Do not manually choose one part or assemble a group.

A unique OneMap result at the verified street address is valid host-building evidence even when its building or complex name differs from the tenant. The recovery command fills this coordinate automatically; do not discard it merely because OneMap names the host building rather than the unit occupant.

For any `notMappableEvidence`, write `sourceUrls` canonically as an array of actual inspected HTTP(S) URL strings, for example `{ "reasonCode": "multi_venue", "sourceUrls": ["https://host.example/event"] }`; do not use labelled objects or search-result URLs.

The recovery command automatically converts a verified MRT exit, platform, gantry, or passage into `no_target_building` and discards its coordinate as a highlight target.

The orchestrator automatically classifies a normalized event whose source explicitly lists two or more locations as `multi_venue`; do not research or collapse it onto one listed building.

### Inconclusive visual verification

Use the relevant highlight, pill, or panel adjudication skill only after automated assertions and captured screenshots are complete but cannot decide a visual criterion. Record the inspected evidence and narrow judgment; do not claim automated checks that did not run.

### Exceptional external state

Ask for authority only when required for an external-state mutation, such as removing a cross-host lock whose owner cannot be verified. Do not broaden the requested action.

## Completion

Submit the structured intervention result through the CLI and wait for that command to exit with its complete result. Only then resume executable progression. Never launch `record-venue-recovery` and `advance` concurrently. Completion exists only when the CLI returns `complete: true`.
