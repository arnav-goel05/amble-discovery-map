export function googleMapsRouteUrls(stops, travelMode = "walking") {
  if (!Array.isArray(stops) || stops.length < 1) return [];
  const validStops = stops.filter((stop) => Number.isFinite(Number(stop?.latitude)) && Number(stop.latitude) >= -90 && Number(stop.latitude) <= 90
    && Number.isFinite(Number(stop?.longitude)) && Number(stop.longitude) >= -180 && Number(stop.longitude) <= 180);
  if (!validStops.length) return [];
  stops = validStops.map((stop) => ({ ...stop, latitude: Number(stop.latitude), longitude: Number(stop.longitude) }));
  if (travelMode === "transit") {
    return stops.map((stop, index) => {
      const url = new URL("https://www.google.com/maps/dir/");
      url.searchParams.set("api", "1");
      if (index > 0) url.searchParams.set("origin", `${stops[index - 1].latitude},${stops[index - 1].longitude}`);
      url.searchParams.set("destination", `${stop.latitude},${stop.longitude}`);
      url.searchParams.set("travelmode", "transit");
      return url.href;
    });
  }
  const chunks = [];
  let cursor = 0;
  while (cursor < stops.length) {
    const isFirst = cursor === 0;
    const destinations = stops.slice(cursor, cursor + 4);
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    if (!isFirst) url.searchParams.set("origin", `${stops[cursor - 1].latitude},${stops[cursor - 1].longitude}`);
    url.searchParams.set("destination", `${destinations.at(-1).latitude},${destinations.at(-1).longitude}`);
    const waypoints = destinations.slice(0, -1);
    if (waypoints.length) url.searchParams.set("waypoints", waypoints.map((stop) => `${stop.latitude},${stop.longitude}`).join("|"));
    url.searchParams.set("travelmode", travelMode);
    chunks.push(url.href);
    cursor += destinations.length;
  }
  return chunks;
}
