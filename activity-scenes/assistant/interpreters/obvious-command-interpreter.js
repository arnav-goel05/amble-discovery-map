const MAX_TEXT_LENGTH = 500;

function normalize(value) {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function validRevision(value) {
  return Number.isInteger(value) && value >= 0;
}

const proposal = (family, capabilityId, argumentsValue = {}) =>
  Object.freeze({
    family,
    capabilityId,
    arguments: Object.freeze(argumentsValue),
  });

export function interpretObviousCommand({
  text,
  baseContextRevision = 0,
  catalogRevision = null,
} = {}) {
  const normalized = normalize(text);
  if (!normalized) return null;

  if (/^(?:please\s+)?zoom in(?:\s+please)?$/.test(normalized))
    return proposal("map", "map.zoomin");

  if (/^(?:please\s+)?zoom out(?:\s+please)?$/.test(normalized))
    return proposal("map", "map.zoomout");

  const pan = normalized.match(
    /^(?:please\s+)?pan(?:\s+the\s+map)?\s+(up|down|left|right)(?:\s+(?:a\s+)?(?:little|bit))?(?:\s+please)?$/,
  );
  if (pan) return proposal("map", "map.pan", { direction: pan[1], amount: 1 });

  if (
    /^(?:please\s+)?(?:rotate|turn)(?:\s+the\s+map)?(?:\s+(?:back\s+)?north)?(?:\s+please)?$/.test(
      normalized,
    )
  )
    return proposal("map", "map.rotate");

  if (
    /^(?:please\s+)?(?:reset|restore)(?:\s+the)?\s+map(?:\s+view)?(?:\s+please)?$/.test(
      normalized,
    )
  )
    return proposal("map", "map.resetview");

  const mrtVisibility = normalized.match(
    /^(?:please\s+)?(show|hide)(?:\s+the)?\s+mrt\s+(lines?|stations?)(?:\s+please)?$/,
  );
  if (mrtVisibility)
    return proposal("map", "map.setlayervisibility", {
      layer: mrtVisibility[2].startsWith("line") ? "mrtLines" : "mrtStations",
      visible: mrtVisibility[1] === "show",
    });

  const layerVisibility = normalized.match(
    /^(?:please\s+)?(show|hide)(?:\s+the)?\s+(recommendations?|(?:my\s+)?location)(?:\s+please)?$/,
  );
  if (layerVisibility)
    return proposal("map", "map.setlayervisibility", {
      layer: layerVisibility[2].startsWith("recommendation")
        ? "recommendations"
        : "location",
      visible: layerVisibility[1] === "show",
    });

  if (
    /^(?:please\s+)?start(?:\s+the)?\s+(?:tour|tutorial|walkthrough)$/.test(
      normalized,
    )
  )
    return proposal("tour", "tour.start");
  if (/^(?:please\s+)?previous\s+(?:tour\s+)?step$/.test(normalized))
    return proposal("tour", "tour.previous");
  if (/^(?:please\s+)?next\s+(?:tour\s+)?step$/.test(normalized))
    return proposal("tour", "tour.next");
  if (
    /^(?:please\s+)?(?:finish|skip|end)(?:\s+the)?\s+(?:tour|tutorial|walkthrough)$/.test(
      normalized,
    )
  )
    return proposal("tour", "tour.finish");

  if (/^(?:please\s+)?clear(?:\s+all)?\s+event\s+filters?$/.test(normalized))
    return proposal("event", "event.clearfilters");
  if (/^(?:please\s+)?previous\s+event$/.test(normalized))
    return proposal("event", "event.previousevent");
  if (/^(?:please\s+)?next\s+event$/.test(normalized))
    return proposal("event", "event.nextevent");
  if (/^(?:please\s+)?close(?:\s+the)?\s+event\s+details?$/.test(normalized))
    return proposal("event", "event.closedetail");

  if (
    /^(?:please\s+)?clear(?:\s+all)?\s+restaurant\s+filters?$/.test(normalized)
  )
    return proposal("restaurant", "restaurant.clearfilters");
  if (
    /^(?:please\s+)?close(?:\s+the)?\s+restaurant\s+results?$/.test(normalized)
  )
    return proposal("restaurant", "restaurant.closeresults");
  if (
    /^(?:please\s+)?close(?:\s+the)?\s+restaurant\s+details?$/.test(normalized)
  )
    return proposal("restaurant", "restaurant.closedetail");

  if (
    /^(?:please\s+)?open(?:\s+my|\s+the)?\s+(?:plan|itinerary)$/.test(
      normalized,
    )
  )
    return proposal("plan", "plan.open");
  if (
    /^(?:please\s+)?close(?:\s+my|\s+the)?\s+(?:plan|itinerary)$/.test(
      normalized,
    )
  )
    return proposal("plan", "plan.close");
  const travelMode = normalized.match(
    /^(?:please\s+)?(?:set|change)(?:\s+the)?\s+travel\s+mode\s+to\s+(walking|driving|bicycling|transit)$/,
  );
  if (travelMode)
    return proposal("plan", "plan.settravelmode", { mode: travelMode[1] });

  if (
    /^(?:please\s+)?(?:enter|start)(?:\s+the)?\s+experience$/.test(normalized)
  )
    return proposal("navigation", "navigation.enterexperience");
  if (/^(?:please\s+)?open(?:\s+the)?\s+assistant$/.test(normalized))
    return proposal("navigation", "navigation.openassistant");
  if (/^(?:please\s+)?close(?:\s+the)?\s+assistant$/.test(normalized))
    return proposal("navigation", "navigation.closeassistant");
  if (/^(?:please\s+)?open(?:\s+the)?\s+attribution$/.test(normalized))
    return proposal("navigation", "navigation.openattribution");
  if (/^(?:please\s+)?close(?:\s+the)?\s+attribution$/.test(normalized))
    return proposal("navigation", "navigation.closeattribution");

  if (
    /^(?:please\s+)?(?:find|show)(?:\s+me)?\s+free\s+events?(?:\s+please)?$/.test(
      normalized,
    ) &&
    validRevision(baseContextRevision) &&
    typeof catalogRevision === "string" &&
    catalogRevision.length > 0 &&
    catalogRevision.length <= 160
  )
    return proposal("event", "event.applyquery", {
      text: normalized,
      mode: "replace",
      baseContextRevision,
      catalogRevision,
    });

  return null;
}
