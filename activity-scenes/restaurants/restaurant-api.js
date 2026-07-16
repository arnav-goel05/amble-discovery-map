function publicError(payload, fallback) {
  return payload?.error?.message || (typeof payload?.error === "string" ? payload.error : null) || fallback;
}

async function json(response) {
  try { return await response.json(); }
  catch { throw new Error("Restaurant service returned an unreadable response."); }
}

export function normalizeRestaurantEnvelope(payload) {
  const data = payload?.data || payload || {};
  return {
    status: payload?.status || (payload?.error ? "unavailable" : "success"),
    restaurants: Array.isArray(data.restaurants) ? data.restaurants : (Array.isArray(payload?.restaurants) ? payload.restaurants : []),
    fetchedAt: payload?.fetchedAt || null,
    stale: payload?.stale === true,
    warning: payload?.warning || null,
    source: payload?.source || null,
    cache: data.cache || payload?.cache || null,
  };
}

export function normalizeDealEnvelope(payload) {
  const result = payload?.data || payload?.result || null;
  return {
    status: payload?.status || "error",
    result: result ? {
      ...result,
      deals: (result.deals || []).filter(({ validUntil }) => !validUntil || Date.parse(validUntil) >= Date.now()),
    } : null,
    stale: payload?.stale === true,
    fetchedAt: payload?.fetchedAt || result?.fetchedAt || null,
    warning: payload?.warning || null,
    error: publicError(payload, null),
    progress: payload?.progress || null,
  };
}

export async function requestRestaurants(fetchImpl, bbox, { signal } = {}) {
  const response = await fetchImpl(`/api/restaurants?bbox=${encodeURIComponent(bbox)}`, { signal });
  const payload = await json(response);
  if (!response.ok && !payload?.data) throw new Error(publicError(payload, "Restaurant data is temporarily unavailable."));
  return normalizeRestaurantEnvelope(payload);
}

export async function requestDealBatch(fetchImpl, restaurantIds) {
  const response = await fetchImpl("/api/restaurant-deals/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantIds }),
  });
  const payload = await json(response);
  if (!response.ok) throw new Error(publicError(payload, "Deal checks could not be started."));
  return payload.jobs || [];
}

export async function requestDealStatus(fetchImpl, restaurantId) {
  const response = await fetchImpl(`/api/restaurant-deals?id=${encodeURIComponent(restaurantId)}`);
  const payload = await json(response);
  if (!response.ok) throw new Error(publicError(payload, "Deal lookup is unavailable right now."));
  return normalizeDealEnvelope(payload);
}
