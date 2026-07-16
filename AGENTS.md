# Repository Agent Instructions

## Event pipeline command

When the task is `npm run event-pipeline -- start`, this command means run the complete event pipeline, not merely initialize it.

For `npm run event-pipeline -- start` or `advance`, do not begin by inventorying the repository, running `rg --files`, or listing/searching `outputs`. Read only `skills/event-pipeline-runner/SKILL.md` plus these exact files: `skills/event-pipeline-runner/references/pipeline-contract.md`, `skills/event-pipeline-runner/references/stage-handoffs.md`, `skills/event-pipeline-runner/references/source-adapters.md`, and `skills/event-pipeline-runner/references/executable-orchestrator.md`; then execute the command. Do not guess reference filenames or probe with `ls`. After an ambiguous-venue intervention, open only its `allowedLocalReads` files and authoritative web pages; never search output directories or older runs.

1. Read `skills/event-pipeline-runner/SKILL.md` and all references it requires.
2. Execute `npm run event-pipeline -- start`.
3. Exit code `3` means `continuation_required`, not failure. Execute the returned `next.command` exactly in the same task; do not infer an internal stage action.
4. Continue through source collection, normalization, every venue's resolve/highlight/pill/panel stages, verification, and finalization.
5. Finish only after the CLI returns `complete: true`, or after a genuine documented external blocker remains unresolved.

Never offer continuation as optional. Never reuse or copy artifacts from an older run. Use the checked-in adapter definitions; do not rediscover documented endpoints. A listing row with no detail URL is an invalid listing-record pointer, not a synthetic URL or ID.

Process every eligible physical venue; do not limit the run to existing highlights. Reuse approved venue evidence before research and cache `needs_review` or `not_mappable` outcomes by evidence hash. Merge venue aliases only after they resolve to the same approved OneMap POI.

Classify frontend work as `create`, `update`, or `noop`. Reuse unchanged highlights, replace changed events by stable source-event identity, and skip extraction and generated-data writes for no-op landmarks.

Keep source occurrence identity separate from parent-listing and merged-event identities. A sibling performance is replaced only by its own occurrence identity; changing merged membership must not collapse or duplicate siblings.

At the start of reconciliation, expire events whose final known date is before the run window. Remove a pipeline-managed landmark and POI only when it has no current or future events. Preserve undated events for review rather than deleting them speculatively.

Publish only after every required source, venue branch, geometry check, build, event UI test, and staged browser check succeeds. An evidence-backed `not_mappable` outcome is safely accounted without a highlight. Any `needs_review`, source outage, or failed gate preserves the previous active snapshot. Successful publication writes a new immutable `data/snapshots/<run-id>/` manifest and then atomically swaps `data/approved-snapshot.json`.

`outputs/data/events.json` is event data, not a venue registry, and must never be passed to `--registry`. A reusable registry entry is trusted only when it is explicitly approved and contains both OneMap identity/tile evidence and coordinates.

## Local venue resolution

- Extract saved address evidence with `npm run venue-index:enrich -- --run <run-id>`, then resolve without runtime external services using `npm run venue-index:resolve -- --run <run-id>`.
- The SQLite database and downloaded OSM extract live under ignored `outputs/local-venue-index/`.
- Rebuild with `npm run venue-index:build -- --onemap tiles,public/poi-tiles --osm outputs/local-venue-index/malaysia-singapore-brunei-latest.osm.pbf`.
- Review `local-venue-resolution.md`; apply only `candidate_matched` and never promote `needs_review` automatically.
- Store reusable evidence-backed parent-building relationships in `data/venue-alias-registry.json`.
