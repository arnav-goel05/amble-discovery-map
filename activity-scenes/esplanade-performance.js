import { createLandmarkEventPanel } from "./landmark-event-panel";
import { createLandmarkEventPillLayer } from "./landmark-event-pill";
import { createLandmarkEventSearch } from "./landmark-event-search";
import { APPROVED_LANDMARKS } from "../data/approved-landmarks.js";
import { focusMapLocation } from "./map-location-focus.js";
import { createEventDiscoveryModel } from "./events/event-discovery-model.js";
import { eventCategory } from "./landmark-event-pill.js";

const NAVBAR_CATEGORIES = [
  "Exhibitions",
  "Performances",
  "Workshops & Classes",
  "Tours & Experiences",
];

const toLandmarkScene = (landmarks) =>
  landmarks.map((landmark) => ({
    id: landmark.id,
    label: landmark.label,
    anchor: landmark.anchor,
    areaId: landmark.areaId,
    subzoneId: landmark.subzoneId,
    events: landmark.events.map((event, index) => ({
      ...event,
      id: event.id || `${landmark.id}-approved-${index + 1}`,
      venueVerified: true,
    })),
  }));

export function addEsplanadePerformanceScene(
  map,
  {
    areaIdOf,
    landmarks: approvedLandmarks = APPROVED_LANDMARKS,
    offMapEvents: approvedOffMapEvents = [],
    onDiscoveryCandidatesChanged,
    onLandmarkSelected,
    sourceSnapshotId: initialSourceSnapshotId,
  } = {},
) {
  if (document.getElementById("esplanade-event-pill")) return [];

  const eventPanel = createLandmarkEventPanel({
    onClose: () => onLandmarkSelected?.(null),
  });
  let landmarks = toLandmarkScene(approvedLandmarks);
  let offMapEvents = approvedOffMapEvents;
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
        selectedEventIndex: 0,
        trigger,
      });
      onLandmarkSelected?.(null);
      return true;
    }
    if (!pillLayer.selectResult(result, { notify: false })) return false;
    onLandmarkSelected?.(landmark.id);
    eventPanel.close({ restoreFocus: false });
    pillLayer.setNavigationTarget(landmark.id);
    focusMapLocation(map, landmark.anchor);
    return true;
  };
  const eventSearch = createLandmarkEventSearch({
    categories: NAVBAR_CATEGORIES.filter((category) =>
      availableCategories.has(category),
    ),
    discoveryModel,
    onFilterResult: (result) => pillLayer.applyDiscoveryResult(result),
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
        offMapEvents: nextOffMapEvents,
        sourceSnapshotId: nextSourceSnapshotId,
      }) => {
        const nextLandmarks = toLandmarkScene(nextApprovedLandmarks || []);
        const previousHash = JSON.stringify(landmarks);
        const nextHash = JSON.stringify(nextLandmarks);
        const nextOffMap = nextOffMapEvents ?? [];
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
      },
    },
  ];
}
