const DEFAULT_CLUSTER_RADIUS = 72;
const DEFAULT_NAVIGATION_ZOOM_STEP = 2;
const DEFAULT_NAVIGATION_DURATION = 700;
const MEMBER_KEY_SEPARATOR = "\u001f";

const isLocation = (location) =>
  typeof location?.id === "string" &&
  location.id.trim() &&
  Number.isFinite(location.x) &&
  Number.isFinite(location.y) &&
  Number.isFinite(location.lng) &&
  Number.isFinite(location.lat);

const compareLocations = (left, right) =>
  left.id.localeCompare(right.id) ||
  left.x - right.x ||
  left.y - right.y ||
  left.lng - right.lng ||
  left.lat - right.lat;

function uniqueLocations(locations) {
  const sorted = (Array.isArray(locations) ? locations : [])
    .filter(isLocation)
    .map((location) => ({ ...location, id: location.id.trim() }))
    .sort(compareLocations);
  const seen = new Set();
  return sorted.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function summarizeCluster(members) {
  const memberIds = members.map(({ id }) => id).sort();
  const count = members.length;
  const totals = members.reduce(
    (result, member) => ({
      lat: result.lat + member.lat,
      lng: result.lng + member.lng,
      x: result.x + member.x,
      y: result.y + member.y,
    }),
    { lat: 0, lng: 0, x: 0, y: 0 },
  );
  return {
    bounds: {
      east: Math.max(...members.map(({ lng }) => lng)),
      north: Math.max(...members.map(({ lat }) => lat)),
      south: Math.min(...members.map(({ lat }) => lat)),
      west: Math.min(...members.map(({ lng }) => lng)),
    },
    count,
    key: memberIds.join(MEMBER_KEY_SEPARATOR),
    label:
      count === 1
        ? members[0].label || "Event location"
        : `${count} event locations`,
    lat: totals.lat / count,
    lng: totals.lng / count,
    memberIds,
    members,
    x: totals.x / count,
    y: totals.y / count,
  };
}

export function clusterEventLocations(
  locations,
  { radius = DEFAULT_CLUSTER_RADIUS } = {},
) {
  if (!Number.isFinite(radius) || radius <= 0)
    throw new TypeError("Cluster radius must be a positive finite number");
  const points = uniqueLocations(locations);
  if (!points.length) return [];

  const parents = points.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };

  const cells = new Map();
  const radiusSquared = radius * radius;
  for (const [index, point] of points.entries()) {
    const cellX = Math.floor(point.x / radius);
    const cellY = Math.floor(point.y / radius);
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const neighbors = cells.get(`${cellX + xOffset}:${cellY + yOffset}`);
        if (!neighbors) continue;
        for (const neighborIndex of neighbors) {
          const neighbor = points[neighborIndex];
          const xDistance = neighbor.x - point.x;
          const yDistance = neighbor.y - point.y;
          if (xDistance * xDistance + yDistance * yDistance <= radiusSquared) {
            join(index, neighborIndex);
          }
        }
      }
    }
    const cellKey = `${cellX}:${cellY}`;
    const cell = cells.get(cellKey) || [];
    cell.push(index);
    cells.set(cellKey, cell);
  }

  const groups = new Map();
  for (const [index, point] of points.entries()) {
    const root = find(index);
    const group = groups.get(root) || [];
    group.push(point);
    groups.set(root, group);
  }
  return [...groups.values()]
    .map(summarizeCluster)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function clusterAriaLabel(cluster) {
  if (cluster.count === 1)
    return `Zoom in to explore ${cluster.label} event location`;
  return `Zoom in to explore ${cluster.count} event locations`;
}

function focusMap(map) {
  const zoomControl = document.querySelector(".maplibregl-ctrl-zoom-in");
  (zoomControl || map.getCanvas?.())?.focus?.();
}

function createClusterDom(cluster, map, minZoom, navigationOptions) {
  const root = document.createElement("div");
  root.className = "landmark-event-cluster";
  const button = document.createElement("button");
  button.className = "landmark-event-cluster__count";
  button.type = "button";
  root.appendChild(button);
  document.body.appendChild(root);

  const record = {
    button,
    cluster,
    root,
  };
  const activate = () => {
    const currentZoom = Number(map.getZoom?.());
    if (!map.easeTo || !Number.isFinite(currentZoom)) return;
    const zoom =
      record.cluster.count === 1
        ? minZoom
        : Math.min(minZoom, currentZoom + navigationOptions.zoomStep);
    map.easeTo({
      center: [record.cluster.lng, record.cluster.lat],
      duration: navigationOptions.duration,
      zoom,
    });
  };
  button.addEventListener("click", activate);
  record.destroy = () => {
    button.removeEventListener("click", activate);
    root.remove();
  };
  return record;
}

function renderCluster(record, cluster) {
  record.cluster = cluster;
  record.root.dataset.clusterKey = cluster.key;
  record.root.dataset.clusterCount = String(cluster.count);
  record.root.dataset.clusterMembers = cluster.memberIds.join(",");
  record.root.style.transform = `translate(${Math.round(cluster.x)}px, ${Math.round(cluster.y)}px)`;
  record.button.textContent = String(cluster.count);
  record.button.setAttribute("aria-label", clusterAriaLabel(cluster));
  record.button.title =
    cluster.count === 1
      ? `Zoom in to ${cluster.label}`
      : `Zoom in to ${cluster.count} event locations`;
}

export function createLandmarkEventClusterLayer({
  map,
  minZoom,
  radius = DEFAULT_CLUSTER_RADIUS,
  navigationDuration = DEFAULT_NAVIGATION_DURATION,
  navigationZoomStep = DEFAULT_NAVIGATION_ZOOM_STEP,
}) {
  const records = new Map();
  const navigationOptions = {
    duration: navigationDuration,
    zoomStep: navigationZoomStep,
  };

  const reconcile = (locations) => {
    const clusters = clusterEventLocations(locations, { radius });
    const incomingKeys = new Set(clusters.map(({ key }) => key));
    let shouldRestoreMapFocus = false;
    for (const [key, record] of records) {
      if (incomingKeys.has(key)) continue;
      shouldRestoreMapFocus ||= record.button === document.activeElement;
      record.destroy();
      records.delete(key);
    }
    for (const cluster of clusters) {
      let record = records.get(cluster.key);
      if (!record) {
        record = createClusterDom(cluster, map, minZoom, navigationOptions);
        records.set(cluster.key, record);
      }
      renderCluster(record, cluster);
    }
    if (shouldRestoreMapFocus) focusMap(map);
    return clusters;
  };

  const destroy = () => {
    let shouldRestoreMapFocus = false;
    for (const record of records.values()) {
      shouldRestoreMapFocus ||= record.button === document.activeElement;
      record.destroy();
    }
    records.clear();
    if (shouldRestoreMapFocus) focusMap(map);
  };

  return { destroy, reconcile };
}
