export function createLocationContextControls({
  locationController,
  transitLayerManager,
} = {}) {
  const root = document.createElement("div");
  root.className = "location-context-controls";
  root.setAttribute("aria-label", "Location and MRT context");
  const locate = document.createElement("button");
  locate.type = "button";
  locate.dataset.testid = "show-my-location";
  locate.textContent = "Show my location";
  const transit = document.createElement("button");
  transit.type = "button";
  transit.dataset.testid = "toggle-mrt-context";
  transit.textContent = "Hide MRT";
  transit.setAttribute("aria-pressed", "true");
  const status = document.createElement("span");
  status.dataset.testid = "location-context-status";
  status.setAttribute("aria-live", "polite");
  root.append(locate, transit, status);
  document.body.append(root);
  let transitVisible = true;
  const unsubscribe =
    locationController?.subscribe?.((snapshot) => {
      status.textContent =
        {
          locating: "Finding your location…",
          fresh: "Your location is shown",
          stale: "Last known location shown",
          error:
            snapshot.permission === "denied"
              ? "Location permission denied"
              : "Location unavailable",
          idle: "Location not requested",
        }[snapshot.status] || "Location unavailable";
    }) || (() => {});
  locate.addEventListener("click", async () => {
    const snapshot = locationController?.snapshot?.({ includeExact: true });
    if (snapshot?.coordinates) locationController.model?.refresh?.();
    else await locationController?.requestLocation?.();
  });
  transit.addEventListener("click", () => {
    transitVisible = !transitVisible;
    transitLayerManager?.setVisible?.(transitVisible);
    transit.setAttribute("aria-pressed", String(transitVisible));
    transit.textContent = transitVisible ? "Hide MRT" : "Show MRT";
  });
  return Object.freeze({
    id: "location-context-controls",
    finalize() {
      unsubscribe();
      root.remove();
    },
  });
}
