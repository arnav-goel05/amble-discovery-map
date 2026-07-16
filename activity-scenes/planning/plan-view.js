import { googleMapsRouteUrls } from "../plan-routes.js";
import { createPlanState, planWarnings } from "./plan-model.js";

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function iconButton(className, label, iconName) {
  const button = element("button", className);
  button.type = "button";
  button.title = label;
  button.ariaLabel = label;
  const icon = element("i", `ph-bold ph-${iconName}`);
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  return button;
}

function routeDistanceKm(points) {
  const radians = (value) => value * Math.PI / 180;
  let meters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1], right = points[index];
    const dLat = radians(right.latitude - left.latitude), dLng = radians(right.longitude - left.longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLng / 2) ** 2;
    meters += 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return meters / 1000;
}

export function renderPlanPreview({ container, stops, currentLocation, travelMode }) {
  container.replaceChildren();
  container.hidden = stops.length === 0;
  if (!stops.length) return;
  const distance = routeDistanceKm([...(currentLocation ? [currentLocation] : []), ...stops]);
  const speeds = { walking: 4.5, bicycling: 14, driving: 22, transit: 18 };
  const minutes = distance ? Math.max(1, Math.round(distance / speeds[travelMode] * 60)) : 0;
  const summary = element("div", "plan-builder__preview-summary");
  summary.append(
    element("strong", "", `${stops.length} stop${stops.length === 1 ? "" : "s"}`),
    element("span", "", distance ? `≈ ${distance.toFixed(1)} km · ${minutes} min travel` : "Add stops for a route estimate"),
  );
  const warnings = planWarnings(createPlanState({ stops }));
  const warningList = element("ul", "plan-builder__preview-warnings");
  for (const warning of warnings) warningList.append(element("li", "", warning));
  container.append(summary);
  if (warningList.children.length) container.append(warningList);
}

export function renderPlanRoutes({ container, stops, currentLocation, travelMode }) {
  container.replaceChildren();
  const routeUrls = googleMapsRouteUrls(stops, travelMode);
  if (!routeUrls.length) {
    const button = element("button", "plan-builder__maps-link plan-builder__maps-link--disabled");
    button.type = "button";
    button.disabled = true;
    const glyph = element("i", "ph-bold ph-map-trifold");
    glyph.setAttribute("aria-hidden", "true");
    button.append(glyph, element("span", "", "Open route in Google Maps"));
    container.append(button);
    return;
  }
  routeUrls.forEach((href, index, links) => {
    const url = new URL(href);
    if (index === 0 && currentLocation) url.searchParams.set("origin", `${currentLocation.latitude},${currentLocation.longitude}`);
    const link = element("a", "plan-builder__maps-link");
    const glyph = element("i", "ph-bold ph-map-trifold");
    glyph.setAttribute("aria-hidden", "true");
    link.append(glyph, element("span", "", links.length > 1 ? `Open Google Maps route ${index + 1}/${links.length}` : "Open route in Google Maps"));
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    container.append(link);
  });
}
