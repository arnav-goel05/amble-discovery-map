"use strict";

function projectPublicEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event;
  const {
    fieldCompleteness: _fieldCompleteness,
    fieldCompletenessByOccurrence: _fieldCompletenessByOccurrence,
    ...publicEvent
  } = event;
  return publicEvent;
}

function projectPublicEventCatalogue(catalogue) {
  if (!catalogue || typeof catalogue !== "object" || Array.isArray(catalogue))
    return catalogue;
  const { mapped: _mapped, offMap, ...publicCatalogue } = catalogue;
  return {
    ...publicCatalogue,
    offMap: Array.isArray(offMap) ? offMap.map(projectPublicEvent) : [],
  };
}

function projectPublicLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return landmarks;
  return landmarks.map((landmark) => {
    if (!landmark || typeof landmark !== "object" || Array.isArray(landmark))
      return landmark;
    return {
      ...landmark,
      events: Array.isArray(landmark.events)
        ? landmark.events.map(projectPublicEvent)
        : landmark.events,
    };
  });
}

module.exports = {
  projectPublicEvent,
  projectPublicEventCatalogue,
  projectPublicLandmarks,
};
