const CANVAS_WIDTH = 96;
const CANVAS_HEIGHT = 64;
const DENSITY_COLUMNS = 16;
const DENSITY_ROWS = 10;

const WATER_COLOURS = ["#74aeb5", "#6aa4ad", "#82bac0"];
const LAND_COLOURS = ["#4f8b43", "#579649", "#3f7c39", "#68a652"];
const DENSITY_COLOUR = "#f1d64a";

const coordinateOf = (candidate) => {
  const source =
    candidate?.candidateCoordinates ||
    candidate?.anchor ||
    candidate?.sourceEvent?.coordinates;
  const longitude = Number(Array.isArray(source) ? source[0] : source?.lng);
  const latitude = Number(Array.isArray(source) ? source[1] : source?.lat);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
};

const geometryPolygons = (geometry) =>
  geometry?.type === "Polygon"
    ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon"
      ? geometry.coordinates
      : [];

const visitCoordinates = (value, visitor) => {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    visitor(value);
    return;
  }
  if (Array.isArray(value))
    for (const child of value) visitCoordinates(child, visitor);
};

export function singaporeGeometryBounds(featureCollection, padding = 0.025) {
  const bounds = {
    minLongitude: Number.POSITIVE_INFINITY,
    maxLongitude: Number.NEGATIVE_INFINITY,
    minLatitude: Number.POSITIVE_INFINITY,
    maxLatitude: Number.NEGATIVE_INFINITY,
  };
  for (const feature of featureCollection?.features ?? [])
    visitCoordinates(feature.geometry?.coordinates, ([longitude, latitude]) => {
      bounds.minLongitude = Math.min(bounds.minLongitude, longitude);
      bounds.maxLongitude = Math.max(bounds.maxLongitude, longitude);
      bounds.minLatitude = Math.min(bounds.minLatitude, latitude);
      bounds.maxLatitude = Math.max(bounds.maxLatitude, latitude);
    });
  if (!Number.isFinite(bounds.minLongitude))
    return {
      minLongitude: 103.6,
      maxLongitude: 104.05,
      minLatitude: 1.15,
      maxLatitude: 1.48,
    };
  const longitudePadding =
    (bounds.maxLongitude - bounds.minLongitude) * padding;
  const latitudePadding = (bounds.maxLatitude - bounds.minLatitude) * padding;
  return {
    minLongitude: bounds.minLongitude - longitudePadding,
    maxLongitude: bounds.maxLongitude + longitudePadding,
    minLatitude: bounds.minLatitude - latitudePadding,
    maxLatitude: bounds.maxLatitude + latitudePadding,
  };
}

export function densityPointsFromDiscoveryResult(result) {
  const points = [];
  const seen = new Set();
  for (const activity of result?.events ?? []) {
    const mappedVenueGroups = (activity.venueGroups ?? []).filter(
      (group) => group.publicPlacement === "mapped" && group.coordinates,
    );
    const occurrences = mappedVenueGroups.length
      ? mappedVenueGroups.map((group) => ({
          activityId: activity.activityId,
          anchor: group.coordinates,
        }))
      : activity.matchingOccurrences?.length > 0
        ? activity.matchingOccurrences
        : [activity];
    for (const occurrence of occurrences) {
      const coordinate = coordinateOf(occurrence);
      if (!coordinate) continue;
      const activityId =
        activity.activityId || activity.identity || occurrence.activityId;
      const key = `${activityId}:${coordinate
        .map((value) => value.toFixed(5))
        .join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ activityId, coordinate });
    }
  }
  return points;
}

export function eventDensityCells(
  points,
  bounds,
  columns = DENSITY_COLUMNS,
  rows = DENSITY_ROWS,
) {
  const cells = new Map();
  for (const { coordinate } of points) {
    const [longitude, latitude] = coordinate;
    const x = Math.floor(
      ((longitude - bounds.minLongitude) /
        (bounds.maxLongitude - bounds.minLongitude)) *
        columns,
    );
    const y = Math.floor(
      ((bounds.maxLatitude - latitude) /
        (bounds.maxLatitude - bounds.minLatitude)) *
        rows,
    );
    if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
    const key = `${x}:${y}`;
    cells.set(key, { x, y, count: (cells.get(key)?.count ?? 0) + 1 });
  }
  return [...cells.values()].sort((left, right) => right.count - left.count);
}

const projectCoordinate = ([longitude, latitude], bounds) => [
  ((longitude - bounds.minLongitude) /
    (bounds.maxLongitude - bounds.minLongitude)) *
    CANVAS_WIDTH,
  ((bounds.maxLatitude - latitude) /
    (bounds.maxLatitude - bounds.minLatitude)) *
    CANVAS_HEIGHT,
];

const drawPolygon = (context, polygon, bounds) => {
  context.beginPath();
  for (const ring of polygon) {
    ring.forEach((coordinate, index) => {
      const [x, y] = projectCoordinate(coordinate, bounds);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  }
  context.fill("evenodd");
};

const textureIndex = (x, y, length) =>
  Math.abs((x * 73856093) ^ (y * 19349663)) % length;

function drawTerrain(context, featureCollection, bounds) {
  context.imageSmoothingEnabled = false;
  for (let y = 0; y < CANVAS_HEIGHT; y += 4)
    for (let x = 0; x < CANVAS_WIDTH; x += 4) {
      context.fillStyle =
        WATER_COLOURS[textureIndex(x / 4, y / 4, WATER_COLOURS.length)];
      context.fillRect(x, y, 4, 4);
    }

  const mask = document.createElement("canvas");
  mask.width = CANVAS_WIDTH;
  mask.height = CANVAS_HEIGHT;
  const maskContext = mask.getContext("2d");
  maskContext.fillStyle = "#fff";
  for (const feature of featureCollection?.features ?? [])
    for (const polygon of geometryPolygons(feature.geometry))
      drawPolygon(maskContext, polygon, bounds);
  const pixels = maskContext.getImageData(
    0,
    0,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
  ).data;
  for (let y = 0; y < CANVAS_HEIGHT; y += 3)
    for (let x = 0; x < CANVAS_WIDTH; x += 3) {
      const sampleX = Math.min(CANVAS_WIDTH - 1, x + 1);
      const sampleY = Math.min(CANVAS_HEIGHT - 1, y + 1);
      if (pixels[(sampleY * CANVAS_WIDTH + sampleX) * 4 + 3] === 0) continue;
      context.fillStyle =
        LAND_COLOURS[textureIndex(x / 3, y / 3, LAND_COLOURS.length)];
      context.fillRect(x, y, 3, 3);
    }
}

function drawDensity(context, cells) {
  const cellWidth = CANVAS_WIDTH / DENSITY_COLUMNS;
  const cellHeight = CANVAS_HEIGHT / DENSITY_ROWS;
  const maximum = Math.max(1, ...cells.map(({ count }) => count));
  for (const { x, y, count } of [...cells].reverse()) {
    const intensity = count / maximum;
    const size = intensity >= 0.66 ? 5 : intensity >= 0.33 ? 4 : 3;
    const centreX = Math.round((x + 0.5) * cellWidth);
    const centreY = Math.round((y + 0.5) * cellHeight);
    context.fillStyle = "#5e2b22";
    context.fillRect(
      centreX - Math.floor(size / 2) - 1,
      centreY - Math.floor(size / 2) - 1,
      size + 2,
      size + 2,
    );
    context.fillStyle = DENSITY_COLOUR;
    context.fillRect(
      centreX - Math.floor(size / 2),
      centreY - Math.floor(size / 2),
      size,
      size,
    );
  }
}

const numericBound = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function minimapViewportRectangle(
  viewportBounds,
  singaporeBounds,
  width = CANVAS_WIDTH,
  height = CANVAS_HEIGHT,
) {
  if (!viewportBounds) return null;
  const west = numericBound(
    viewportBounds.west ??
      (typeof viewportBounds.getWest === "function"
        ? viewportBounds.getWest()
        : undefined),
    Number.NaN,
  );
  const east = numericBound(
    viewportBounds.east ??
      (typeof viewportBounds.getEast === "function"
        ? viewportBounds.getEast()
        : undefined),
    Number.NaN,
  );
  const south = numericBound(
    viewportBounds.south ??
      (typeof viewportBounds.getSouth === "function"
        ? viewportBounds.getSouth()
        : undefined),
    Number.NaN,
  );
  const north = numericBound(
    viewportBounds.north ??
      (typeof viewportBounds.getNorth === "function"
        ? viewportBounds.getNorth()
        : undefined),
    Number.NaN,
  );
  if (![west, east, south, north].every(Number.isFinite)) return null;
  const project = ([longitude, latitude]) => [
    ((longitude - singaporeBounds.minLongitude) /
      (singaporeBounds.maxLongitude - singaporeBounds.minLongitude)) *
      width,
    ((singaporeBounds.maxLatitude - latitude) /
      (singaporeBounds.maxLatitude - singaporeBounds.minLatitude)) *
      height,
  ];
  const [left, top] = project([west, north]);
  const [right, bottom] = project([east, south]);
  const rawLeft = Math.min(left, right);
  const rawRight = Math.max(left, right);
  const rawTop = Math.min(top, bottom);
  const rawBottom = Math.max(top, bottom);
  if (
    rawRight < 0 ||
    rawLeft > width ||
    rawBottom < 0 ||
    rawTop > height
  )
    return null;
  const clippedLeft = Math.max(0, Math.min(width, rawLeft));
  const clippedTop = Math.max(0, Math.min(height, rawTop));
  const clippedRight = Math.max(0, Math.min(width, rawRight));
  const clippedBottom = Math.max(0, Math.min(height, rawBottom));
  return {
    x: clippedLeft,
    y: clippedTop,
    width: Math.max(2, clippedRight - clippedLeft),
    height: Math.max(2, clippedBottom - clippedTop),
  };
}

function drawViewport(context, rectangle) {
  if (!rectangle) return;
  const x = Math.round(rectangle.x) + 0.5;
  const y = Math.round(rectangle.y) + 0.5;
  const width = Math.max(2, Math.round(rectangle.width));
  const height = Math.max(2, Math.round(rectangle.height));
  context.fillStyle = "rgba(255, 255, 255, 0.12)";
  context.fillRect(x, y, width, height);
  context.strokeStyle = "rgba(255, 255, 255, 0.92)";
  context.lineWidth = 1;
  context.strokeRect(x, y, width, height);
}

function drawCompass(context) {
  context.fillStyle = "#f8f1d7";
  context.font = "bold 7px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("N", CANVAS_WIDTH / 2, 5);
  context.fillText("S", CANVAS_WIDTH / 2, CANVAS_HEIGHT - 4);
  context.fillText("W", 5, CANVAS_HEIGHT / 2);
  context.fillText("E", CANVAS_WIDTH - 5, CANVAS_HEIGHT / 2);
}

export function createEventDensityMinimap({
  discoveryAreaAsset,
  discoveryModel,
  map,
} = {}) {
  const existing = document.getElementById("event-density-minimap");
  if (existing) return { destroy: () => existing.remove(), root: existing };

  const root = document.createElement("aside");
  root.id = "event-density-minimap";
  root.className = "event-density-minimap";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Event density across Singapore");

  const canvas = document.createElement("canvas");
  canvas.className = "event-density-minimap__canvas";
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.setAttribute("aria-hidden", "true");

  root.append(canvas);
  document.body.appendChild(root);

  const context = canvas.getContext("2d");
  const bounds = singaporeGeometryBounds(discoveryAreaAsset);
  let points = densityPointsFromDiscoveryResult(discoveryModel?.filter());
  let viewportRectangle = minimapViewportRectangle(map?.getBounds?.(), bounds);
  let scheduledRender = null;

  const render = () => {
    scheduledRender = null;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawTerrain(context, discoveryAreaAsset, bounds);
    const cells = eventDensityCells(points, bounds);
    drawDensity(context, cells);
    drawViewport(context, viewportRectangle);
    drawCompass(context);
    const activityCount = new Set(points.map(({ activityId }) => activityId))
      .size;
    root.dataset.activityCount = String(activityCount);
    root.dataset.densityCellCount = String(cells.length);
    root.dataset.viewportVisible = String(Boolean(viewportRectangle));
    if (viewportRectangle) {
      root.dataset.viewportX = viewportRectangle.x.toFixed(2);
      root.dataset.viewportY = viewportRectangle.y.toFixed(2);
      root.dataset.viewportWidth = viewportRectangle.width.toFixed(2);
      root.dataset.viewportHeight = viewportRectangle.height.toFixed(2);
    } else {
      for (const name of [
        "viewportX",
        "viewportY",
        "viewportWidth",
        "viewportHeight",
      ])
        delete root.dataset[name];
    }
    root.setAttribute(
      "aria-label",
      `Event density across Singapore. ${activityCount} filtered mapped ${
        activityCount === 1 ? "activity" : "activities"
      }. The outlined box shows the current map viewport.`,
    );
  };

  const updateViewport = () => {
    viewportRectangle = minimapViewportRectangle(map?.getBounds?.(), bounds);
    if (scheduledRender !== null) return;
    scheduledRender = requestAnimationFrame(render);
  };
  map?.on?.("move", updateViewport);
  map?.on?.("resize", updateViewport);
  render();

  return Object.freeze({
    destroy() {
      map?.off?.("move", updateViewport);
      map?.off?.("resize", updateViewport);
      if (scheduledRender !== null) cancelAnimationFrame(scheduledRender);
      root.remove();
    },
    root,
    setDiscoveryModel(nextModel) {
      points = densityPointsFromDiscoveryResult(nextModel?.filter());
      render();
    },
    setDiscoveryResult(result) {
      points = densityPointsFromDiscoveryResult(result);
      render();
    },
  });
}
