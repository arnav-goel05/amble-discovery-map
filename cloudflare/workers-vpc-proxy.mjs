const DEFAULT_ORIGIN = "http://127.0.0.1:4173";
const TILE_PATH = /^\/(?:optimized-tiles|poi-tiles)\//;
const HASHED_ASSET_PATH = /^\/assets\/.+\.[a-f0-9]{8,}\.(?:css|js|svg|ttf|woff2?)$/i;
const PRIVATE_PATH = /^(?:\/admin\.html|\/api\/admin(?:\/|$))/;

export function isPrivatePath(pathname) {
  return PRIVATE_PATH.test(pathname);
}

export function isCacheableTileRequest(request) {
  if (request.method !== "GET" || request.headers.has("range")) return false;
  return TILE_PATH.test(new URL(request.url).pathname);
}

export function tileObjectKey(request) {
  const pathname = new URL(request.url).pathname;
  return TILE_PATH.test(pathname) ? pathname.slice(1) : null;
}

function fallbackContentType(key) {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".b3dm") || key.endsWith(".glb")) return "application/octet-stream";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function fallbackCacheControl(key) {
  return key.endsWith(".json")
    ? "public, max-age=300, stale-while-revalidate=86400"
    : "public, max-age=86400, stale-while-revalidate=604800";
}

function applyR2Headers(object, key, request) {
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  if (!headers.has("content-type")) headers.set("content-type", fallbackContentType(key));
  if (!headers.has("cache-control")) headers.set("cache-control", fallbackCacheControl(key));
  headers.set("accept-ranges", "bytes");
  headers.set("x-amble-tile-source", "r2");
  if (request.headers.has("range") && object.range && Number.isFinite(object.size)) {
    const offset = object.range.offset ?? Math.max(0, object.size - object.range.length);
    const length = object.range.length ?? Math.max(0, object.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
  } else if (Number.isFinite(object.size)) {
    headers.set("content-length", String(object.size));
  }
  return headers;
}

export async function r2TileResponse(request, bucket) {
  const key = tileObjectKey(request);
  if (!key || !bucket || !["GET", "HEAD"].includes(request.method)) return null;
  const object = request.method === "HEAD"
    ? await bucket.head(key)
    : await bucket.get(key, { onlyIf: request.headers, range: request.headers });
  if (object === null) return null;
  const headers = applyR2Headers(object, key, request);
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const hasBody = "body" in object && object.body !== undefined;
  return new Response(hasBody ? object.body : null, {
    status: hasBody ? (request.headers.has("range") ? 206 : 200) : 412,
    headers,
  });
}

export function isCacheableHashedAssetRequest(request) {
  if (request.method !== "GET" || request.headers.has("range")) return false;
  return HASHED_ASSET_PATH.test(new URL(request.url).pathname);
}

export function originRequest(request, origin = DEFAULT_ORIGIN) {
  const incomingUrl = new URL(request.url);
  const target = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));
  return new Request(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
}

function unavailableResponse() {
  return new Response("The map is temporarily unavailable.", {
    status: 502,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (isPrivatePath(url.pathname)) return new Response("Not found", { status: 404 });

    const cacheable = isCacheableTileRequest(request) || isCacheableHashedAssetRequest(request);
    const cache = globalThis.caches?.default;
    if (cacheable && cache) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }

    if (tileObjectKey(request) && env?.TILES_BUCKET) {
      try {
        const response = await r2TileResponse(request, env.TILES_BUCKET);
        if (response) {
          if (cacheable && cache && response.ok) context?.waitUntil?.(cache.put(request, response.clone()));
          return response;
        }
      } catch (error) {
        console.warn("R2 tile read failed; falling back to the private origin", error);
      }
    }

    if (!env?.LOCAL_APP?.fetch) return unavailableResponse();

    try {
      const response = await env.LOCAL_APP.fetch(originRequest(request, env.ORIGIN_URL || DEFAULT_ORIGIN));
      if (cacheable && cache && response.ok) context?.waitUntil?.(cache.put(request, response.clone()));
      return response;
    } catch {
      return unavailableResponse();
    }
  },
};
