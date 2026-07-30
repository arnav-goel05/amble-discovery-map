# Data Model: Event Pipeline Optimization

## StageInputManifest

Immutable declaration of everything capable of changing one stage result.

| Field               | Type    | Rules                                                |
| ------------------- | ------- | ---------------------------------------------------- |
| `schemaVersion`     | string  | Versioned contract                                   |
| `stage`             | string  | Stable stage/gate identifier                         |
| `contractVersion`   | string  | Changes when stage semantics change                  |
| `codeIdentity`      | object  | Commit/tree or explicit source-file hashes           |
| `configuration`     | array   | Ordered `{ref, sha256}` records                      |
| `upstreamArtifacts` | array   | Ordered `{ref, sha256, bytes}` records               |
| `dependencies`      | object  | Adapter, policy, runtime, execution-context versions |
| `inputHash`         | SHA-256 | Canonical hash of all fields above                   |

## StageCheckpoint

| Field           | Type            | Rules                                     |
| --------------- | --------------- | ----------------------------------------- |
| `schemaVersion` | string          | `1.0` initially                           |
| `checkpointId`  | string          | Stable stage plus input hash              |
| `stage`         | string          | Matches manifest                          |
| `inputHash`     | SHA-256         | Exact manifest hash                       |
| `status`        | enum            | `success`, `failed`, `invalidated`        |
| `outputs`       | array           | Immutable refs with SHA-256 and byte size |
| `metrics`       | ResourceMetrics | Bounded measurements                      |
| `createdAt`     | timestamp       | Volatile, excluded from parity            |
| `invalidatedBy` | array           | Reason-coded changed inputs               |

Only `success` checkpoints with intact output hashes are reusable. Failure checkpoints are
diagnostic, not reusable results.

## GateReceipt

A specialized checkpoint containing command identity, bounded environment contract, input
artifact hashes, and the gate outcome. The authoritative release barrier requires receipts
for POI separation, build, event UI, and staged browser verification.

## RecoveryCacheEntry

| Field               | Type           | Rules                                                    |
| ------------------- | -------------- | -------------------------------------------------------- |
| `schemaVersion`     | string         | Versioned                                                |
| `cacheKey`          | SHA-256        | Canonical recovery inputs                                |
| `evidenceHash`      | SHA-256        | Source evidence, normalized clues, event horizon         |
| `policyVersion`     | string         | Recovery/authority policy                                |
| `adapterVersion`    | string         | Search/fetch contract                                    |
| `geographicContext` | object         | Existing locale/provider identity                        |
| `outcome`           | enum           | `recovered`, `not_found`, `needs_review`, `not_mappable` |
| `result`            | object         | Existing validated recovery payload                      |
| `evidenceRefs`      | array          | Public evidence references                               |
| `createdAt`         | timestamp      | Freshness origin                                         |
| `expiresAt`         | timestamp/null | Required for negative outcomes                           |
| `lastUsedAt`        | timestamp      | Operational only                                         |

State transitions:

```text
fresh -> reused
fresh -> invalidated (declared input changed)
fresh -> expired (TTL elapsed)
invalidated/expired -> recomputed -> fresh
```

## ResourceMetrics

| Field                                 | Type      |
| ------------------------------------- | --------- |
| `startedAt`, `finishedAt`             | timestamp |
| `durationMs`, `blockingMs`            | integer   |
| `externalRequests`                    | integer   |
| `cacheHits`, `cacheMisses`            | integer   |
| `bytesRead`, `bytesWritten`           | integer   |
| `artifactsCreated`, `artifactsReused` | integer   |
| `gateExecutions`, `gateReuses`        | integer   |
| `reasonCode`                          | string    |

## EquivalenceReport

Contains baseline/candidate identities, canonicalizer version, excluded volatile paths,
surface hashes, exact differences, asset hash results, metric deltas, and activation
decision. An activated category has no unexplained differences and improves at least one
declared target without violating its tolerance.

## DeliveryReceipt

Content-addressed proof for publication-adjacent side effects.

| Field             | Type      | Rules                                                   |
| ----------------- | --------- | ------------------------------------------------------- |
| `operation`       | enum      | `admin_reconcile`, `snapshot_publish`, `dashboard_sync` |
| `payloadHash`     | SHA-256   | Canonical payload                                       |
| `destinationHash` | SHA-256   | Non-secret destination identity                         |
| `contractVersion` | string    | Operation semantics                                     |
| `status`          | enum      | `success`, `failed`                                     |
| `responseSummary` | object    | Bounded and redacted                                    |
| `completedAt`     | timestamp | Operational only                                        |

Only successful receipts with the same operation, payload, destination, and contract are
reusable.
