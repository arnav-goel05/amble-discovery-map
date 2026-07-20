"use strict";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

class HttpContractError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "HttpContractError";
    this.code = code;
    this.status = status;
  }
}

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(self)");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://*.basemaps.cartocdn.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; connect-src 'self' https://*.basemaps.cartocdn.com https://demotiles.maplibre.org https://cloudflareinsights.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

function successEnvelope(data, { fetchedAt = new Date().toISOString(), stale = false, warning = null, source = { id: "whats-here", costClass: "free" } } = {}) {
  return { schemaVersion: "1.0", data, fetchedAt, stale, warning, source };
}

function errorEnvelope(code, message) {
  return { schemaVersion: "1.0", error: { code, message } };
}

function sendJson(response, status, payload, { cacheControl = "no-store" } = {}) {
  if (response.writableEnded) return;
  applySecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.end(`${JSON.stringify(payload)}\n`);
}

function readJsonBody(request, { maxBytes = DEFAULT_MAX_BODY_BYTES, required = true } = {}) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return reject(new HttpContractError("content_type_invalid", "Content-Type must be application/json", 415));
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpContractError("request_body_too_large", "Request body is too large", 413));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (size > maxBytes) return;
      if (size === 0 && !required) return resolve(null);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch { reject(new HttpContractError("request_json_invalid", "Request body must be a JSON object", 400)); }
    });
  });
}

function publicError(error) {
  if (error instanceof HttpContractError) return { status: error.status, body: errorEnvelope(error.code, error.message) };
  const code = typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code) ? error.code : "internal_error";
  const known = new Map([
    ["snapshot_pointer_missing", [503, "Approved event data is currently unavailable."]],
    ["snapshot_manifest_missing", [503, "Approved event data is currently unavailable."]],
    ["snapshot_asset_not_active", [404, "Snapshot asset was not found."]],
    ["snapshot_asset_unapproved", [404, "Snapshot asset was not found."]],
  ]);
  const [status, message] = known.get(code) ?? [500, "The request could not be completed."];
  return { status, body: errorEnvelope(code, message) };
}

function sendPublicError(response, error) {
  const mapped = publicError(error);
  sendJson(response, mapped.status, mapped.body);
}

module.exports = {
  DEFAULT_MAX_BODY_BYTES,
  HttpContractError,
  applySecurityHeaders,
  errorEnvelope,
  publicError,
  readJsonBody,
  sendJson,
  sendPublicError,
  successEnvelope,
};
