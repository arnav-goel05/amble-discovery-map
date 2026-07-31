const MAX_RESOURCE_PATHS = 12;

export const PERFORMANCE_MILESTONE_METRICS = {
  "startup.mapInitializedMs": ["mapInitialized", "true"],
  "startup.overlayLayersLoadedMs": ["overlayLayersLoaded", "true"],
  "startup.eventUiMountedMs": ["landmarkEventPills", "mounted"],
  "startup.tilesetLoadedMs": ["tilesetLoaded", "true"],
};

export function capturePerformanceMilestones(body, milestones, now) {
  for (const [metric, [key, value]] of Object.entries(
    PERFORMANCE_MILESTONE_METRICS,
  ))
    if (milestones[metric] == null && body[key] === value)
      milestones[metric] = now();
}

export const roundPerformanceValue = (value, digits = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

export const performancePercentile = (values, quantile) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  ];
};

export function sanitizePerformanceResourcePath(value) {
  try {
    return new URL(value, "https://diagnostics.invalid").pathname
      .replace(
        /\/api\/snapshot\/assets\/[^/]+\//i,
        "/api/snapshot/assets/:snapshot/",
      )
      .replace(/\/poi-tiles\/[^/]+\//i, "/poi-tiles/:poi/")
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
      .replace(/-[a-z0-9_-]{8,}(?=\.[a-z0-9]+$)/i, "-:hash");
  } catch {
    return "/unparseable-resource";
  }
}

function resourceGroup(entry) {
  const path = sanitizePerformanceResourcePath(entry.name);
  if (/\.b3dm$/i.test(path)) return "3d-tiles";
  if (/tileset[^/]*\.json$/i.test(path)) return "tileset-json";
  if (/\.(?:m?js)$/i.test(path) || entry.initiatorType === "script")
    return "scripts";
  if (/\.css$/i.test(path) || entry.initiatorType === "css") return "styles";
  if (/\.(?:woff2?|ttf|otf)$/i.test(path)) return "fonts";
  if (/\.(?:png|jpe?g|webp|svg)$/i.test(path)) return "images";
  if (
    entry.initiatorType === "fetch" ||
    entry.initiatorType === "xmlhttprequest"
  )
    return "data";
  return "other";
}

export function summarizePerformanceResources(performance) {
  const entries = performance?.getEntriesByType?.("resource") ?? [];
  const groups = {};
  let totalBytes = 0;
  let knownByteRequests = 0;
  const resources = entries.map((entry) => {
    const bytes =
      Number.isFinite(entry.transferSize) && entry.transferSize > 0
        ? entry.transferSize
        : Number.isFinite(entry.encodedBodySize) && entry.encodedBodySize > 0
          ? entry.encodedBodySize
          : null;
    const group = resourceGroup(entry);
    groups[group] ||= { bytes: 0, requests: 0, unknownByteRequests: 0 };
    groups[group].requests += 1;
    if (bytes == null) groups[group].unknownByteRequests += 1;
    else {
      groups[group].bytes += bytes;
      totalBytes += bytes;
      knownByteRequests += 1;
    }
    return {
      bytes,
      group,
      path: sanitizePerformanceResourcePath(entry.name),
      startTime: Number.isFinite(entry.startTime) ? entry.startTime : null,
    };
  });
  const first = [...resources].sort(
    (left, right) =>
      (left.startTime ?? Number.POSITIVE_INFINITY) -
      (right.startTime ?? Number.POSITIVE_INFINITY),
  )[0];
  return {
    totalBytes,
    requests: entries.length,
    knownByteRequests,
    unknownByteRequests: entries.length - knownByteRequests,
    groups,
    first: first
      ? {
          bytes: first.bytes,
          group: first.group,
          path: first.path,
          startTime: first.startTime,
        }
      : null,
    largest: resources
      .filter(({ bytes }) => bytes != null)
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, MAX_RESOURCE_PATHS)
      .map(({ bytes, group, path }) => ({ bytes, group, path })),
  };
}

export function performanceMetricState(
  value,
  { min, warnMin, max, warnMax } = {},
) {
  if (!Number.isFinite(value)) return "pending";
  if ((min != null && value < min) || (max != null && value > max))
    return "over_budget";
  if (
    (warnMin != null && value < warnMin) ||
    (warnMax != null && value > warnMax)
  )
    return "warning";
  return "healthy";
}

export function formatPerformanceValue(sample) {
  if (sample.value == null) return sample.state;
  if (sample.unit === "bytes") {
    const units = ["B", "KiB", "MiB", "GiB"];
    let value = sample.value;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${roundPerformanceValue(value, 1)} ${units[index]}`;
  }
  return `${sample.value}${sample.unit === "count" ? "" : ` ${sample.unit}`}`;
}
