# Data Model: Performance Observability

## Performance Sample

| Field         | Type                  | Rules                                                         |
| ------------- | --------------------- | ------------------------------------------------------------- |
| `metric`      | string                | Stable allowlisted identifier                                 |
| `value`       | finite number or null | Null only for pending/unsupported                             |
| `unit`        | enum                  | `ms`, `bytes`, `count`, `fps`, `percent`, `state`             |
| `capturedAt`  | ISO timestamp         | Updated when the value changes                                |
| `freshnessMs` | non-negative number   | Derived at snapshot/render time                               |
| `state`       | enum                  | `healthy`, `warning`, `over_budget`, `pending`, `unsupported` |

Transitions: `pending → healthy|warning|over_budget|unsupported`; supported samples may
move among budget states as measurements change.

## Performance Snapshot

| Field           | Type          | Rules                                                |
| --------------- | ------------- | ---------------------------------------------------- |
| `schemaVersion` | string        | Required, currently `1.0`                            |
| `capturedAt`    | ISO timestamp | Explicit developer capture time                      |
| `visibility`    | enum          | `foreground` or `background`                         |
| `reducedMotion` | boolean       | Capability/context only                              |
| `capabilities`  | object        | Boolean flags only                                   |
| `samples`       | array         | Allowlisted aggregate Performance Samples            |
| `resources`     | object        | Aggregate groups and bounded sanitized largest paths |
| `budgets`       | array         | Evaluation summaries for visible samples             |

Validation: UTF-8 JSON must remain below 100 KiB. It must not contain coordinates,
location/area, URL query/fragment/origin, application identifiers, user input, selected
content, event/restaurant/plan/conversation data, or credentials.

## Performance Budget Configuration

| Field                | Type    | Rules                                               |
| -------------------- | ------- | --------------------------------------------------- |
| `schemaVersion`      | string  | Required, currently `1.0`                           |
| `label`              | string  | Identifies guardrails as red-line limits            |
| `profiles`           | object  | Exactly the benchmark profile identifiers           |
| `profiles.*.metrics` | object  | Stable report metric paths                          |
| `metrics.*.min       | max`    | finite number                                       | Exactly one comparison direction |
| `metrics.*.severity` | enum    | `warning` or `error`                                |
| `metrics.*.required` | boolean | Missing required measurement is a failed evaluation |

## Budget Evaluation

| Field       | Type                  | Rules                               |
| ----------- | --------------------- | ----------------------------------- |
| `profile`   | string                | Declared profile                    |
| `metric`    | string                | Declared metric path                |
| `operator`  | enum                  | `min` or `max`                      |
| `threshold` | finite number         | Copied from validated configuration |
| `actual`    | finite number or null | Null when unsupported/missing       |
| `delta`     | finite number or null | Signed distance from threshold      |
| `severity`  | enum                  | Copied from budget                  |
| `status`    | enum                  | `passed`, `exceeded`, `unsupported` |

## Benchmark Report

The existing report advances to schema version 2 and retains raw runs, summaries,
environment, dataset context, area/context correctness gates, and full-quality restoration.
It adds validated budget configuration metadata, all evaluations, overall budget state,
browser version, and git dirty state.
