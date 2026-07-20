# Event Pull Sources

This file is the human-readable source schedule. Executable adapter and window configuration lives in `data/event-pipeline-config.json`; the pipeline validates that configuration at run start.

## Shared filter

- Window: `current_date 00:00` through `current_date + 7 days 23:59:59`, inclusive (eight represented calendar dates)
- Timezone: `Asia/Singapore`

## Sources

| Source                         | Enabled  | Adapter                              | Date filter                                         | Last successful use        |
| ------------------------------ | -------- | ------------------------------------ | --------------------------------------------------- | -------------------------- |
| Catch.sg                       | yes      | `catch-official-listing-v1`          | shared window                                       | `2026-07-17T18:59:40.768Z` |
| SISTIC                         | yes      | `sistic-official-listing-v1`         | shared window                                       | `2026-07-19T19:18:21.712Z` |
| Fever Singapore                | yes      | `fever-singapore-rendered-v1`        | shared window                                       | `2026-07-19T19:23:10.668Z` |
| Visit Singapore All Happenings | yes      | `visit-singapore-rendered-v1`        | shared window                                       | `2026-07-19T19:23:20.344Z` |
| Singapore Film Society         | yes      | `singapore-film-society-rendered-v1` | shared window                                       | `2026-07-19T19:23:36.872Z` |
| Roots HAN                      | disabled | `roots-han-rendered-v1`              | layout contract changed; revalidate before enabling | `2026-07-17T12:35:48.168Z` |
| Honeycombers                   | pilot    | `honeycombers-discovery-v1`          | shared window                                       | `2026-07-19T19:24:06.666Z` |
| ArtsEquator                    | pilot    | `arts-equator-discovery-v1`          | shared window                                       | `2026-07-19T19:24:10.067Z` |
| Time Out Singapore             | pilot    | `time-out-singapore-discovery-v1`    | shared window                                       | `2026-07-19T19:24:42.996Z` |

Adapter definitions are in `data/event-pipeline-config.json`. Update `Last successful use` only after executable source collection completes every configured page and validation step successfully.

# Discovery, MRT, and location context

The checked-in source catalogue is `data/map-context-sources.json`. It records the official data.gov.sg dataset identities, catalogue pages, poll-download endpoints, observed source periods, Singapore Open Data Licence, staging/final paths, and required provenance fields for:

- URA subzone boundaries used for wide-zoom area recommendations;
- LTA MRT station exits consolidated by normalized station name;
- URA rail lines simplified only for runtime rendering;
- URA Master Plan 2025 station-name annotations joined to station identity.

Generate staged assets with `npm run build:map-context`. Do not copy older outputs, invent a download URL, merge stations by proximity, or publish one half of an asset/manifest pair. Review the manifest hashes, feature counts, unique IDs, WGS84 validation, and any reconciliation result. Publish only an approved pair; on HTTP 429, source outage, unexpected loss, or validation failure, leave the current approved asset unchanged and retry the authoritative endpoint later.

MRT data is presentation context unless the user explicitly requests a transit-aware recommendation. Browser geolocation is not downloaded or persisted: it is requested explicitly, shared in memory, reduced to a coarse area for assistant context, and cleared when the session or controller ends.
