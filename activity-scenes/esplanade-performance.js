import { createLandmarkEventPanel } from "./landmark-event-panel";
import { createLandmarkEventPillLayer } from "./landmark-event-pill";
import { createLandmarkEventSearch } from "./landmark-event-search";
import { APPROVED_LANDMARKS } from "../data/approved-landmarks.js";
import { focusMapLocation } from "./map-location-focus.js";
import { createEventDiscoveryModel } from "./events/event-discovery-model.js";
import { eventCategory } from "./landmark-event-pill.js";
import { createEventDensityMinimap } from "./event-density-minimap.js";

const NAVBAR_CATEGORIES = [
  "Exhibitions",
  "Performances",
  "Workshops & Classes",
  "Tours & Experiences",
];

const activityEvent = (activity, venueGroup, landmark) => ({
  ...activity,
  id: activity.activityId,
  activityId: activity.activityId,
  venue: venueGroup?.label ?? landmark?.label ?? "Location TBA",
  address: venueGroup?.address ?? null,
  coordinates: venueGroup?.coordinates ?? landmark?.anchor ?? null,
  approvedLocationId: venueGroup?.approvedLocationId ?? null,
  publicPlacement: venueGroup?.publicPlacement ?? "off_map",
  mappingStatus: venueGroup?.mappingStatus ?? "not_required",
  offMapSubtype: venueGroup?.offMapSubtype ?? null,
  projectedVenueGroupId: venueGroup?.venueGroupId ?? null,
  projectedSessionIds: [...(venueGroup?.sessionIds ?? [])],
  schedule: activity.sessions?.[0]?.schedule ?? null,
  dateText:
    activity.scheduleSummary?.label ??
    activity.sessions?.[0]?.schedule?.displayText ??
    null,
  venueOccurrences: (activity.venueGroups ?? []).map((group) => ({
    venueOccurrenceId: group.venueGroupId,
    approvedLocationId: group.approvedLocationId,
    publishedVenueName: group.label,
    offMapSubtype: group.offMapSubtype ?? null,
  })),
});

const toLandmarkScene = (landmarks, activities) => {
  const byId = new Map(
    (activities ?? []).map((activity) => [activity.activityId, activity]),
  );
  return landmarks.map((landmark) => ({
    id: landmark.id,
    label: landmark.label,
    anchor: landmark.anchor,
    areaId: landmark.areaId,
    subzoneId: landmark.subzoneId,
    events: (landmark.activityRefs ?? []).map((reference) => {
      const activity = byId.get(reference.activityId);
      if (!activity)
        throw new Error(
          `landmark_activity_reference_missing:${landmark.id}:${reference.activityId}`,
        );
      const venueGroup = activity.venueGroups.find((group) =>
        reference.venueGroupIds?.includes(group.venueGroupId),
      );
      return {
        ...activityEvent(activity, venueGroup, landmark),
        venueVerified: true,
      };
    }),
  }));
};

export function addEsplanadePerformanceScene(
  map,
  {
    areaIdOf,
    discoveryAreaAsset,
    landmarks: approvedLandmarks = APPROVED_LANDMARKS,
    activities: approvedActivities = [],
    locationController = null,
    onDiscoveryCandidatesChanged,
    onLandmarkSelected,
    sourceSnapshotId: initialSourceSnapshotId,
    diagnosticWorkloads = null,
  } = {},
) {
  if (document.getElementById("esplanade-event-pill")) return [];

  const eventPanel = createLandmarkEventPanel({
    onClose: () => onLandmarkSelected?.(null),
  });
  let activities = approvedActivities;
  let landmarks = toLandmarkScene(approvedLandmarks, activities);
  let offMapEvents = activities
    .filter(
      (activity) =>
        !activity.venueGroups.some(
          (group) => group.publicPlacement === "mapped",
        ),
    )
    .map((activity) =>
      activityEvent(
        activity,
        activity.venueGroups.find(
          (group) => group.publicPlacement === "off_map",
        ),
        null,
      ),
    );
  let pillLayer;
  pillLayer = createLandmarkEventPillLayer({
    map,
    onHidden: () => eventPanel.close({ restoreFocus: false }),
    onEventsChanged: (change) => eventPanel.refresh(change),
    panelId: eventPanel.id,
    onSelect: (selection) => {
      onLandmarkSelected?.(selection.landmark.id);
      pillLayer.setNavigationTarget(null);
      focusMapLocation(map, selection.landmark.anchor);
      eventPanel.open(selection);
    },
  });
  pillLayer.reconcile({
    runStatus: "success",
    landmarks: landmarks.map((landmark) => ({
      landmark,
      sourceEvents: landmark.events,
    })),
  });
  let sourceSnapshotId =
    initialSourceSnapshotId || document.body.dataset.snapshotId || null;
  const createDiscoveryModel = () =>
    createEventDiscoveryModel(landmarks, {
      areaIdOf,
      categoryOf: eventCategory,
      offMapEvents,
      sourceSnapshotId,
      performanceDiagnostics: Boolean(diagnosticWorkloads),
    });
  let discoveryModel = createDiscoveryModel();
  const densityMinimap =
    diagnosticWorkloads?.densityMinimap === false
      ? {
          destroy() {},
          setDiscoveryModel() {},
          setDiscoveryResult() {},
        }
      : createEventDensityMinimap({
          discoveryAreaAsset,
          discoveryModel,
          map,
          trackViewport: diagnosticWorkloads?.minimapViewportTracking !== false,
          performanceDiagnostics: Boolean(diagnosticWorkloads),
          renderMode: diagnosticWorkloads?.minimapRenderMode,
        });
  const availableCategories = new Set(discoveryModel.categories());
  const selectEventResult = (result, trigger = document.activeElement) => {
    const landmark = landmarks.find((item) => item.id === result?.landmarkId);
    if (!landmark) {
      const event = result?.sourceEvent;
      if (!event || !(trigger instanceof HTMLElement)) return false;
      eventPanel.open({
        landmark: {
          id: `off-map-${result.eventId}`,
          label: result.venue || "Location TBA",
          anchor: null,
        },
        sourceEvents: [event],
        activity: result,
        selectedEventIndex: 0,
        trigger,
      });
      onLandmarkSelected?.(null);
      return true;
    }
    if (!pillLayer.selectResult(result, { notify: false })) return false;
    onLandmarkSelected?.(landmark.id);
    eventPanel.open({
      landmark,
      sourceEvents: landmark.events,
      selectedEventIndex: result.eventIndex,
      activity: result,
      trigger,
    });
    pillLayer.setNavigationTarget(landmark.id);
    focusMapLocation(map, landmark.anchor);
    return true;
  };
  const eventSearch = createLandmarkEventSearch({
    categories: NAVBAR_CATEGORIES.filter((category) =>
      availableCategories.has(category),
    ),
    discoveryModel,
    getMapBounds: () => map.getBounds?.() ?? null,
    requestLocation: async () => {
      const current = locationController?.snapshot?.({ includeExact: true });
      if (Array.isArray(current?.coordinates)) return current.coordinates;
      const located = await locationController?.requestLocation?.();
      if (Array.isArray(located?.coordinates)) return located.coordinates;
      throw new Error(
        located?.permission === "denied"
          ? "Location access was not granted."
          : "Location is unavailable on this device.",
      );
    },
    onFilterResult: (result) => {
      densityMinimap.setDiscoveryResult(result);
      return pillLayer.applyDiscoveryResult(result);
    },
    onResultSelect: selectEventResult,
  });
  const publishDiscoveryCandidates = () => {
    const candidates = discoveryModel.approvedCandidates();
    onDiscoveryCandidatesChanged?.(candidates);
    return candidates;
  };
  publishDiscoveryCandidates();
  let moveEndRefreshMode =
    diagnosticWorkloads?.moveEndSearchRefreshMode === "full"
      ? "full"
      : "viewport";
  const refreshEventSearch = () => {
    const startedAt = diagnosticWorkloads ? performance.now() : 0;
    const result =
      moveEndRefreshMode === "full"
        ? eventSearch.refresh?.()
        : eventSearch.refreshViewport?.();
    const duration = diagnosticWorkloads ? performance.now() - startedAt : 0;
    if (diagnosticWorkloads) {
      document.body.dataset.eventSearchMoveEndRefreshDurationMs =
        duration.toFixed(2);
      document.body.dataset.eventSearchMoveEndRefreshMode = moveEndRefreshMode;
      document.body.dataset.eventSearchMoveEndRefreshCount = String(
        Number(document.body.dataset.eventSearchMoveEndRefreshCount ?? 0) + 1,
      );
    }
    return result;
  };
  let refreshOnMoveEnd = diagnosticWorkloads?.moveEndSearchRefresh !== false;
  if (refreshOnMoveEnd) map.on?.("moveend", refreshEventSearch);
  if (diagnosticWorkloads) {
    document.body.dataset.eventSearchMoveEndRefreshEnabled =
      String(refreshOnMoveEnd);
    document.body.dataset.eventSearchMoveEndRefreshMode = moveEndRefreshMode;
  }

  document.body.dataset.esplanadeActivityScene = "event-pill";
  document.body.dataset.landmarkEventPills = "mounted";
  document.body.dataset.landmarkEventPillCount = String(landmarks.length);

  const eventSubscribers = new Set();
  let eventRevision = 0;
  const eventSnapshot = () => {
    const search = eventSearch.snapshot();
    const panel = eventPanel.snapshot();
    const selectedEventId = panel.detailOpen
      ? panel.selectedEventId
      : search.selectedEventId;
    return {
      ...search,
      revision: eventRevision,
      detailOpen: panel.detailOpen,
      events: search.events.map((event) =>
        event.eventId === panel.selectedEventId
          ? {
              ...event,
              occurrenceIds: panel.occurrenceIds,
              sourceOffers: panel.referenceIds.map((referenceId) => ({
                referenceId,
              })),
              routable: panel.routable,
            }
          : event,
      ),
      selectedEventId,
      selectedOccurrenceId: panel.selectedOccurrenceId,
      sessionsExpanded: panel.sessionsExpanded,
      hasPrevious: panel.hasPrevious,
      hasNext: panel.hasNext,
      planCanAdd: true,
    };
  };
  const publishEventSnapshot = () => {
    eventRevision += 1;
    const snapshot = eventSnapshot();
    for (const subscriber of eventSubscribers) subscriber(snapshot);
  };
  const unsubscribeEventSearch = eventSearch.subscribe(publishEventSnapshot);
  const unsubscribeEventPanel = eventPanel.subscribe(publishEventSnapshot);
  const searchActionIds = new Set([
    "event.applyquery",
    "event.search",
    "event.setfilter",
    "event.removefilter",
    "event.setcategory",
    "event.setdaterange",
    "event.setpricerange",
    "event.clearfilters",
    "event.selectresult",
    "event.opendetail",
  ]);
  const panelActionIds = new Set([
    "event.selectoccurrence",
    "event.setsessionsexpanded",
    "event.previousevent",
    "event.nextevent",
    "event.closedetail",
    "event.addtoplan",
    "event.openreference",
    "event.opendirections",
  ]);
  const dispatchEventAction = (actionId, args = {}) => {
    if (searchActionIds.has(actionId))
      return eventSearch.dispatch(actionId, args);
    if (!panelActionIds.has(actionId)) return false;
    if (
      args.eventId &&
      eventPanel.snapshot().selectedEventId !== args.eventId &&
      !eventSearch.dispatch("event.selectresult", {
        eventId: args.eventId,
      })
    )
      return false;
    return eventPanel.dispatch(actionId, args);
  };

  return [
    {
      id: "landmark-event-pills",
      setDiagnosticMinimapViewportTracking: (enabled) =>
        densityMinimap.setViewportTracking?.(enabled) ?? false,
      setDiagnosticMoveEndSearchRefresh: (enabled) => {
        const next = Boolean(enabled);
        if (next === refreshOnMoveEnd) return false;
        if (next) map.on?.("moveend", refreshEventSearch);
        else map.off?.("moveend", refreshEventSearch);
        refreshOnMoveEnd = next;
        document.body.dataset.eventSearchMoveEndRefreshEnabled =
          String(refreshOnMoveEnd);
        return true;
      },
      setDiagnosticMoveEndSearchRefreshMode: (mode) => {
        if (!["full", "viewport"].includes(mode)) return false;
        if (mode === moveEndRefreshMode) return false;
        moveEndRefreshMode = mode;
        document.body.dataset.eventSearchMoveEndRefreshMode =
          moveEndRefreshMode;
        return true;
      },
      getApprovedCandidates: () => discoveryModel.approvedCandidates(),
      selectCandidate: (candidateId) => {
        const selection = discoveryModel.selectionForCandidate(candidateId);
        return selection ? selectEventResult(selection) : false;
      },
      search: (query) => {
        return dispatchEventAction("event.search", { query });
      },
      dispatch: dispatchEventAction,
      snapshot: eventSnapshot,
      subscribe(listener, { emitCurrent = false } = {}) {
        if (typeof listener !== "function")
          throw new TypeError("Event-scene subscriber must be callable");
        eventSubscribers.add(listener);
        if (emitCurrent) listener(eventSnapshot());
        return () => eventSubscribers.delete(listener);
      },
      reconcile: ({
        landmarks: nextApprovedLandmarks,
        activities: nextActivities,
        sourceSnapshotId: nextSourceSnapshotId,
      }) => {
        const canonicalActivities = nextActivities ?? [];
        const nextLandmarks = toLandmarkScene(
          nextApprovedLandmarks || [],
          canonicalActivities,
        );
        const previousHash = JSON.stringify(landmarks);
        const nextHash = JSON.stringify(nextLandmarks);
        const nextOffMap = canonicalActivities
          .filter(
            (activity) =>
              !activity.venueGroups.some(
                (group) => group.publicPlacement === "mapped",
              ),
          )
          .map((activity) =>
            activityEvent(
              activity,
              activity.venueGroups.find(
                (group) => group.publicPlacement === "off_map",
              ),
              null,
            ),
          );
        const offMapChanged =
          JSON.stringify(offMapEvents) !== JSON.stringify(nextOffMap);
        const nextSnapshotId =
          nextSourceSnapshotId ||
          document.body.dataset.snapshotId ||
          sourceSnapshotId;
        if (
          previousHash === nextHash &&
          !offMapChanged &&
          nextSnapshotId === sourceSnapshotId
        )
          return { changed: false };
        landmarks = nextLandmarks;
        activities = canonicalActivities;
        offMapEvents = nextOffMap;
        sourceSnapshotId = nextSnapshotId;
        pillLayer.reconcile({
          runStatus: "success",
          landmarks: landmarks.map((landmark) => ({
            landmark,
            sourceEvents: landmark.events,
          })),
        });
        discoveryModel = createDiscoveryModel();
        densityMinimap.setDiscoveryModel(discoveryModel);
        eventSearch.setDiscoveryModel?.(discoveryModel);
        publishDiscoveryCandidates();
        document.body.dataset.landmarkEventPillCount = String(landmarks.length);
        return { changed: true };
      },
      finalize: () => {
        if (refreshOnMoveEnd) map.off?.("moveend", refreshEventSearch);
        unsubscribeEventSearch();
        unsubscribeEventPanel();
        eventSubscribers.clear();
        pillLayer.destroy();
        eventPanel.destroy();
        eventSearch.destroy();
        densityMinimap.destroy();
      },
    },
  ];
}
