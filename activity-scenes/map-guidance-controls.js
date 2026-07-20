import "@phosphor-icons/web/bold";

function guidanceButton(label, iconName, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-guidance__button";
  button.ariaLabel = label;
  button.title = label;
  const icon = document.createElement("i");
  icon.className = `ph-bold ph-${iconName}`;
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);
  button.addEventListener("click", action);
  return button;
}

export function addMapGuidanceControls(map, { onShowTour, dispatch } = {}) {
  const existing = document.getElementById("map-guidance");
  if (existing) return { finalize() {} };

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
  for (const [label, href] of [
    ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
    ["CARTO", "https://carto.com/attributions"],
    ["SLA", "https://www.sla.gov.sg/"],
    ["OneMap", "https://www.onemap.gov.sg/legal/termsofuse.html"],
  ]) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = label;
    attribution.append(link);
  }
  const attributionButton = document.createElement("button");
  attributionButton.type = "button";
  attributionButton.className = "map-attribution-button";
  attributionButton.ariaLabel = "Map information and attribution";
  attributionButton.title = "Map information and attribution";
  attributionButton.setAttribute("aria-controls", attribution.id);
  attributionButton.setAttribute("aria-expanded", "false");
  const attributionIcon = document.createElement("i");
  attributionIcon.className = "ph-bold ph-info";
  attributionIcon.setAttribute("aria-hidden", "true");
  attributionButton.append(attributionIcon);
  const setAttributionOpen = (open) => {
    attribution.hidden = !open;
    attributionButton.setAttribute("aria-expanded", String(open));
  };
  attributionButton.addEventListener("click", () => {
    setAttributionOpen(attribution.hidden);
  });
  const invoke = (actionId, fallback) => () => {
    if (typeof dispatch === "function") return dispatch(actionId, {});
    return fallback?.();
  };
  const showTourButton = guidanceButton(
    "Show feature tour",
    "question",
    invoke("tour.start", onShowTour),
  );
  showTourButton.classList.add("map-guidance__button--tour");
  root.append(
    guidanceButton(
      "Zoom in",
      "plus",
      invoke("map.zoomin", () => map?.zoomIn?.({ duration: 300 })),
    ),
    guidanceButton(
      "Zoom out",
      "minus",
      invoke("map.zoomout", () => map?.zoomOut?.({ duration: 300 })),
    ),
    guidanceButton(
      "Rotate map",
      "arrow-clockwise",
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
    if (!root.contains(event.target)) setAttributionOpen(false);
  };
  const closeAttributionOnEscape = (event) => {
    if (event.key !== "Escape" || attribution.hidden) return;
    setAttributionOpen(false);
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

  return {
    id: "map-guidance",
    finalize: () => {
      document.removeEventListener("pointerdown", closeAttributionOnPointerDown);
      document.removeEventListener("keydown", closeAttributionOnEscape);
      root.remove();
    },
  };
}
