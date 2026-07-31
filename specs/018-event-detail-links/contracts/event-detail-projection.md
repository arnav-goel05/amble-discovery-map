# Event Detail Projection Contract

## Input

The projector accepts:

- a current landmark context;
- one or more approved canonical activities or supported legacy event records;
- an optional selected discovery activity.

Canonical records use activity schema version `1.0` and retain stable activity, session, venue-group, and offer identities.

## Output

The projector returns a deterministically ordered list of event-detail activities. Each result contains:

- stable `activityId`;
- normalized `occurrences` with stable `occurrenceId`;
- normalized venue groups and occurrence membership;
- validated source offers with `referenceId`, label, URL, scope, and occurrence coverage;
- approved descriptive fields;
- separate date and time values when published schedule evidence supports them;
- a schedule summary and session count.

## Source-offer rules

1. Accept only HTTP(S) targets.
2. Preserve `offerId` as the UI and capability `referenceId`.
3. Preserve the approved source as the link label.
4. Activity-scoped offers apply to every occurrence.
5. Session-scoped offers apply only to listed session identities.
6. Deduplicate identical stable reference and URL pairs.
7. An invalid or inapplicable offer is absent, not rendered as a disabled link.

## Capability parity

The panel context exposes at most the existing bounded reference set for the selected activity. Direct link clicks and `event.openreference` use the same reference identity and current eligibility. Changing the selected occurrence republishes context before another action is accepted.

## Legacy compatibility

Legacy event records may provide:

- `eventUrl`, `sourceUrl`, or `url`;
- object-shaped `sources`;
- explicit `dateText` and `timeText`.

They pass through the same HTTP(S) validation and produce the same normalized output shape.

## Failure behavior

- Missing optional fields remain null and render as "Not available."
- Missing sessions produce the existing unavailable schedule state.
- Missing venue groups do not create coordinates or venue names.
- Invalid external URLs never become actionable.
