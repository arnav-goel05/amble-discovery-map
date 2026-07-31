# Contract: Normalized Date Reviews

`normalized/date-reviews.json` is an immutable per-run envelope:

```json
{
  "schemaVersion": "3.0",
  "runId": "<run-id>",
  "createdAt": "<ISO timestamp>",
  "source": null,
  "counts": { "records": 1 },
  "records": [
    {
      "schemaVersion": "1.0",
      "reviewId": "date-review:<stable hash>",
      "eventId": "<occurrence identity>",
      "parentActivityId": "<parent identity>",
      "sourceName": "<configured source>",
      "sourceRecordRef": "<captured artifact pointer>",
      "occurrenceIndex": 0,
      "evidenceHash": "<evidence hash>",
      "policyVersion": "1.0",
      "asOf": "<run window start>",
      "status": "needs_review",
      "lifecycleState": "held",
      "reasonCodes": ["missing_date"],
      "assessment": {},
      "event": {}
    }
  ]
}
```

Required accounting:

- `counts.records` equals `records.length`.
- `reviewId` and `eventId` are unique within the artifact.
- Every reason code belongs to the date-quality policy vocabulary.
- Every review points to processed source evidence.
- Accepted, excluded, invalid, and date-review artifacts jointly account for the run input.
