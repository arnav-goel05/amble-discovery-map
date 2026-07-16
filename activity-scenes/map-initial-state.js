export function resetSavedMapView({
  location = window.location,
  history = window.history,
  preserve = false,
} = {}) {
  if (preserve || !location.hash) return false;
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return true;
}
