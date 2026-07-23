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
    onDiscoveryCandidatesChanged,
    onLandmarkSelected,
    sourceSnapshotId: initialSourceSnapshotId,
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
    });
  let discoveryModel = createDiscoveryModel();
  const densityMinimap = createEventDensityMinimap({
    discoveryAreaAsset,
    discoveryModel,
    map,
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
  const refreshEventSearch = () => eventSearch.refresh?.();
  map.on?.("moveend", refreshEventSearch);

  document.body.dataset.esplanadeActivityScene = "event-pill";
  document.body.dataset.landmarkEventPills = "mounted";
  document.body.dataset.landmarkEventPillCount = String(landmarks.length);

  return [
    {
      id: "landmark-event-pills",
      getApprovedCandidates: () => discoveryModel.approvedCandidates(),
      selectCandidate: (candidateId) => {
        const selection = discoveryModel.selectionForCandidate(candidateId);
        return selection ? selectEventResult(selection) : false;
      },
      search: (query) => {
        eventSearch.input.value = String(query ?? "");
        eventSearch.input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      dispatch: (actionId, args = {}) => {
        if (
          [
            "event.search",
            "event.setcategory",
            "event.setdaterange",
            "event.setpricerange",
            "event.clearfilters",
          ].includes(actionId)
        )
          return eventSearch.dispatch(actionId, args);
        if (
          actionId === "event.selectresult" ||
          actionId === "event.opendetail"
        )
          return Boolean(
            discoveryModel.selectionForCandidate(args.eventId) &&
            selectEventResult(
              discoveryModel.selectionForCandidate(args.eventId),
            ),
          );
        if (actionId === "event.previousevent")
          return eventPanel.previous() !== false;
        if (actionId === "event.nextevent") return eventPanel.next() !== false;
        if (actionId === "event.closedetail") {
          eventPanel.close();
          return true;
        }
        if (actionId === "event.addtoplan") {
          const selection = discoveryModel.selectionForCandidate(args.eventId);
          if (!selection || !selectEventResult(selection)) return false;
          eventPanel.addToPlan();
          return true;
        }
        if (
          actionId === "event.openreference" ||
          actionId === "event.opendirections"
        ) {
          if (args.eventId) {
            const selection = discoveryModel.selectionForCandidate(
              args.eventId,
            );
            if (!selection || !selectEventResult(selection)) return false;
          }
          if (actionId === "event.openreference") eventPanel.openReference();
          else eventPanel.openDirections();
          return true;
        }
        return false;
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
        map.off?.("moveend", refreshEventSearch);
        pillLayer.destroy();
        eventPanel.destroy();
        eventSearch.destroy();
        densityMinimap.destroy();
      },
    },
  ];
}
