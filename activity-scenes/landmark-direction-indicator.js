import "@phosphor-icons/web/bold";
import { focusMapLocation, LANDMARK_PILL_MIN_ZOOM, zoomMapToMinimum } from "./map-location-focus.js";

const SCREEN_MARGIN = 24;
const TOP_CLEARANCE = 104;
const isInViewport = (point) => point.x >= 0 && point.x <= window.innerWidth && point.y >= 0 && point.y <= window.innerHeight;

export function createLandmarkDirectionIndicator(map, { onVisible } = {}) {
  const root = document.createElement("button");
  root.type = "button";
  root.className = "landmark-direction-indicator";
  root.hidden = true;
  root.innerHTML = '<i class="ph-bold ph-arrow-up landmark-direction-indicator__arrow" aria-hidden="true"></i><span class="landmark-direction-indicator__label"></span>';
  document.body.appendChild(root);
  const label = root.querySelector(".landmark-direction-indicator__label");

  let updateFrame = null;
  let target = null;
  let fittedLabelWidth = 0;
  let fittedLabelText = "";

  const fitLabel = () => {
    const availableWidth = Math.round(label.clientWidth);
    if (!availableWidth || (availableWidth === fittedLabelWidth && label.textContent === fittedLabelText)) return;
    label.style.fontSize = "13px";
    label.style.letterSpacing = "";
    label.classList.remove("is-multiline");
    let fontSize = 13;
    while (label.scrollWidth > label.clientWidth && fontSize > 10) {
      fontSize -= 0.25;
      label.style.fontSize = `${fontSize}px`;
    }
    if (label.scrollWidth > label.clientWidth) {
      label.classList.add("is-multiline");
      fontSize = 10;
      label.style.fontSize = `${fontSize}px`;
      while (label.scrollHeight > label.clientHeight && fontSize > 8) {
        fontSize -= 0.25;
        label.style.fontSize = `${fontSize}px`;
      }
    }
    fittedLabelWidth = availableWidth;
    fittedLabelText = label.textContent;
  };

  const clearTarget = () => {
    target = null;
    root.hidden = true;
    label.textContent = "";
    root.setAttribute("aria-label", "");
  };

  const update = () => {
    if (!target) {
      root.hidden = true;
      return;
    }
    document.body.dataset.landmarkDirectionUpdateCount = String(
      Number(document.body.dataset.landmarkDirectionUpdateCount || 0) + 1,
    );
    const point = map.project([target.anchor.lng, target.anchor.lat]);
    const currentZoom = Number(map.getZoom?.());
    const isZoomReady = !Number.isFinite(currentZoom) || currentZoom >= LANDMARK_PILL_MIN_ZOOM;
    if (isInViewport(point) && isZoomReady) {
      const visibleTarget = target;
      clearTarget();
      onVisible?.(visibleTarget);
      return;
    }
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    root.hidden = false;
    fitLabel();
    const bounds = root.getBoundingClientRect();
    const horizontalTravel = Math.max(0, center.x - SCREEN_MARGIN - bounds.width / 2);
    const verticalMargin = dy < 0 ? TOP_CLEARANCE : SCREEN_MARGIN;
    const verticalTravel = Math.max(0, center.y - verticalMargin - bounds.height / 2);
    const scale = Math.min(
      horizontalTravel / Math.max(Math.abs(dx), 0.001),
      verticalTravel / Math.max(Math.abs(dy), 0.001),
    );
    root.style.left = `${Math.round(center.x + dx * scale)}px`;
    root.style.top = `${Math.round(center.y + dy * scale)}px`;
    root.style.setProperty("--direction-angle", `${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg`);
  };

  const scheduleUpdate = () => {
    if (!target || updateFrame !== null) return;
    updateFrame = requestAnimationFrame(() => {
      updateFrame = null;
      update();
    });
  };
  const mapEvents = ["move", "zoom", "resize"];
  for (const eventName of mapEvents) map.on?.(eventName, scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);

  root.addEventListener("click", () => {
    if (!target) return;
    focusMapLocation(map, target.anchor);
  });

  return {
    destroy() {
      if (updateFrame !== null) cancelAnimationFrame(updateFrame);
      for (const eventName of mapEvents) map.off?.(eventName, scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      root.remove();
    },
    setTarget(landmark) {
      target = landmark?.anchor ? landmark : null;
      fittedLabelText = "";
      label.textContent = target?.label || "";
      root.setAttribute("aria-label", target ? `Show ${target.label} on map` : "");
      if (target) zoomMapToMinimum(map);
      update();
    },
    update,
  };
}
