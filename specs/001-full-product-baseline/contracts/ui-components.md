# UI Component Contracts

UI components own markup, styling hooks, interaction, and lifecycle. Pipelines and API
clients provide validated data only. Every component supports consistent loading, empty,
missing-data, stale, selected, disabled, and error states where applicable.

Apple Human Interface Guidelines inform hierarchy, spacing, feedback, touch targets, and
motion. What's Here tokens and cross-browser behavior remain authoritative; this is not an
instruction to imitate an Apple product or adopt an Apple UI library.

## Shared lifecycle

Singleton feature components expose only the methods they need from this vocabulary:

```text
mount(container/context)
open(payload)
close(reason)
reconcile(snapshot)
refresh(context)
select(identity)
finalize()
```

`mount` and `finalize` are paired and idempotent. `reconcile` updates stable identities,
removes expired identities, and performs no work for unchanged hashes. Opening one exclusive
overlay closes the previous exclusive overlay through the shared coordinator. Map clicks may
close overlays only through the same coordinator.

## Event pill layer

Input per landmark: stable landmark ID, anchor, ordered current events, selected event,
content hash, and snapshot freshness.

Display: complete title in the agreed compact typography. Date/time is not rendered inside
the compact map pill. Multiple events rotate only through the explicit interval contract and
preserve stable selection when the panel is open.

Updates occur only on map move/zoom, viewport resize, filter/search reconciliation, event
rotation, selection, or snapshot replacement. Layout reads are batched with animation-frame
coalescing. No permanent frame loop is permitted.

## Event panel

Exactly one panel instance displays the selected landmark and event. Fields: event title,
date/date range, time, venue, description, planning action, optional official-link action,
and multiple-event navigation. Missing optional values are empty or “Not available.” The
official-link action does not exist without a validated URL. Previous/next use icon controls
with accessible names and a current-position indicator. Closing restores map interaction and
clears selection consistently.

## Search and category filters

Search matches normalized event title, venue, and represented date. Category controls apply
to event results relevant to the current dataset and compose with search. The result model,
pills, direction indicator, and selected panel reconcile from one filtered identity set.
When the selected identity is filtered out, the panel closes and map selection clears.

## Restaurant explorer

The toolbar control is the only loading surface: while a request is active its icon becomes a
spinner and its accessible label communicates loading. No separate temporary loading popup
opens. Results are limited to the relevant viewport, use visually distinct markers, and show
one selected state. The singleton detail panel uses shared shell/tokens and provides a close
icon. Closing restaurant mode removes all restaurant markers and panels without changing
event filters, selection, highlights, or plan contents.

Restaurant/deal stale results show “potentially outdated” and last-checked context. Expired
deal evidence is not shown as current. Missing optional fields are not fabricated.

## Plan builder

Maintains one in-memory ordered stop list during public editing. Receives additions through a
stable shared event contract, deduplicates by stop identity, supports remove/reorder, and
renders count, route estimates, warnings, challenge themes, optional timer, and readiness.
Google Maps handoff preserves order. Server persistence occurs only during challenge launch.

## Direction and guidance controls

Direction updates are event-driven and animation-frame coalesced. Guidance controls reflect
current map/view state and do not introduce permanent polling. Indicators do not cover active
search, map navigation, or close controls at supported mobile widths.

## Private admin shell

Admin UI is a separate private route/shell, not an overlay exposed in the public map toolbar.
Unauthenticated state contains only login and generic errors. Authenticated state contains
venue and photo review queues, decision detail, safe operational revocation, logout, loading,
empty, stale-conflict, and error states. It never embeds the admin password, session token,
operator secret, raw Telegram payload, or filesystem path in DOM/data attributes.

Venue review displays official evidence, geographic candidates, competing candidates, and
uncertainty reasons before enabling a decision. Approval requires an explicit selected
candidate and reason. A 409 stale-evidence response refreshes the case without applying the
old decision.

## Public snapshot state

The application loads one approved snapshot identity. A `potentially_outdated` snapshot
shows a restrained global freshness indication without blocking map use. A missing active
snapshot shows a production error state; it never assembles a public view from staging files.

## Performance contract

- Map layer and feature setup is progressive; restaurants remain user-triggered.
- Highlight geometry uses the combined POI layer and validated background separation.
- During map motion, rendering may use temporary lower resolution or paused tile selection;
  full configured quality returns after the settled delay.
- Hidden/closed components perform no continuous work.
- Rendering-sensitive changes record cold and warm desktop/mobile benchmark results.

## Browser release evidence

Automated engine projects provide the required repeatable desktop/mobile Chromium, WebKit,
and Firefox coverage. Current branded Chrome, Safari, Firefox, and Edge installations, iOS
Simulator, or Android Emulator MAY provide supporting evidence when freely available. An
unexercised optional combination is documented without blocking release.
