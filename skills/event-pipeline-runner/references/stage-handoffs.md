# Stage Handoffs

Every stage file uses this envelope:

```json
{
  "schemaVersion": "1.0",
  "runId": "",
  "stage": "resolve | highlight | pill | panel",
  "status": "pending | success | blocked | failed | skipped | unresolved",
  "startedAt": "",
  "endedAt": "",
  "inputRefs": [],
  "outputRefs": [],
  "error": null,
  "nextStep": null,
  "result": {}
}
```

Domain values belong in `result`; for example, resolver `approved` is `result.resolutionStatus`, while the stage status is `success`.

Every successful highlight, pill, and panel result includes `changeAction: "create" | "update" | "noop"`. Use `noop` only when the existing artifact's canonical content hash matches the complete incoming content.

The complete snapshot also records `expiredEventIds` and `removedLandmarkIds`. Expiry removals are successful reconciliation changes, not failed venue stages.

## Resolve result

Use the approved record defined by `onemap-venue-resolver` as `result`, with `resolutionStatus: "approved"`, plus `inputEventIds` and attempts. The stage envelope has `status: "success"`. Persist as `stages/<poi-id>/resolve.json`.

Use stage status `unresolved` for resolver outcomes `needs_review` and `not_mappable`. Include the complete `inputEventIds`, `evidenceInspected`, `finalReason`, `cacheKey`, and `evidenceHash` so unchanged later runs reuse the outcome instead of repeating research. A `needs_review` result must additionally include the exact `recoveryEvidenceRef` returned by `record-venue-recovery`, `webResearch` covering `venue_official` and `host_or_authority`, `localLookupEvidence` covering the focused address/coordinate rerun and `find-poi-tile-candidates`, numbered `recoveryAttempts` 1 and 2, and `competingCandidates` (empty only when no candidates were returned).

For an emitted ambiguous-venue checkpoint, edit the supplied `recoveryTemplate` and run its exact `recoveryCommand`. The orchestrator creates the stage handoff after the focused rerun; the intervention agent must not create or search for that handoff itself.

Research and submit each branch independently. `evidenceInspected` and `webResearch.resultUrls` contain pages actually opened, never search-result URLs. When `local-venue-resolution.json` lists alternatives, `competingCandidates` includes their GML identities and the evidence used to reject or prefer each relevant candidate; a templated empty list is invalid.

A `not_mappable` result must include `notMappableEvidence` with `reasonCode` equal to `outside_singapore`, `mobile_venue`, `multi_venue`, or `no_target_building`, plus at least one authoritative URL. The canonical shape is `{ "reasonCode": "multi_venue", "sourceUrls": ["https://host.example/event"] }`: `sourceUrls` contains inspected HTTP(S) URL strings, not labels or search-result URLs. A local lookup miss alone must be recovered or returned as fully evidenced `needs_review`.

## Highlight result

```json
{
  "changeAction": "create | update | noop",
  "poiId": "esplanade",
  "canonicalVenue": "Esplanade - Theatres on the Bay",
  "anchor": { "lng": 103.85455, "lat": 1.2892 },
  "poiTilesetUrl": "poi-tiles/esplanade/tileset.json",
  "extractionManifestUrl": "poi-tiles/esplanade/extraction-manifest.json",
  "backgroundTileRefs": [],
  "frontendLayerId": "event-venues-3d",
  "eventIds": [],
  "verification": { "browserUrl": "", "zoomLevels": [], "tileErrors": 0, "evidence": [] }
}
```

Require browser evidence and zero relevant tile errors.

## Pill result

```json
{
  "changeAction": "create | update | noop",
  "poiId": "esplanade",
  "rootId": "esplanade-event-pill",
  "component": "activity-scenes/landmark-event-pill.js",
  "updateMode": "successful-snapshot-reconcile",
  "eventIds": [],
  "selectedEventId": "",
  "verification": { "closeZoom": 17, "overviewZoom": 15.5, "keyboard": true, "evidence": [] }
}
```

The panel input is the complete canonical events referenced by `eventIds`, the approved landmark identity/anchor, and this successful pill stage.

The pipeline commits pill handoffs as one complete successful snapshot. Existing `poiId` values replace their event lists, new values append, and values absent from the successful snapshot are removed. Partial or failed runs do not commit frontend handoffs.

## Panel result

```json
{
  "changeAction": "create | update | noop",
  "poiId": "esplanade",
  "component": "activity-scenes/landmark-event-panel.js",
  "eventIds": [],
  "fieldContractVersion": "1.0",
  "refreshMode": "replace-active-landmark-events",
  "verification": { "mouse": true, "keyboard": true, "responsive": true, "fallbacks": true, "evidence": [] }
}
```

Never create a downstream handoff when the upstream stage status is not `success`.
