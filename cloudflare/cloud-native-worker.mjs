import { APPROVED_SNAPSHOT } from "./generated-approved-snapshot.mjs";
import { r2TileResponse, tileObjectKey } from "./workers-vpc-proxy.mjs";
import { dealResponse } from "./restaurant-deals.mjs";

const PRIVATE_PATH = /^(?:\/admin\.html|\/api\/admin(?:\/|$))/;
const RESTAURANT_TTL_MS = 24 * 60 * 60 * 1000;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' data: https://*.basemaps.cartocdn.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; connect-src 'self' https://*.basemaps.cartocdn.com https://demotiles.maplibre.org https://cloudflareinsights.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(self)",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function withSecurityHeaders(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
}

function json(payload, { status = 200, cacheControl = "no-store", headers = {} } = {}) {
  return withSecurityHeaders(new Response(`${JSON.stringify(payload)}\n`, {
    status,
    headers: { "cache-control": cacheControl, "content-type": "application/json; charset=utf-8", ...headers },
  }));
}

function successEnvelope(data, { fetchedAt = new Date().toISOString(), stale = false, warning = null, source = { id: "amble", costClass: "free" } } = {}) {
  return { schemaVersion: "1.0", data, fetchedAt, stale, warning, source };
}

function errorEnvelope(code, message) {
  return { schemaVersion: "1.0", error: { code, message } };
}

function publicTileset(value) {
  const copy = structuredClone(value);
  const visit = (tile) => {
    const content = tile?.content;
    if (content) for (const key of ["uri", "url"]) {
      if (typeof content[key] === "string" && content[key].startsWith("/poi-tiles/")) {
        content[key] = `../../../../${content[key].slice(1)}`;
      }
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(copy.root);
  return copy;
}

function snapshotMetadata(now = new Date()) {
  const { manifest } = APPROVED_SNAPSHOT;
  const stale = Number.isFinite(Date.parse(manifest.staleAfter)) && now.getTime() > Date.parse(manifest.staleAfter);
  const sourceHealth = Object.fromEntries(Object.entries(manifest.sourceHealth || {}).map(([id, health]) => [id, {
    status: ["success", "failed", "blocked", "unavailable", "stale"].includes(health?.status) ? health.status : "unavailable",
    ...(health?.lastSuccessfulAt && !Number.isNaN(Date.parse(health.lastSuccessfulAt)) ? { lastSuccessfulAt: health.lastSuccessfulAt } : {}),
  }]));
  const prefix = `/api/snapshot/assets/${encodeURIComponent(manifest.snapshotId)}`;
  return {
    stale,
    data: {
      schemaVersion: manifest.schemaVersion,
      snapshotId: manifest.snapshotId,
      publishedAt: manifest.publishedAt,
      coveredWindow: manifest.coveredWindow,
      freshness: manifest.freshness,
      staleAfter: manifest.staleAfter,
      sourceHealth,
      landmarksRef: `${prefix}/${manifest.landmarksRef}`,
      poisRef: `${prefix}/${manifest.poisRef}`,
      tilesetRef: `${prefix}/${manifest.tilesetRef}?assetPaths=site-root-v1`,
      previousSnapshotId: manifest.previousSnapshotId,
      contentHash: manifest.contentHash,
    },
  };
}

function snapshotResponse(request, url) {
  const { manifest, assets } = APPROVED_SNAPSHOT;
  if (!["GET", "HEAD"].includes(request.method)) return json(errorEnvelope("method_not_allowed", "Only GET and HEAD are supported."), { status: 405, headers: { allow: "GET, HEAD" } });
  const metadata = snapshotMetadata();
  if (url.pathname === "/api/snapshot") {
    const body = successEnvelope(metadata.data, {
      fetchedAt: manifest.publishedAt,
      stale: metadata.stale,
      warning: metadata.stale ? "The latest approved event snapshot may be out of date." : null,
      source: { id: "approved-snapshot", costClass: "free" },
    });
    return request.method === "HEAD" ? withSecurityHeaders(new Response(null, { headers: { "cache-control": "no-cache" } })) : json(body, { cacheControl: "no-cache" });
  }
  const prefix = "/api/snapshot/assets/";
  const pieces = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent);
  const snapshotId = pieces.shift();
  const reference = pieces.join("/");
  if (snapshotId !== manifest.snapshotId || !(reference in assets)) return json(errorEnvelope("snapshot_asset_not_active", "Snapshot asset was not found."), { status: 404 });
  const immutable = "public, max-age=31536000, immutable";
  if (reference === manifest.tilesetRef) {
    const response = json(publicTileset(assets[reference]), { cacheControl: immutable });
    return request.method === "HEAD" ? withSecurityHeaders(new Response(null, { headers: response.headers })) : response;
  }
  const response = json(successEnvelope(assets[reference], {
    fetchedAt: manifest.publishedAt,
    stale: metadata.stale,
    warning: metadata.stale ? "The latest approved event snapshot may be out of date." : null,
    source: { id: "approved-snapshot", costClass: "free" },
  }), { cacheControl: immutable });
  return request.method === "HEAD" ? withSecurityHeaders(new Response(null, { headers: response.headers })) : response;
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tag(tags, ...keys) {
  for (const key of keys) if (normalizeSpace(tags?.[key])) return normalizeSpace(tags[key]);
  return null;
}

function normalizeWebsite(value) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function normalizeRestaurant(element) {
  const tags = element.tags || {};
  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const address = [tag(tags, "addr:housenumber"), tag(tags, "addr:street"), tag(tags, "addr:housename"), tag(tags, "addr:city"), tag(tags, "addr:postcode")].filter(Boolean).join(", ");
  return {
    id: `osm-${element.type}-${element.id}`,
    osm: { type: element.type, id: String(element.id), url: `https://www.openstreetmap.org/${element.type}/${element.id}` },
    name: tag(tags, "name", "brand") || "Unnamed food venue",
    brand: tag(tags, "brand"),
    category: tag(tags, "amenity") || "restaurant",
    cuisine: tag(tags, "cuisine"),
    address: address || null,
    latitude,
    longitude,
    openingHours: tag(tags, "opening_hours"),
    phone: tag(tags, "phone", "contact:phone"),
    email: tag(tags, "email", "contact:email"),
    website: normalizeWebsite(tag(tags, "website", "contact:website", "brand:website")),
    wikidata: tag(tags, "wikidata"),
    brandWikidata: tag(tags, "brand:wikidata"),
    takeaway: tag(tags, "takeaway"),
    delivery: tag(tags, "delivery"),
    dietary: Object.entries(tags).filter(([key, value]) => key.startsWith("diet:") && ["yes", "only"].includes(value)).map(([key]) => key.slice(5).replaceAll("_", " ")),
    source: "OpenStreetMap",
    sourceUpdatedAt: null,
  };
}

export function parseBbox(input, { maxLatSpan = 0.12, maxLngSpan = 0.12 } = {}) {
  const values = String(input || "").split(",").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw new Error("bbox must be south,west,north,east");
  const [south, west, north, east] = values;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) throw new Error("bbox coordinates are invalid");
  if (north - south > maxLatSpan || east - west > maxLngSpan) throw new Error("viewport is too large; zoom in before searching restaurants");
  return { south, west, north, east, key: values.map((value) => value.toFixed(5)).join(",") };
}

function overpassQuery(bbox) {
  return `[out:json][timeout:20];nwr["amenity"~"^(restaurant|fast_food|food_court|cafe)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out center tags qt 500;`;
}

async function collectRestaurants(bbox) {
  const attempts = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const startedAt = new Date().toISOString();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: overpassQuery(bbox) }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.elements)) throw new Error("response has no elements array");
      const restaurants = payload.elements.map(normalizeRestaurant).filter(Boolean);
      const unique = [...new Map(restaurants.map((restaurant) => [restaurant.id, restaurant])).values()].sort((left, right) => left.name.localeCompare(right.name)).slice(0, 250);
      attempts.push({ endpoint, providerId: "openstreetmap-overpass", startedAt, status: "success", count: unique.length });
      return { bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east }, fetchedAt: new Date().toISOString(), endpoint, attempts, restaurants: unique };
    } catch (error) {
      attempts.push({ endpoint, providerId: "openstreetmap-overpass", startedAt, status: "failed", error: normalizeSpace(error.message) });
    }
  }
  const error = new Error("All restaurant sources are temporarily unavailable");
  error.attempts = attempts;
  throw error;
}

function restaurantEnvelope(result, { cache, stale = false, warning = null } = {}) {
  return {
    schemaVersion: "1.0",
    status: "success",
    data: { bbox: result.bbox, restaurants: result.restaurants, cache },
    bbox: result.bbox,
    restaurants: result.restaurants,
    cache,
    fetchedAt: result.fetchedAt,
    stale,
    warning,
    source: { id: "openstreetmap-overpass", costClass: "open" },
  };
}

async function savedRestaurants(bbox, env) {
  const query = await env.RUNTIME_DB.prepare(`SELECT payload FROM restaurants
    WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
    ORDER BY id LIMIT 250`).bind(bbox.south, bbox.north, bbox.west, bbox.east).all();
  const restaurants = (query.results || []).map((row) => JSON.parse(row.payload)).sort((left, right) => left.name.localeCompare(right.name));
  if (!restaurants.length) return null;
  return {
    bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east },
    fetchedAt: new Date().toISOString(),
    restaurants,
  };
}

async function restaurantResponse(request, url, env, context) {
  if (request.method !== "GET") return json(errorEnvelope("method_not_allowed", "Only GET is supported."), { status: 405, headers: { allow: "GET" } });
  let bbox;
  try { bbox = parseBbox(url.searchParams.get("bbox")); }
  catch (error) { return json(errorEnvelope("invalid_restaurant_request", String(error.message).slice(0, 180)), { status: 400 }); }

  const now = new Date();
  const row = await env.RUNTIME_DB.prepare("SELECT payload,fetched_at,expires_at FROM restaurant_viewports WHERE cache_key=?").bind(bbox.key).first();
  if (row && Date.parse(row.expires_at) > now.getTime()) {
    return json(restaurantEnvelope(JSON.parse(row.payload), { cache: "hit" }), { cacheControl: "public, max-age=300, stale-while-revalidate=3600" });
  }
  const saved = await savedRestaurants(bbox, env);
  if (saved) {
    return json(restaurantEnvelope(saved, { cache: "database" }), { cacheControl: "public, max-age=3600, stale-while-revalidate=86400" });
  }
  try {
    const result = await collectRestaurants(bbox);
    const expiresAt = new Date(now.getTime() + RESTAURANT_TTL_MS).toISOString();
    await env.RUNTIME_DB.prepare(`INSERT INTO restaurant_viewports(cache_key,south,west,north,east,payload,fetched_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET south=excluded.south,west=excluded.west,north=excluded.north,east=excluded.east,payload=excluded.payload,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`)
      .bind(bbox.key, bbox.south, bbox.west, bbox.north, bbox.east, JSON.stringify(result), result.fetchedAt, expiresAt).run();
    context.waitUntil(env.RUNTIME_DB.prepare("DELETE FROM restaurant_viewports WHERE expires_at<?").bind(new Date(now.getTime() - 7 * RESTAURANT_TTL_MS).toISOString()).run());
    return json(restaurantEnvelope(result, { cache: "miss" }), { cacheControl: "public, max-age=300, stale-while-revalidate=3600" });
  } catch {
    if (row) return json(restaurantEnvelope(JSON.parse(row.payload), { cache: "stale", stale: true, warning: "Live restaurant refresh failed; showing the last saved result." }), { cacheControl: "public, max-age=60" });
    return json({ ...errorEnvelope("restaurant_service_unavailable", "Restaurant data is temporarily unavailable."), status: "unavailable", data: null, stale: false, warning: null, source: { id: "openstreetmap-overpass", costClass: "open" } }, { status: 503 });
  }
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (PRIVATE_PATH.test(url.pathname)) return withSecurityHeaders(new Response("Not found", { status: 404 }));

    if (tileObjectKey(request)) {
      try {
        const response = await r2TileResponse(request, env.TILES_BUCKET);
        return response ? withSecurityHeaders(response) : withSecurityHeaders(new Response("Not found", { status: 404 }));
      } catch { return withSecurityHeaders(new Response("Tile service unavailable", { status: 503 })); }
    }
    if (url.pathname === "/api/snapshot" || url.pathname.startsWith("/api/snapshot/assets/")) return snapshotResponse(request, url);
    if (url.pathname === "/api/restaurants") return restaurantResponse(request, url, env, context);
    const deals = await dealResponse(request, url, env, context, { json, errorEnvelope });
    if (deals) return deals;
    if (["/health/live", "/health/ready", "/api/health/live", "/api/health/ready"].includes(url.pathname)) return json({ ok: true, runtime: "cloudflare" });
    if (url.pathname === "/api/game-readiness") return json({ enabled: false, botConfigured: false, deliveryConfigured: false, adaptiveLocationVerification: false, photoVerification: false, storage: "d1" });
    if (url.pathname.startsWith("/api/")) return json(errorEnvelope("route_not_found", "API route was not found."), { status: 404 });

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
