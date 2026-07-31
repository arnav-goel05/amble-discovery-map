# Public Capability Inventory

**Feature**: 004 Conversational Voice Map

**Inventory version**: 2.2

**Reviewed**: 2026-07-26

**Scope**: anonymous, user-facing first-release web experience

This is the release baseline for the typed capability registry. The command rows below retain their
stable action IDs during migration. Every row marked `existing` or
`004` is in the SC-004 coverage denominator and must have the same observable result from its
direct control and from the assistant capability gateway. `004` identifies a direct control that this
feature adds or restores before release; it is not permission to ship a voice-only capability.

Admin controls, pipeline tooling, browser-native history, raw map pointer gestures, and Telegram
commands that have no in-app control are not public application actions. Starting microphone
capture and accepting or rejecting a confirmation remain explicit consent controls owned by the
voice-session and confirmation controllers; they cannot be initiated by a model-proposed action.

## Contract rules

- Every entry is a `query` or `command` in
  [capability-connector-architecture.md](capability-connector-architecture.md) and validates against
  [capability-contract.schema.json](capability-contract.schema.json).
- IDs and arguments are semantic and stable. Arguments contain IDs, enums, bounded numbers, or
  text filters; they never contain a selector, function name, or caller-supplied URL.
- `visible` context comes from the revisioned interface-context provider. A target ID must be
  visible, selected, focused, or explicitly present in the current approved result set.
- `reversible` actions execute immediately and show the stated result. `consequential` actions have
  no effect until a later, matching explicit confirmation. External navigation, destructive
  changes, precise-location use or sharing, game progress loss, and deletion are consequential.
- External destinations are resolved by application code from an approved target and link kind.
  `navigation.openexternal` is therefore bounded routing, not a generic URL-opening tool.
- Each registry entry uses capability contract version `2.0`, a closed argument schema, the
  eligible states below, its named connector/context provider, and an observable result schema
  derived from the **Result** column. Legacy action-contract version `1.0` is generated one-way
  from compatible command entries and is never a second runtime registry.

### 2.2 implementation corrections

- `plan.uselocation` and `plan.focuslocation` retain their public IDs but are owned by the dedicated
  `location` connector; exact coordinates remain browser-local and only permission, freshness, and
  coarse-area state enter assistant context.
- `map.setlayervisibility` delegates location, MRT-station, and MRT-line visibility in both
  directions to their authoritative owners. MRT visibility is presentation state and never enables
  a ranking constraint; only an explicit user transit request can do that. The canonical context
  retains four bounded booleans for recommendation, location, MRT-station, and MRT-line visibility
  so every observable layer change advances the revision independently.
- `event.setfilter`, `event.removefilter`, `event.selectoccurrence`, and
  `event.setsessionsexpanded` are the canonical progressive-filter/detail controls. Their older
  single-facet command IDs remain generated compatibility aliases during migration.
- `conditional-content` stays unregistered while saved/game data and matching public controls are
  absent. Empty conditional rows are not advertised as tools.
- `session.stop`, `session.mute`, `session.unmute`, and `session.interrupt` are handled by the
  deterministic browser-local lifecycle router and remain outside the model-invokable capability
  registry with consent and confirmation controls.

## Foundational queries

| Capability ID    | Kind  | Arguments                            | Eligible state / context                        | Result                                                                                                                     |
| ---------------- | ----- | ------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `app.inspect`    | query | `{}`                                 | application initialized / `applicationContext`  | Bounded revisioned application snapshot and eligible capability IDs                                                        |
| `catalog.search` | query | `{ query, types?, limit?, cursor? }` | approved catalogue available / `catalogContext` | Schema-valid approved result page, total, truncation state, composite catalogue revision/provenance, and stable target IDs |
| `catalog.get`    | query | `{ targetIds }`                      | all requested IDs registered / `catalogContext` | Allowlisted details for at most ten stable target IDs                                                                      |

## Map and discovery areas

| Action ID                | Release  | Arguments               | Eligible state / context                           | Class      | Result                                                                                               | Direct-control owner                       |
| ------------------------ | -------- | ----------------------- | -------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `map.zoomin`             | existing | `{}`                    | map ready / `mapContext`                           | reversible | Map zoom increases one step.                                                                         | `activity-scenes/map-guidance-controls.js` |
| `map.zoomout`            | existing | `{}`                    | map ready / `mapContext`                           | reversible | Map zoom decreases one step.                                                                         | `activity-scenes/map-guidance-controls.js` |
| `map.pan`                | existing | `{ direction, amount }` | map ready / `mapContext`                           | reversible | Map center moves by the bounded directional amount.                                                  | map controller gesture/keyboard command    |
| `map.rotate`             | existing | `{ bearing? }`          | map ready / `mapContext`                           | reversible | Bearing changes, or resets north when omitted.                                                       | `activity-scenes/map-guidance-controls.js` |
| `map.focustarget`        | existing | `{ targetId }`          | target in visible context / `selectionContext`     | reversible | Target is focused and visibly selected.                                                              | `activity-scenes/map-location-focus.js`    |
| `map.resetview`          | 004      | `{}`                    | map ready / `mapContext`                           | reversible | Initial Singapore camera is restored.                                                                | map initial-state control                  |
| `map.openarea`           | 004      | `{ areaId }`            | recommended area visible / `discoveryContext`      | reversible | Area becomes focused and its reason/candidates open.                                                 | assistant area card/select control         |
| `map.selectarea`         | 004      | `{ areaId }`            | recommended area visible / `discoveryContext`      | reversible | Area is selected and emphasized on the map.                                                          | assistant area card/select control         |
| `map.compareareas`       | 004      | `{ areaIds }`           | 2–3 recommended areas visible / `discoveryContext` | reversible | Selected areas enter the visible comparison state.                                                   | area comparison control                    |
| `map.dismissarea`        | 004      | `{ areaId }`            | recommended area visible / `discoveryContext`      | reversible | Area leaves the active recommendation set and ranking refreshes.                                     | area dismiss control                       |
| `map.setlayervisibility` | 004      | `{ layer, visible }`    | layer available / `mapContext`                     | reversible | The approved layer (`recommendations`, `location`, `mrtStations`, or `mrtLines`) changes visibility. | map layer controls                         |

## Feature tour

| Action ID       | Release  | Arguments | Eligible state / context                       | Class      | Result                                                                   | Direct-control owner                                                          |
| --------------- | -------- | --------- | ---------------------------------------------- | ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `tour.start`    | existing | `{}`      | application ready / `applicationContext`       | reversible | Feature tour opens at step one.                                          | `activity-scenes/map-guidance-controls.js`, `activity-scenes/feature-tour.js` |
| `tour.previous` | existing | `{}`      | tour open after step one / `overlayContext`    | reversible | Previous tour step is visible.                                           | `activity-scenes/feature-tour.js`                                             |
| `tour.next`     | existing | `{}`      | tour open before final step / `overlayContext` | reversible | Next tour step is visible.                                               | `activity-scenes/feature-tour.js`                                             |
| `tour.finish`   | existing | `{}`      | tour open / `overlayContext`                   | reversible | Tour closes and completion is remembered, matching Skip/Start exploring. | `activity-scenes/feature-tour.js`                                             |

## Events

| Action ID                   | Release       | Arguments                                              | Eligible state / context                                               | Class         | Result                                                                                                                                                                           | Direct-control owner                       |
| --------------------------- | ------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `event.search`              | existing      | `{ query }`                                            | event search available / `eventContext`                                | reversible    | Result list and count reflect the query.                                                                                                                                         | `activity-scenes/landmark-event-search.js` |
| `event.applyquery`          | 004 amendment | `{ text, mode, baseContextRevision, catalogRevision }` | event composer and current option catalogue available / `eventContext` | reversible    | The complete sentence is applied or clarified atomically; result includes canonical sentence, ordered phrases, residual query, result count, and one resulting context revision. | event sentence-composer controller         |
| `event.setfilter`           | existing      | `{ facet, values }`                                    | filter options registered / `eventContext`                             | reversible    | The complete ordered values for `what`, `when`, `where`, or `price` are applied without collapsing unrelated facets.                                                             | `activity-scenes/landmark-event-search.js` |
| `event.removefilter`        | existing      | `{ filterId }`                                         | filter token active / `eventContext`                                   | reversible    | The named active token is removed and results refresh.                                                                                                                           | `activity-scenes/landmark-event-search.js` |
| `event.setcategory`         | existing      | `{ categoryId? }`                                      | event search available / `eventContext`                                | reversible    | The single category filter, or all categories, is visible and applied.                                                                                                           | `activity-scenes/landmark-event-search.js` |
| `event.setdaterange`        | existing      | `{ startDate?, endDate? }`                             | event search available / `eventContext`                                | reversible    | Date label and results reflect the valid range; empty values clear it.                                                                                                           | `activity-scenes/landmark-event-search.js` |
| `event.setpricerange`       | 004           | `{ priceBand? }`                                       | event search available / `eventContext`                                | reversible    | Price filter and result set visibly update.                                                                                                                                      | event price-filter control                 |
| `event.clearfilters`        | existing      | `{}`                                                   | an event query/filter is active / `eventContext`                       | reversible    | Query, category, date, and price return to defaults.                                                                                                                             | event search/filter controls               |
| `event.selectresult`        | existing      | `{ eventId }`                                          | event in visible results / `eventContext`                              | reversible    | Event venue is focused and its event pill becomes current.                                                                                                                       | `activity-scenes/landmark-event-search.js` |
| `event.opendetail`          | existing      | `{ eventId }`                                          | event pill/result visible / `eventContext`                             | reversible    | Detail overlay opens on that event.                                                                                                                                              | `activity-scenes/landmark-event-pill.js`   |
| `event.selectoccurrence`    | existing      | `{ eventId, occurrenceId }`                            | occurrence visible in event detail / `eventContext`                    | reversible    | The selected occurrence becomes the current date/session and reference context.                                                                                                  | `activity-scenes/landmark-event-panel.js`  |
| `event.setsessionsexpanded` | existing      | `{ eventId, expanded }`                                | multi-session event detail open / `overlayContext`                     | reversible    | The session list is expanded or collapsed to the requested state.                                                                                                                | `activity-scenes/landmark-event-panel.js`  |
| `event.previousevent`       | existing      | `{}`                                                   | event detail open with previous item / `overlayContext`                | reversible    | Previous event detail is shown.                                                                                                                                                  | `activity-scenes/landmark-event-panel.js`  |
| `event.nextevent`           | existing      | `{}`                                                   | event detail open with next item / `overlayContext`                    | reversible    | Next event detail is shown.                                                                                                                                                      | `activity-scenes/landmark-event-panel.js`  |
| `event.closedetail`         | existing      | `{}`                                                   | event detail open / `overlayContext`                                   | reversible    | Detail closes and focus returns to its trigger when available.                                                                                                                   | `activity-scenes/landmark-event-panel.js`  |
| `event.addtoplan`           | existing      | `{ eventId }`                                          | event visible and plan below limit / `eventContext`                    | reversible    | Event stop is present once and plan opens with status feedback.                                                                                                                  | `activity-scenes/landmark-event-panel.js`  |
| `event.openreference`       | existing      | `{ eventId, referenceId? }`                            | approved reference visible / `eventContext`                            | consequential | Confirmed reference opens in a new tab.                                                                                                                                          | `activity-scenes/landmark-event-panel.js`  |
| `event.opendirections`      | existing      | `{ eventId }`                                          | routable event visible / `eventContext`                                | consequential | Confirmed venue directions open externally.                                                                                                                                      | `activity-scenes/landmark-event-panel.js`  |

`event.applyquery` is the version-2 atomic sentence-level contract shared by the direct composer and
connected assistant. Its interpreter is side-effect-free; ambiguity, stale revisions, or an invalid
compound part change nothing. `event.setfilter` and `event.removefilter` remain the version-2
semantic contracts for individual phrase edits. The existing
single-facet `event.setcategory`, `event.setdaterange`, and `event.setpricerange` commands remain
one-way compatibility aliases during migration and are not independently advertised when the
version-2 filter commands are available.

## Restaurants

| Action ID                      | Release  | Arguments                  | Eligible state / context                                      | Class         | Result                                                            | Direct-control owner                                                                      |
| ------------------------------ | -------- | -------------------------- | ------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `restaurant.search`            | existing | `{ query }`                | restaurant explorer available / `restaurantContext`           | reversible    | Visible restaurant results reflect the text query.                | `activity-scenes/restaurant-explorer.js`                                                  |
| `restaurant.searchviewport`    | existing | `{}`                       | map ready / `mapContext`                                      | reversible    | Results are refreshed for the visible map bounds and panel opens. | `activity-scenes/restaurant-explorer.js`                                                  |
| `restaurant.setcategory`       | existing | `{ categoryId? }`          | restaurant results open / `restaurantContext`                 | reversible    | Category filter and dependent cuisine options update.             | `activity-scenes/restaurant-explorer.js`                                                  |
| `restaurant.setcuisine`        | existing | `{ cuisineId? }`           | cuisine option available / `restaurantContext`                | reversible    | Cuisine filter and results visibly update.                        | `activity-scenes/restaurant-explorer.js`                                                  |
| `restaurant.clearfilters`      | existing | `{}`                       | a restaurant query/filter is active / `restaurantContext`     | reversible    | Query, category, and cuisine return to defaults.                  | `activity-scenes/restaurant-explorer.js`                                                  |
| `restaurant.selectcluster`     | existing | `{ clusterId }`            | cluster visible / `restaurantContext`                         | reversible    | Map zooms to expand the selected cluster.                         | `activity-scenes/restaurants/restaurant-map.js`                                           |
| `restaurant.selectresult`      | existing | `{ restaurantId }`         | restaurant visible / `restaurantContext`                      | reversible    | Restaurant is focused, selected, and its detail opens.            | `activity-scenes/restaurant-explorer.js`, `activity-scenes/restaurants/restaurant-map.js` |
| `restaurant.closeresults`      | existing | `{}`                       | restaurant results open / `overlayContext`                    | reversible    | Results panel closes.                                             | `activity-scenes/restaurant-explorer.js`                                                  |
| `restaurant.closedetail`       | existing | `{}`                       | restaurant detail open / `overlayContext`                     | reversible    | Detail closes and focus returns when available.                   | `activity-scenes/restaurants/restaurant-detail.js`                                        |
| `restaurant.addtoplan`         | existing | `{ restaurantId }`         | restaurant visible and plan below limit / `restaurantContext` | reversible    | Restaurant stop is present once and plan opens with feedback.     | `activity-scenes/restaurants/restaurant-detail.js`                                        |
| `restaurant.openreference`     | existing | `{ restaurantId }`         | approved website/map listing visible / `restaurantContext`    | consequential | Confirmed restaurant reference opens externally.                  | `activity-scenes/restaurants/restaurant-detail.js`                                        |
| `restaurant.opendealreference` | existing | `{ restaurantId, dealId }` | approved deal visible / `restaurantContext`                   | consequential | Confirmed official deal source opens externally.                  | `activity-scenes/restaurants/restaurant-detail.js`                                        |
| `restaurant.opendirections`    | existing | `{ restaurantId }`         | routable restaurant visible / `restaurantContext`             | consequential | Confirmed restaurant directions open externally.                  | `activity-scenes/restaurants/restaurant-detail.js`                                        |

## Plan

| Action ID            | Release  | Arguments             | Eligible state / context                                                 | Class         | Result                                                                                        | Direct-control owner                    |
| -------------------- | -------- | --------------------- | ------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| `plan.open`          | existing | `{}`                  | application ready / `planContext`                                        | reversible    | Plan panel opens with current stops and route preview.                                        | `activity-scenes/plan-builder.js`       |
| `plan.close`         | existing | `{}`                  | plan open / `overlayContext`                                             | reversible    | Plan panel closes.                                                                            | `activity-scenes/plan-builder.js`       |
| `plan.uselocation`   | existing | `{}`                  | location API available / `locationContext`                               | consequential | After confirmation and browser permission, precise current location is used for this session. | `activity-scenes/plan-builder.js`       |
| `plan.focuslocation` | existing | `{}`                  | current location available / `locationContext`                           | reversible    | Map visibly focuses the current-location marker.                                              | `activity-scenes/plan-builder.js`       |
| `plan.settravelmode` | existing | `{ mode }`            | plan open / `planContext`                                                | reversible    | Route preview and links use walking, driving, bicycling, or transit.                          | `activity-scenes/plan-builder.js`       |
| `plan.addstop`       | existing | `{ targetId }`        | eligible event/restaurant visible, plan below limit / `selectionContext` | reversible    | Target is added once and stop count/route update.                                             | event and restaurant detail controls    |
| `plan.removestop`    | existing | `{ stopId }`          | stop visible in plan / `planContext`                                     | consequential | Confirmed stop is removed and route updates.                                                  | `activity-scenes/plan-builder.js`       |
| `plan.reorderstop`   | existing | `{ stopId, toIndex }` | stop visible in multi-stop plan / `planContext`                          | reversible    | Stop order, status text, and route update.                                                    | `activity-scenes/plan-builder.js`       |
| `plan.focusstop`     | existing | `{ stopId }`          | stop visible in plan / `planContext`                                     | reversible    | Map focuses the stop.                                                                         | `activity-scenes/plan-builder.js`       |
| `plan.openroute`     | existing | `{ segmentIndex? }`   | at least one routable stop / `planContext`                               | consequential | Confirmed Google Maps route segment opens externally.                                         | `activity-scenes/planning/plan-view.js` |

## Saved content and games

These families are conditional. They are included in the registry only when real saved/game data
and matching direct controls are registered. Empty global fixture arrays or synthetic empty panels
do not make them eligible. Telegram lifecycle and admin game endpoints are not direct-interface
equivalents.

| Action ID          | Release | Arguments                | Eligible state / context                | Class         | Result                                                      | Direct-control owner   |
| ------------------ | ------- | ------------------------ | --------------------------------------- | ------------- | ----------------------------------------------------------- | ---------------------- |
| `saved.open`       | 004     | `{}`                     | application ready / `savedContext`      | reversible    | Saved-content overlay opens.                                | saved-content controls |
| `saved.openitem`   | 004     | `{ itemId }`             | saved item visible / `savedContext`     | reversible    | Saved item becomes current and its detail opens.            | saved-content controls |
| `saved.deleteitem` | 004     | `{ itemId }`             | saved item visible / `savedContext`     | consequential | Confirmed item is removed from saved content.               | saved-content controls |
| `game.open`        | 004     | `{ gameId? }`            | game available / `gameContext`          | reversible    | Game panel opens on the current or named game.              | in-app game controls   |
| `game.start`       | 004     | `{ planId }`             | non-empty eligible plan / `planContext` | consequential | Confirmed game is created and its in-app start state opens. | in-app game controls   |
| `game.pause`       | 004     | `{ gameId }`             | active game running / `gameContext`     | reversible    | Game enters paused state.                                   | in-app game controls   |
| `game.resume`      | 004     | `{ gameId }`             | active game paused / `gameContext`      | reversible    | Game resumes at its saved mission.                          | in-app game controls   |
| `game.status`      | 004     | `{ gameId }`             | game visible / `gameContext`            | reversible    | Current mission/progress is shown.                          | in-app game controls   |
| `game.skip`        | 004     | `{ gameId, missionId }`  | active mission visible / `gameContext`  | consequential | Confirmed mission is skipped and progress advances.         | in-app game controls   |
| `game.quit`        | 004     | `{ gameId }`             | active game incomplete / `gameContext`  | consequential | Confirmed game is ended and cannot resume.                  | in-app game controls   |
| `game.openroute`   | 004     | `{ gameId, missionId? }` | game route available / `gameContext`    | consequential | Confirmed mission or recap route opens externally.          | in-app game controls   |

## Application navigation, overlays, and external routing

| Action ID                             | Release  | Arguments                | Eligible state / context                                  | Class         | Result                                                        | Direct-control owner                          |
| ------------------------------------- | -------- | ------------------------ | --------------------------------------------------------- | ------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `navigation.enterexperience`          | existing | `{}`                     | intro visible / `applicationContext`                      | reversible    | Intro leaves and the interactive map receives focus.          | application intro control                     |
| `navigation.openassistant`            | existing | `{}`                     | application ready / `applicationContext`                  | reversible    | Assistant panel opens and text input is focused.              | `activity-scenes/assistant/assistant-view.js` |
| `navigation.closeassistant`           | 004      | `{}`                     | assistant open / `overlayContext`                         | reversible    | Assistant panel closes without ending direct app access.      | assistant close control                       |
| `navigation.closeoverlay`             | existing | `{ overlayId? }`         | closable overlay active / `overlayContext`                | reversible    | Named or active overlay closes with normal focus restoration. | overlay close/back/Escape controls            |
| `navigation.openattribution`          | existing | `{}`                     | map guidance available / `applicationContext`             | reversible    | Map attribution opens with its approved references.           | `activity-scenes/map-guidance-controls.js`    |
| `navigation.closeattribution`         | existing | `{}`                     | attribution open / `overlayContext`                       | reversible    | Attribution closes with normal focus restoration.             | `activity-scenes/map-guidance-controls.js`    |
| `navigation.openattributionreference` | existing | `{ referenceId }`        | approved attribution reference visible / `overlayContext` | consequential | Confirmed approved attribution source opens externally.       | `activity-scenes/map-guidance-controls.js`    |
| `navigation.openexternal`             | 004      | `{ targetId, linkKind }` | allowlisted link on visible target / `selectionContext`   | consequential | Confirmed approved destination opens in a new tab.            | shared external-navigation command            |

Domain-specific external actions resolve an approved `targetId` plus link kind and delegate to
`navigation.openexternal`; they never accept a URL. This covers event references and directions,
restaurant references/deals/directions, plan routes, and game routes while preserving precise
domain eligibility and confirmation copy.

## Protected assistant lifecycle controls

Disclosure accept/cancel, push-to-talk press/release, and confirmation accept/reject are explicit
user-consent controls and are never model-invokable capabilities. Stop, mute, unmute, and interrupt
MAY be recognized by a deterministic browser-local `session.*` intent router so they do not depend
on the model completing another turn. These controls are owned by the assistant lifecycle and
browser-audio services, not by an additional application connector.

## Review and completeness gate

The review inspected the public control owners named above plus
`activity-scenes/restaurants/restaurant-map.js`, `activity-scenes/planning/plan-view.js`, and the
voice lifecycle fixture in `tests/fixtures/voice/action-lifecycle.json`. It deliberately excludes
admin APIs and Telegram-only commands.

Release verification must fail when any of the following is true:

1. A public direct control has no row, registry entry, and direct/voice observable-state parity test.
2. A row has no direct control, including any remaining `004` saved-content or game gap.
3. A registry entry is absent from this inventory or changes ID, arguments, eligibility, result,
   or confirmation class without an inventory-version review.
4. A consequential row can cause an external, destructive, privacy-sensitive, or progress-changing
   effect before confirmation, or a reversible row asks for unnecessary confirmation.
5. A target is accepted from stale or ambiguous context instead of using a stable visible ID or
   requesting clarification.
6. A query returns unbounded data, an unknown identity, raw source payload, unapproved URL, or exact
   user location.
7. A state-changing command completes without a validated observable outcome and refreshed context
   revision.
8. A capability is advertised in one environment but absent or semantically different for the same
   fixture and state in another environment.
