import "@phosphor-icons/web/bold";

function guidanceButton(label, iconName, capabilityId, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-guidance__button";
  button.ariaLabel = label;
  button.title = label;
  button.dataset.capabilityId = capabilityId;
  const icon = document.createElement("i");
  icon.className = `ph-bold ph-${iconName}`;
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);
  button.addEventListener("click", action);
  return button;
}

export function addMapGuidanceControls(
  map,
  { onShowTour, executeCapability = null, dispatch = null } = {},
) {
  const existing = document.getElementById("map-guidance");
  if (existing) return { finalize() {} };
  const registeredExecutor = executeCapability ?? dispatch;
  const subscribers = new Set();

  const root = document.createElement("aside");
  root.id = "map-guidance";
  root.className = "map-guidance frosted-control-bar";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Map guidance");
  const attribution = document.createElement("section");
  attribution.id = "map-attribution-details";
  attribution.className = "map-attribution-details";
  attribution.hidden = true;
  attribution.setAttribute("aria-label", "Map information and attribution");
  const references = new Map(
    [
      [
        "attribution:openstreetmap",
        "OpenStreetMap",
        "https://www.openstreetmap.org/copyright",
      ],
      ["attribution:carto", "CARTO", "https://carto.com/attributions"],
      ["attribution:sla", "SLA", "https://www.sla.gov.sg/"],
      [
        "attribution:onemap",
        "OneMap",
        "https://www.onemap.gov.sg/legal/termsofuse.html",
      ],
    ].map(([referenceId, label, href]) => [
      referenceId,
      Object.freeze({ referenceId, label, href }),
    ]),
  );
  for (const reference of references.values()) {
    const link = document.createElement("a");
    link.href = reference.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = reference.label;
    link.dataset.capabilityId = "navigation.openattributionreference";
    link.dataset.referenceId = reference.referenceId;
    link.addEventListener("click", (event) => {
      if (typeof registeredExecutor !== "function") return;
      event.preventDefault();
      void registeredExecutor("navigation.openattributionreference", {
        referenceId: reference.referenceId,
      });
    });
    attribution.append(link);
  }
  const attributionButton = document.createElement("button");
  attributionButton.type = "button";
  attributionButton.className = "map-attribution-button";
  attributionButton.ariaLabel = "Map information and attribution";
  attributionButton.title = "Map information and attribution";
  attributionButton.dataset.capabilityId = "navigation.openattribution";
  attributionButton.setAttribute("aria-controls", attribution.id);
  attributionButton.setAttribute("aria-expanded", "false");
  const attributionIcon = document.createElement("i");
  attributionIcon.className = "ph-bold ph-info";
  attributionIcon.setAttribute("aria-hidden", "true");
  attributionButton.append(attributionIcon);
  const setAttributionOpen = (open) => {
    const nextOpen = open === true;
    if (attribution.hidden === !nextOpen) return false;
    attribution.hidden = !nextOpen;
    attributionButton.dataset.capabilityId = nextOpen
      ? "navigation.closeattribution"
      : "navigation.openattribution";
    attributionButton.setAttribute("aria-expanded", String(nextOpen));
    const snapshot = Object.freeze({
      attributionOpen: nextOpen,
      attributionReferenceIds: Object.freeze([...references.keys()]),
    });
    for (const subscriber of subscribers) subscriber(snapshot);
    return true;
  };
  attributionButton.addEventListener("click", () => {
    const capabilityId = attribution.hidden
      ? "navigation.openattribution"
      : "navigation.closeattribution";
    if (typeof registeredExecutor === "function")
      void registeredExecutor(capabilityId, {});
    else setAttributionOpen(attribution.hidden);
  });
  const invoke = (actionId, fallback) => () => {
    if (typeof registeredExecutor === "function")
      return registeredExecutor(actionId, {});
    return fallback?.();
  };
  const showTourButton = guidanceButton(
    "Show feature tour",
    "question",
    "tour.start",
    invoke("tour.start", onShowTour),
  );
  showTourButton.classList.add("map-guidance__button--tour");
  root.append(
    guidanceButton(
      "Zoom in",
      "plus",
      "map.zoomin",
      invoke("map.zoomin", () => map?.zoomIn?.({ duration: 300 })),
    ),
    guidanceButton(
      "Zoom out",
      "minus",
      "map.zoomout",
      invoke("map.zoomout", () => map?.zoomOut?.({ duration: 300 })),
    ),
    guidanceButton(
      "Rotate map",
      "arrow-clockwise",
      "map.rotate",
      invoke("map.rotate", () =>
        map?.easeTo?.({
          bearing: (map.getBearing?.() || 0) + 45,
          duration: 450,
        }),
      ),
    ),
    showTourButton,
    attributionButton,
    attribution,
  );
  document.body.appendChild(root);

  const closeAttributionOnPointerDown = (event) => {
    if (root.contains(event.target) || attribution.hidden) return;
    if (typeof registeredExecutor === "function")
      void registeredExecutor("navigation.closeattribution", {});
    else setAttributionOpen(false);
  };
  const closeAttributionOnEscape = (event) => {
    if (event.key !== "Escape" || attribution.hidden) return;
    if (typeof registeredExecutor === "function")
      void registeredExecutor("navigation.closeattribution", {});
    else setAttributionOpen(false);
    attributionButton.focus();
  };
  document.addEventListener("pointerdown", closeAttributionOnPointerDown);
  document.addEventListener("keydown", closeAttributionOnEscape);

  for (const type of [
    "pointerdown",
    "mousedown",
    "touchstart",
    "wheel",
    "dblclick",
  ]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }

  const snapshot = () =>
    Object.freeze({
      attributionOpen: !attribution.hidden,
      attributionReferenceIds: Object.freeze([...references.keys()]),
    });

  return {
    id: "map-guidance",
    dispatch(capabilityId, args = {}) {
      if (capabilityId === "navigation.openattribution")
        return setAttributionOpen(true);
      if (capabilityId === "navigation.closeattribution")
        return setAttributionOpen(false);
      if (capabilityId !== "navigation.openattributionreference") return false;
      const reference = references.get(args.referenceId);
      if (!reference || attribution.hidden) return false;
      window.open(reference.href, "_blank", "noopener,noreferrer");
      return true;
    },
    finalize: () => {
      document.removeEventListener(
        "pointerdown",
        closeAttributionOnPointerDown,
      );
      document.removeEventListener("keydown", closeAttributionOnEscape);
      subscribers.clear();
      root.remove();
    },
    snapshot,
    subscribe(subscriber, { emitCurrent = false } = {}) {
      if (typeof subscriber !== "function")
        throw new TypeError("Map guidance subscriber must be a function");
      subscribers.add(subscriber);
      if (emitCurrent) subscriber(snapshot());
      return () => subscribers.delete(subscriber);
    },
  };
}
