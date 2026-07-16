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

export function addMapGuidanceControls(map, { onShowTour } = {}) {
  const existing = document.getElementById("map-guidance");
  if (existing) return { finalize() {} };

  const root = document.createElement("aside");
  root.id = "map-guidance";
  root.className = "map-guidance";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Map guidance");
  root.append(
    guidanceButton("Zoom in", "plus", () => map?.zoomIn?.({ duration: 300 })),
    guidanceButton("Zoom out", "minus", () => map?.zoomOut?.({ duration: 300 })),
    guidanceButton("Rotate map", "arrow-clockwise", () => map?.easeTo?.({ bearing: (map.getBearing?.() || 0) + 45, duration: 450 })),
    guidanceButton("Show feature tour", "question", () => onShowTour?.()),
  );
  document.body.appendChild(root);

  for (const type of ["pointerdown", "mousedown", "touchstart", "wheel", "dblclick"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }

  return { id: "map-guidance", finalize: () => root.remove() };
}
