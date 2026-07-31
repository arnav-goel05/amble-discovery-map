import "@phosphor-icons/web/bold";
import { projectEventDetails } from "./event-detail-projection.js";
import {
  announceOverlayClosed,
  announceOverlayOpen,
  closeWhenAnotherOverlayOpens,
} from "./overlay-coordinator.js";

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
const INITIAL_SESSIONS_PER_VENUE = 6;

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

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
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
  let selectedOccurrenceId = null;
  const expandedVenueGroups = new Set();
  const subscribers = new Set();
  let revision = 0;
  let destroyed = false;
  let invokingExternal = false;
  const referenceLinks = new Map();

  const eventTargetId = (activity) =>
    activity?.assistantEventId ??
    activity?.candidateId ??
    activity?.targetId ??
    (Array.isArray(activity?.sourceEvent?.sessions)
      ? activity?.activityId
      : null) ??
    (activity?.landmarkId && activity?.id
      ? `event:${activity.landmarkId}:${activity.id}`
      : (activity?.activityId ?? activity?.id ?? null));
  const expansionKeys = (activity) =>
    (activity?.occurrences?.length ?? 0) > INITIAL_SESSIONS_PER_VENUE
      ? [`${activity.activityId}:schedule`]
      : [];
  const snapshot = () => {
    const activity = events[selectedIndex] ?? null;
    const occurrenceIds = (activity?.occurrences ?? [])
      .map(({ occurrenceId }) => occurrenceId)
      .filter(Boolean)
      .slice(0, 20);
    const expandedVenueGroupIds = expansionKeys(activity)
      .filter((key) => expandedVenueGroups.has(key))
      .slice(0, 20);
    return {
      revision,
      detailOpen: !panel.hidden,
      events: events.slice(0, 20).map((item) => ({
        eventId: eventTargetId(item),
        title: item.title,
      })),
      selectedEventId: eventTargetId(activity),
      occurrenceIds,
      selectedOccurrenceId: occurrenceIds.includes(selectedOccurrenceId)
        ? selectedOccurrenceId
        : null,
      sessionsExpanded: expandedVenueGroupIds.length > 0,
      sessionsExpandable: expansionKeys(activity).length > 0,
      expandedVenueGroupIds,
      hasPrevious: !panel.hidden && events.length > 1,
      hasNext: !panel.hidden && events.length > 1,
      referenceIds: [...referenceLinks.keys()].slice(0, 10),
      routable: !getDirections.hidden && Boolean(getDirections.href),
    };
  };
  const publish = () => {
    if (destroyed) return;
    revision += 1;
    const current = snapshot();
    for (const subscriber of subscribers) subscriber(current);
  };

  const renderDetails = () => {
    const activity = events[selectedIndex];
    details.replaceChildren();
    referenceLinks.clear();
    if (!activity) return;
    const occurrence =
      activity.occurrences?.find(
        (item) => item.occurrenceId === selectedOccurrenceId,
      ) ??
      activity.occurrences?.[0] ??
      activity;
    selectedOccurrenceId = occurrence.occurrenceId;
    const event = {
      ...activity,
      date: occurrence.date ?? activity.scheduleSummary,
      time: occurrence.time,
      venue:
        activity.venueGroups?.length > 1
          ? `${activity.venueGroups.length} venues`
          : occurrence.venue,
    };

    details.appendChild(
      makeElement("h3", "landmark-event-panel__event-title", event.title),
    );
    const scheduleRows = [];
    if ((activity.occurrences?.length ?? 0) > 1) {
      const expansionKey = expansionKeys(activity)[0];
      const expanded =
        Boolean(expansionKey) && expandedVenueGroups.has(expansionKey);
      const makeChoiceRow = ({
        key,
        label,
        items,
        itemLabel,
        isSelected,
        revealNoun,
      }) => {
        const row = makeElement(
          "div",
          `landmark-event-panel__field landmark-event-panel__field--${key}-choices`,
        );
        row.appendChild(
          makeElement("dt", "landmark-event-panel__label", label),
        );
        const value = makeElement(
          "dd",
          "landmark-event-panel__value landmark-event-panel__schedule-value",
        );
        const choices = makeElement("div", "landmark-event-panel__sessions");
        choices.id = `activity-${key}-choices-${selectedIndex}`;
        const visibleItems = expanded
          ? items
          : items.slice(0, INITIAL_SESSIONS_PER_VENUE);
        for (const item of visibleItems) {
          const button = makeElement(
            "button",
            `landmark-event-panel__session landmark-event-panel__session--${key}`,
            itemLabel(item),
          );
          button.type = "button";
          button.setAttribute("aria-pressed", String(isSelected(item)));
          button.addEventListener("click", () => {
            executeAction("event.selectoccurrence", {
              eventId: eventTargetId(activity),
              occurrenceId: item.occurrence.occurrenceId,
            });
          });
          choices.appendChild(button);
        }
        value.appendChild(choices);
        if (items.length > INITIAL_SESSIONS_PER_VENUE) {
          const remaining = items.length - visibleItems.length;
          const reveal = makeElement(
            "button",
            "landmark-event-panel__session-reveal",
            expanded
              ? `Show fewer ${revealNoun}`
              : revealNoun === "dates"
                ? `+${remaining} dates`
                : `Show ${remaining} more ${revealNoun}`,
          );
          reveal.type = "button";
          reveal.setAttribute("aria-expanded", String(expanded));
          reveal.setAttribute("aria-controls", choices.id);
          reveal.addEventListener("click", () => {
            executeAction("event.setsessionsexpanded", {
              eventId: eventTargetId(activity),
              expanded: !expanded,
            });
          });
          value.appendChild(reveal);
        }
        row.appendChild(value);
        return row;
      };

      const canSplitSchedule = activity.occurrences.every(
        (item) => item.date && item.time,
      );
      if (canSplitSchedule) {
        const dateGroups = [
          ...groupBy(activity.occurrences, (item) => item.date),
        ].map(([date, occurrences]) => ({
          label: date,
          occurrence: occurrences[0],
          occurrences,
        }));
        const selectedDate =
          dateGroups.find(({ occurrences }) =>
            occurrences.some(
              (item) => item.occurrenceId === occurrence.occurrenceId,
            ),
          ) ?? dateGroups[0];
        const timeCounts = groupBy(
          selectedDate.occurrences,
          (item) => item.time,
        );
        scheduleRows.push(
          makeChoiceRow({
            key: "date",
            label: "Date",
            items: dateGroups,
            itemLabel: (item) => item.label,
            isSelected: (item) => item.label === selectedDate.label,
            revealNoun: "dates",
          }),
          makeChoiceRow({
            key: "time",
            label: "Time",
            items: selectedDate.occurrences.map((item) => ({
              occurrence: item,
            })),
            itemLabel: ({ occurrence: item }) =>
              timeCounts.get(item.time).length > 1 && item.venue
                ? `${item.time} · ${item.venue}`
                : item.time,
            isSelected: ({ occurrence: item }) =>
              item.occurrenceId === occurrence.occurrenceId,
            revealNoun: "times",
          }),
        );
      } else {
        scheduleRows.push(
          makeChoiceRow({
            key: "schedule",
            label: "Dates & times",
            items: activity.occurrences.map((item) => ({ occurrence: item })),
            itemLabel: ({ occurrence: item }) =>
              [item.date, item.time].filter(Boolean).join(" · ") ||
              "Flexible schedule",
            isSelected: ({ occurrence: item }) =>
              item.occurrenceId === occurrence.occurrenceId,
            revealNoun: "sessions",
          }),
        );
      }
    }
    const fields = makeElement("dl", "landmark-event-panel__fields");

    const referenceRow = makeElement(
      "div",
      "landmark-event-panel__field landmark-event-panel__field--reference",
    );
    referenceRow.appendChild(
      makeElement("dt", "landmark-event-panel__label", "Sources & tickets"),
    );
    const referenceValue = makeElement(
      "dd",
      "landmark-event-panel__value landmark-event-panel__references",
    );
    const applicableReferences = (
      activity.sourceOffers ?? activity.references
    ).filter(
      (reference) =>
        reference.scope !== "sessions" ||
        reference.occurrenceIds?.includes(occurrence.occurrenceId),
    );
    if (applicableReferences.length) {
      applicableReferences.forEach((reference, index) => {
        if (index) referenceValue.appendChild(document.createTextNode(" · "));
        if (reference.url) {
          const referenceId =
            reference.referenceId ?? reference.id ?? `reference:${index + 1}`;
          const link = makeElement(
            "a",
            "landmark-event-panel__reference-link",
            reference.label,
          );
          link.href = reference.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.addEventListener("click", () => {
            if (!invokingExternal)
              executeAction(
                "event.openreference",
                {
                  eventId: eventTargetId(activity),
                  referenceId,
                },
                { direct: true },
              );
          });
          referenceLinks.set(referenceId, link);
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
    fields.append(...scheduleRows);

    for (const [key, label] of FIELD_CONTRACT) {
      if (scheduleRows.length && (key === "date" || key === "time")) continue;
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

    eventPosition.textContent = `${selectedIndex + 1} of ${events.length} activities`;
    eventList.hidden = events.length < 2;
    previousButton.disabled = events.length < 2;
    nextButton.disabled = events.length < 2;
    if (occurrence.eventUrl) {
      viewEvent.href = occurrence.eventUrl;
      viewEvent.hidden = false;
    } else {
      viewEvent.removeAttribute("href");
      viewEvent.hidden = true;
    }
    const routeUrl = directionsUrl(occurrence.anchor ?? activeLandmark?.anchor);
    if (routeUrl) {
      getDirections.href = routeUrl;
      getDirections.hidden = false;
    } else {
      getDirections.removeAttribute("href");
      getDirections.hidden = true;
    }
  };

  const selectEvent = (index) => {
    if (!events[index]) return false;
    selectedIndex = index;
    renderDetails();
    return true;
  };

  const moveSelection = (direction) =>
    selectEvent((selectedIndex + direction + events.length) % events.length);

  const closePanel = ({ restoreFocus = true } = {}) => {
    if (panel.hidden) return false;
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
    return true;
  };

  const selectedActivity = () => events[selectedIndex] ?? null;
  const selectedOccurrence = () => {
    const activity = selectedActivity();
    return (
      activity?.occurrences?.find(
        (occurrence) => occurrence.occurrenceId === selectedOccurrenceId,
      ) ?? activity
    );
  };
  const executeAction = (actionId, args = {}, { direct = false } = {}) => {
    const activity = selectedActivity();
    const currentEventId = eventTargetId(activity);
    if (actionId === "event.selectoccurrence") {
      if (
        panel.hidden ||
        args.eventId !== currentEventId ||
        (activity?.occurrences?.length ?? 0) < 2 ||
        !activity?.occurrences?.some(
          ({ occurrenceId }) => occurrenceId === args.occurrenceId,
        )
      )
        return false;
      selectedOccurrenceId = args.occurrenceId;
      renderDetails();
    } else if (actionId === "event.setsessionsexpanded") {
      if (
        panel.hidden ||
        args.eventId !== currentEventId ||
        typeof args.expanded !== "boolean"
      )
        return false;
      const keys = args.venueGroupId
        ? [`${activity.activityId}:${args.venueGroupId}`].filter((key) =>
            expansionKeys(activity).includes(key),
          )
        : expansionKeys(activity);
      if (!keys.length) return false;
      for (const key of keys)
        if (args.expanded) expandedVenueGroups.add(key);
        else expandedVenueGroups.delete(key);
      renderDetails();
    } else if (actionId === "event.previousevent") {
      if (panel.hidden || events.length < 2 || !moveSelection(-1)) return false;
    } else if (actionId === "event.nextevent") {
      if (panel.hidden || events.length < 2 || !moveSelection(1)) return false;
    } else if (actionId === "event.closedetail") {
      if (!closePanel(args)) return false;
    } else if (actionId === "event.addtoplan") {
      const event = selectedOccurrence();
      if (
        panel.hidden ||
        (args.eventId && args.eventId !== currentEventId) ||
        !event ||
        !activeLandmark
      )
        return false;
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
            latitude: Number(activeLandmark.anchor?.lat),
            longitude: Number(activeLandmark.anchor?.lng),
            sourceUrl: event.eventUrl,
          },
        }),
      );
    } else if (actionId === "event.openreference") {
      const target = args.referenceId
        ? referenceLinks.get(args.referenceId)
        : viewEvent;
      if (
        panel.hidden ||
        (args.eventId && args.eventId !== currentEventId) ||
        !target ||
        target.hidden ||
        !target.href
      )
        return false;
      if (!direct) {
        invokingExternal = true;
        target.click();
        invokingExternal = false;
      }
    } else if (actionId === "event.opendirections") {
      if (
        panel.hidden ||
        (args.eventId && args.eventId !== currentEventId) ||
        getDirections.hidden ||
        !getDirections.href
      )
        return false;
      if (!direct) {
        invokingExternal = true;
        getDirections.click();
        invokingExternal = false;
      }
    } else return false;
    publish();
    return true;
  };
  const close = (options) => executeAction("event.closedetail", options ?? {});

  const normalizeEvents = (landmark, sourceEvents, activity = null) =>
    projectEventDetails({ landmark, sourceEvents, activity });

  const open = ({
    landmark,
    sourceEvents,
    activity = null,
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
    const normalizedEvents = normalizeEvents(landmark, sourceEvents, activity);
    if (!normalizedEvents.length) return;
    announceOverlayOpen("event-details");
    if (activeTrigger && activeTrigger !== trigger)
      activeTrigger.setAttribute("aria-expanded", "false");
    activeTrigger = trigger;
    activeLandmark = landmark;
    events = normalizedEvents;
    const selectedActivityId = activity?.activityId;
    const selectedTargetId =
      activity?.candidateId ?? activity?.targetId ?? null;
    if (selectedTargetId)
      for (const candidate of events)
        if (candidate.activityId === selectedActivityId)
          candidate.assistantEventId = selectedTargetId;
    const sortedSelectedIndex = events.findIndex(
      (event) =>
        event.activityId === activity?.activityId ||
        event.occurrences?.some((occurrence) => occurrence.id === selectedId),
    );
    selectedIndex = sortedSelectedIndex >= 0 ? sortedSelectedIndex : 0;
    selectedOccurrenceId =
      activity?.matchingOccurrences?.[0]?.occurrenceId ?? selectedId;
    heading.textContent = landmark.label;
    renderDetails();
    panel.hidden = false;
    panel.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    document.body.dataset.eventPanelOpen = "true";
    document.body.dataset.eventPanelLandmark = landmark.id;
    closeButton.focus();
    publish();
    return true;
  };

  const refresh = ({ landmark, sourceEvents, trigger }) => {
    if (
      !activeLandmark ||
      activeLandmark.id !== landmark?.id ||
      activeTrigger !== trigger
    )
      return false;
    const selectedActivityId = events[selectedIndex]?.activityId;
    const selectedId = selectedOccurrenceId;
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
      (event) =>
        event.activityId === selectedActivityId ||
        event.occurrences?.some(
          (occurrence) => occurrence.occurrenceId === selectedId,
        ),
    );
    selectedIndex = replacementIndex >= 0 ? replacementIndex : 0;
    heading.textContent = landmark.label;
    renderDetails();
    publish();
    return true;
  };

  const onDocumentKeydown = (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  };
  const stopMapInteraction = (event) => event.stopPropagation();

  addToPlan.addEventListener("click", () =>
    executeAction("event.addtoplan", {
      eventId: eventTargetId(selectedActivity()),
    }),
  );
  viewEvent.addEventListener("click", () => {
    if (!invokingExternal)
      executeAction(
        "event.openreference",
        { eventId: eventTargetId(selectedActivity()) },
        { direct: true },
      );
  });
  getDirections.addEventListener("click", () => {
    if (!invokingExternal)
      executeAction(
        "event.opendirections",
        { eventId: eventTargetId(selectedActivity()) },
        { direct: true },
      );
  });
  backButton.addEventListener("click", () => close());
  closeButton.addEventListener("click", () => close());
  previousButton.addEventListener("click", () =>
    executeAction("event.previousevent"),
  );
  nextButton.addEventListener("click", () => executeAction("event.nextevent"));
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
    if (destroyed) return;
    close({ restoreFocus: false });
    destroyed = true;
    subscribers.clear();
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
    dispatch: executeAction,
    destroy,
    id: panel.id,
    open,
    refresh,
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        throw new TypeError("Event-panel subscriber must be callable");
      subscribers.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => subscribers.delete(listener);
    },
    previous: () => executeAction("event.previousevent"),
    next: () => executeAction("event.nextevent"),
    addToPlan: () =>
      executeAction("event.addtoplan", {
        eventId: eventTargetId(selectedActivity()),
      }),
    selectOccurrence: (eventId, occurrenceId) =>
      executeAction("event.selectoccurrence", {
        eventId,
        occurrenceId,
      }),
    setSessionsExpanded: (eventId, expanded) =>
      executeAction("event.setsessionsexpanded", {
        eventId,
        expanded,
      }),
    openReference: (referenceId) =>
      executeAction("event.openreference", {
        eventId: eventTargetId(selectedActivity()),
        referenceId,
      }),
    openDirections: () =>
      executeAction("event.opendirections", {
        eventId: eventTargetId(selectedActivity()),
      }),
  };
  activePanelInstance = api;
  return api;
}
