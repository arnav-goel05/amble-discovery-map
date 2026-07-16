export const LOCATION_FOCUS_ZOOM = 17;
export const LANDMARK_PILL_MIN_ZOOM = 16.65;

export function zoomMapToMinimum(map, { duration = 700, zoom = LANDMARK_PILL_MIN_ZOOM } = {}) {
  const currentZoom = Number(map?.getZoom?.());
  if (!map?.easeTo || !Number.isFinite(currentZoom) || currentZoom >= zoom) return false;
  map.easeTo({ zoom, duration });
  return true;
}

export function focusMapLocation(map, { latitude, longitude, lat, lng } = {}, { duration = 700, zoom = LOCATION_FOCUS_ZOOM } = {}) {
  const targetLatitude = Number.isFinite(latitude) ? latitude : lat;
  const targetLongitude = Number.isFinite(longitude) ? longitude : lng;
  if (!map?.easeTo || !Number.isFinite(targetLatitude) || !Number.isFinite(targetLongitude)) return false;
  const currentZoom = Number(map.getZoom?.());
  map.easeTo({
    center: [targetLongitude, targetLatitude],
    zoom: Number.isFinite(currentZoom) ? Math.max(currentZoom, zoom) : zoom,
    duration,
  });
  return true;
}
