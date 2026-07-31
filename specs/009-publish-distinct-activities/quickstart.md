# Quickstart: Validate Distinct Activity Publication

## Prerequisites

- Node.js 24+
- Dependencies installed
- Worktree on `develop`
- Existing approved snapshot and stored event-pipeline fixture

## Focused validation

1. Run public activity projection and immutable-snapshot unit tests.
2. Run discovery-model tests for multi-session, multi-venue, off-map, filter, offer, and planning behavior.
3. Run the affected event-pipeline snapshot tests.
4. Generate the Cloudflare snapshot and run its contract tests.
5. Run lint and the production build.

Expected:

- Metadata exposes `activitiesRef` only.
- Landmarks contain references rather than embedded events.
- The catalogue contains unique activities with all compact sessions.
- No public artifact contains internal evidence/audit fields.
- Invalid and dangling references preserve the active snapshot.

## Browser validation

Run the event discovery flow across desktop/mobile Chromium, WebKit, and Firefox. Confirm one result per activity, all applicable map landmarks, off-map discovery, details, offers, and planning.

## Performance validation

Run the existing release benchmark with the same profile used for the occurrence baseline. Compare event transfer, parsed object volume, UI-ready time, heap, and frame rate. Record results in the feature validation notes before publication.
