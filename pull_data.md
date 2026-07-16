# Event Pull Sources

This file is the human-readable source schedule. Executable adapter and window configuration lives in `data/event-pipeline-config.json`; the pipeline validates that configuration at run start.

## Shared filter

- Window: `current_date 00:00` through `current_date + 7 days 23:59:59`, inclusive (eight represented calendar dates)
- Timezone: `Asia/Singapore`

## Sources

| Source | Enabled | Adapter | Date filter | Last successful use |
|---|---|---|---|---|
| Catch.sg | yes | `catch-official-listing-v1` | shared window | `2026-07-13T07:34:03.078Z` |
| SISTIC | yes | `sistic-official-listing-v1` | shared window | `2026-07-13T12:18:46.110Z` |

Adapter definitions are in `data/event-pipeline-config.json`. Update `Last successful use` only after executable source collection completes every configured page and validation step successfully.
