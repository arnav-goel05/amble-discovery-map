import "@phosphor-icons/web/bold";
import {
  announceOverlayClosed,
  announceOverlayOpen,
  closeWhenAnotherOverlayOpens,
} from "./overlay-coordinator.js";
import { focusMapLocation } from "./map-location-focus.js";
import {
  addPlanStop,
  createPlanningCandidateState,
  createPlanState,
  movePlanStop,
  planStopKey,
  removePlanStop,
} from "./planning/plan-model.js";
import {
  element,
  iconButton,
  renderPlanPreview,
  renderPlanRoutes,
} from "./planning/plan-view.js";

export { googleMapsRouteUrls } from "./plan-routes.js";

export function addPlanBuilder({
  map,
  geolocation = globalThis.navigator?.geolocation,
  locationController = null,
  gameCandidates = [],
} = {}) {
  const existingButton = document.getElementById("plan-builder-button");
  if (existingButton)
    return existingButton.__planBuilderController || { finalize() {} };
  const button = element("button", "plan-builder-button");
  button.id = "plan-builder-button";
  button.type = "button";
  button.ariaLabel = "Plan, 0 stops";
  button.title = "Plan, 0 stops";
  button.setAttribute("aria-controls", "plan-builder");
  button.setAttribute("aria-expanded", "false");
  const buttonIcon = element("i", "ph-bold ph-list-checks");
  buttonIcon.setAttribute("aria-hidden", "true");
  button.appendChild(buttonIcon);

  const panel = element("aside", "plan-builder");
  panel.id = "plan-builder";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "plan-builder-title");
  const header = element("header", "plan-builder__header");
  const headingGroup = element("div", "plan-builder__heading-group");
  const kicker = element("div", "plan-builder__kicker", "Your itinerary");
  const heading = element("h2", "plan-builder__heading", "Make a plan");
  heading.id = "plan-builder-title";
  headingGroup.append(kicker, heading);
  const close = iconButton("plan-builder__close", "Close plan", "x");
  header.append(headingGroup, close);
  const modeLabel = element("label", "plan-builder__label");
  const modeLabelText = element(
    "span",
    "plan-builder__field-label",
    "Travel mode",
  );
  const mode = element("select", "plan-builder__mode");
  for (const value of ["walking", "driving", "bicycling", "transit"]) {
    const option = element(
      "option",
      "",
      value[0].toUpperCase() + value.slice(1),
    );
    option.value = value;
    mode.appendChild(option);
  }
  modeLabel.append(modeLabelText, mode);
  const status = element(
    "p",
    "plan-builder__status",
    "Add an event or restaurant to begin.",
  );
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const preview = element("section", "plan-builder__preview");
  preview.setAttribute("aria-label", "Route preview");
  const list = element("ol", "plan-builder__stops");
  const actions = element("div", "plan-builder__actions");
  const maps = element("div", "plan-builder__route-links");
  actions.append(maps);
  panel.append(header, modeLabel, preview, status, list, actions);
  document.body.append(button, panel);

  let planState = createPlanState();
  let stops = planState.stops;
  let dragState = null;
  let currentLocation = null;
  let locationState = "idle";
  let currentGames = Array.isArray(gameCandidates)
    ? structuredClone(gameCandidates)
    : [];
  let candidateRevision = 0;
  let candidateState = Object.freeze({
    revision: candidateRevision,
    ...createPlanningCandidateState(planState, { games: currentGames }),
  });
  const candidateListeners = new Set();

  const publishCandidateState = () => {
    candidateRevision += 1;
    candidateState = Object.freeze({
      revision: candidateRevision,
      ...createPlanningCandidateState(planState, { games: currentGames }),
    });
    for (const listener of candidateListeners) listener(candidateState);
    window.dispatchEvent(
      new CustomEvent("whats-here:planning-candidates-changed", {
        detail: candidateState,
      }),
    );
  };

  const renderPreview = () => {
    renderPlanPreview({
      container: preview,
      stops,
      currentLocation,
      travelMode: mode.value,
    });
  };

  const clearDragVisuals = () => {
    if (!dragState) return;
    if (dragState.captureTarget?.hasPointerCapture?.(dragState.pointerId)) {
      dragState.captureTarget.releasePointerCapture(dragState.pointerId);
    }
    dragState.item.classList.remove("is-dragging");
    dragState.item.style.removeProperty("transform");
    list.classList.remove("is-reordering");
    for (const item of list.children) item.classList.remove("is-drop-target");
    document.removeEventListener("pointermove", moveDrag);
    document.removeEventListener("pointerup", endDrag);
    document.removeEventListener("pointercancel", cancelDrag);
  };

  const finishDrag = (commit) => {
    if (!dragState) return;
    const { startIndex, targetIndex, moved, stop } = dragState;
    clearDragVisuals();
    dragState = null;
    if (!commit || !moved || startIndex === targetIndex) return;
    planState = movePlanStop(planState, startIndex, targetIndex);
    stops = planState.stops;
    publishCandidateState();
    render();
    status.textContent = `${stop.title} moved to stop ${targetIndex + 1}.`;
  };

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.preventDefault();
    const deltaY = event.clientY - dragState.startY;
    dragState.moved ||= Math.abs(deltaY) > 4;
    if (!dragState.moved) return;
    dragState.item.style.transform = `translateY(${deltaY}px)`;
    const listRect = list.getBoundingClientRect();
    if (event.clientY < listRect.top + 36) list.scrollTop -= 8;
    else if (event.clientY > listRect.bottom - 36) list.scrollTop += 8;
    const scrollDelta = list.scrollTop - dragState.startScrollTop;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    dragState.centers.forEach((center, index) => {
      const distance = Math.abs(event.clientY - (center - scrollDelta));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    dragState.targetIndex = nearestIndex;
    for (const [index, item] of [
      ...list.querySelectorAll(
        ".plan-builder__stop:not(.plan-builder__stop--origin)",
      ),
    ].entries()) {
      item.classList.toggle(
        "is-drop-target",
        index === nearestIndex && item !== dragState.item,
      );
    }
  }

  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    finishDrag(true);
  }

  function cancelDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    finishDrag(false);
  }

  const beginDrag = (event, item, index, stop) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    dragState = {
      centers: [
        ...list.querySelectorAll(
          ".plan-builder__stop:not(.plan-builder__stop--origin)",
        ),
      ].map((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }),
      item,
      captureTarget: event.currentTarget,
      moved: false,
      pointerId: event.pointerId,
      startIndex: index,
      startScrollTop: list.scrollTop,
      startY: event.clientY,
      stop,
      targetIndex: index,
    };
    item.classList.add("is-dragging");
    list.classList.add("is-reordering");
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      /* Synthetic tests and legacy engines may not expose an active pointer. */
    }
    document.addEventListener("pointermove", moveDrag, { passive: false });
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", cancelDrag);
  };

  const setOpen = (open) => {
    const wasOpen = !panel.hidden;
    if (open) announceOverlayOpen("plan-builder");
    else finishDrag(false);
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    document.body.dataset.planBuilderOpen = String(open);
    if (open) close.focus();
    if (open && locationState === "idle" && !locationController)
      requestCurrentLocation();
    if (!open && wasOpen) announceOverlayClosed("plan-builder");
  };

  const renderRoutes = () => {
    renderPlanRoutes({
      container: maps,
      stops,
      currentLocation,
      travelMode: mode.value,
    });
  };

  const showStopOnMap = (stop) => {
    focusMapLocation(map, stop);
  };

  const requestCurrentLocation = () => {
    if (locationState === "locating") return;
    if (locationController) {
      locationState = "locating";
      render();
      void locationController.requestLocation();
      return;
    }
    if (!geolocation?.getCurrentPosition) {
      locationState = "unavailable";
      render();
      return;
    }
    locationState = "locating";
    render();
    geolocation.getCurrentPosition(
      ({ coords }) => {
        if (
          !Number.isFinite(coords?.latitude) ||
          !Number.isFinite(coords?.longitude)
        ) {
          locationState = "unavailable";
          render();
          return;
        }
        currentLocation = {
          id: "current-location",
          type: "location",
          title: "My location",
          place: "Your current position",
          latitude: Number(coords.latitude),
          longitude: Number(coords.longitude),
        };
        locationState = "ready";
        render();
      },
      () => {
        locationState = "unavailable";
        render();
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 },
    );
  };

  const applySharedLocation = (snapshot) => {
    if (snapshot?.coordinates && ["fresh", "stale"].includes(snapshot.status)) {
      currentLocation = {
        id: "current-location",
        type: "location",
        title: "My location",
        place:
          snapshot.status === "stale"
            ? "Your last known position"
            : "Your current position",
        latitude: snapshot.coordinates[1],
        longitude: snapshot.coordinates[0],
      };
      locationState = "ready";
    } else {
      currentLocation = null;
      locationState =
        snapshot?.status === "locating"
          ? "locating"
          : snapshot?.status === "error"
            ? "unavailable"
            : "idle";
    }
    render();
  };
  const unsubscribeLocation =
    locationController?.subscribe?.(applySharedLocation, {
      emitCurrent: false,
    }) || (() => {});

  const renderCurrentLocation = () => {
    const item = element("li", "plan-builder__stop plan-builder__stop--origin");
    const copyNode = element(
      "button",
      "plan-builder__stop-focus plan-builder__stop-copy",
    );
    copyNode.type = "button";
    copyNode.ariaLabel = currentLocation
      ? "Show my location on map"
      : "Use my current location";
    const locationCopy =
      locationState === "ready"
        ? "Starting point · Current position"
        : locationState === "locating"
          ? "Starting point · Finding your position…"
          : locationState === "unavailable"
            ? "Starting point · Select to try again"
            : "Starting point · Current position";
    copyNode.append(
      element("strong", "plan-builder__stop-title", "My location"),
      element("span", "plan-builder__stop-place", locationCopy),
    );
    const icon = element("i", "ph-bold ph-crosshair plan-builder__origin-icon");
    icon.setAttribute("aria-hidden", "true");
    copyNode.onclick = () => {
      if (currentLocation) showStopOnMap(currentLocation);
      else requestCurrentLocation();
    };
    item.append(copyNode, icon);
    list.appendChild(item);
  };

  const render = () => {
    const stopLabel = `${stops.length} stop${stops.length === 1 ? "" : "s"}`;
    button.ariaLabel = `Plan, ${stopLabel}`;
    button.title = `Plan, ${stopLabel}`;
    list.replaceChildren();
    renderCurrentLocation();
    stops.forEach((stop, index) => {
      const item = element("li", "plan-builder__stop");
      item.dataset.planStop = planStopKey(stop);
      const copyNode = element(
        "button",
        "plan-builder__stop-focus plan-builder__stop-copy",
      );
      copyNode.type = "button";
      copyNode.ariaLabel = `Show ${stop.title} on map`;
      copyNode.append(
        element("strong", "plan-builder__stop-title", stop.title),
        element(
          "span",
          "plan-builder__stop-place",
          `${stop.type === "event" ? "Event" : "Food"} · ${stop.place}`,
        ),
      );
      const controls = element("div", "plan-builder__stop-controls");
      const drag = iconButton(
        "plan-builder__drag-handle",
        `Drag ${stop.title} to reorder`,
        "dots-six-vertical",
      );
      const remove = iconButton(
        "plan-builder__stop-button plan-builder__stop-button--remove",
        `Remove ${stop.title}`,
        "x",
      );
      remove.onclick = () => {
        planState = removePlanStop(planState, planStopKey(stop));
        stops = planState.stops;
        publishCandidateState();
        render();
      };
      drag.addEventListener("pointerdown", (event) =>
        beginDrag(event, item, index, stop),
      );
      item.onclick = (event) => {
        if (event.target.closest(".plan-builder__stop-controls")) return;
        showStopOnMap(stop);
      };
      controls.append(drag, remove);
      item.append(copyNode, controls);
      list.appendChild(item);
    });
    status.textContent = stops.length
      ? `${stops.length} stop${stops.length === 1 ? "" : "s"}. Drag stops to reorder.`
      : "Add an event or restaurant to begin.";
    renderRoutes();
    renderPreview();
  };

  const add = (event) => {
    const stop = event.detail;
    const added = addPlanStop(planState, stop);
    if (added.reason === "invalid") return;
    if (added.reason === "duplicate") {
      setOpen(true);
      status.textContent = `${stop.title} is already in your plan.`;
      return;
    }
    if (added.reason === "limit") {
      setOpen(true);
      status.textContent = "A plan can contain at most 20 stops.";
      return;
    }
    planState = added.state;
    stops = planState.stops;
    publishCandidateState();
    render();
    setOpen(true);
    status.textContent = `${stop.title} added. Your Google Maps route is ready below.`;
  };

  const setGameCandidates = (nextGames = []) => {
    const normalized = Array.isArray(nextGames)
      ? structuredClone(nextGames)
      : [];
    const currentPublicGames = createPlanningCandidateState(createPlanState(), {
      games: currentGames,
    }).games;
    const nextPublicGames = createPlanningCandidateState(createPlanState(), {
      games: normalized,
    }).games;
    if (JSON.stringify(nextPublicGames) === JSON.stringify(currentPublicGames))
      return candidateState;
    currentGames = normalized;
    publishCandidateState();
    return candidateState;
  };

  const subscribeCandidateState = (listener, { emitCurrent = true } = {}) => {
    if (typeof listener !== "function")
      throw new TypeError("candidate listener must be a function");
    candidateListeners.add(listener);
    if (emitCurrent) listener(candidateState);
    return () => candidateListeners.delete(listener);
  };

  button.onclick = () => setOpen(panel.hidden);
  close.onclick = () => setOpen(false);
  const stopWatchingOverlays = closeWhenAnotherOverlayOpens(
    "plan-builder",
    () => setOpen(false),
  );
  const onKey = (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("whats-here:add-to-plan", add);
  for (const type of [
    "pointerdown",
    "mousedown",
    "touchstart",
    "wheel",
    "dblclick",
  ])
    panel.addEventListener(type, (event) => event.stopPropagation());
  mode.addEventListener("change", () => {
    renderRoutes();
    renderPreview();
    status.textContent = `${mode.value[0].toUpperCase() + mode.value.slice(1)} route ready in Google Maps.`;
  });
  render();
  if (locationController)
    applySharedLocation(locationController.snapshot({ includeExact: true }));
  document.body.dataset.planBuilder = "mounted";
  const controller = {
    id: "plan-builder",
    getCandidateState: () => candidateState,
    getApprovedCandidates: () =>
      [...candidateState.planStops, ...candidateState.games]
        .filter(
          (candidate) =>
            candidate.areaId &&
            Array.isArray(candidate.coordinates) &&
            candidate.coordinates.length === 2,
        )
        .map((candidate) => ({
          candidateId: candidate.candidateId,
          candidateType: candidate.candidateType,
          sourceSnapshotId:
            document.body.dataset.snapshotId || "in-memory-current",
          areaId: candidate.areaId,
          coordinates: [...candidate.coordinates],
          attributes: {
            name: candidate.title,
            status: candidate.status || candidate.availability || "available",
            ...(candidate.theme ? { theme: candidate.theme } : {}),
          },
          evidenceRefs: ["application-state:plan-builder"],
        })),
    selectCandidate(candidateId) {
      const candidate = [
        ...candidateState.planStops,
        ...candidateState.games,
      ].find((item) => item.candidateId === candidateId);
      if (!candidate) return false;
      if (candidate.candidateType === "plan_stop")
        return this.dispatch("plan.focusstop", { stopId: candidate.stopKey });
      setOpen(true);
      return true;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    setGameCandidates,
    subscribeCandidateState,
    dispatch(actionId, args = {}) {
      if (actionId === "plan.open") {
        setOpen(true);
        return true;
      }
      if (actionId === "plan.close") {
        setOpen(false);
        return true;
      }
      if (actionId === "plan.uselocation") {
        requestCurrentLocation();
        return true;
      }
      if (actionId === "plan.focuslocation") {
        if (!currentLocation) return false;
        showStopOnMap(currentLocation);
        return true;
      }
      if (actionId === "plan.settravelmode") {
        mode.value = args.mode;
        mode.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      if (actionId === "plan.removestop") {
        const previousLength = stops.length;
        planState = removePlanStop(planState, args.stopId);
        stops = planState.stops;
        if (stops.length === previousLength) return false;
        publishCandidateState();
        render();
        return true;
      }
      if (actionId === "plan.reorderstop") {
        const fromIndex = stops.findIndex(
          (stop) => planStopKey(stop) === args.stopId,
        );
        if (fromIndex < 0 || args.toIndex >= stops.length) return false;
        planState = movePlanStop(planState, fromIndex, args.toIndex);
        stops = planState.stops;
        publishCandidateState();
        render();
        return true;
      }
      if (actionId === "plan.focusstop") {
        const stop = stops.find((item) => planStopKey(item) === args.stopId);
        if (!stop) return false;
        showStopOnMap(stop);
        return true;
      }
      if (actionId === "plan.openroute") {
        const links = [...maps.querySelectorAll("a")];
        const link = links[args.segmentIndex || 0] || links[0];
        link?.click();
        return Boolean(link);
      }
      return false;
    },
    finalize() {
      finishDrag(false);
      candidateListeners.clear();
      unsubscribeLocation();
      stopWatchingOverlays();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("whats-here:add-to-plan", add);
      delete button.__planBuilderController;
      panel.remove();
      button.remove();
    },
  };
  button.__planBuilderController = controller;
  return controller;
}
