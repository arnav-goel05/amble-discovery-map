import { createLandmarkEventPanel } from "./landmark-event-panel";
import { createLandmarkEventPillLayer } from "./landmark-event-pill";
import { createLandmarkEventSearch } from "./landmark-event-search";
import { APPROVED_LANDMARKS } from "../data/approved-landmarks.js";
import { focusMapLocation } from "./map-location-focus.js";
import { createEventDiscoveryModel } from "./events/event-discovery-model.js";
import { eventCategory } from "./landmark-event-pill.js";

const NAVBAR_CATEGORIES = ["Exhibitions", "Performances", "Workshops & Classes", "Tours & Experiences"];

const toLandmarkScene = (landmarks) => landmarks.map((landmark) => ({
  id: landmark.id,
  label: landmark.label,
  anchor: landmark.anchor,
  events: landmark.events.map((event, index) => ({
    ...event,
    id: event.id || `${landmark.id}-approved-${index + 1}`,
    venueVerified: true,
  })),
}));

export function addEsplanadePerformanceScene(map, {
  landmarks: approvedLandmarks = APPROVED_LANDMARKS,
  onLandmarkSelected,
} = {}) {
  if (document.getElementById("esplanade-event-pill")) return [];

  const eventPanel = createLandmarkEventPanel({ onClose: () => onLandmarkSelected?.(null) });
  let landmarks = toLandmarkScene(approvedLandmarks);
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
    landmarks: landmarks.map((landmark) => ({ landmark, sourceEvents: landmark.events })),
  });
  let discoveryModel = createEventDiscoveryModel(landmarks, { categoryOf: eventCategory });
  const availableCategories = new Set(discoveryModel.categories());
  const eventSearch = createLandmarkEventSearch({
    categories: NAVBAR_CATEGORIES.filter((category) => availableCategories.has(category)),
    discoveryModel,
    onFilterResult: (result) => pillLayer.applyDiscoveryResult(result),
    onResultSelect: (result) => {
      const landmark = landmarks.find((item) => item.id === result.landmarkId);
      if (!landmark || !pillLayer.selectResult(result, { notify: false })) return;
      onLandmarkSelected?.(landmark.id);
      eventPanel.close({ restoreFocus: false });
      pillLayer.setNavigationTarget(landmark.id);
      focusMapLocation(map, landmark.anchor);
    },
  });
  const refreshEventSearch = () => eventSearch.refresh?.();
  map.on?.("moveend", refreshEventSearch);

  document.body.dataset.esplanadeActivityScene = "event-pill";
  document.body.dataset.landmarkEventPills = "mounted";
  document.body.dataset.landmarkEventPillCount = String(landmarks.length);

  return [
    {
      id: "landmark-event-pills",
      reconcile: ({ landmarks: nextApprovedLandmarks }) => {
        const nextLandmarks = toLandmarkScene(nextApprovedLandmarks || []);
        const previousHash = JSON.stringify(landmarks);
        const nextHash = JSON.stringify(nextLandmarks);
        if (previousHash === nextHash) return { changed: false };
        landmarks = nextLandmarks;
        pillLayer.reconcile({ runStatus: "success", landmarks: landmarks.map((landmark) => ({ landmark, sourceEvents: landmark.events })) });
        discoveryModel = createEventDiscoveryModel(landmarks, { categoryOf: eventCategory });
        eventSearch.setDiscoveryModel?.(discoveryModel);
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
