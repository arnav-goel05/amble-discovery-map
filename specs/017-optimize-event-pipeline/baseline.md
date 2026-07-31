# Baseline: 2026-07-26 Event Pipeline

## Authority

- Repository commit before Feature 017: `234c950be84d9f4c61f7af80e01fe45d070d9f71`
- Full-run directory:
  `outputs/event-pipeline/20260726T114314Z-20260726T000000+0800-20260802T235959+0800`
- Active approved snapshot:
  `20260726T114314Z-20260726T000000+0800-20260802T235959+0800-schedule-semantics-v10`
- Approved pointer manifest hash:
  `1ec3a5f138a966835a8c30702013590d3cce6b26a332983f054a8eb9893b7858`

## Canonical counts

| Surface                    | Baseline |
| -------------------------- | -------: |
| Source occurrences         |   31,801 |
| Excluded occurrences       |   17,880 |
| Eligible pre-dedup         |   13,905 |
| After same-source dedup    |   13,562 |
| After cross-source dedup   |   13,537 |
| Published activities       |      566 |
| Published mapped sessions  |    6,467 |
| Published off-map sessions |    5,708 |
| Approved landmarks         |      136 |
| Approved POIs              |      136 |

Counts are orientation only. Activation requires canonical identity/field/evidence/decision
parity under `contracts/equivalence-contract.md`.

## Active snapshot hashes

| Artifact               | SHA-256                                                            |       Bytes |
| ---------------------- | ------------------------------------------------------------------ | ----------: |
| `activities.json`      | `829c25ffbc137c5d7010c24912e0006890165a059aac00a2f289e4b5ed28e136` |   8,188,675 |
| `internal-events.json` | `24b6b612ca79e8adca3778c4ed2544b702d2a77d49ff04a58bb3ddec1a4df1e6` | 212,120,803 |
| `landmarks.json`       | `70402be9a420bf6e1c28ea88fd3eb979640a2f5c0c4ca09723d7a596a3eb5ad5` |     107,374 |
| `pois.json`            | `ddda612304679fa1201eaa11d41cfaf38ed8478b3c0a8b7ccc92e67057c4e6a3` |      74,296 |
| `tileset.json`         | `e2e8c8484c3dcfa1e29d3048efeb550f59bbd08ca79e573eaff63ca4e89aa1cf` |      75,858 |

## Resource baseline

| Resource                             | Baseline observation                                                |
| ------------------------------------ | ------------------------------------------------------------------- |
| Wall time                            | Approximately 2h29m                                                 |
| Run directory                        | 6.6 GB                                                              |
| Normalized intermediates             | 422 MB                                                              |
| Frontend staging                     | 6.0 GB                                                              |
| TinyFish venue searches              | 57                                                                  |
| Venue searches recovered / not found | 8 / 49                                                              |
| Venue branches                       | 302                                                                 |
| Frontend actions                     | 11 create, 1 update, 124 no-op highlights                           |
| Repeated verification                | POI/build/event UI executed in staged and later verification paths  |
| Repeated finalization                | Five finalization/admin/dashboard attempts observed during recovery |

Provider wait and manual intervention are separated from deterministic processing in new
measurements; total wall time is reported but has no fixed activation threshold.
