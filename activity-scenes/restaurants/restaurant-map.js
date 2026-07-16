export const RESTAURANT_SOURCE_ID = "viewport-restaurants";
const CLUSTER_LAYER = "viewport-restaurant-clusters";
const CLUSTER_COUNT_LAYER = "viewport-restaurant-cluster-count";
const POINT_LAYER = "viewport-restaurant-points";
const SELECTED_LAYER = "viewport-restaurant-selected";
const EARTH_RADIUS_METERS = 6_371_008.8;
const SEARCH_SCREEN_INSET = 0.82;

const emptyCollection = () => ({ type: "FeatureCollection", features: [] });

function restaurantFeature(restaurant) {
  return {
    type: "Feature",
    id: restaurant.id,
    properties: { id: restaurant.id, name: restaurant.name, category: restaurant.category },
    geometry: { type: "Point", coordinates: [restaurant.longitude, restaurant.latitude] },
  };
}

function distanceMeters(left, right) {
  const radians = (value) => value * Math.PI / 180;
  const latitudeDelta = radians(right.lat - left.lat);
  const longitudeDelta = radians(right.lng - left.lng);
  const latitude1 = radians(left.lat);
  const latitude2 = radians(right.lat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function restaurantSearchArea(map) {
  const center = map.getCenter();
  const centerPoint = map.project(center);
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || map.getContainer().clientWidth;
  const height = canvas.clientHeight || map.getContainer().clientHeight;
  const pixelRadius = Math.max(1, Math.min(
    centerPoint.x,
    width - centerPoint.x,
    centerPoint.y,
    height - centerPoint.y,
  ) * SEARCH_SCREEN_INSET);
  const edgePoints = [
    [centerPoint.x - pixelRadius, centerPoint.y],
    [centerPoint.x + pixelRadius, centerPoint.y],
    [centerPoint.x, centerPoint.y - pixelRadius],
    [centerPoint.x, centerPoint.y + pixelRadius],
  ].map((point) => map.unproject(point));
  const radiusMeters = Math.min(...edgePoints.map((point) => distanceMeters(center, point)));
  const latitudeDelta = radiusMeters / EARTH_RADIUS_METERS * 180 / Math.PI;
  const longitudeDelta = latitudeDelta / Math.max(0.01, Math.cos(center.lat * Math.PI / 180));
  const bbox = [
    center.lat - latitudeDelta,
    center.lng - longitudeDelta,
    center.lat + latitudeDelta,
    center.lng + longitudeDelta,
  ].map((value) => value.toFixed(6)).join(",");

  return {
    bbox,
    center: { latitude: center.lat, longitude: center.lng },
    radiusMeters,
    contains(restaurant) {
      const latitude = Number(restaurant.latitude);
      const longitude = Number(restaurant.longitude);
      return Number.isFinite(latitude) && Number.isFinite(longitude)
        && distanceMeters(center, { lat: latitude, lng: longitude }) <= radiusMeters;
    },
  };
}

export function createRestaurantMap(map) {
  if (!map.getSource(RESTAURANT_SOURCE_ID)) map.addSource(RESTAURANT_SOURCE_ID, { type: "geojson", data: emptyCollection(), cluster: true, clusterMaxZoom: 17, clusterRadius: 44 });
  if (!map.getLayer(CLUSTER_LAYER)) map.addLayer({
    id: CLUSTER_LAYER, type: "circle", source: RESTAURANT_SOURCE_ID, filter: ["has", "point_count"],
    paint: { "circle-color": "#172033", "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 22], "circle-stroke-color": "#fff", "circle-stroke-width": 2.5, "circle-opacity": 0.94 },
  });
  if (!map.getLayer(CLUSTER_COUNT_LAYER)) map.addLayer({
    id: CLUSTER_COUNT_LAYER, type: "symbol", source: RESTAURANT_SOURCE_ID, filter: ["has", "point_count"],
    layout: { "text-field": "{point_count_abbreviated}", "text-size": 11 }, paint: { "text-color": "#fff" },
  });
  if (!map.getLayer(POINT_LAYER)) map.addLayer({
    id: POINT_LAYER, type: "circle", source: RESTAURANT_SOURCE_ID, filter: ["!", ["has", "point_count"]],
    paint: { "circle-color": "#172033", "circle-radius": 6, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });
  if (!map.getLayer(SELECTED_LAYER)) map.addLayer({
    id: SELECTED_LAYER, type: "circle", source: RESTAURANT_SOURCE_ID, filter: ["==", ["get", "id"], ""],
    paint: { "circle-color": "#087f84", "circle-radius": 10, "circle-stroke-color": "#fff", "circle-stroke-width": 4 },
  });

  const setRestaurants = (restaurants) => map.getSource(RESTAURANT_SOURCE_ID)?.setData({
    type: "FeatureCollection",
    features: restaurants.map(restaurantFeature),
  });
  const select = (id) => {
    if (map.getSource(RESTAURANT_SOURCE_ID) && map.getLayer(SELECTED_LAYER)) map.setFilter(SELECTED_LAYER, ["==", ["get", "id"], id || ""]);
  };
  const clear = () => { select(null); setRestaurants([]); };
  const destroy = () => {
    if (!map.getStyle?.()) return;
    for (const layer of [SELECTED_LAYER, POINT_LAYER, CLUSTER_COUNT_LAYER, CLUSTER_LAYER]) if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(RESTAURANT_SOURCE_ID)) map.removeSource(RESTAURANT_SOURCE_ID);
  };
  return { setRestaurants, select, clear, destroy };
}
