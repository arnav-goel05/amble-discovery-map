export function normalizeResourceMetrics(metrics = {}) {
  const integer = (value) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
  return {
    durationMs: integer(metrics.durationMs),
    blockingMs: integer(metrics.blockingMs),
    externalRequests: integer(metrics.externalRequests),
    cacheHits: integer(metrics.cacheHits),
    cacheMisses: integer(metrics.cacheMisses),
    bytesRead: integer(metrics.bytesRead),
    bytesWritten: integer(metrics.bytesWritten),
    artifactsCreated: integer(metrics.artifactsCreated),
    artifactsReused: integer(metrics.artifactsReused),
    gateExecutions: integer(metrics.gateExecutions),
    gateReuses: integer(metrics.gateReuses),
    reasonCode: String(metrics.reasonCode ?? "executed").slice(0, 160),
  };
}

export function createResourceMeter({
  now = () => Date.now(),
  initial = {},
} = {}) {
  const started = now();
  const counters = normalizeResourceMetrics(initial);
  return {
    add(field, amount = 1) {
      if (field in counters && field !== "reasonCode")
        counters[field] += Math.max(0, Math.round(Number(amount) || 0));
    },
    finish(extra = {}) {
      return normalizeResourceMetrics({
        ...counters,
        ...extra,
        durationMs: Math.max(0, now() - started),
      });
    },
  };
}
