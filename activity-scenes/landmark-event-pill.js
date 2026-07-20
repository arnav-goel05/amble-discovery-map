import { plainText } from "./plain-text.js";
import { landmarkInputIdentity } from "./events/event-map-reconciliation.js";
import {
  createEventDiscoveryModel,
  eventIdentity,
} from "./events/event-discovery-model.js";
import { eventLocationLabel } from "./events/event-location-label.js";
import { LANDMARK_PILL_MIN_ZOOM } from "./map-location-focus.js";

const DEFAULT_ROTATION_MS = 3000;
const VIEWPORT_MARGIN = 0;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

const searchableText = (...values) =>
  values.flat().filter(Boolean).join(" ").toLocaleLowerCase();

function distanceFromMapCenter(map, landmark) {
  const lng = Number(landmark?.anchor?.lng);
  const lat = Number(landmark?.anchor?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat))
    return Number.POSITIVE_INFINITY;

  const center = map.getCenter?.();
  if (Number.isFinite(center?.lng) && Number.isFinite(center?.lat)) {
    const latitudeScale = Math.cos((((center.lat + lat) / 2) * Math.PI) / 180);
    return Math.hypot((lng - center.lng) * latitudeScale, lat - center.lat);
  }

  const point = map.project?.([lng, lat]);
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y))
    return Number.POSITIVE_INFINITY;
  return Math.hypot(
    point.x - window.innerWidth / 2,
    point.y - window.innerHeight / 2,
  );
}

const CATEGORY_RULES = [
  [
    "Workshops & Classes",
    /\b(workshops?|classes?|courses?|lessons?|masterclasses?|seminars?|talks?|lectures?|conferences?|beginners?|painting experience|art education)\b/i,
  ],
  [
    "Exhibitions",
    /\b(exhibitions?|galleries|gallery|museums?|installations?|visual arts?|artscience|showcases?)\b/i,
  ],
  [
    "Performances",
    /\b(concerts?|music|musical|orchestras?|symphon(?:y|ies)|recitals?|singers?|bands?|jazz|opera|theatre|theater|plays?|drama|stage|dance|ballet|choreograph(?:y|ed)?|comedy|comedian|stand[ -]?up|storytelling|sing[ -]?along)\b/i,
  ],
  [
    "Tours & Experiences",
    /\b(tours?|trails?|walks?|rides?|adventures?|hunts?|admissions?|observation deck|attractions?|experiences?|excursions?)\b/i,
  ],
];

export function eventCategory(event = {}) {
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const explicit = [
    event.category,
    event.genre,
    event.eventType,
    event.type,
    ...list(event.categories),
    ...list(event.tags),
  ]
    .flat()
    .filter((value) => typeof value === "string" && value.trim());
  const primaryText = [...explicit, event.title, event.venue]
    .filter(Boolean)
    .join(" ");
  const primaryMatch = CATEGORY_RULES.find(([, rule]) =>
    rule.test(primaryText),
  );
  if (primaryMatch) return primaryMatch[0];
  const descriptionMatch = CATEGORY_RULES.find(([, rule]) =>
    rule.test(event.description || ""),
  );
  return descriptionMatch?.[0] || "Tours & Experiences";
}

function normalizeEvent(event, landmarkId, index) {
  const title = plainText(event.title);
  const time = text(event.timeText || event.timeRange || event.time);
  const scheduleKind = text(event.schedule?.kind);
  const date =
    text(
      event.dateText ||
        event.dateRange ||
        event.date ||
        event.schedule?.displayText,
    ) ||
    ({
      selectable: "Select a date",
      anytime: "Available anytime",
      unverified: "Date to be confirmed",
    }[scheduleKind] ??
      "");
  if (!title || (!time && !date)) return null;
  return {
    id: event.id || `${landmarkId}-event-${index + 1}`,
    title,
    time,
    date,
    temporalText: [date, time].filter(Boolean).join(" · "),
    category: eventCategory(event),
    locationLabel: eventLocationLabel(event),
  };
}

function makeElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function createPillDom(landmark, panelId) {
  const root = makeElement("section", "landmark-event-pill");
  root.id = `${landmark.id}-event-pill`;
  root.setAttribute("aria-label", `${landmark.label} upcoming events`);

  const card = makeElement("div", "landmark-event-pill__card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-expanded", "false");
  card.setAttribute("aria-controls", panelId);
  card.setAttribute("aria-label", `Open ${landmark.label} event details`);

  const copy = makeElement("div", "landmark-event-pill__copy");
  copy.append(makeElement("div", "landmark-event-pill__title"));
  copy.append(makeElement("div", "landmark-event-pill__location"));
  card.append(copy);
  root.appendChild(card);
  document.body.appendChild(root);
  return { card, root };
}

function renderState(state) {
  const event = state.events[state.activeIndex];
  state.root.querySelector(".landmark-event-pill__title").textContent =
    event.title;
  const location = state.root.querySelector(".landmark-event-pill__location");
  location.textContent = event.locationLabel;
  location.hidden = !event.locationLabel;
}

function updatePosition(map, state, minZoom, onHidden) {
  const point = map.project([
    state.landmark.anchor.lng,
    state.landmark.anchor.lat,
  ]);
  const cardWidth = state.cardWidth || state.root.offsetWidth;
  const edgePadding = 18;
  const minCardCenter = edgePadding + cardWidth / 2;
  const maxCardCenter = window.innerWidth - edgePadding - cardWidth / 2;
  const cardCenter = Math.min(Math.max(point.x, minCardCenter), maxCardCenter);
  const isNavigationTarget = state.root.classList.contains(
    "is-navigation-target",
  );
  const isNearLocation =
    state.matchesSearch &&
    (map.getZoom() >= minZoom || isNavigationTarget) &&
    point.x >= -VIEWPORT_MARGIN &&
    point.x <= window.innerWidth + VIEWPORT_MARGIN &&
    point.y >= -VIEWPORT_MARGIN &&
    point.y <= window.innerHeight + VIEWPORT_MARGIN;

  if (state.isVisible && !isNearLocation) {
    const wasInteracting =
      state.card.contains(document.activeElement) ||
      state.card.getAttribute("aria-expanded") === "true";
    if (wasInteracting) {
      onHidden?.({ landmark: state.landmark, trigger: state.card });
      const visibleMapControl = document.querySelector(
        ".maplibregl-ctrl-zoom-in",
      );
      (visibleMapControl || map.getCanvas()).focus();
    }
  }

  state.root.style.transform = `translate(${Math.round(point.x - cardWidth / 2)}px, ${Math.round(point.y)}px)`;
  state.root.style.setProperty(
    "--pill-card-offset-x",
    `${Math.round(cardCenter - point.x)}px`,
  );
  state.root.classList.toggle("is-hidden", !isNearLocation);
  state.root.setAttribute("aria-hidden", String(!isNearLocation));
  state.card.tabIndex = isNearLocation ? 0 : -1;
  state.isVisible = isNearLocation;
}

export function createLandmarkEventPillLayer({
  map,
  onSelect,
  onHidden,
  onEventsChanged,
  panelId,
  minZoom = LANDMARK_PILL_MIN_ZOOM,
  rotationMs = DEFAULT_ROTATION_MS,
}) {
  const states = [];
  let positionFrame = null;
  let positionFallback = null;
  let rotationTimer = null;
  let navigationTargetId = null;
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const state = states.find(
              (candidate) => candidate.root === entry.target,
            );
            if (state) state.cardWidth = entry.contentRect.width;
          }
          schedulePositionUpdate();
        })
      : null;

  const recordPositionPass = () => {
    const body = document.body;
    body.dataset.landmarkEventPillPositionPassCount = String(
      Number(body.dataset.landmarkEventPillPositionPassCount || 0) + 1,
    );
    body.dataset.landmarkEventPillPositionUpdateCount = String(
      Number(body.dataset.landmarkEventPillPositionUpdateCount || 0) +
        states.length,
    );
  };

  const updateAllPositions = () => {
    if (!states.length) return;
    recordPositionPass();
    for (const state of states) updatePosition(map, state, minZoom, onHidden);
  };

  function schedulePositionUpdate() {
    if (positionFrame !== null) return;
    const run = () => {
      if (positionFrame === null) return;
      cancelAnimationFrame(positionFrame);
      clearTimeout(positionFallback);
      positionFrame = null;
      positionFallback = null;
      updateAllPositions();
    };
    positionFrame = requestAnimationFrame(run);
    // Mobile WebKit can suspend animation frames briefly while its viewport settles.
    // Keep event-driven updates bounded without falling back to permanent polling.
    positionFallback = setTimeout(run, 100);
  }

  const rotateEvents = () => {
    rotationTimer = null;
    const now = performance.now();
    let rendered = false;
    for (const state of states) {
      if (
        state.visibleEventIndices.length < 2 ||
        now - state.lastRotationAt < rotationMs
      )
        continue;
      const currentVisibleIndex = state.visibleEventIndices.indexOf(
        state.activeIndex,
      );
      state.activeIndex =
        state.visibleEventIndices[
          (currentVisibleIndex + 1) % state.visibleEventIndices.length
        ] ?? 0;
      state.lastRotationAt = now;
      renderState(state);
      rendered = true;
    }
    if (rendered) schedulePositionUpdate();
    scheduleRotation();
  };

  function scheduleRotation() {
    if (rotationTimer !== null) clearTimeout(rotationTimer);
    const rotatingStates = states.filter(
      (state) => state.visibleEventIndices.length > 1,
    );
    if (!rotatingStates.length) {
      rotationTimer = null;
      return;
    }
    const now = performance.now();
    const nextDue = Math.min(
      ...rotatingStates.map((state) => state.lastRotationAt + rotationMs),
    );
    rotationTimer = setTimeout(rotateEvents, Math.max(0, nextDue - now));
  }

  const mapEvents = ["move", "zoom", "resize"];
  for (const eventName of mapEvents)
    map.on?.(eventName, schedulePositionUpdate);
  window.addEventListener("resize", schedulePositionUpdate);

  const normalizedInput = (landmark, sourceEvents) =>
    (Array.isArray(sourceEvents) ? sourceEvents : [])
      .map((sourceEvent, index) => ({
        normalized: normalizeEvent(sourceEvent, landmark.id, index),
        sourceEvent,
      }))
      .filter(({ normalized }) => normalized);

  const findState = (landmarkId) =>
    states.find((state) => state.landmark.id === landmarkId);

  const setNavigationTarget = (landmarkId = null) => {
    navigationTargetId = findState(landmarkId) ? landmarkId : null;
    for (const state of states) {
      const isTarget = state.landmark.id === navigationTargetId;
      state.root.classList.toggle("is-navigation-target", isTarget);
      if (isTarget) state.card.setAttribute("aria-current", "location");
      else state.card.removeAttribute("aria-current");
    }
    updateAllPositions();
    return Boolean(navigationTargetId);
  };

  const remove = (landmarkId) => {
    const index = states.findIndex((state) => state.landmark.id === landmarkId);
    if (index < 0) return false;
    const [state] = states.splice(index, 1);
    resizeObserver?.unobserve(state.root);
    if (navigationTargetId === landmarkId) navigationTargetId = null;
    onEventsChanged?.({
      landmark: state.landmark,
      sourceEvents: [],
      trigger: state.card,
    });
    state.root.remove();
    scheduleRotation();
    return true;
  };

  const add = ({ landmark, sourceEvents }) => {
    if (
      !landmark?.id ||
      !landmark?.label ||
      !landmark?.anchor ||
      document.getElementById(`${landmark.id}-event-pill`)
    ) {
      return null;
    }
    const input = normalizedInput(landmark, sourceEvents);
    if (!input.length) return null;

    const { card, root } = createPillDom(landmark, panelId);
    const state = {
      activeIndex: 0,
      card,
      events: input.map(({ normalized }) => normalized),
      landmark,
      matchesSearch: true,
      matchesCategory: true,
      lastRotationAt: performance.now(),
      root,
      sourceEvents: input.map(({ sourceEvent }) => sourceEvent),
      visibleEventIndices: input.map((_, index) => index),
      contentIdentity: landmarkInputIdentity(landmark, sourceEvents),
    };
    root.dataset.landmark = landmark.id;
    root.dataset.minVisibleZoom = String(minZoom);
    root.dataset.partialEventSupport = "enabled";
    root.dataset.placementMode = "map-anchor";
    root.dataset.contentIdentity = state.contentIdentity;
    root.classList.toggle(
      "is-navigation-target",
      landmark.id === navigationTargetId,
    );

    const select = () =>
      onSelect?.({
        landmark: state.landmark,
        selectedEventIndex: state.activeIndex,
        sourceEvents: state.sourceEvents,
        trigger: card,
      });
    card.addEventListener("click", select);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });

    states.push(state);
    state.cardWidth = root.offsetWidth;
    resizeObserver?.observe(root);
    renderState(state);
    updatePosition(map, state, minZoom, onHidden);
    scheduleRotation();
    return root;
  };

  const upsert = ({ landmark, sourceEvents }) => {
    if (!landmark?.id || !landmark?.label || !landmark?.anchor) return null;
    const existing = findState(landmark.id);
    if (!existing) return add({ landmark, sourceEvents });
    const nextContentIdentity = landmarkInputIdentity(landmark, sourceEvents);
    if (existing.contentIdentity === nextContentIdentity) return existing.root;
    const input = normalizedInput(landmark, sourceEvents);
    if (!input.length) {
      remove(landmark.id);
      return null;
    }
    const selectedId = existing.events[existing.activeIndex]?.id;
    existing.landmark = landmark;
    existing.events = input.map(({ normalized }) => normalized);
    existing.sourceEvents = input.map(({ sourceEvent }) => sourceEvent);
    existing.visibleEventIndices = input.map((_, index) => index);
    const selectedIndex = existing.events.findIndex(
      (event) => event.id === selectedId,
    );
    existing.activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    existing.lastRotationAt = performance.now();
    existing.contentIdentity = nextContentIdentity;
    existing.root.dataset.contentIdentity = nextContentIdentity;
    existing.root.setAttribute(
      "aria-label",
      `${landmark.label} upcoming events`,
    );
    existing.card.setAttribute(
      "aria-label",
      `Open ${landmark.label} event details`,
    );
    renderState(existing);
    updatePosition(map, existing, minZoom, onHidden);
    scheduleRotation();
    onEventsChanged?.({
      landmark,
      sourceEvents: existing.sourceEvents,
      trigger: existing.card,
    });
    return existing.root;
  };

  const reconcile = ({ landmarks, runStatus }) => {
    if (runStatus !== "success" || !Array.isArray(landmarks)) return false;
    const incomingIds = new Set();
    for (const item of landmarks) {
      if (!item?.landmark?.id) continue;
      incomingIds.add(item.landmark.id);
      upsert(item);
    }
    for (const state of [...states])
      if (!incomingIds.has(state.landmark.id)) remove(state.landmark.id);
    return true;
  };

  const applyDiscoveryResult = (discoveryResult) => {
    const identities =
      discoveryResult?.identities instanceof Set
        ? discoveryResult.identities
        : new Set();
    let matchedEvents = 0;
    let matchedLandmarks = 0;
    const matchesByState = new Map();
    for (const state of states) {
      const matches = state.events
        .map((event, index) => ({
          index,
          identity: eventIdentity(state.landmark.id, event.id),
        }))
        .filter(({ identity }) => identities.has(identity));
      state.matchesSearch = matches.length > 0;
      state.matchesCategory = state.matchesSearch;
      state.visibleEventIndices = matches.map((entry) => entry.index);
      matchesByState.set(state, matches);
      if (
        state.matchesSearch &&
        !matches.some((entry) => entry.index === state.activeIndex)
      ) {
        if (state.card.getAttribute("aria-expanded") === "true")
          onHidden?.({ landmark: state.landmark, trigger: state.card });
        state.activeIndex = matches[0].index;
        state.lastRotationAt = performance.now();
        renderState(state);
      }
    }
    updateAllPositions();
    const results = [];
    for (const event of discoveryResult?.events ?? []) {
      if (event.publicPlacement === "off_map") {
        results.push({
          ...event,
          distanceFromCenter: Number.POSITIVE_INFINITY,
          inView: false,
        });
        continue;
      }
      const state = findState(event.landmarkId);
      if (!state || !state.events[event.eventIndex]) continue;
      results.push({
        category: state.events[event.eventIndex].category,
        date: state.events[event.eventIndex].temporalText,
        distanceFromCenter: distanceFromMapCenter(map, state.landmark),
        eventIndex: event.eventIndex,
        landmarkId: state.landmark.id,
        title: state.events[event.eventIndex].title,
        venue:
          state.sourceEvents[event.eventIndex]?.venue || state.landmark.label,
        offMapSubtype: state.sourceEvents[event.eventIndex]?.offMapSubtype,
        venueOccurrences:
          state.sourceEvents[event.eventIndex]?.venueOccurrences || [],
        inView: state.isVisible,
      });
    }
    matchedEvents = results.length;
    matchedLandmarks = new Set(results.map(({ landmarkId }) => landmarkId))
      .size;
    results.sort((a, b) => a.distanceFromCenter - b.distanceFromCenter);
    scheduleRotation();
    return { ...discoveryResult, matchedEvents, matchedLandmarks, results };
  };

  const setFilters = ({ query: value = "", categories = [] } = {}) => {
    const model = createEventDiscoveryModel(
      states.map((state) => ({
        ...state.landmark,
        events: state.sourceEvents,
      })),
      { categoryOf: eventCategory },
    );
    return applyDiscoveryResult(model.filter({ query: value, categories }));
  };

  const setSearchQuery = (value = "") => setFilters({ query: value });

  const selectResult = ({ landmarkId, eventIndex }, { notify = true } = {}) => {
    const state = findState(landmarkId);
    if (!state || !state.events[eventIndex]) return false;
    state.activeIndex = eventIndex;
    state.lastRotationAt = performance.now();
    renderState(state);
    schedulePositionUpdate();
    scheduleRotation();
    if (notify) {
      onSelect?.({
        landmark: state.landmark,
        selectedEventIndex: eventIndex,
        sourceEvents: state.sourceEvents,
        trigger: state.card,
      });
    }
    return true;
  };

  const categories = () =>
    [
      ...new Set(
        states.flatMap((state) => state.events.map((event) => event.category)),
      ),
    ].sort();

  const destroy = () => {
    if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    if (positionFallback !== null) clearTimeout(positionFallback);
    if (rotationTimer !== null) clearTimeout(rotationTimer);
    for (const eventName of mapEvents)
      map.off?.(eventName, schedulePositionUpdate);
    window.removeEventListener("resize", schedulePositionUpdate);
    resizeObserver?.disconnect();
    for (const state of states) state.root.remove();
    states.length = 0;
  };

  return {
    add,
    applyDiscoveryResult,
    categories,
    destroy,
    reconcile,
    remove,
    selectResult,
    setFilters,
    setNavigationTarget,
    setSearchQuery,
    upsert,
  };
}
