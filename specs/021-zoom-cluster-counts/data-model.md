# Data Model: Zoom-Aware Event Cluster Counts

All entities in this document are transient presentation data. No persisted schema or
approved snapshot format changes.

## Event Location Candidate

Represents one approved event landmark eligible for overview clustering.

| Field              | Meaning                               | Validation                                |
| ------------------ | ------------------------------------- | ----------------------------------------- |
| `id`               | Stable landmark identity              | Non-empty and unique in the current layer |
| `label`            | Human-readable venue/location label   | Non-empty                                 |
| `longitude`        | Approved anchor longitude             | Finite number                             |
| `latitude`         | Approved anchor latitude              | Finite number                             |
| `screenX`          | Current projected horizontal position | Finite number                             |
| `screenY`          | Current projected vertical position   | Finite number                             |
| `matches`          | Whether current event filters match   | Must be true to participate               |
| `navigationTarget` | Existing explicit pill exception      | Must be false to participate              |

Candidates outside the viewport or at/above the pill threshold are excluded before
grouping.

## Location Cluster

Represents one derived group of distinct event locations for the current viewport and zoom.

| Field       | Meaning                                                   | Validation                                |
| ----------- | --------------------------------------------------------- | ----------------------------------------- |
| `key`       | Transient identity from sorted member landmark identities | Stable while membership is unchanged      |
| `members`   | Distinct candidate locations represented                  | At least one, no duplicate `id`           |
| `count`     | Number displayed                                          | Exactly `members.length`                  |
| `screenX`   | Display anchor horizontal position                        | Finite mean of member projected positions |
| `screenY`   | Display anchor vertical position                          | Finite mean of member projected positions |
| `longitude` | Navigation center longitude                               | Finite mean of member anchors             |
| `latitude`  | Navigation center latitude                                | Finite mean of member anchors             |
| `bounds`    | Minimum/maximum member coordinates                        | Contains every member                     |

## Presentation Mode

| State                  | Entry condition                 | Visible representation                     | Exit                                    |
| ---------------------- | ------------------------------- | ------------------------------------------ | --------------------------------------- |
| `empty`                | No matching visible candidates  | No count or ordinary pill                  | Data/filter/viewport adds a candidate   |
| `clusters`             | Zoom below pill threshold       | One count per derived cluster              | Zoom reaches threshold                  |
| `pills`                | Zoom at or above pill threshold | Existing matching pills                    | Zoom drops below threshold              |
| `navigation-exception` | Existing target is active       | Target pill plus clusters excluding target | Target clears or zoom reaches threshold |

## Reconciliation

- **Create**: A cluster membership key appears for the first time.
- **Update**: The key remains but its projected position, label context, or navigation data
  changes.
- **No-op**: The key and rendered values are unchanged.
- **Expire**: The key is absent after map, filter, navigation, or landmark reconciliation.
- **Review**: Not applicable; clusters never alter approved evidence.

The sum of member counts across settled clusters equals the number of eligible candidates.
