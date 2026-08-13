export function createSnapshotStatus() {
  const existing = document.getElementById("snapshot-status");
  if (existing) return existing.__snapshotStatus;
  const root = document.createElement("div");
  root.id = "snapshot-status";
  root.className = "snapshot-freshness";
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  const message = document.createElement("span");
  message.id = "snapshot-freshness";
  root.appendChild(message);
  document.body.appendChild(root);
  const update = ({ state } = {}) => {
    root.dataset.state = state || "fresh";
    root.hidden = state !== "unavailable";
    if (state === "unavailable") message.textContent = "Event information unavailable. Please try again later.";
    else message.textContent = "";
  };
  const api = { root, update, destroy: () => root.remove() };
  root.__snapshotStatus = api;
  return api;
}
