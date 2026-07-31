# Schedule Contract

## Adapter output

Each adapter record supplies:

```json
{
  "dateText": "26 Jul & 2 Aug 2026, Sun, 9am",
  "performances": [
    {
      "startDateTime": "2026-07-26T09:00:00+08:00",
      "endDateTime": null,
      "dateText": "26 Jul 2026",
      "timeText": "9am",
      "schedule": {
        "kind": "exact",
        "evidenceReasonCode": "enumerated_dates_parsed"
      }
    }
  ],
  "authorityRefs": ["sistic:palacews0826"]
}
```

If exact dates cannot be established:

```json
{
  "performances": [
    {
      "startDateTime": null,
      "endDateTime": null,
      "dateText": "Official source text",
      "schedule": {
        "kind": "selectable",
        "evidenceReasonCode": "schedule_dates_not_expanded"
      }
    }
  ]
}
```

## Normalized output

- `exact`: strict ISO `start`; optional strict ISO `end`
- `range`: strict ISO `start` and `end`; explicit continuous evidence
- `recurring`: recurrence evidence plus upstream exact instances
- `selectable`: no claimable `start`/`end`
- `unverified`: no claimable `start`/`end`

`finalKnownOccurrence` may retain a lifecycle bound but MUST NOT be used as a date-filter
match for `selectable` or `unverified`.

## Public filtering

1. Compute selected day as `[00:00:00, 23:59:59.999]` at `+08:00`.
2. Restrict the candidate set to the projected venue group's `sessionIds`.
3. Match only strict-ISO exact sessions or explicit continuous ranges.
4. Reject non-ISO boundaries with a diagnostic reason.
5. Return the matching session IDs separately from all activity sessions.

## Diagnostics

Required reason codes:

- `enumerated_dates_parsed`
- `schedule_dates_not_expanded`
- `continuous_range_confirmed`
- `structured_performance_exact`
- `coarse_envelope_suppressed`
- `non_iso_boundary_rejected`
- `projected_session_not_applicable`
