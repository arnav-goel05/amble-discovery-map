import { r2TilesetIntegrityResponse } from "./r2-tileset-integrity.mjs";

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function secure(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    secured.headers.set(name, value);
  return secured;
}

export function integrityCacheKey(request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "poi" ? "poi" : "summary";
  const candidate = url.searchParams.get("release");
  const release = /^[a-f0-9]{16}$/u.test(candidate ?? "")
    ? candidate
    : "current";
  const verificationCandidate = url.searchParams.get("verification");
  const verification = /^[a-f0-9]{16}$/u.test(verificationCandidate ?? "")
    ? verificationCandidate
    : "shared";
  return new Request(
    `${url.origin}/api/tile-integrity?scope=${scope}&release=${release}&verification=${verification}`,
  );
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/tile-integrity" || request.method !== "GET")
      return secure(new Response("Not found", { status: 404 }));
    const scope = url.searchParams.get("scope");
    const release = url.searchParams.get("release");
    const verification = url.searchParams.get("verification");
    if (
      (scope && scope !== "poi") ||
      (release && !/^[a-f0-9]{16}$/u.test(release)) ||
      (verification && !/^[a-f0-9]{16}$/u.test(verification))
    )
      return secure(new Response("Invalid integrity request", { status: 400 }));
    const cache = globalThis.caches?.default;
    const cacheKey = integrityCacheKey(request);
    const cached = await cache?.match(cacheKey);
    if (cached) return secure(cached);
    const response = await r2TilesetIntegrityResponse(
      request,
      env.TILES_BUCKET,
    );
    if (response?.ok && cache)
      context?.waitUntil?.(cache.put(cacheKey, response.clone()));
    return secure(response ?? new Response("Not found", { status: 404 }));
  },
};
