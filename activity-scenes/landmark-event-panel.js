import "@phosphor-icons/web/bold";
import { plainText } from "./plain-text.js";
import {
  announceOverlayClosed,
  announceOverlayOpen,
  closeWhenAnotherOverlayOpens,
} from "./overlay-coordinator.js";
import { eventLocationLabel } from "./events/event-location-label.js";

let activePanelInstance = null;

const FIELD_CONTRACT = [
  ["date", "Date"],
  ["time", "Time"],
  ["locationType", "Location type"],
  ["venue", "Venue"],
  ["address", "Address"],
  ["category", "Category"],
  ["price", "Price"],
  ["organizer", "Organizer"],
];

function optionalText(value) {
  const normalized = plainText(value);
  return normalized || null;
}

function validUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function directionsUrl(anchor) {
  const latitude = Number(anchor?.lat);
  const longitude = Number(anchor?.lng);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${latitude},${longitude}`);
  return url.href;
}

function referenceLabel(url) {
  if (!url) return "Reference";
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "catch.sg") return "Catch.sg";
  if (hostname === "sistic.com.sg") return "SISTIC";
  return hostname;
}

function eventReferences(event, eventUrl) {
  const records =
    Array.isArray(event.sources) && event.sources.length
      ? event.sources
      : [{ source: event.source, sourceUrl: event.sourceUrl || eventUrl }];
  const references = [];
  for (const record of records) {
    const url = validUrl(record?.sourceUrl || record?.url || eventUrl);
    const label =
      optionalText(record?.source) || (url ? referenceLabel(url) : null);
    if (!label && !url) continue;
    const key = `${label || ""}|${url || ""}`;
    if (!references.some((reference) => reference.key === key))
      references.push({ key, label: label || referenceLabel(url), url });
  }
  return references;
}

function normalizeEvent(event, landmark, index) {
  const title = plainText(event.title);
  if (!title) return null;
  const startTimestamp = Date.parse(event.startDateTime || "");
  const eventUrl = validUrl(event.eventUrl || event.sourceUrl || event.url);
  return {
    id: event.id || `${landmark.id}-event-${index + 1}`,
    sourceIndex: index,
    sortTimestamp: Number.isFinite(startTimestamp)
      ? startTimestamp
      : Number.POSITIVE_INFINITY,
    title,
    date: optionalText(event.dateText || event.dateRange || event.date),
    time: optionalText(event.timeText || event.timeRange || event.time),
    locationType: eventLocationLabel(event, { includeDefault: true }),
    venue: optionalText(
      event.venue || (event.venueVerified ? landmark.label : null),
    ),
    address: optionalText(event.address),
    category: optionalText(event.category),
    price: optionalText(event.price),
    description: optionalText(event.description),
    organizer: optionalText(event.organizer),
    eventUrl,
    references: eventReferences(event, eventUrl),
  };
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendIcon(element, name) {
  const icon = makeElement("i", `ph-bold ph-${name}`);
  icon.setAttribute("aria-hidden", "true");
  element.appendChild(icon);
  return element;
}

export function createLandmarkEventPanel({ onClose } = {}) {
  if (activePanelInstance) return activePanelInstance;

  const panel = makeElement("aside", "landmark-event-panel");
  panel.id = "landmark-event-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "landmark-event-panel-title");

  const header = makeElement("header", "landmark-event-panel__header");
  const backButton = appendIcon(
    makeElement(
      "button",
      "landmark-event-panel__action landmark-event-panel__back",
    ),
    "arrow-left",
  );
  backButton.type = "button";
  backButton.title = "Back";
  backButton.setAttribute("aria-label", "Back to events");
  const headingGroup = makeElement(
    "div",
    "landmark-event-panel__heading-group",
  );
  const heading = makeElement("h2", "landmark-event-panel__heading");
  heading.id = "landmark-event-panel-title";
  headingGroup.append(heading);

  const headerActions = makeElement("div", "landmark-event-panel__actions");
  const addToPlan = appendIcon(
    makeElement(
      "button",
      "landmark-event-panel__action landmark-event-panel__plan",
    ),
    "list-plus",
  );
  addToPlan.type = "button";
  addToPlan.title = "Add to plan";
  addToPlan.setAttribute("aria-label", "Add event to plan");
  const viewEvent = appendIcon(
    makeElement("a", "landmark-event-panel__action landmark-event-panel__link"),
    "arrow-square-out",
  );
  viewEvent.title = "View event";
  viewEvent.setAttribute("aria-label", "View event website");
  viewEvent.target = "_blank";
  viewEvent.rel = "noopener noreferrer";
  const getDirections = appendIcon(
    makeElement(
      "a",
      "landmark-event-panel__action landmark-event-panel__directions",
    ),
    "navigation-arrow",
  );
  getDirections.title = "Get directions";
  getDirections.setAttribute("aria-label", "Get directions to venue");
  getDirections.target = "_blank";
  getDirections.rel = "noopener noreferrer";
  const closeButton = appendIcon(
    makeElement(
      "button",
      "landmark-event-panel__action landmark-event-panel__close",
    ),
    "x",
  );
  closeButton.type = "button";
  closeButton.title = "Close";
  closeButton.setAttribute("aria-label", "Close event details");
  headerActions.append(addToPlan, viewEvent, getDirections, closeButton);
  header.append(backButton, headingGroup, headerActions);

  const eventList = makeElement("nav", "landmark-event-panel__events");
  eventList.setAttribute("aria-label", "Choose an upcoming event");
  const previousButton = appendIcon(
    makeElement("button", "landmark-event-panel__event-nav"),
    "arrow-left",
  );
  previousButton.type = "button";
  previousButton.title = "Previous event";
  previousButton.setAttribute("aria-label", "Previous event");
  const eventPosition = makeElement(
    "div",
    "landmark-event-panel__event-position",
  );
  eventPosition.setAttribute("aria-live", "polite");
  const nextButton = appendIcon(
    makeElement("button", "landmark-event-panel__event-nav"),
    "arrow-right",
  );
  nextButton.type = "button";
  nextButton.title = "Next event";
  nextButton.setAttribute("aria-label", "Next event");
  eventList.append(previousButton, eventPosition, nextButton);
  const details = makeElement("div", "landmark-event-panel__details");
  panel.append(header, eventList, details);
  document.body.appendChild(panel);

  let activeTrigger = null;
  let activeLandmark = null;
  let events = [];
  let selectedIndex = 0;

  const renderDetails = () => {
    const event = events[selectedIndex];
    details.replaceChildren();
    if (!event) return;

    details.appendChild(
      makeElement("h3", "landmark-event-panel__event-title", event.title),
    );
    const fields = makeElement("dl", "landmark-event-panel__fields");

    const referenceRow = makeElement(
      "div",
      "landmark-event-panel__field landmark-event-panel__field--reference",
    );
    referenceRow.appendChild(
      makeElement("dt", "landmark-event-panel__label", "Reference"),
    );
    const referenceValue = makeElement(
      "dd",
      "landmark-event-panel__value landmark-event-panel__references",
    );
    if (event.references.length) {
      event.references.forEach((reference, index) => {
        if (index) referenceValue.appendChild(document.createTextNode(" · "));
        if (reference.url) {
          const link = makeElement(
            "a",
            "landmark-event-panel__reference-link",
            reference.label,
          );
          link.href = reference.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          referenceValue.appendChild(link);
        } else {
          referenceValue.appendChild(document.createTextNode(reference.label));
        }
      });
    } else {
      referenceValue.textContent = "Not available";
      referenceValue.classList.add("is-unavailable");
    }
    referenceRow.appendChild(referenceValue);
    fields.appendChild(referenceRow);

    for (const [key, label] of FIELD_CONTRACT) {
      const row = makeElement(
        "div",
        `landmark-event-panel__field landmark-event-panel__field--${key}`,
      );
      row.appendChild(makeElement("dt", "landmark-event-panel__label", label));
      const value = makeElement(
        "dd",
        "landmark-event-panel__value",
        event[key] || "Not available",
      );
      if (!event[key]) value.classList.add("is-unavailable");
      row.appendChild(value);
      fields.appendChild(row);
    }
    details.appendChild(fields);

    const description = makeElement(
      "section",
      "landmark-event-panel__description",
    );
    const descriptionCopy = makeElement(
      "p",
      "landmark-event-panel__description-copy",
      event.description || "Not available",
    );
    if (!event.description) descriptionCopy.classList.add("is-unavailable");
    description.append(
      makeElement(
        "h4",
        "landmark-event-panel__section-title",
        "About this event",
      ),
      descriptionCopy,
    );
    details.appendChild(description);

    eventPosition.textContent = `${selectedIndex + 1} of ${events.length} events`;
    eventList.hidden = events.length < 2;
    previousButton.disabled = events.length < 2;
    nextButton.disabled = events.length < 2;
    if (event.eventUrl) {
      viewEvent.href = event.eventUrl;
      viewEvent.hidden = false;
    } else {
      viewEvent.removeAttribute("href");
      viewEvent.hidden = true;
    }
    const routeUrl = directionsUrl(activeLandmark?.anchor);
    if (routeUrl) {
      getDirections.href = routeUrl;
      getDirections.hidden = false;
    } else {
      getDirections.removeAttribute("href");
      getDirections.hidden = true;
    }
  };

  const selectEvent = (index) => {
    selectedIndex = index;
    renderDetails();
  };

  const moveSelection = (direction) =>
    selectEvent((selectedIndex + direction + events.length) % events.length);

  const close = ({ restoreFocus = true } = {}) => {
    if (panel.hidden) return;
    const closedLandmark = activeLandmark;
    panel.classList.remove("is-open");
    panel.hidden = true;
    document.body.dataset.eventPanelOpen = "false";
    if (activeTrigger) activeTrigger.setAttribute("aria-expanded", "false");
    if (restoreFocus && activeTrigger?.isConnected) activeTrigger.focus();
    activeTrigger = null;
    activeLandmark = null;
    announceOverlayClosed("event-details");
    onClose?.({ landmark: closedLandmark });
  };

  const normalizeEvents = (landmark, sourceEvents) =>
    sourceEvents
      .map((event, index) => normalizeEvent(event, landmark, index))
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.sortTimestamp - right.sortTimestamp ||
          left.sourceIndex - right.sourceIndex,
      );

  const open = ({
    landmark,
    sourceEvents,
    selectedEventIndex = 0,
    trigger,
  }) => {
    if (
      !landmark ||
      !Array.isArray(sourceEvents) ||
      sourceEvents.length === 0 ||
      !trigger
    )
      return;
    const selectedSource = sourceEvents[selectedEventIndex];
    const selectedId =
      selectedSource?.id || `${landmark.id}-event-${selectedEventIndex + 1}`;
    const normalizedEvents = normalizeEvents(landmark, sourceEvents);
    if (!normalizedEvents.length) return;
    announceOverlayOpen("event-details");
    if (activeTrigger && activeTrigger !== trigger)
      activeTrigger.setAttribute("aria-expanded", "false");
    activeTrigger = trigger;
    activeLandmark = landmark;
    events = normalizedEvents;
    const sortedSelectedIndex = events.findIndex(
      (event) => event.id === selectedId,
    );
    selectedIndex = sortedSelectedIndex >= 0 ? sortedSelectedIndex : 0;
    heading.textContent = landmark.label;
    renderDetails();
    panel.hidden = false;
    panel.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    document.body.dataset.eventPanelOpen = "true";
    document.body.dataset.eventPanelLandmark = landmark.id;
    closeButton.focus();
  };

  const refresh = ({ landmark, sourceEvents, trigger }) => {
    if (
      !activeLandmark ||
      activeLandmark.id !== landmark?.id ||
      activeTrigger !== trigger
    )
      return false;
    const selectedId = events[selectedIndex]?.id;
    const normalizedEvents = normalizeEvents(
      landmark,
      Array.isArray(sourceEvents) ? sourceEvents : [],
    );
    if (!normalizedEvents.length) {
      close({ restoreFocus: false });
      return true;
    }
    activeLandmark = landmark;
    events = normalizedEvents;
    const replacementIndex = events.findIndex(
      (event) => event.id === selectedId,
    );
    selectedIndex = replacementIndex >= 0 ? replacementIndex : 0;
    heading.textContent = landmark.label;
    renderDetails();
    return true;
  };

  const onDocumentKeydown = (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  };
  const stopMapInteraction = (event) => event.stopPropagation();

  addToPlan.addEventListener("click", () => {
    const event = events[selectedIndex];
    if (!event || !activeLandmark) return;
    window.dispatchEvent(
      new CustomEvent("whats-here:add-to-plan", {
        detail: {
          id: event.id,
          type: "event",
          title: event.title,
          place: event.venue || activeLandmark.label,
          detail:
            [event.date, event.time].filter(Boolean).join(" · ") ||
            event.description,
          startsAt: event.startsAt || event.startDate || null,
          endsAt: event.endsAt || event.endDate || null,
          accessibility:
            event.accessibility || activeLandmark.accessibility || null,
          availability: event.availability || null,
          latitude: Number(activeLandmark.anchor.lat),
          longitude: Number(activeLandmark.anchor.lng),
          sourceUrl: event.eventUrl,
        },
      }),
    );
  });
  backButton.addEventListener("click", () => close());
  closeButton.addEventListener("click", () => close());
  previousButton.addEventListener("click", () => moveSelection(-1));
  nextButton.addEventListener("click", () => moveSelection(1));
  document.addEventListener("keydown", onDocumentKeydown);
  const stopWatchingOverlays = closeWhenAnotherOverlayOpens(
    "event-details",
    () => close({ restoreFocus: false }),
  );
  for (const type of [
    "pointerdown",
    "mousedown",
    "touchstart",
    "wheel",
    "dblclick",
  ]) {
    panel.addEventListener(type, stopMapInteraction);
  }

  const destroy = () => {
    close({ restoreFocus: false });
    stopWatchingOverlays();
    document.removeEventListener("keydown", onDocumentKeydown);
    for (const type of [
      "pointerdown",
      "mousedown",
      "touchstart",
      "wheel",
      "dblclick",
    ]) {
      panel.removeEventListener(type, stopMapInteraction);
    }
    panel.remove();
    if (activePanelInstance === api) activePanelInstance = null;
  };

  const api = {
    close,
    destroy,
    id: panel.id,
    open,
    refresh,
    previous: () => moveSelection(-1),
    next: () => moveSelection(1),
    addToPlan: () => addToPlan.click(),
    openReference: () => {
      if (!viewEvent.hidden && viewEvent.href) viewEvent.click();
    },
    openDirections: () => {
      if (!getDirections.hidden && getDirections.href) getDirections.click();
    },
  };
  activePanelInstance = api;
  return api;
}
