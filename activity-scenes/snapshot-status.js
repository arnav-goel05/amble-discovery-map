function formatChecked(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "last checked time unavailable";
  return `last checked ${new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}`;
}

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
  const update = ({ state, fetchedAt } = {}) => {
    root.dataset.state = state || "fresh";
    root.hidden = state === "fresh" || !state;
    if (state === "stale") message.textContent = `Potentially outdated · ${formatChecked(fetchedAt)}`;
    else if (state === "unavailable") message.textContent = "Event information unavailable. Please try again later.";
    else message.textContent = "";
  };
  const api = { root, update, destroy: () => root.remove() };
  root.__snapshotStatus = api;
  return api;
}
